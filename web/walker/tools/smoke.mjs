// Builds the scene and runs the full loop without a renderer, so structural and
// numerical faults surface without needing a browser.
//   node tools/smoke.mjs

import * as THREE from '../vendor/three.module.js';
import { FlyBrain } from '../brain/index.js';
import { FlyFlightBrain } from '../brain/flight.js';
import { ZoroBrain, AIM, CAPACITY } from '../brain/zoro.js';
import { SearchWalk } from '../brain/forage.js';
import {
  buildMaze, sense, resolveCollision, lineOfSight, roomAround, cellCentre, MAZE, ROOM, BODY_RADIUS,
} from '../world/maze.js';
import { buildPlayer, applyWeaponPose, gripTargets } from '../world/player.js';
import { VARIANTS, buildHuman } from '../world/human.js';
import { buildFly, makeHalves, FLY_HIT_RADIUS, FLY_CLEAR_RADIUS } from '../world/fly.js';
import { Swing } from '../world/sword.js';
import { Bolts } from '../world/laser.js';
import { Score, SCORING } from '../score.js';
import { Life, LIFE } from '../life.js';
import { legAngles, doubleSupportFraction, TOE_OFF } from '../world/gait.js';
import { pullCameraIn } from '../render/camera.js';
import { moveAndSlide, moveToward, planarSpeed } from '../world/body3d.js';

// Same controller the scene runs -- see world/body3d.js. These tools exist so
// the march can be measured without a browser, and a tool that integrates
// movement its own way is measuring its own integration.
const WALK_ACCEL = 9.0;
const WALK_BRAKE = 11.0;

import { LENGTHS_M, sceneWingbeatHz, FLY_SIZE_NOTE } from '../scale.js';
import { makeRandom, wrapPi, clamp } from '../brain/neuron.js';

const DT = 1 / 120;
const MAX_FLIES = 3;
let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

// --------------------------------------------------------- 1. the four -----
console.log('\n1. characters');
for (const v of VARIANTS) {
  // buildHuman, not buildPlayer: the weapons hang off the torso, and a held
  // katana adds 35 cm to the bounding box. This measures the person.
  const p = buildHuman(v.id);
  p.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(p.group);
  const h = b.max.y - b.min.y;
  let meshes = 0;
  p.group.traverse((o) => { if (o.isMesh) meshes++; });
  console.log(`  ${v.id.padEnd(8)} height ${h.toFixed(3)} m  floor ${b.min.y.toFixed(4)}  meshes ${meshes}`);
  check(`${v.id} stands 1.78 m`, Math.abs(h - 1.78) < 0.06, `${h.toFixed(3)} m`);
  check(`${v.id} feet on the floor`, Math.abs(b.min.y) < 0.03, `${b.min.y.toFixed(4)}`);
}

// ------------------------------------------------------------ 2. gait -----
console.log('\n2. human gait kinematics');
{
  // Stance/swing split straight from the tables.
  let stance = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) if (legAngles(i / N).stance) stance++;
  const duty = stance / N;
  const ds = doubleSupportFraction();
  console.log(`  duty factor      : ${duty.toFixed(3)} (toe-off ${TOE_OFF})`);
  console.log(`  double support   : ${(ds * 100).toFixed(1)}% of the cycle`);
  check('duty factor matches toe-off', Math.abs(duty - TOE_OFF) < 0.01);
  check('double support is 20-25%, as gait labs measure', ds > 0.20 && ds < 0.26,
        `${(ds * 100).toFixed(1)}%`);

  // The knee double bump: a loading-response peak AND a swing peak, with a
  // genuine dip between. A single sinusoid cannot produce this.
  let loadPeak = 0; let loadAt = 0;
  for (let t = 0.05; t < 0.30; t += 0.005) {
    const k = legAngles(t).knee;
    if (k > loadPeak) { loadPeak = k; loadAt = t; }
  }
  let dip = Infinity; let dipAt = 0;
  for (let t = 0.30; t < 0.50; t += 0.005) {
    const k = legAngles(t).knee;
    if (k < dip) { dip = k; dipAt = t; }
  }
  let swingPeak = 0; let swingAt = 0;
  for (let t = 0.55; t < 0.90; t += 0.005) {
    const k = legAngles(t).knee;
    if (k > swingPeak) { swingPeak = k; swingAt = t; }
  }
  const deg = (r) => (r * 180 / Math.PI).toFixed(1);
  console.log(`  knee loading peak: ${deg(loadPeak)} deg at ${(loadAt * 100).toFixed(0)}%`);
  console.log(`  knee midstance   : ${deg(dip)} deg at ${(dipAt * 100).toFixed(0)}%`);
  console.log(`  knee swing peak  : ${deg(swingPeak)} deg at ${(swingAt * 100).toFixed(0)}%`);
  check('knee has a loading-response bump', loadPeak > dip + 0.1, `${deg(loadPeak)} vs ${deg(dip)}`);
  check('knee swing flexion is the larger peak', swingPeak > loadPeak * 2.5);
  check('swing peak lands near 70% of the cycle', swingAt > 0.6 && swingAt < 0.8);
}

// ------------------------------------------------------------- 3. fly -----
console.log('\n3. fly scale');
{
  const fly = buildFly();
  fly.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(fly.parts.body);
  const len = b.max.z - b.min.z;
  console.log(`  body length      : ${(len * 1000).toFixed(0)} mm`);
  console.log(`  vs real fly      : ${(len / LENGTHS_M.fly).toFixed(0)}x`);
  console.log(`  vs character     : ${(len / 1.78 * 100).toFixed(0)}%`);
  console.log(`  wingbeat         : ${sceneWingbeatHz().toFixed(1)} Hz`);
  check('fly is 534 mm', Math.abs(len - 0.534) < 0.01, `${(len * 1000).toFixed(0)} mm`);
  check('fly is 3x the previous size',
        Math.abs(len / FLY_SIZE_NOTE.previousM - 3) < 0.05,
        `${(len / FLY_SIZE_NOTE.previousM).toFixed(2)}x`);
  check('the size change is declared as authored, not derived', FLY_SIZE_NOTE.derived === false);

  const halves = makeHalves(fly);
  check('the fly can be cut into two halves', Boolean(halves.front && halves.rear));
}

// ----------------------------------------------------- 4. search walk -----
console.log('\n4. search is random, not a route');
{
  const trace = (seed) => {
    const w = new SearchWalk({ seed });
    let x = 0; let z = 0; let yaw = 0;
    const path = [];
    for (let i = 0; i < 120 * 90; i++) {
      const b = w.step(DT, { hasTarget: false, x, z, yaw, bounds: { hw: ROOM.w / 2, hd: ROOM.d / 2 } });
      yaw = wrapPi(yaw + clamp(b, -1, 1) * 1.4 * DT);
      x = clamp(x + Math.sin(yaw) * 1.3 * DT, -4.4, 4.4);
      z = clamp(z + Math.cos(yaw) * 1.3 * DT, -4.4, 4.4);
      if (i % 30 === 0) path.push([x, z]);
    }
    return { path, tumbles: w.tumbles };
  };

  const a = trace(11);
  const b = trace(12);
  let diff = 0;
  for (let i = 0; i < a.path.length; i++) {
    diff += Math.hypot(a.path[i][0] - b.path[i][0], a.path[i][1] - b.path[i][1]);
  }
  diff /= a.path.length;

  // Coverage: how many 1 m cells the walk visits. A fixed route revisits a few.
  const cells = new Set(a.path.map(([x, z]) => `${Math.round(x)},${Math.round(z)}`));
  console.log(`  tumbles in 90 s  : ${a.tumbles}`);
  console.log(`  cells visited    : ${cells.size}`);
  console.log(`  mean separation between two seeds: ${diff.toFixed(2)} m`);
  check('the walk tumbles', a.tumbles > 5, `${a.tumbles}`);
  check('different seeds give different paths', diff > 1.5, `${diff.toFixed(2)} m apart`);
  check('the walk covers ground rather than looping', cells.size > 8, `${cells.size} cells`);

  // Area-restricted search must actually tighten the walk.
  const w = new SearchWalk({ seed: 3 });
  for (let i = 0; i < 120; i++) w.step(DT, { hasTarget: true, x: 0, z: 0, yaw: 0, bounds: { hw: ROOM.w / 2, hd: ROOM.d / 2 } });
  check('pursuit mode while a target is held', w.mode === 'pursuit');
  w.step(DT, { hasTarget: false, x: 0, z: 0, yaw: 0, bounds: { hw: ROOM.w / 2, hd: ROOM.d / 2 } });
  check('losing a target triggers area-restricted search', w.mode === 'area-restricted',
        w.mode);
}

// ------------------------------------------------------ 5. closed loop -----
console.log('\n5. closed loop, 150 s, three flies');
const scene = new THREE.Scene();
// A small open arena rather than the carved maze: this suite exercises combat,
// and tools/maze.mjs is where the maze and the march are tested. Small matters
// -- in the full 31 m arena the flies are shot at range long before any of them
// closes, and the melee path never runs.
const world = buildMaze({ seed: 4242, open: true, ringCells: [8, 8, 16] });
scene.add(world.group);
const player = buildPlayer(VARIANTS[0].id);
scene.add(player.group);
const bolts = new Bolts(scene, { speed: AIM.boltSpeed });

const rng = makeRandom(4242);
const brain = new FlyBrain({ seed: 4242, sex: 'male' });
const zoro = new ZoroBrain();
const swing = new Swing();
const search = new SearchWalk({ seed: 5150 });
const score = new Score();

const body = { x: -7.0, z: 3.0, y: 0, vx: 0, vy: 0, vz: 0, onFloor: true, yaw: 0.6, yawRate: 0 };
brain.anchor(body.yaw);
const env = { obstacles: [], hw: world.shellR + 1, hd: world.shellR + 1, maxY: MAZE.height - 0.1 };
const nav = { bearing: 0, targetVisible: true };

function freePoint(minFromPlayer = 0) {
  for (let t = 0; t < 200; t++) {
    const id = 1 + (Math.floor(rng() * (world.graph.n - 1)) % (world.graph.n - 1));
    const c = cellCentre(world.graph, id);
    if (Math.hypot(c.x - body.x, c.z - body.z) >= minFromPlayer) return c;
  }
  return { x: world.start.x, z: world.start.z };
}

const flies = [];
for (let i = 0; i < MAX_FLIES; i++) {
  const view = buildFly();
  scene.add(view.group);
  const p = freePoint(3.0);
  const f = {
    id: i, view,
    flyBrain: new FlyFlightBrain({ seed: 1337 + i * 97 }),
    state: { x: p.x, y: 1.4 + rng() * 0.4, z: p.z, yaw: rng() * Math.PI * 2, yawRate: 0, stun: 0 },
    alive: true, respawnIn: 0, escapes: 0, wasEscaping: false,
  };
  f.flyBrain.anchor(f.state.yaw);
  flies.push(f);
}

const muzzle = new THREE.Vector3();
const dir = new THREE.Vector3();
const bladeA = new THREE.Vector3();
const bladeB = new THREE.Vector3();

function segDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax; const dy = by - ay; const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t), pz - (az + dz * t));
}

let prevMiss = 0;
let path = 0;
let px = body.x; let pz = body.z;
let nan = false; let escaped = false;
let swordFrames = 0;
let debrisMade = 0;
let worstCompass = 0;

const STEPS = 120 * 150;
for (let i = 0; i < STEPS; i++) {
  score.step(DT);
  zoro.cooldownScale = score.cooldownScale;

  for (const f of flies) {
    if (!f.alive) { f.respawnIn -= DT; if (f.respawnIn <= 0) { const p = freePoint(3); Object.assign(f.state, { x: p.x, z: p.z, y: 1.5, yaw: rng() * 6.28, yawRate: 0, stun: 0.3 }); f.flyBrain.anchor(f.state.yaw); f.alive = true; } continue; }
    const out = f.flyBrain.step(DT, {
      pos: f.state, yaw: f.state.yaw, yawRate: f.state.yawRate,
      zoro: { x: body.x, y: 1.25, z: body.z }, bolts: bolts.liveBolts, bounds: env,
    });
    if (out.escaping && !f.wasEscaping) f.escapes++;
    f.wasEscaping = out.escaping;
    f.state.stun = Math.max(0, f.state.stun - DT);
    const sp = f.state.stun > 0 ? out.speed * 0.2 : out.speed;
    f.state.yawRate = out.yawRate;
    f.state.yaw = wrapPi(f.state.yaw + out.yawRate * DT);
    f.state.x = clamp(f.state.x + Math.sin(f.state.yaw) * sp * DT, -env.hw + 0.5, env.hw - 0.5);
    f.state.z = clamp(f.state.z + Math.cos(f.state.yaw) * sp * DT, -env.hd + 0.5, env.hd - 0.5);
    f.state.y = clamp(f.state.y + out.climb * DT, 0.5, MAZE.height - 0.4);
    // The partitions go floor to ceiling, and the flight brain only knows
    // about the outer box, so the walls are enforced here rather than
    // steered around. A fly that clips through a wall makes the occlusion
    // above look broken when it is not.
    // Slide, not shove. Velocity is rewritten from the heading every frame, so
    // the flies gain no inertia and the escape dynamics tools/experiment.mjs
    // measures are unchanged.
    f.state.vx = Math.sin(f.state.yaw) * sp;
    f.state.vz = Math.cos(f.state.yaw) * sp;
    moveAndSlide(world, f.state, DT, {
      // Its whole rendered extent, not just its body -- see world/fly.js.
      radius: FLY_CLEAR_RADIUS, wallT: MAZE.wallT, props: false,
      floorY: 0.5, ceilingY: MAZE.height - 0.4,
    });
  }

  const candidates = [];
  for (const f of flies) {
    if (!f.alive) continue;
    const dx = f.state.x - body.x; const dz = f.state.z - body.z;
    const range = Math.hypot(dx, dz);
    const bearing = wrapPi(Math.atan2(dx, dz) - body.yaw);
    // Frontal field, in range, and not through a partition.
    const clear = lineOfSight(world, body.x, body.z, f.state.x, f.state.z);
    const vis = Math.abs(bearing) < 1.31 && range < AIM.maxRange && clear;
    candidates.push({
      id: f.id, fly: f, range, bearing,
      // Coarse omnidirectional channel: presence and bearing only.
      heard: range < AIM.hearingRange && clear,
      observed: vis ? {
        x: f.state.x + (rng() - 0.5) * AIM.rangeNoise,
        y: f.state.y + (rng() - 0.5) * AIM.rangeNoise,
        z: f.state.z + (rng() - 0.5) * AIM.rangeNoise,
      } : null,
    });
  }
  const chosen = zoro.selectTarget(candidates);
  const engaged = chosen ? chosen.fly : null;
  // Nothing engaged: park the carrier out of the world AND tell the sensory
  // pathway there is nothing to see. Parking it at the body's own x/z left
  // targetDistance at 0, which brain/index.js reads as "arrived" and answers by
  // dropping walkDrive to 0 -- the legs stop and never restart, because the
  // carrier follows the body that is no longer moving. Latent until the
  // partitions made `engaged` commonly null; nav.targetVisible was initialised
  // true here and never written again.
  nav.targetVisible = Boolean(engaged);
  if (engaged) world.target.position.set(engaged.state.x, engaged.state.y, engaged.state.z);
  else world.target.position.set(body.x + 1000, -50, body.z + 1000);

  const searchBearing = search.step(DT, { hasTarget: Boolean(engaged), x: body.x, z: body.z, yaw: body.yaw, bounds: env });
  nav.bearing = zoro.orientBearing !== null ? zoro.orientBearing : searchBearing;
  const reading = sense(world, body, nav);
  const motor = brain.step(DT, { ...reading, angularVelocity: body.yawRate });

  const impair = score.speedScale;
  body.yawRate = motor.yawRate * impair;
  body.yaw = wrapPi(body.yaw + body.yawRate * DT);
  const wish = motor.speed * impair;
  const rate = (wish > planarSpeed(body) ? WALK_ACCEL : WALK_BRAKE) * DT;
  const v = moveToward(body.vx, body.vz,
    Math.sin(body.yaw) * wish, Math.cos(body.yaw) * wish, rate);
  body.vx = v.x; body.vz = v.z;
  moveAndSlide(world, body, DT, {
    radius: BODY_RADIUS, wallT: MAZE.wallT, gravity: true, floorY: 0,
  });

  const st = brain.state();
  player.group.position.set(body.x, 0, body.z);
  player.group.rotation.y = body.yaw;
  swing.step(DT);
  applyWeaponPose(player, zoro, swing, DT, roomAround(world, body.x, body.z));
  const grips = gripTargets(player);
  player.human.pose({
    legPhase: st.legPhase, speed: st.speed, turnCommand: st.turnCommand,
    armHold: 1, rightHandTarget: grips.right, leftHandTarget: grips.left,
  });
  player.muzzle.updateWorldMatrix(true, false);
  player.muzzle.getWorldPosition(muzzle);

  const cmd = zoro.step(DT, {
    muzzle, bodyYaw: body.yaw,
    observed: chosen ? chosen.observed : null,
    range: chosen ? chosen.range : Infinity,
  });
  if (zoro.weapon === 'sword') swordFrames++;

  if (cmd.fire && cmd.lead) {
    dir.set(cmd.lead.x - muzzle.x, cmd.lead.y - muzzle.y, cmd.lead.z - muzzle.z).normalize();
    if (bolts.spawn(muzzle, dir)) zoro.didFire();
  }
  if (cmd.swing) swing.start();

  if (swing.contacting && !swing.hasCut) {
    const sw = player.sword;
    sw.updateWorldMatrix(true, false);
    bladeA.set(sw.userData.bladeStart, 0, 0); sw.localToWorld(bladeA);
    bladeB.copy(sw.userData.tip); sw.localToWorld(bladeB);
    for (const f of flies) {
      if (!f.alive) continue;
      if (segDist(bladeA.x, bladeA.y, bladeA.z, bladeB.x, bladeB.y, bladeB.z,
        f.state.x, f.state.y, f.state.z) <= FLY_HIT_RADIUS + 0.05) {
        makeHalves(f.view);
        debrisMade += 2;
        f.alive = false; f.respawnIn = 1.3;
        score.swordCut();
        swing.hasCut = true;
        break;
      }
    }
  }

  const targets = flies.filter((f) => f.alive).map((f) => ({ pos: f.state, radius: FLY_HIT_RADIUS, id: f.id }));
  for (const h of bolts.update(DT, env, targets)) {
    const f = flies.find((x) => x.id === h.id);
    if (f && f.alive) { zoro.hits++; f.alive = false; f.respawnIn = 1.3; score.shotKill(); }
  }
  score.missedShots(bolts.missCount - prevMiss);
  prevMiss = bolts.missCount;

  for (const f of flies) {
    if (!f.alive) continue;
    const d = Math.hypot(f.state.x - body.x, f.state.y - SCORING.landingHeight, f.state.z - body.z);
    if (d <= SCORING.landingRadius && score.flyLanded()) {
      const away = Math.atan2(f.state.x - body.x, f.state.z - body.z);
      f.state.x = body.x + Math.sin(away) * 1.9;
      f.state.z = body.z + Math.cos(away) * 1.9;
      f.state.stun = 0.3;
    }
  }

  if (!Number.isFinite(body.x) || !Number.isFinite(zoro.aimYaw) || !Number.isFinite(score.points)) { nan = true; break; }
  if (Math.hypot(body.x, body.z) > world.shellR + 1.5) escaped = true;
  path += Math.hypot(body.x - px, body.z - pz);
  px = body.x; pz = body.z;
  worstCompass = Math.max(worstCompass, Math.abs(wrapPi(st.headingEstimate - body.yaw)));
}

const zs = zoro.state();
const sc = score.state();
const escapes = flies.reduce((a, f) => a + f.escapes, 0);

console.log(`  walked            : ${path.toFixed(1)} m (${(path / 150).toFixed(2)} m/s)`);
console.log(`  shots / hits      : ${zs.shots} / ${zs.hits}  (${zs.shots ? (100 * zs.hits / zs.shots).toFixed(0) : 0}%)`);
console.log(`  sword cuts        : ${sc.cuts}   melee frames ${(100 * swordFrames / STEPS).toFixed(1)}%`);
console.log(`  landed on         : ${sc.landings}`);
console.log(`  missed shots      : ${sc.misses}`);
console.log(`  fly escapes       : ${escapes}`);
console.log(`  target switches   : ${zs.switches}`);
console.log(`  score             : ${sc.points}  (best streak ${sc.bestStreak})`);
console.log(`  worst compass err : ${(worstCompass * 180 / Math.PI).toFixed(1)} deg`);

check('no NaN anywhere', !nan);
check('stayed in the room', !escaped);
// NOTHING hangs in this arena, and that is the correct answer rather than a
// gap. It is built with `open: true`, so every interior passage is carved and
// the only wall left standing is the outer shell -- which is excluded from the
// hang, because its arcs face outward and a picture on one lands on the far
// side of the boundary pointing away from the maze. No interior walls, nowhere
// to hang. The real count is asserted against the full maze in tools/maze.mjs.
check('nothing hangs on the shell in the open arena', world.pictures.length === 0,
      `${world.pictures.length} hung`);
check('covered ground', path > 40, `${path.toFixed(0)} m`);
check('it fired', zs.shots > 5, `${zs.shots}`);
check('it hit flies with the rifle', zs.hits > 0, `${zs.hits}`);
check('it closed to melee', swordFrames > 0, `${swordFrames} frames`);
check('it cut flies in half', sc.cuts > 0, `${sc.cuts}`);
check('cutting produced debris', debrisMade >= sc.cuts * 2);
check('flies used the escape reflex', escapes > 3, `${escapes}`);
check('it switched between flies', zs.switches > 0, `${zs.switches}`);
check('reward and punishment both fired', sc.cuts + sc.shotKills > 0 && sc.misses > 0);
check('score is finite', Number.isFinite(sc.points));
check('compass stayed locked', worstCompass * 180 / Math.PI < 45, `${(worstCompass * 180 / Math.PI).toFixed(0)} deg`);
check('gait held', brain.state().tripodSync > 0.9, `${brain.state().tripodSync.toFixed(3)}`);

console.log('\n6. a fly behind the character is noticed and turned toward');
{
  const z = new ZoroBrain();
  const behind = [{ id: 0, range: 3.0, bearing: Math.PI * 0.92, observed: null, heard: true }];
  z.selectTarget(behind);
  const deg = z.orientBearing * 180 / Math.PI;
  console.log(`  fly bearing       : 166 deg (behind)`);
  console.log(`  orient bearing    : ${deg.toFixed(0)} deg`);
  check('something audible behind produces a turn', z.orientBearing !== null);
  check('the turn points roughly backwards', Math.abs(Math.abs(deg) - 166) < 30,
        `${deg.toFixed(0)} deg`);

  const front = [{ id: 1, range: 4, bearing: 0.1, observed: { x: 0, y: 1, z: 4 }, heard: true }];
  z.selectTarget(front);
  check('a fly in the frontal field suppresses the coarse channel',
        z.orientBearing === null);

  const far = [{ id: 2, range: 99, bearing: Math.PI, observed: null, heard: false }];
  z.selectTarget(far);
  check('nothing heard beyond hearing range', z.orientBearing === null);
}

console.log('\n7. camera never sits inside a wall');
{
  const cam = { x: 0, y: 2.3, z: 0 };
  let blocked = 0;
  let inside = 0;
  let tested = 0;

  for (let i = 0; i < 4000; i++) {
    const sx = -world.shellR + 0.8 + rng() * (world.shellR * 2 - 1.6);
    const sz = -world.shellR + 0.8 + rng() * (world.shellR * 2 - 1.6);
    const p0 = resolveCollision(world, sx, sz);
    if (Math.hypot(p0.x - sx, p0.z - sz) > 1e-6) continue;

    const yaw = rng() * Math.PI * 2;
    cam.x = sx - Math.sin(yaw) * 3.6 + Math.cos(yaw) * 1.3;
    cam.y = 2.3;
    cam.z = sz - Math.cos(yaw) * 3.6 - Math.sin(yaw) * 1.3;
    pullCameraIn(world, sx, sz, cam);
    tested++;

    if (!lineOfSight(world, sx, sz, cam.x, cam.z)) blocked++;
    // props: false, to match render/camera.js. The camera rides above the
    // plants, so counting one as 'inside geometry' asserts something that
    // is false by construction.
    const solid = resolveCollision(world, cam.x, cam.z, 0.28, { props: false });
    if (Math.hypot(solid.x - cam.x, solid.z - cam.z) > 1e-6) inside++;
  }

  console.log(`  placements tested : ${tested}`);
  console.log(`  blocked by a wall : ${blocked}`);
  console.log(`  inside geometry   : ${inside}`);
  check('camera always has line of sight to the subject', blocked === 0, `${blocked}`);
  check('camera is never inside geometry', inside === 0, `${inside}`);
}

console.log('\n8. declared budget');
console.log(`  spec neurons      : ${CAPACITY.neurons.toExponential(3)} (${CAPACITY.vsHuman.toFixed(2)}x human)`);
console.log(`  modules simulated : ${CAPACITY.modulesSimulated}`);
check('budget is a spec, not a simulated count',
      CAPACITY.modulesSimulated < 20 && CAPACITY.neurons > 1e11);

console.log('\n9. the camera answers the hand at the same rate at any frame rate');
{
  // OrbitControls applies `dampingFactor` of the OUTSTANDING movement PER FRAME
  // and decays the rest. A fixed factor is therefore a different speed at every
  // frame rate -- which is why the controls went stiff when the fly count went
  // up tenfold: the frame got longer and the camera got slower to answer.
  //
  // main.js recomputes the factor from the real frame time against a fixed time
  // constant. This is that arithmetic, checked against the fixed factor it
  // replaced.
  const CAM_RESPONSE = 0.055;   // s, must match main.js

  // Frames for an outstanding drag to decay to a tenth of itself.
  const settle = (fps, factorFor) => {
    const step = 1 / fps;
    let left = 1;
    let t = 0;
    for (let i = 0; i < 20000 && left > 0.1; i++) {
      left *= (1 - factorFor(step));
      t += step;
    }
    return t;
  };
  const scaled = (step) => Math.min(1, 1 - Math.exp(-step / CAM_RESPONSE));
  const fixed = () => 0.08;

  const rates = [30, 60, 144];
  const sc = rates.map((f) => settle(f, scaled));
  const fx = rates.map((f) => settle(f, fixed));
  for (let i = 0; i < rates.length; i++) {
    console.log(`  ${String(rates[i]).padStart(3)} fps           : `
      + `${(sc[i] * 1000).toFixed(0)} ms to 90% `
      + `(a fixed 0.08 would be ${(fx[i] * 1000).toFixed(0)} ms)`);
  }
  const spreadScaled = Math.max(...sc) - Math.min(...sc);
  const spreadFixed = Math.max(...fx) - Math.min(...fx);
  console.log(`  spread over rates : ${(spreadScaled * 1000).toFixed(0)} ms scaled, `
    + `${(spreadFixed * 1000).toFixed(0)} ms fixed`);

  check('the view answers at the same rate whatever the frame rate',
    spreadScaled < 0.02, `${(spreadScaled * 1000).toFixed(0)} ms spread`);
  check('a fixed factor would not have', spreadFixed > 0.1,
    `${(spreadFixed * 1000).toFixed(0)} ms spread`);
  // The point of the change: a drag should land in a couple of frames rather
  // than trailing the cursor through the whole gesture.
  check('the view keeps up with the hand', Math.max(...sc) < 0.20,
    `${(Math.max(...sc) * 1000).toFixed(0)} ms worst case`);

  // Wheel zoom is multiplicative: a notch scales the distance by
  // 0.95^zoomSpeed. At the old 1.1 it took eighty notches to cross the range.
  const notches = (speed) => Math.ceil(
    Math.log(1.2 / 60) / Math.log(Math.pow(0.95, speed)),
  );
  console.log(`  zoom, end to end  : ${notches(2.4)} notches at 2.4 `
    + `(was ${notches(1.1)} at 1.1)`);
  check('the zoom range is crossable in a reasonable number of notches',
    notches(2.4) < 40, `${notches(2.4)}`);
}

console.log('\n10. being knocked about is a limp, not a switch');
{
  // `speedScale` used to be `stun > 0 ? 0.25 : 1` -- a step function. The body
  // has momentum and absorbs some of that, but yawRate is scaled by it
  // directly, so every landing snapped the turn rate. At eighty flies that is a
  // jolt every seven seconds, which is what "the movement is not consistent"
  // was. It eases back over the stun now.
  const sc = new Score();
  sc.flyLanded();
  const trace = [];
  let worstJump = 0;
  let prev = sc.speedScale;
  let monotonic = true;
  for (let i = 0; i < Math.round(1.6 / DT); i++) {
    sc.step(DT);
    const v = sc.speedScale;
    worstJump = Math.max(worstJump, Math.abs(v - prev));
    if (v < prev - 1e-9) monotonic = false;
    if (i % Math.round(0.15 / DT) === 0) trace.push(v.toFixed(2));
    prev = v;
  }
  console.log(`  recovery curve    : ${trace.join(' -> ')}`);
  console.log(`  worst step        : ${(worstJump * 100).toFixed(2)}% of full speed per frame`);

  check('it starts impaired', SCORING.stunSpeedScale < 0.5, `${SCORING.stunSpeedScale}`);
  check('it gets back to full speed', Math.abs(prev - 1) < 1e-6, `${prev.toFixed(3)}`);
  check('recovery never goes backwards', monotonic);
  // The whole point: no frame may move him by a visible fraction of his speed.
  // A step function scores 0.75 here.
  check('speed never changes discontinuously', worstJump < 0.02,
    `${(worstJump * 100).toFixed(2)}% worst frame`);
}

console.log('\n11. the life line');
{
  const life = new Life();
  check('he starts whole', life.hp === LIFE.max && life.alive, `${life.hp}`);

  // Exactly max landings, no more and no fewer.
  let n = 0;
  let ended = false;
  while (!ended && n < 100) { ended = life.hit(); n++; }
  console.log(`  landings survived : ${n - 1} before the ${n}th ended it`);
  check('the run ends on the max-th landing', n === LIFE.max, `${n}`);
  check('he is down', !life.alive && life.hp === 0);
  // A corpse cannot be killed again; the overlay would fire twice.
  check('further landings do not re-trigger the end', life.hit() === false);

  // Recovery: nothing before regenAfter, then one per regenEvery.
  const l2 = new Life();
  l2.hit(4);
  const hurt = l2.hp;
  for (let i = 0; i < Math.round((LIFE.regenAfter - 0.5) / DT); i++) l2.step(DT);
  check('no recovery inside the grace window', l2.hp === hurt, `${l2.hp}`);
  for (let i = 0; i < Math.round((LIFE.regenEvery * 2 + 0.5) / DT); i++) l2.step(DT);
  console.log(`  recovered         : ${l2.hp - hurt} points over ${LIFE.regenEvery * 2}s`);
  check('two points come back over two regen periods', l2.hp - hurt === 2, `${l2.hp - hurt}`);

  // And it never overfills.
  for (let i = 0; i < Math.round(600 / DT); i++) l2.step(DT);
  check('recovery stops at full', l2.hp === LIFE.max, `${l2.hp}`);

  // Under steady fire the pool goes down, not up: recovery is slower than the
  // landings even when the grace window is being cleared between them.
  const l3 = new Life();
  const every = 10;
  for (let i = 0; i < Math.round(240 / DT); i++) {
    l3.step(DT);
    if (i % Math.round(every / DT) === 0) l3.hit();
  }
  const gained = Math.floor(Math.max(0, every - LIFE.regenAfter) / LIFE.regenEvery);
  console.log(`  bitten every ${every}s  : ${l3.hp} / ${LIFE.max} after 240 s `
    + `(${gained} recovered per landing)`);
  check('steady landings drain faster than recovery refills', l3.hp < LIFE.max,
    `${l3.hp}/${LIFE.max}`);
}

console.log(`\n${failures === 0 ? 'smoke test passed' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
