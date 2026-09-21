// Every named import in the browser entry points must actually be exported.
//
//   node tools/imports.mjs
//
// main.js only runs in a browser, so a missing export there is invisible to the
// node tests and shows up as a blank page. That happened once already:
// `wallSegments` was used in main.js while the import line still listed the old
// set, and nothing caught it until the page was loaded.

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRIES = ['../main.js', '../world/player.js', '../render/hud.js'];

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

let failures = 0;
console.log('');

for (const entry of ENTRIES) {
  const path = resolve(HERE, entry);
  const src = await readFile(path, 'utf8');
  const rel = entry.replace('../', '');

  for (const m of src.matchAll(IMPORT_RE)) {
    const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    // The vendored OrbitControls imports the bare specifier "three", which only
    // the browser import map resolves. node cannot load it, and that is not a
    // fault in this project.
    if (spec.includes('OrbitControls')) continue;

    const target = resolve(dirname(path), spec);
    let mod;
    try {
      mod = await import(pathToFileURL(target).href);
    } catch (err) {
      console.log(`  [FAIL] ${rel} cannot import ${spec}: ${err.message}`);
      failures++;
      continue;
    }
    for (const n of names) {
      if (!(n in mod)) {
        console.log(`  [FAIL] ${rel} imports { ${n} } from ${spec}, which does not export it`);
        failures++;
      }
    }
  }
  console.log(`  [PASS] ${rel} imports resolve`);
}

// Identifiers used in main.js that look like they came from a module but were
// never imported are the other half of the same bug.
const mainSrc = await readFile(resolve(HERE, '../main.js'), 'utf8');
const imported = new Set();
for (const m of mainSrc.matchAll(IMPORT_RE)) {
  for (const n of m[1].split(',')) {
    const name = n.trim().split(/\s+as\s+/).pop().trim();
    if (name) imported.add(name);
  }
}
for (const m of mainSrc.matchAll(/import\s+\*\s+as\s+(\w+)/g)) imported.add(m[1]);

const SUSPECTS = ['wallSegments', 'roomAt', 'ROOMS', 'lineOfSight', 'Radar', 'buildPlayer', 'SCORING'];
for (const name of SUSPECTS) {
  const used = new RegExp(`\b${name}\s*[({.]`).test(mainSrc);
  if (used && !imported.has(name)) {
    console.log(`  [FAIL] main.js uses ${name} but never imports it`);
    failures++;
  }
}
if (!failures) console.log('  [PASS] no undeclared module identifiers in main.js');

// Every element main.js reaches for has to exist in the page. This is the one
// failure a headless module check cannot see and a browser would: el() returns
// null for a missing id and the first property access throws, taking the whole
// scene down on load. The HUD and the overlays are edited in two places at
// once, and a new readout added to main.js without its <span> looks perfectly
// fine to node.
const html = await readFile(resolve(HERE, '../index.html'), 'utf8');
const ids = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
// Built at run time rather than written into the page. Each is a host that IS
// in the page, so a typo in the host itself is still caught.
const GENERATED = new Set(['pick-rows', 'speeds']);
const missing = [];
for (const m of mainSrc.matchAll(/\bel\('([^']+)'\)/g)) {
  if (!ids.has(m[1]) && !GENERATED.has(m[1]) && !missing.includes(m[1])) missing.push(m[1]);
}
for (const id of missing) {
  console.log(`  [FAIL] main.js reads #${id}, which is not in index.html`);
  failures++;
}
if (!missing.length) {
  console.log(`  [PASS] every element main.js reads exists in the page  ${ids.size} ids`);
}


// The two view modes have to stay separate, and "separate" is a property of the
// source, not of anything that can be measured at run time: FREE is free
// precisely because no line in it writes the camera. That is easy to undo by
// accident -- one `controls.target.lerp(...)` added for a good reason and the
// view quietly starts dragging itself after the character again, which is the
// behaviour the two modes were split up to get rid of.
//
// So it is checked here, by reading the branch.
{
  const open = mainSrc.indexOf("if (viewMode === 'free') {");
  if (open < 0) {
    console.log('  [FAIL] main.js has no free-view branch in updateCamera');
    failures++;
  } else {
    // Walk to the matching brace.
    let depth = 0;
    let end = open;
    for (let i = mainSrc.indexOf('{', open); i < mainSrc.length; i++) {
      if (mainSrc[i] === '{') depth++;
      else if (mainSrc[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    // Comments stripped first: the branch explains itself by NAMING the
    // things it must not do, so a check that reads prose is not checking
    // anything. It failed on its own comment the first time it was run.
    const branch = mainSrc.slice(open, end + 1)
      .split('\n')
      .map((L) => L.replace(/\/\/.*$/, ''))
      .join('\n');
    const writes = [];
    if (/camera\.position/.test(branch)) writes.push('camera.position');
    if (/controls\.target/.test(branch)) writes.push('controls.target');
    if (/lookGoal|camGoal/.test(branch)) writes.push('the camera goals');
    if (writes.length) {
      console.log(`  [FAIL] free view moves the camera by itself: ${writes.join(', ')}`);
      failures++;
    } else {
      console.log('  [PASS] free view never moves the camera itself'
        + `  ${branch.split('\n').length} lines`);
    }
  }

  // And the one switch that tells the modes apart must be the only thing that
  // sets viewMode, or the two can disagree about whether input is live.
  const assigns = (mainSrc.match(/\bviewMode = /g) || []).length;
  // One in the declaration, one in setViewMode.
  if (assigns > 2) {
    console.log(`  [FAIL] viewMode is assigned in ${assigns} places, not just setViewMode`);
    failures++;
  } else {
    console.log('  [PASS] only setViewMode changes the mode, so input state cannot drift');
  }
}

console.log(`\n${failures === 0 ? 'imports ok' : failures + ' IMPORT PROBLEM(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
