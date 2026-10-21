import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export const typeOf = path => TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream';

// Assets are a Map of '/path' -> { type, body: Buffer }. Embedded builds supply
// globalThis.__MT_ASSETS__ (path -> base64); development reads web/ from disk.
export async function loadAssets(webDir) {
  const assets = new Map();
  const embedded = globalThis.__MT_ASSETS__;
  if (embedded) {
    for (const [path, b64] of Object.entries(embedded))
      assets.set('/' + path, { type: typeOf(path), body: Buffer.from(b64, 'base64') });
    return assets;
  }
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel + '/');
      else assets.set('/' + rel, { type: typeOf(rel), body: await readFile(join(dir, entry.name)) });
    }
  };
  await walk(webDir, '');
  return assets;
}
