import { validateTrace } from '../web/trace.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const INDEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;

function identity(index, id) {
  if (typeof index !== 'string' || !INDEX.test(index) || index === '..' ||
      typeof id !== 'string' || !ID.test(id) || id === '..')
    throw new Error('A valid physical index and message ID are required.');
}

// Keep API requests on the configured Graylog origin, including reverse-proxy prefixes.
export function buildMessageUrl(baseUrl, index, id, { allowHttp = false } = {}) {
  identity(index, id);
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error('Invalid Graylog base URL.'); }
  if (base.username || base.password || base.search || base.hash)
    throw new Error('Graylog URL must not contain credentials, query or fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && (loopback || allowHttp)))
    throw new Error('HTTPS is required unless HTTP is explicitly permitted.');
  let prefix = base.pathname.replace(/\/+$/, '');
  if (!prefix.endsWith('/api')) prefix += '/api';
  return base.origin + prefix + '/messages/' + encodeURIComponent(index) + '/' + encodeURIComponent(id);
}

// Interpret the single-message ResultMessage payload as stored facts only.
// This function MUST NOT synthesize original processing or stream-routing events.
export function normalizeMessage(result, index, id) {
  identity(index, id);
  if (!isRecord(result) || !isRecord(result.message) || !isRecord(result.message.fields ?? result.message))
    throw new Error('Graylog returned an invalid single-message response.');
  if (result.index !== undefined && result.index !== null && result.index !== index)
    throw new Error('Graylog response index differs from the requested index.');
  if (result.message.id !== undefined && result.message.id !== id)
    throw new Error('Graylog response message ID differs from the requested ID.');
  const fields = result.message.fields ?? result.message;
  if (fields.id !== undefined && fields.id !== id)
    throw new Error('Graylog response message ID differs from the requested ID.');
  const steps = [
    { label: 'Stored final message document', provenance: 'OBSERVED' },
    { label: 'Physical index: ' + index, provenance: 'OBSERVED' }
  ];
  if (typeof fields.gl2_source_input === 'string' && fields.gl2_source_input)
    steps.push({ label: 'Stored input ID: ' + fields.gl2_source_input, provenance: 'OBSERVED' });
  if (Array.isArray(fields.streams))
    steps.push({ label: 'Stored final stream IDs (not routing history)', provenance: 'OBSERVED' });
  return validateTrace({
    schema_version: 1,
    message: { index, id, fields },
    capture: { complete: false },
    steps
  });
}

async function readLimited(response, maxBytes) {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes)
    throw new Error('Graylog response exceeds size limit.');
  if (!response.body?.getReader) {
    const content = await response.text();
    if (Buffer.byteLength(content) > maxBytes) throw new Error('Graylog response exceeds size limit.');
    return content;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, result = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Graylog response exceeds size limit.');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

// The server enforces its own message and stream ACLs before returning the document.
// No search fallback, broad query, or privileged backend access is attempted.
export async function fetchGraylogTrace({
  baseUrl, index, id, username, password, allowHttp = false,
  maxBytes = 5 * 1024 * 1024, fetchImpl = globalThis.fetch
}) {
  const url = buildMessageUrl(baseUrl, index, id, { allowHttp });
  if (typeof username !== 'string' || !username || /[:\r\n]/.test(username) ||
      typeof password !== 'string' || !password || /[\r\n]/.test(password))
    throw new Error('Graylog username and password/token must be provided.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5 * 1024 * 1024)
    throw new Error('Response size limit must be 1 byte through 5 MiB.');
  const authorization = 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
  const response = await fetchImpl(url, {
    method: 'GET', headers: { Accept: 'application/json', Authorization: authorization },
    redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Graylog message lookup failed (HTTP ' + response.status + ').');
  let result;
  try { result = JSON.parse(await readLimited(response, maxBytes)); }
  catch (error) {
    if (/size limit/.test(error.message)) throw error;
    throw new Error('Graylog returned malformed JSON.');
  }
  return normalizeMessage(result, index, id);
}
