#!/usr/bin/env node
import { main } from '../lib/cli.js';
main(process.argv.slice(2)).catch(error => {
  process.stderr.write('Error: ' + error.message + '\n');
  process.exitCode = 1;
});
