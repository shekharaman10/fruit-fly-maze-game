// Does the fly escape reflex still defeat the predictive fire control?
//
//   node tools/experiment.mjs
//
// The first run of this measured 8.9% against 41.8% hit rate, reflex on versus
// off. Since then the fly was tripled in size, halved in speed and given timed
// approach runs; the character gained a sword and two more flies to choose
// between. Every one of those moves the number, so it is re-measured here
// rather than carried forward. A stale measurement quoted as current is worse
// than no measurement.
//
// Same duel, same seeds, one variable: whether LPLC2 is shown the bolts.

import { runDuel, MAX_FLIES, FLY_HIT_RADIUS, AIM } from './duel.mjs';
import { LENGTHS_M } from '../scale.js';
import { FLIGHT } from '../brain/flight.js';

const SEEDS = [11, 23, 37, 51, 67];
const SECONDS = 150;

const results = { on: [], off: [] };
const runs = { on: [], off: [] };

console.log(`\nduel, ${SECONDS}s per run, ${SEEDS.length} seeds, ${MAX_FLIES} flies`);
console.log(`  bolt speed     : ${AIM.boltSpeed} m/s`);
console.log(`  fly length     : ${(LENGTHS_M.sceneFly * 1000).toFixed(0)} mm, hit radius ${FLY_HIT_RADIUS} m`);
console.log(`  fly cruise     : ${FLIGHT.cruiseSpeed} m/s, escape ${FLIGHT.escapeSpeed} m/s\n`);

console.log('  seed  reflex   shots   hits    rate   cuts  landed  escapes   score');
for (const seed of SEEDS) {
  for (const on of [true, false]) {
    const r = runDuel({ seed, seconds: SECONDS, escapeEnabled: on });
    const rate = r.shots ? r.hits / r.shots : 0;
    const key = on ? 'on' : 'off';
    results[key].push(rate);
    runs[key].push(r);
    console.log(`  ${String(seed).padStart(4)}  ${(on ? 'ON ' : 'OFF').padStart(6)}   `
      + `${String(r.shots).padStart(5)}   ${String(r.hits).padStart(4)}   `
      + `${(rate * 100).toFixed(1).padStart(5)}%   ${String(r.cuts).padStart(4)}  `
      + `${String(r.landings).padStart(6)}  ${String(r.escapes).padStart(7)}  `
      + `${String(r.points).padStart(6)}`);
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1));
};

const mOn = mean(results.on);
const mOff = mean(results.off);
const col = (k, f) => mean(runs[k].map(f));

console.log('');
console.log(`  reflex ON  : ${(mOn * 100).toFixed(1)}% +/- ${(sd(results.on) * 100).toFixed(1)}`
  + `   cuts ${col('on', (r) => r.cuts).toFixed(1)}`
  + `   landed ${col('on', (r) => r.landings).toFixed(1)}`
  + `   score ${col('on', (r) => r.points).toFixed(0)}`);
console.log(`  reflex OFF : ${(mOff * 100).toFixed(1)}% +/- ${(sd(results.off) * 100).toFixed(1)}`
  + `   cuts ${col('off', (r) => r.cuts).toFixed(1)}`
  + `   landed ${col('off', (r) => r.landings).toFixed(1)}`
  + `   score ${col('off', (r) => r.points).toFixed(0)}`);

const drop = (mOff - mOn) * 100;
console.log('');
if (drop > 1) {
  console.log(`  The reflex costs the shooter ${drop.toFixed(1)} points of hit rate, `
    + `a ${(mOff / Math.max(mOn, 1e-9)).toFixed(2)}x reduction.`);
} else {
  console.log(`  NEGATIVE RESULT: the reflex changes hit rate by ${drop.toFixed(1)} points, `
    + `which is not a defence. Report it as such.`);
}
console.log('');
