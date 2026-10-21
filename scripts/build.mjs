// Builds a single-file executable (Node SEA) for the CURRENT platform:
//   node scripts/build.mjs [--target NAME]  ->  dist/graylog-trace-NAME[.exe]
// Requires devDependencies (esbuild, postject). Web assets are embedded.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const platform = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform];
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : `${platform}-${process.arch}`;
const exe = join(dist, `graylog-trace-${target}${process.platform === 'win32' ? '.exe' : ''}`);

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const assets = {};
for (const file of files(join(root, 'web')).sort())
  assets[relative(join(root, 'web'), file).split('\\').join('/')] = readFileSync(file).toString('base64');
await build({
  entryPoints: [join(root, 'tools/graylog-trace.mjs')], bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', outfile: join(dist, 'bundle.cjs'), logLevel: 'warning',
  banner: { js: `globalThis.__MT_ASSETS__=${JSON.stringify(assets)};` }
});
writeFileSync(join(dist, 'sea-config.json'), JSON.stringify({
  main: join(dist, 'bundle.cjs'), output: join(dist, 'sea.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', join(dist, 'sea-config.json')], { stdio: 'inherit' });
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
const postject = join(createRequire(import.meta.url).resolve('postject/package.json'), '..', 'dist', 'cli.js');
const injectArgs = [postject, exe, 'NODE_SEA_BLOB', join(dist, 'sea.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') injectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, injectArgs, { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });
console.log('Built ' + exe);
