// Record the maze running, as an animated GIF for the README.
//
//   node tools/capture.mjs [seconds] [outfile]
//
// NO NPM. Chrome is driven over the DevTools Protocol through node's built-in
// WebSocket -- no puppeteer, no playwright, nothing installed. The GIF is
// assembled by Pillow, which is already here for the connectome work. The point
// of the project is that it runs from a clone with nothing fetched, and a
// recording tool that needed a package tree would undercut that.
//
// Headless Chrome renders the scene through SwiftShader, so it is software
// WebGL: the frame rate is far below what a real GPU gives, and this records
// wall-clock frames rather than a fixed step. Expect a recording that looks
// slower than the game does. It is a picture of the game, not a benchmark.
//
// RECORD WITH art/ EMPTY. Whatever is hanging on the walls ends up inside the
// GIF, and the GIF goes in a public README. The gallery is meant to be the
// viewer's own pictures anyway, so an empty one is the honest advertisement.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECONDS = Number(process.argv[2]) || 8;
const OUT = process.argv[3]
  || fileURLToPath(new URL('../../../docs/maze.gif', import.meta.url));

// The BROWSER window, which is not the GIF size. The first attempt recorded at
// 640x360 and produced an unreadable picture: the HUD panels are laid out for a
// desktop window, so at that size they covered the scene completely and the
// canvas was left 449x190 behind them. Record big, scale down after.
const WIDTH = 1280;
const HEIGHT = 720;
const GIF_WIDTH = 640;   // what actually goes in the README
const FPS = 10;
const SERVE_PORT = 8391;
const CDP_PORT = 9393;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChrome() {
  const { access } = await import('node:fs/promises');
  for (const p of CHROME) {
    try {
      await access(p);
      return p;
    } catch { /* next */ }
  }
  throw new Error('no Chrome or Edge found; edit CHROME in tools/capture.mjs');
}

/** Minimal CDP client: send a command, await its reply, subscribe to events. */
function cdp(ws) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    const fn = listeners.get(msg.method);
    if (fn) fn(msg.params);
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) { listeners.set(method, fn); },
  };
}

const root = fileURLToPath(new URL('..', import.meta.url));

console.log(`recording ${SECONDS}s at ${WIDTH}x${HEIGHT}, ${FPS} fps`);

// --- the game's own server, so this records exactly what a visitor loads ----
const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(SERVE_PORT)],
  { stdio: 'ignore' });
await sleep(1200);

const chromePath = await findChrome();
const profile = await mkdtemp(join(tmpdir(), 'walker-cap-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  // Real GPU if the machine has one. SwiftShader managed 0.6 fps on this scene
  // -- 878 instanced wall segments under a 2048px soft shadow map is simply
  // more than software rasterisation will do. Falls back on its own if there
  // is no device, and --enable-unsafe-swiftshader keeps that path working.
  '--use-angle=default',
  '--enable-unsafe-swiftshader',
  // Headless treats the page as occluded and throttles requestAnimationFrame,
  // which held the capture at 4 fps no matter how cheap the frames were made.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${CDP_PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  `http://localhost:${SERVE_PORT}/`,
], { stdio: 'ignore' });

const frameDir = await mkdtemp(join(tmpdir(), 'walker-frames-'));
let code = 0;

try {
  // Wait for the debugging endpoint, then find the page target.
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome never exposed a page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  const c = cdp(ws);
  await c.send('Page.enable');

  // Let the scene build, the textures settle and the character start walking.
  // Recording from frame zero gets a grey canvas and a standing start.
  console.log('  warming up...');
  await sleep(5000);

  // H hides the overlays. The HUD is the point of the app and not of the GIF --
  // a README wants the maze, not eleven readouts over it.
  const key = async (type, k, code, vk) => c.send('Input.dispatchKeyEvent', {
    type, key: k, code, windowsVirtualKeyCode: vk, text: type === 'keyDown' ? k : undefined,
  });
  await key('keyDown', 'h', 'KeyH', 72);
  await key('keyUp', 'h', 'KeyH', 72);
  await sleep(1200);

  // C cycles the camera. Two presses lands on the over-the-shoulder shot, which
  // is the one that reads as a game: the character from behind, the corridor
  // ahead, the flies in frame. The opening view is the whole maze from above --
  // handsome, but at 640 px the character in it is four pixels tall.
  for (let i = 0; i < 2; i++) {
    await key('keyDown', 'c', 'KeyC', 67);
    await key('keyUp', 'c', 'KeyC', 67);
    await sleep(900);
  }
  await sleep(1200);

  const frames = [];
  const minGap = 1000 / FPS;
  let last = 0;

  c.on('Page.screencastFrame', async (p) => {
    const now = Date.now();
    if (now - last >= minGap) {
      last = now;
      frames.push(Buffer.from(p.data, 'base64'));
    }
    try { await c.send('Page.screencastFrameAck', { sessionId: p.sessionId }); } catch { /* closing */ }
  });

  await c.send('Page.startScreencast', {
    format: 'jpeg', quality: 70, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1,
  });
  console.log('  recording...');
  await sleep(SECONDS * 1000);
  await c.send('Page.stopScreencast');
  ws.close();

  if (!frames.length) throw new Error('no frames captured');
  const realFps = frames.length / SECONDS;
  console.log(`  captured ${frames.length} frames (${realFps.toFixed(1)} fps actual)`);

  for (let i = 0; i < frames.length; i++) {
    await writeFile(join(frameDir, `f${String(i).padStart(4, '0')}.jpg`), frames[i]);
  }

  // --- Pillow does the encoding -------------------------------------------
  const py = `
import glob, os
from PIL import Image
files = sorted(glob.glob(os.path.join(r"${frameDir}", "*.jpg")))
ims = [Image.open(f).convert("RGB") for f in files]
w, h = ims[0].size
scale = ${GIF_WIDTH} / w
ims = [im.resize((${GIF_WIDTH}, round(h * scale)), Image.LANCZOS) for im in ims]
# Adaptive palette per frame would shimmer; one palette from the middle frame
# keeps the walls from crawling between frames.
pal = ims[len(ims)//2].quantize(colors=96, method=Image.MEDIANCUT)
qs = [im.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for im in ims]
qs[0].save(r"${OUT}", save_all=True, append_images=qs[1:],
           duration=${Math.round(1000 / FPS)}, loop=0, optimize=True)
print("  wrote", r"${OUT}", round(os.path.getsize(r"${OUT}")/1048576, 2), "MB")
`;
  await new Promise((res, rej) => {
    const p = spawn('python', ['-c', py], { stdio: 'inherit' });
    p.on('exit', (x) => (x === 0 ? res() : rej(new Error(`pillow exited ${x}`))));
  });
} catch (err) {
  console.error('capture failed:', err.message);
  code = 1;
} finally {
  chrome.kill();
  server.kill();
  await rm(frameDir, { recursive: true, force: true }).catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

process.exit(code);
