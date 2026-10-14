// Graylog 7.1 REST access tokens are HTTP Basic username=token value,
// password=the literal string "token". Account passwords use username:password.
export function credentialsFromEnv(env) {
  const hasToken = typeof env.GRAYLOG_TOKEN === 'string' && env.GRAYLOG_TOKEN.length > 0;
  const hasUser = typeof env.GRAYLOG_USER === 'string' && env.GRAYLOG_USER.length > 0;
  const hasPassword = typeof env.GRAYLOG_PASSWORD === 'string' && env.GRAYLOG_PASSWORD.length > 0;
  if (hasToken && !hasUser && !hasPassword)
    return { username: env.GRAYLOG_TOKEN, password: 'token' };
  if (!hasToken && hasUser && hasPassword)
    return { username: env.GRAYLOG_USER, password: env.GRAYLOG_PASSWORD };
  throw new Error('Provide either GRAYLOG_TOKEN or GRAYLOG_USER and GRAYLOG_PASSWORD authentication credentials.');
}
