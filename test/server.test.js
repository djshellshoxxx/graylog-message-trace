import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerServer } from '../lib/server.js';
import { loadAssets } from '../lib/assets.js';
import { parseArgs } from '../lib/cli.js';

const assets = await loadAssets(new URL('../web', import.meta.url).pathname);
const env = { GRAYLOG_TOKEN: 'secret' };
const fetchTrace = async ({ index, id, username }) => {
  if (id === 'bad') throw new Error('Graylog message lookup failed (HTTP 404).');
  return { schema_version: 1, index, id, seen: username };
};
async function withServer(graylog, fn) {
  const v = createViewerServer({ assets, graylog, fetchTrace, port: 0 });
  const port = await v.listen();
  try { await fn(`http://127.0.0.1:${port}`, port); } finally { await v.close(); }
}
const post = (base, body, headers = {}) => fetch(base + '/lookup', { method: 'POST',
  headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('serves viewer with security headers; rejects foreign Host', async () => {
  await withServer(null, async (base, port) => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/../package.json')).status, 404);
    const { request } = await import('node:http');
    const status = await new Promise(res => request({ host: '127.0.0.1', port, path: '/', headers: { host: 'evil.example' } }, r2 => { r2.resume(); res(r2.statusCode); }).end());
    assert.equal(status, 403);
  });
});

test('lookup disabled without GRAYLOG_URL', async () => {
  await withServer(null, async base => assert.equal((await post(base, { index: 'a', id: 'b' })).status, 404));
});

test('lookup uses server-side credentials and refuses cross-origin', async () => {
  await withServer({ baseUrl: 'https://g.example/api', env }, async base => {
    const ok = await post(base, { index: 'i', id: 'x' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.seen, 'secret');
    assert.equal((await post(base, { index: 'i', id: 'x' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(base, { index: 'i', id: 'bad' })).status, 502);
    const wrongType = await fetch(base + '/lookup', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
  });
});

test('parseArgs rejects unknown and duplicate arguments', () => {
  assert.throws(() => parseArgs(['--x'], [], []), /Unknown/);
  assert.throws(() => parseArgs(['--a', '1', '--a', '2'], [], ['--a']), /duplicate/i);
  assert.deepEqual(parseArgs(['--a', '1', '--f'], ['--f'], ['--a']), { '--a': '1', '--f': true });
});
