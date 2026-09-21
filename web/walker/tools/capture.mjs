// Record one camera of the maze as an animated GIF.
//
//   node tools/capture.mjs <mode> [seconds] [outfile]
//   node tools/capture.mjs shoulder
//   node tools/capture.mjs all            # free, shoulder and pov, one file each
//
// Modes: free, follow, shoulder, pov, duel, top.
//
// NO NPM. Chrome is driven over the DevTools Protocol through node's built-in
// WebSocket -- no puppeteer, no playwright, nothing installed. The GIF is
// assembled by Pillow, which is already here for the connectome work. The point
// of the project is that it runs from a clone with nothing fetched, and a
// recording tool that needed a package tree would undercut that.
//
// IT RECORDS LONG AND KEEPS THE BEST BIT. The character goes where its own
// circuitry sends it, so a fixed window is a lottery -- the first POV recording
// spent seven seconds facing a blank wall, because pictures hang on the curved
// walls and walking a corridor points you at the flat ones. So it records for
// RECORD_SECS, scores every frame for how much framed artwork is in shot, and
// keeps the best contiguous KEEP_SECS. That turns "hope it looks good" into
// "keep the part that does".
//
// MIND WHAT IS ON THE WALLS. Whatever is hanging ends up inside the GIF, and
// the GIF goes in a public README. Record with art/ holding pictures you are
// willing to publish -- the placeholder set, not a personal gallery.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// C only switches free->follow the first time it is pressed, and cycles the
// shot after that. See the key handler in main.js; these counts follow from it.
const MODES = {
  free: { presses: 0, label: 'FREE VIEW \u2014 the whole maze' },
  follow: { presses: 1, label: 'FOLLOW \u2014 behind and above' },
  shoulder: { presses: 2, label: 'OVER THE SHOULDER \u2014 hunting' },
  pov: { presses: 3, label: 'POV \u2014 100 degrees horizontal' },
  duel: { presses: 4, label: 'DUEL \u2014 framed on the target' },
  top: { presses: 5, label: 'TOP \u2014 straight down' },
};

const argMode = (process.argv[2] || 'shoulder').toLowerCase();
const RECORD_SECS = Number(process.argv[3]) || 14;
const KEEP_SECS = 5;

const WIDTH = 1280;      // the browser window. The HUD is laid out for a desktop
const HEIGHT = 720;      // size; recording small buries the scene behind it.
const GIF_WIDTH = 560;   // three of these go in one README
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
const root = fileURLToPath(new URL('..', import.meta.url));
const docs = fileURLToPath(new URL('../../../docs/', import.meta.url));

async function findChrome() {
  for (const p of CHROME) {
    try { await access(p); return p; } catch { /* next */ }
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

async function recordOne(c, mode, outFile) {
  const spec = MODES[mode];
  const key = (type, k, code, vk) => c.send('Input.dispatchKeyEvent', {
    type, key: k, code, windowsVirtualKeyCode: vk, text: type === 'keyDown' ? k : undefined,
  });
  const press = async (k, code, vk) => {
    await key('keyDown', k, code, vk);
    await key('keyUp', k, code, vk);
    await sleep(700);
  };

  // SET THE CAMERA BY CLICKING ITS BUTTON, not by counting C presses. Counting
  // drifts: C cycles from wherever the camera already is, R does not reset it,
  // and a batch run therefore carried state between modes -- the GIF labelled
  // POV came out showing the top-down view, three shots further round the cycle
  // than intended. The HUD has button.vm[data-mode] and button.shot[data-shot],
  // and #r-cam reports what is actually selected, so ask for the mode and then
  // check it was given.
  const want = mode;
  await c.send('Runtime.evaluate', {
    expression: `(() => {
      const vm = (m) => document.querySelector('button.vm[data-mode="' + m + '"]');
      const shot = (sname) => document.querySelector('button.shot[data-shot="' + sname + '"]');
      if (${JSON.stringify(mode)} === 'free') { vm('free') && vm('free').click(); return; }
      vm('follow') && vm('follow').click();
      const b = shot(${JSON.stringify(mode)});
      if (b) b.click();
    })()`,
  });
  await sleep(1200);

  const cam = await c.send('Runtime.evaluate', {
    returnByValue: true,
    expression: "(document.getElementById('r-cam') || {}).textContent || '?'",
  });
  const got = String(cam.result?.value || '').trim().toLowerCase();
  if (!got.includes(want)) {
    console.log(`  ${mode}: WARNING readout says "${got}"`);
  }
  await sleep(3000);

  // H TOGGLES the overlays -- it does not hide them. Pressing it once per mode
  // left every second GIF with the whole HUD across the scene, because the
  // previous mode had already hidden it. Assert the state instead of assuming:
  // main.js puts `bare` on <body>, so press until that is what is there.
  for (let i = 0; i < 3; i++) {
    const r = await c.send('Runtime.evaluate', {
      returnByValue: true,
      expression: "document.body.classList.contains('bare')",
    });
    if (r.result?.value === true) break;
    await press('h', 'KeyH', 72);
  }

  await sleep(1500);

  const frames = [];
  const minGap = 1000 / FPS;
  let last = 0;
  let collecting = true;
  c.on('Page.screencastFrame', async (p) => {
    const now = Date.now();
    if (collecting && now - last >= minGap) {
      last = now;
      frames.push(Buffer.from(p.data, 'base64'));
    }
    try { await c.send('Page.screencastFrameAck', { sessionId: p.sessionId }); } catch { /* closing */ }
  });

  await c.send('Page.startScreencast', {
    format: 'jpeg', quality: 72, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1,
  });
  console.log(`  ${mode}: recording ${RECORD_SECS}s`);
  await sleep(RECORD_SECS * 1000);
  collecting = false;
  await c.send('Page.stopScreencast');

  if (!frames.length) throw new Error(`${mode}: no frames captured`);

  const frameDir = await mkdtemp(join(tmpdir(), `walker-${mode}-`));
  for (let i = 0; i < frames.length; i++) {
    await writeFile(join(frameDir, `f${String(i).padStart(4, '0')}.jpg`), frames[i]);
  }
  await writeFile(join(frameDir, 'label.txt'), spec.label, 'utf8');

  const keep = Math.max(6, Math.round(KEEP_SECS * (frames.length / RECORD_SECS)));
  const py = `
import glob, os
from PIL import Image, ImageDraw, ImageFont

# Hoisted out of the f-strings below: a Windows path is full of backslashes
# and an f-string expression cannot contain one before Python 3.12.
OUT_PATH = r"${outFile}"
files = sorted(glob.glob(os.path.join(r"${frameDir}", "*.jpg")))
ims = [Image.open(f).convert("RGB") for f in files]
# UTF-8 explicitly: the em dash came back as mojibake through the Windows
# locale codec when this was left to the default.
label = open(os.path.join(r"${frameDir}", "label.txt"), encoding="utf-8").read()


def picture_score(im):
    """How much framed artwork is in shot.

    The maze is white walls, green floor and sky, and the character is orange.
    A saturated pixel that is none of those is almost certainly a picture.
    """
    sm = im.resize((160, 90))
    n = 0
    for r, g, b in sm.getdata():
        mx, mn = max(r, g, b), min(r, g, b)
        if mx <= 60 or (mx - mn) / (mx or 1) <= 0.32:
            continue
        if g > r + 18 and g > b + 18:            # floor
            continue
        if b > 170 and b > r + 25 and g > 140:   # sky
            continue
        if r > 150 and g > 110 and b < 110:      # the character's shirt
            continue
        n += 1
    return n


scores = [picture_score(im) for im in ims]
keep = min(${keep}, len(ims))
best, best_i = -1, 0
for i in range(0, len(ims) - keep + 1):
    s = sum(scores[i:i + keep])
    if s > best:
        best, best_i = s, i
ims = ims[best_i:best_i + keep]
print(f"    best window: frames {best_i}-{best_i + keep} of {len(scores)}, score {best}")

w, h = ims[0].size
ims = [im.resize((${GIF_WIDTH}, round(h * ${GIF_WIDTH} / w)), Image.LANCZOS) for im in ims]

try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 15)
except Exception:
    font = ImageFont.load_default()

for im in ims:
    d = ImageDraw.Draw(im, "RGBA")
    box = d.textbbox((0, 0), label, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad, m = 8, 12
    y0 = im.height - th - pad * 2 - m
    d.rounded_rectangle([m, y0, m + tw + pad * 2, y0 + th + pad * 2],
                        radius=5, fill=(14, 16, 20, 190))
    d.text((m + pad - box[0], y0 + pad - box[1]), label, font=font,
           fill=(245, 245, 245, 255))

# One palette for the whole clip. Per-frame adaptive palettes make the walls
# crawl between frames.
pal = ims[len(ims) // 2].quantize(colors=96, method=Image.MEDIANCUT)
qs = [im.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for im in ims]
qs[0].save(OUT_PATH, save_all=True, append_images=qs[1:],
           duration=${Math.round(1000 / FPS)}, loop=0, optimize=True)
name = os.path.basename(OUT_PATH)
mb = round(os.path.getsize(OUT_PATH) / 1048576, 2)
print(f"    wrote {name}  {mb} MB, {len(qs)} frames")
`;
  await new Promise((res, rej) => {
    const p = spawn('python', ['-c', py], { stdio: 'inherit' });
    p.on('exit', (x) => (x === 0 ? res() : rej(new Error(`pillow exited ${x}`))));
  });
  await rm(frameDir, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------

const wanted = argMode === 'all' ? ['free', 'shoulder', 'pov'] : [argMode];
for (const m of wanted) {
  if (!MODES[m]) throw new Error(`unknown mode "${m}"; try ${Object.keys(MODES).join(', ')}`);
}

const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(SERVE_PORT)],
  { stdio: 'ignore' });
await sleep(1300);

const chromePath = await findChrome();
const profile = await mkdtemp(join(tmpdir(), 'walker-cap-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  // Real GPU where there is one. SwiftShader managed 0.6 fps on this scene --
  // 878 instanced wall segments under a 2048 px soft shadow map is more than
  // software rasterisation will do.
  '--use-angle=default',
  '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--hide-scrollbars', '--mute-audio', '--no-first-run',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${CDP_PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  `http://localhost:${SERVE_PORT}/`,
], { stdio: 'ignore' });

let code = 0;
try {
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
  await c.send('Runtime.enable');

  console.log('  warming up...');
  await sleep(6000);

  for (const m of wanted) {
    const out = process.argv[4] || join(docs, `cam-${m}.gif`);
    await recordOne(c, m, out);
  }
  ws.close();
} catch (err) {
  console.error('capture failed:', err.message);
  code = 1;
} finally {
  chrome.kill();
  server.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

process.exit(code);
