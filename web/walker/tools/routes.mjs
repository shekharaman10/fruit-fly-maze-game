// How long does it take to reach the centre, and what does the rule cost?
//
//   node tools/routes.mjs
//
// Two routes through the same maze, walked by the same brain:
//
//   shortest  the BFS path -- straight to the middle, ignoring the rule
//   coverage  the ordered DFS walk -- every corridor at least once
//
// The gap between them is the price of "cover every wall", measured rather
// than guessed at.

import { buildMaze, sense, resolveCollision, cellCentre, MAZE } from '../world/maze.js';
import { FlyBrain } from '../brain/index.js';
import { wrapPi } from '../brain/neuron.js';

const DT = 1 / 120;
const WIN_R = MAZE.centreR - 0.35;

function march(world, points, seed) {
  const brain = new FlyBrain({ seed, sex: 'male' });
  const body = {
    x: world.outside.x,
    z: world.outside.z,
    yaw: Math.atan2(-world.outside.x, -world.outside.z),
    yawRate: 0,
  };
  brain.anchor(body.yaw);
  const nav = { bearing: 0, targetVisible: false };

  let i = 0;
  let walked = 0;
  let px = body.x;
  let pz = body.z;

  const LIMIT = 120 * 60 * 20;
  for (let t = 0; t < LIMIT; t++) {
    const wp = points[Math.min(i, points.length - 1)];
    if (Math.hypot(wp.x - body.x, wp.z - body.z) < 0.55 && i < points.length - 1) i++;
    nav.bearing = wrapPi(Math.atan2(wp.x - body.x, wp.z - body.z) - body.yaw);

    const r = sense(world, body, nav);
    const m = brain.step(DT, { ...r, angularVelocity: body.yawRate });
    body.yawRate = m.yawRate;
    body.yaw = wrapPi(body.yaw + body.yawRate * DT);
    const f = resolveCollision(
      world,
      body.x + Math.sin(body.yaw) * m.speed * DT,
      body.z + Math.cos(body.yaw) * m.speed * DT,
    );
    body.x = f.x;
    body.z = f.z;
    walked += Math.hypot(body.x - px, body.z - pz);
    px = body.x;
    pz = body.z;

    if (Math.hypot(body.x, body.z) < WIN_R) {
      return { arrived: true, seconds: t * DT, walked, waypoints: points.length };
    }
  }
  return { arrived: false, seconds: Infinity, walked, waypoints: points.length };
}

console.log('');
console.log('  seed   route      cells   walked    time     vs shortest');
const rows = { cover: [], short: [] };

for (const seed of [20260917, 1, 7, 23, 99]) {
  const w = buildMaze({ seed });
  const coverPts = w.routePoints;
  const shortPts = w.shortest.map((id) => cellCentre(w.graph, id));

  const c = march(w, coverPts, 4242);
  const s = march(w, shortPts, 4242);
  rows.cover.push(c);
  rows.short.push(s);

  const f = (r, label, ratio) => console.log(
    `  ${String(seed).padStart(8)}   ${label.padEnd(9)} ${String(r.waypoints).padStart(4)}`
    + `  ${r.walked.toFixed(1).padStart(7)} m  ${r.seconds.toFixed(1).padStart(6)} s  ${ratio}`,
  );
  f(c, 'coverage', (c.seconds / s.seconds).toFixed(2) + 'x');
  f(s, 'shortest', '1.00x');
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const cs = mean(rows.cover.map((r) => r.seconds));
const ss = mean(rows.short.map((r) => r.seconds));
const cw = mean(rows.cover.map((r) => r.walked));
const sw = mean(rows.short.map((r) => r.walked));

console.log('');
console.log(`  coverage mean : ${cs.toFixed(1)} s over ${cw.toFixed(0)} m`);
console.log(`  shortest mean : ${ss.toFixed(1)} s over ${sw.toFixed(0)} m`);
console.log(`  the rule costs ${(cs / ss).toFixed(1)}x the time and ${(cw / sw).toFixed(1)}x the distance`);
console.log(`  all arrived   : ${rows.cover.every((r) => r.arrived) && rows.short.every((r) => r.arrived)}`);
console.log('');
