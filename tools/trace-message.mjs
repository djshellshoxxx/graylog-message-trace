#!/usr/bin/env node
// Backward-compatible wrapper: node tools/trace-message.mjs ARGS == graylog-trace fetch ARGS
import { main } from '../lib/cli.js';
main(process.argv.includes('--help') ? ['--help'] : ['fetch', ...process.argv.slice(2)]).catch(error => {
  process.stderr.write('Trace lookup failed: ' + error.message + '\n');
  process.exitCode = 1;
});
