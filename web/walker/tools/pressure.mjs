// How survivable is the march with the swarm at its new size?
//
//   node tools/pressure.mjs [flies]
//
// The fly count went from 8 to 80 and a life line was added at the same time.
// Those two numbers decide each other: a pool of twelve landings is generous
// against eight flies and might be a few seconds against eighty. Guessing at it
// would produce either a run that cannot be lost or one that cannot be won.
//
// So this runs the actual march -- the coverage route, the same brain, the same
// rifle and sword, the same landing test -- with the flies present, and reports
// how often one gets through and how far he gets. It sweeps fly counts so the
// relationship is visible rather than asserted.
//
// It is a measurement, not a test: it prints numbers and checks only the two
// things that would make the design wrong, namely a run that cannot be lost at
// all and a run that ends before it has started.

import * as THREE from '../vendor/three.module.js';
import { FlyBrain } from '../brain/index.js';
import { FlyFlightBrain } from '../brain/flight.js';
import { ZoroBrain, AIM } from '../brain/zoro.js';
import {
  buildMaze, sense, resolveCollision, lineOfSight, cellCentre, roomAround, MAZE,
} from '../world/maze.js';
import { buildPlayer, applyWeaponPose, gripTargets } from '../world/player.js';
import { VARIANTS } from '../world/human.js';
import { FLY_HIT_RADIUS, FLY_CLEAR_RADIUS } from '../world/fly.js';
import { Swing } from '../world/sword.js';
import { Bolts } from '../world/laser.js';
import { Score, SCORING } from '../score.js';
import { Tour, TOUR } from '../tour.js';
import { Life, LIFE } from '../life.js';
import { makeRandom, wrapPi, clamp } from '../brain/neuron.js';

const DT = 1 / 120;
const GATE_TAU = 0.12;
const RETALIATE_FOR = 2.5;
const PERCEIVED = 10;
const FRONTAL = 1.31;
const ENGAGE_GATE = 0.40;
const ENGAGE_BUDGET = 1.6;
const ENGAGE_REST = 2.2;
const ART_CLEAR = 5.5;
const MINUTES_CAP = 12;   // give up on a run after this much simulated time

let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

function segDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t), pz - (az + dz * t));
}

/**
 * One full run. Returns what happened, not whether it was good.
 * @param {number} nFlies
 * @param {number} seed
 */
function run(nFlies, seed) {
  const world = buildMaze({ seed });
  const scene = new THREE.Scene();
  scene.add(world.group);
  const player = buildPlayer(VARIANTS[0].id);
  scene.add(player.group);

  const rng = makeRandom(seed ^ 0x5bf03635);
  const brain = new FlyBrain({ seed, sex: 'male' });
  const zoro = new ZoroBrain({ seed: seed + 11 });
  const swing = new Swing();
  const score = new Score();
  const life = new Life();
  const bolts = new Bolts(scene, { speed: AIM.boltSpeed });
  const tour = new Tour(world.pictures);

  const body = {
    x: world.outside.x,
    z: world.outside.z,
    yaw: Math.atan2(-world.outside.x, -world.outside.z),
    yawRate: 0,
  };
  brain.anchor(body.yaw);
  const nav = { bearing: 0, targetVisible: false };
  const env = { obstacles: [], hw: MAZE.outerR, hd: MAZE.outerR, maxY: MAZE.height - 0.2 };

  const freePoint = (minFrom) => {
    for (let t = 0; t < 200; t++) {
      const id = 1 + (Math.floor(rng() * (world.graph.n - 1)) % (world.graph.n - 1));
      const c = cellCentre(world.graph, id);
      if (Math.hypot(c.x - body.x, c.z - body.z) >= minFrom) return c;
    }
    return { x: world.start.x, z: world.start.z };
  };

  const flies = [];
  for (let i = 0; i < nFlies; i++) {
    const p = freePoint(4);
    const f = {
      id: i,
      flyBrain: new FlyFlightBrain({ seed: seed + 1000 + i * 97 }),
      state: { x: p.x, y: 1.35, z: p.z, yaw: rng() * Math.PI * 2, yawRate: 0, stun: 0 },
      alive: true, respawnIn: 0, escapes: 0, wasEscaping: false,
    };
    f.flyBrain.anchor(f.state.yaw);
    flies.push(f);
  }

  const muzzle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const bladeA = new THREE.Vector3();
  const bladeB = new THREE.Vector3();

  let gateSmooth = 1;
  let marchIndex = 0;
  let retaliate = null;
  let engageLeft = ENGAGE_BUDGET;
  let engageRest = 0;
  let stalled = 0;
  let prevMiss = 0;
  let landings = 0;
  let dead = false;
  let arrived = false;
  let t = 0;
  const WIN_R = MAZE.centreR - 0.35;
  const pts = world.routePoints;
  const STEPS = Math.round((MINUTES_CAP * 60) / DT);

  for (let i = 0; i < STEPS; i++) {
    t = i * DT;
    score.step(DT);
    zoro.cooldownScale = score.cooldownScale;
    life.step(DT);

    for (const f of flies) {
      if (!f.alive) {
        f.respawnIn -= DT;
        if (f.respawnIn <= 0) {
          const p = freePoint(5);
          Object.assign(f.state, {
            x: p.x, z: p.z, y: 1.35, yaw: rng() * 6.28, yawRate: 0, stun: 0.35,
          });
          f.flyBrain.anchor(f.state.yaw);
          f.alive = true;
        }
        continue;
      }
      const out = f.flyBrain.step(DT, {
        pos: f.state, yaw: f.state.yaw, yawRate: f.state.yawRate,
        zoro: { x: body.x, y: 1.25, z: body.z }, bolts: bolts.liveBolts, bounds: env,
      });
      f.state.stun = Math.max(0, f.state.stun - DT);
      const sp = f.state.stun > 0 ? out.speed * 0.2 : out.speed;
      f.state.yawRate = out.yawRate;
      f.state.yaw = wrapPi(f.state.yaw + out.yawRate * DT);
      f.state.x += Math.sin(f.state.yaw) * sp * DT;
      f.state.z += Math.cos(f.state.yaw) * sp * DT;
      f.state.y = clamp(f.state.y + out.climb * DT, 0.5, MAZE.height - 0.4);
      const fp = resolveCollision(world, f.state.x, f.state.z, FLY_CLEAR_RADIUS,
        { props: false });
      f.state.x = fp.x;
      f.state.z = fp.z;
    }

    // Perception: nearest PERCEIVED only, exactly as main.js does it.
    const inRange = [];
    for (const f of flies) {
      if (!f.alive) continue;
      const d2 = (f.state.x - body.x) ** 2 + (f.state.z - body.z) ** 2;
      if (d2 < AIM.maxRange * AIM.maxRange) inRange.push({ f, d2 });
    }
    inRange.sort((a, b) => a.d2 - b.d2);
    if (inRange.length > PERCEIVED) inRange.length = PERCEIVED;

    const candidates = [];
    for (const near of inRange) {
      const f = near.f;
      const dx = f.state.x - body.x;
      const dz = f.state.z - body.z;
      const range = Math.hypot(dx, dz);
      const bearing = wrapPi(Math.atan2(dx, dz) - body.yaw);
      const clear = lineOfSight(world, body.x, body.z, f.state.x, f.state.z);
      const vis = Math.abs(bearing) < 1.31 && range < AIM.maxRange && clear;
      candidates.push({
        id: f.id, fly: f, range, bearing,
        heard: range < AIM.hearingRange && clear,
        observed: vis ? { x: f.state.x, y: f.state.y, z: f.state.z } : null,
      });
    }
    const chosen = zoro.selectTarget(candidates);
    if (chosen) {
      world.target.position.set(chosen.fly.state.x, chosen.fly.state.y, chosen.fly.state.z);
    } else {
      world.target.position.set(body.x + 1e4, -50, body.z + 1e4);
    }

    // Legs: settle a score, look at a picture, otherwise march.
    let gate = 1;
    if (retaliate) {
      const f = flies.find((x) => x.id === retaliate.id);
      retaliate.left -= DT;
      if (!f || !f.alive || retaliate.left <= 0) retaliate = null;
      else {
        nav.bearing = wrapPi(Math.atan2(f.state.x - body.x, f.state.z - body.z) - body.yaw);
        gate = Math.hypot(f.state.x - body.x, f.state.z - body.z) > 2.2 ? 1 : 0;
      }
    }
    // Flies before art, exactly as main.js orders it.
    let engaging = false;
    if (engageRest > 0) engageRest -= DT;
    if (!retaliate && engageRest <= 0) {
      if (chosen && Math.abs(chosen.bearing) > FRONTAL) {
        nav.bearing = chosen.bearing;
        engaging = true;
      } else if (!chosen && zoro.orientBearing !== null) {
        nav.bearing = zoro.orientBearing;
        engaging = true;
      }
      if (engaging) gate = ENGAGE_GATE;
    }
    if (engaging) {
      engageLeft -= DT;
      if (engageLeft <= 0) {
        engaging = false;
        engageLeft = ENGAGE_BUDGET;
        engageRest = ENGAGE_REST;
      }
    } else if (engageRest <= 0) {
      engageLeft = Math.min(ENGAGE_BUDGET, engageLeft + DT * 0.6);
    }
    let nearestFly = Infinity;
    for (const c of candidates) {
      if (c.observed || c.heard) nearestFly = Math.min(nearestFly, c.range);
    }
    const clearOfFlies = !engaging && nearestFly > ART_CLEAR;
    const look = (retaliate || engaging || !clearOfFlies) ? null : tour.step(DT, body);
    if (look) {
      nav.bearing = look.bearing;
      gate = TOUR.slow;
    }
    // Ticked off wherever he got to, whatever was steering -- same as main.js.
    const wp = pts[Math.min(marchIndex, pts.length - 1)];
    if (Math.hypot(wp.x - body.x, wp.z - body.z) < 0.55 && marchIndex < pts.length - 1) {
      marchIndex++;
    }
    if (!look && !retaliate && !engaging) {
      nav.bearing = wrapPi(Math.atan2(wp.x - body.x, wp.z - body.z) - body.yaw);
    }

    const reading = sense(world, body, nav);
    const motor = brain.step(DT, {
      ...reading, angularVelocity: body.yawRate, halt: gate === 0,
    });
    gateSmooth += (gate - gateSmooth) * (1 - Math.exp(-DT / GATE_TAU));
    const impair = score.speedScale * gateSmooth;

    body.yawRate = motor.yawRate * score.speedScale;
    body.yaw = wrapPi(body.yaw + body.yawRate * DT);
    const fx = resolveCollision(world,
      body.x + Math.sin(body.yaw) * motor.speed * impair * DT,
      body.z + Math.cos(body.yaw) * motor.speed * impair * DT);
    body.x = fx.x;
    body.z = fx.z;

    const st = brain.state();
    player.group.position.set(body.x, 0, body.z);
    player.group.rotation.y = body.yaw;
    swing.step(DT);
    applyWeaponPose(player, zoro, swing, DT, roomAround(world, body.x, body.z));
    const grips = gripTargets(player);
    player.human.pose({
      legPhase: st.legPhase, speed: st.speed * gateSmooth, turnCommand: st.turnCommand,
      armHold: 1, rightHandTarget: grips.right, leftHandTarget: grips.left,
    });
    player.muzzle.updateWorldMatrix(true, false);
    player.muzzle.getWorldPosition(muzzle);

    const cmd = zoro.step(DT, {
      muzzle, bodyYaw: body.yaw,
      observed: chosen ? chosen.observed : null,
      range: chosen ? chosen.range : Infinity,
    });
    if (cmd.fire && cmd.lead) {
      dir.set(cmd.lead.x - muzzle.x, cmd.lead.y - muzzle.y, cmd.lead.z - muzzle.z).normalize();
      if (bolts.spawn(muzzle, dir)) zoro.didFire();
    }
    if (cmd.swing) swing.start();

    if (swing.contacting && !swing.hasCut) {
      const sw = player.sword;
      sw.updateWorldMatrix(true, false);
      bladeA.set(sw.userData.bladeStart, 0, 0);
      sw.localToWorld(bladeA);
      bladeB.copy(sw.userData.tip);
      sw.localToWorld(bladeB);
      for (const f of flies) {
        if (!f.alive) continue;
        if (segDist(bladeA.x, bladeA.y, bladeA.z, bladeB.x, bladeB.y, bladeB.z,
          f.state.x, f.state.y, f.state.z) <= FLY_HIT_RADIUS + 0.05) {
          f.alive = false;
          f.respawnIn = 2.5;
          score.swordCut();
          swing.hasCut = true;
          break;
        }
      }
    }

    const targets = flies.filter((f) => f.alive)
      .map((f) => ({ pos: f.state, radius: FLY_HIT_RADIUS, id: f.id }));
    for (const h of bolts.update(DT, env, targets)) {
      const f = flies.find((x) => x.id === h.id);
      if (f && f.alive) { zoro.hits++; f.alive = false; f.respawnIn = 2.5; score.shotKill(); }
    }
    score.missedShots(bolts.missCount - prevMiss);
    prevMiss = bolts.missCount;

    let ended = false;
    for (const f of flies) {
      if (!f.alive) continue;
      const d = Math.hypot(
        f.state.x - body.x, f.state.y - SCORING.landingHeight, f.state.z - body.z,
      );
      if (d <= SCORING.landingRadius && score.flyLanded()) {
        landings++;
        const away = Math.atan2(f.state.x - body.x, f.state.z - body.z);
        f.state.x = body.x + Math.sin(away) * 1.6;
        f.state.z = body.z + Math.cos(away) * 1.6;
        f.state.stun = 0.3;
        retaliate = { id: f.id, left: RETALIATE_FOR };
        if (life.hit()) { ended = true; break; }
      }
    }
    if (ended) { dead = true; break; }

    if (Math.hypot(body.x, body.z) < WIN_R) { arrived = true; break; }
    if (!Number.isFinite(body.x)) break;
  }

  return {
    seconds: t,
    landings,
    dead,
    arrived,
    hp: life.hp,
    kills: zoro.hits + score.cuts,
    cuts: score.cuts,
    progress: marchIndex / (pts.length - 1),
    // Art is the lowest priority, so with the swarm about it is the thing most
    // likely to get squeezed out entirely. Worth reporting rather than assuming.
    viewed: tour.viewedCount,
  };
}

const want = Number(process.argv[2]);
const COUNTS = Number.isFinite(want) && want > 0 ? [want] : [8, 20, 40, 80];
const SEEDS = [20260917, 7, 991];

console.log(`\nlife line: ${LIFE.max} landings, one back every `
  + `${LIFE.regenEvery}s after ${LIFE.regenAfter}s clear`);
console.log(`immunity between landings: ${SCORING.immunity}s `
  + `(so the floor on a run is ${(LIFE.max * SCORING.immunity).toFixed(0)}s)\n`);

console.log('  flies   runs  reached centre   landings/min   median end    kills');
console.log('  ' + '-'.repeat(72));

const byCount = new Map();
for (const n of COUNTS) {
  const runs = SEEDS.map((s) => run(n, s));
  byCount.set(n, runs);
  const reached = runs.filter((r) => r.arrived).length;
  const rate = runs.reduce((a, r) => a + (r.landings / (r.seconds / 60)), 0) / runs.length;
  const ends = runs.map((r) => r.seconds).sort((a, b) => a - b);
  const median = ends[Math.floor(ends.length / 2)];
  const kills = runs.reduce((a, r) => a + r.kills, 0) / runs.length;
  console.log(`  ${String(n).padStart(5)}   ${String(runs.length).padStart(4)}`
    + `   ${String(reached + '/' + runs.length).padStart(14)}`
    + `   ${rate.toFixed(1).padStart(12)}`
    + `   ${(median.toFixed(0) + ' s').padStart(10)}`
    + `   ${kills.toFixed(0).padStart(6)}`);
}

console.log('');
for (const n of COUNTS) {
  for (const r of byCount.get(n)) {
    console.log(`  ${String(n).padStart(3)} flies: `
      + `${r.dead ? 'eliminated' : r.arrived ? 'reached the centre' : 'ran out of time'}`
      + ` at ${r.seconds.toFixed(0)}s, ${r.landings} landings, `
      + `${(100 * r.progress).toFixed(0)}% of the route, ${r.kills} killed `
      + `(${r.cuts} cut), ${r.viewed} pictures seen`);
  }
}

const busiest = byCount.get(COUNTS[COUNTS.length - 1]);
const anyEnd = busiest.some((r) => r.dead || r.arrived);
const shortest = Math.min(...busiest.map((r) => r.seconds));

console.log('');
// Two ways the design would be wrong. Everything between them is a judgement
// about how hard it should be, which is not something a test can settle.
check('the busiest run resolves rather than grinding on', anyEnd);
check('no run ends in the first half-minute', shortest > 30, `${shortest.toFixed(0)} s`);

console.log(`\n${failures === 0 ? 'pressure measured' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
