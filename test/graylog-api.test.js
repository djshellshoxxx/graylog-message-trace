import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageUrl, normalizeMessage, fetchGraylogTrace } from '../lib/graylog-api.js';

const message = { index: 'graylog_42', message: { id: 'abc-123', message: 'hello', gl2_source_input: 'input-1', streams: ['stream-a'], count: 7 } };

test('builds the Graylog 7.1.3 canonical message endpoint, preserving an API subpath', () => {
  assert.equal(buildMessageUrl('https://logs.example.org/graylog/api/', 'graylog_42', 'abc-123'),
    'https://logs.example.org/graylog/api/messages/graylog_42/abc-123');
  assert.equal(buildMessageUrl('https://logs.example.org/graylog', 'graylog_42', 'abc-123'),
    'https://logs.example.org/graylog/api/messages/graylog_42/abc-123');
});

test('rejects unsafe URL shapes, credentials in the URL, and invalid identity', () => {
  for (const url of ['http://logs.example.org', 'https://user:pass@logs.example.org',
    'https://logs.example.org/api?token=secret', 'file:///tmp/api', 'https://logs.example.org/#x'])
    assert.throws(() => buildMessageUrl(url, 'graylog_42', 'abc-123'));
  for (const id of ['../secret', '..', 'id/other', ''])
    assert.throws(() => buildMessageUrl('https://logs.example.org', 'graylog_42', id));
  assert.match(buildMessageUrl('http://127.0.0.1:9000', 'graylog_42', 'abc-123'), /http:/);
  assert.match(buildMessageUrl('http://192.168.3.78:9000', 'graylog_42', 'abc-123', { allowHttp: true }), /http:/);
});

test('normalizes only persisted facts without pretending to know original execution', () => {
  const trace = normalizeMessage(message, 'graylog_42', 'abc-123');
  assert.equal(trace.schema_version, 1);
  assert.deepEqual(trace.message.fields.streams, ['stream-a']);
  assert.equal(trace.message.fields.count, 7);
  assert.ok(trace.steps.every(s => s.provenance === 'OBSERVED'));
  assert.equal(trace.capture.complete, false);
  assert.ok(!trace.steps.some(s => /pipeline|rule executed|replay/i.test(s.label)));
  trace.message.fields.streams.push('tamper');
  assert.deepEqual(message.message.streams, ['stream-a']);
});

test('rejects response identity mismatches rather than relabeling another message', () => {
  assert.throws(() => normalizeMessage({ ...message, index: 'other' }, 'graylog_42', 'abc-123'));
  assert.throws(() => normalizeMessage({ ...message, message: { ...message.message, id: 'different' } }, 'graylog_42', 'abc-123'));
  assert.throws(() => normalizeMessage({ index: 'graylog_42', message: null }, 'graylog_42', 'abc-123'));
});

test('performs one authenticated GET with redirect rejection and never includes credentials in output', async () => {
  let called = 0;
  const trace = await fetchGraylogTrace({
    baseUrl: 'https://logs.example.org', index: 'graylog_42', id: 'abc-123',
    username: 'admin', password: 'top-secret',
    fetchImpl: async (url, init) => {
      called++;
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('admin:top-secret').toString('base64'));
      assert.match(url, /\/api\/messages\/graylog_42\/abc-123$/);
      return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(called, 1);
  assert.doesNotMatch(JSON.stringify(trace), /top-secret|Authorization/);
});

test('propagates safe HTTP status diagnostics without leaking server body', async () => {
  for (const status of [401, 403, 404, 500]) {
    await assert.rejects(fetchGraylogTrace({
      baseUrl: 'https://logs.example.org', index: 'graylog_42', id: 'abc-123',
      username: 'read', password: 'password',
      fetchImpl: async () => new Response('secret backend detail', { status })
    }), error => error.message.includes(String(status)) && !error.message.includes('secret backend detail'));
  }
});

test('rejects unexpectedly large responses with an enforced byte limit', async () => {
  const huge = 'x'.repeat(7000);
  await assert.rejects(fetchGraylogTrace({
    baseUrl: 'https://logs.example.org', index: 'graylog_42', id: 'abc-123',
    username: 'read', password: 'password', maxBytes: 1024,
    fetchImpl: async () => new Response(huge, { status: 200 })
  }), /size limit/i);
});

test('rejects a mismatched wrapper ID even if stored field map has no ID', () => {
  assert.throws(() => normalizeMessage({
    index: 'graylog_42',
    message: { id: 'different', fields: { message: 'hello' } }
  }, 'graylog_42', 'abc-123'), /differs/);
});

test('supports the field-map shape returned by Graylog Message getters', () => {
  const trace = normalizeMessage({
    index: 'graylog_42',
    message: { id: 'abc-123', fields: { message: 'hello', count: 7 } }
  }, 'graylog_42', 'abc-123');
  assert.equal(trace.message.fields.count, 7);
  assert.equal(trace.message.fields.message, 'hello');
});
