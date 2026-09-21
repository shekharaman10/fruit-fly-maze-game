// Zero-dependency static server. No npm install, nothing to audit.
//   node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: this project lives under a path with spaces
// in it, and .pathname hands back percent-encoded text.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    // Resolve, then refuse anything that escaped the root. Simpler to reason
    // about than stripping traversal sequences by pattern.
    const file = resolve(join(ROOT, p));
    const rootAbs = resolve(ROOT);
    if (file !== rootAbs && !file.startsWith(rootAbs + sep)) throw new Error('outside root');
    const s = await stat(file);
    if (s.isDirectory()) throw new Error('dir');
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
}).listen(PORT, async () => {
  // Rebuild the gallery from whatever is in art/ right now, so adding a picture
  // is "drop the file in, restart, refresh" and never "remember to run a tool".
  // The art folder and its manifest are both gitignored; see art/README.md.
  try {
    const { buildManifest } = await import('./artManifest.mjs');
    const n = await buildManifest({ quiet: true });
    console.log(`gallery: ${n} picture${n === 1 ? '' : 's'} in art/`);
  } catch (err) {
    console.log(`gallery: could not build the manifest (${err.message})`);
  }
  console.log(`walker: http://localhost:${PORT}/`);
});
