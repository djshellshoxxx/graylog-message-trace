import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchGraylogTrace } from './graylog-api.js';
import { credentialsFromEnv } from './graylog-auth.js';
import { loadAssets } from './assets.js';
import { createViewerServer } from './server.js';

export const VERSION = '0.2.0';

export function parseArgs(argv, flags, valued) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (flags.includes(key)) {
      if (values[key]) throw new Error('Duplicate argument: ' + key);
      values[key] = true;
    } else if (valued.includes(key)) {
      if (values[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error('Missing value or duplicate argument: ' + key);
      values[key] = argv[++i];
    } else throw new Error('Unknown argument: ' + key);
  }
  return values;
}

export const USAGE = `graylog-trace ${VERSION} — read-only Graylog message trace viewer
Usage:
  graylog-trace serve [--port N]   Start the local viewer on 127.0.0.1 (default port 8080).
  graylog-trace fetch --url URL --index INDEX --id MESSAGE_ID [--out FILE] [--allow-http]
  graylog-trace --version | --help
Credentials (environment only): GRAYLOG_TOKEN, or GRAYLOG_USER plus GRAYLOG_PASSWORD.
Set GRAYLOG_URL (and optionally GRAYLOG_ALLOW_HTTP=1) to enable live lookup inside the viewer.
Existing output files are never overwritten. Output may contain sensitive log data.`;

export async function runFetch(argv, { env = process.env, out = process.stdout, fetchTrace = fetchGraylogTrace } = {}) {
  const opts = parseArgs(argv, ['--allow-http'], ['--url', '--index', '--id', '--out']);
  if (!opts['--url'] || !opts['--index'] || !opts['--id']) throw new Error('Provide --url, --index and --id. Use --help for usage.');
  const trace = await fetchTrace({ baseUrl: opts['--url'], index: opts['--index'], id: opts['--id'],
    ...credentialsFromEnv(env), allowHttp: Boolean(opts['--allow-http']) });
  const json = JSON.stringify(trace, null, 2) + '\n';
  if (opts['--out'] && opts['--out'] !== '-') {
    await writeFile(opts['--out'], json, { flag: 'wx', mode: 0o600 });
    out.write('Trace saved to ' + opts['--out'] + '\n');
  } else out.write(json);
}

export async function runServe(argv, { env = process.env, out = process.stdout, webDir } = {}) {
  const opts = parseArgs(argv, [], ['--port']);
  const port = opts['--port'] === undefined ? 8080 : Number(opts['--port']);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0-65535.');
  const viewer = createViewerServer({
    assets: await loadAssets(webDir ?? (globalThis.__MT_ASSETS__ ? '' : fileURLToPath(new URL('../web', import.meta.url)))), port,
    graylog: env.GRAYLOG_URL ? { baseUrl: env.GRAYLOG_URL, allowHttp: env.GRAYLOG_ALLOW_HTTP === '1', env } : null
  });
  const actual = await viewer.listen();
  out.write(`Viewer: http://localhost:${actual}  (live lookup ${viewer.lookupEnabled ? 'ENABLED' : 'disabled; set GRAYLOG_URL'})\nPress Ctrl+C to stop.\n`);
  return viewer;
}

export async function main(argv, io = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return (io.out ?? process.stdout).write(USAGE + '\n');
  if (command === '--version') return (io.out ?? process.stdout).write(VERSION + '\n');
  if (command === 'fetch') return runFetch(rest, io);
  if (command === 'serve') return runServe(rest, io);
  throw new Error('Unknown command: ' + command + '. Use --help.');
}
