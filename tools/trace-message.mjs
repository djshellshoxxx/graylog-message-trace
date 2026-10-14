#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { fetchGraylogTrace } from '../lib/graylog-api.js';
import { credentialsFromEnv } from '../lib/graylog-auth.js';

function argumentsFrom(argv) {
  const values = {};
  const names = new Set(['--url', '--index', '--id', '--out']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '--allow-http') {
      if (values[key]) throw new Error('Duplicate argument: ' + key);
      values[key] = true;
    } else if (names.has(key)) {
      if (values[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error('Missing value or duplicate argument: ' + key);
      values[key] = argv[++i];
    } else throw new Error('Unknown argument: ' + key);
  }
  return values;
}

const usage = `Read one authorized Graylog message and export stored evidence (no replay).
Usage: node tools/trace-message.mjs --url https://graylog.example/api --index INDEX --id MESSAGE_ID [--out trace.json] [--allow-http]
Credentials: GRAYLOG_TOKEN (preferred), or GRAYLOG_USER plus GRAYLOG_PASSWORD.
--allow-http is only for explicitly authorized HTTP endpoints on trusted networks.
Without --out, JSON goes to stdout. Existing output files are never overwritten.`;

try {
  const opts = argumentsFrom(process.argv.slice(2));
  if (opts['--help']) {
    process.stdout.write(usage + '\n');
    process.exit(0);
  }
  if (!opts['--url'] || !opts['--index'] || !opts['--id'])
    throw new Error('Provide --url, --index and --id. Use --help for usage.');
  const credentials = credentialsFromEnv(process.env);
  const trace = await fetchGraylogTrace({
    baseUrl: opts['--url'], index: opts['--index'], id: opts['--id'],
    ...credentials,
    allowHttp: Boolean(opts['--allow-http'])
  });
  const json = JSON.stringify(trace, null, 2) + '\n';
  if (opts['--out'] && opts['--out'] !== '-') {
    await writeFile(opts['--out'], json, { flag: 'wx', mode: 0o600 });
    process.stdout.write('Trace saved to ' + opts['--out'] + '\n');
  } else process.stdout.write(json);
} catch (error) {
  process.stderr.write('Trace lookup failed: ' + error.message + '\n');
  process.exitCode = 1;
}
