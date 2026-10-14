import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialsFromEnv } from '../lib/graylog-auth.js';

test('Graylog REST API access tokens are Basic Auth token:token', () => {
  assert.deepEqual(credentialsFromEnv({ GRAYLOG_TOKEN: 'access-token-value' }), {
    username: 'access-token-value', password: 'token'
  });
});

test('username and password remain supported as an alternative', () => {
  assert.deepEqual(credentialsFromEnv({ GRAYLOG_USER: 'reader', GRAYLOG_PASSWORD: 'secret' }), {
    username: 'reader', password: 'secret'
  });
});

test('rejects mixed, partial, or empty authentication settings', () => {
  for (const env of [
    {}, { GRAYLOG_USER: 'reader' }, { GRAYLOG_PASSWORD: 'secret' },
    { GRAYLOG_TOKEN: '' }, { GRAYLOG_TOKEN: 't', GRAYLOG_USER: 'reader' },
    { GRAYLOG_TOKEN: 't', GRAYLOG_PASSWORD: 'secret' }
  ]) assert.throws(() => credentialsFromEnv(env), /authentication|credentials/i);
});
