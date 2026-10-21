import http from 'node:http';
import { fetchGraylogTrace } from './graylog-api.js';
import { credentialsFromEnv } from './graylog-auth.js';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const BASE_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };

// Local viewer server. Loopback only; the Graylog URL and credentials are fixed
// at startup from the environment so the browser can never choose a target host.
export function createViewerServer({ assets, graylog, fetchTrace = fetchGraylogTrace, port }) {
  let lookupConfig = null;
  if (graylog?.baseUrl) lookupConfig = { baseUrl: graylog.baseUrl, allowHttp: Boolean(graylog.allowHttp), credentials: credentialsFromEnv(graylog.env ?? {}) };

  const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
  // Defeats DNS rebinding: only accept loopback Host names on our own port.
  const hostOk = (req, actualPort) => {
    const host = String(req.headers.host ?? '');
    return [`localhost:${actualPort}`, `127.0.0.1:${actualPort}`, `[::1]:${actualPort}`].includes(host.toLowerCase());
  };

  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      if (!hostOk(req, actualPort)) return send(res, 403, 'Forbidden host');
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health')
        return json(res, 200, { ok: true, lookup: Boolean(lookupConfig) });
      if (req.method === 'POST' && path === '/lookup') {
        if (!lookupConfig) return json(res, 404, { error: 'Live lookup is not configured (set GRAYLOG_URL).' });
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin request refused.' });
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'Expected application/json.' });
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 4096) return json(res, 413, { error: 'Request too large.' }); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'Malformed JSON.' }); }
        try {
          const trace = await fetchTrace({ baseUrl: lookupConfig.baseUrl, index: body?.index, id: body?.id, allowHttp: lookupConfig.allowHttp, ...lookupConfig.credentials });
          return json(res, 200, trace);
        } catch (error) { return json(res, 502, { error: error.message }); }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      const asset = assets.get(path === '/' ? '/index.html' : path);
      if (!asset) return send(res, 404, 'Not found');
      res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': asset.type });
      res.end(req.method === 'HEAD' ? undefined : asset.body);
    } catch { send(res, 500, 'Internal error'); }
  });
  return {
    server,
    lookupEnabled: Boolean(lookupConfig),
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port ?? 0, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => new Promise(resolve => server.close(resolve))
  };
}
