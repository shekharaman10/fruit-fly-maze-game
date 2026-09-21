// One headless run of the duel, with no renderer.
//
// Shared by tools/experiment.mjs so the measurement runs the same loop the
// scene runs. A benchmark that reimplements the thing it measures is measuring
// the reimplementation.

import * as THREE from '../vendor/three.module.js';
import { FlyBrain } from '../brain/index.js';
import { FlyFlightBrain } from '../brain/flight.js';
import { ZoroBrain, AIM } from '../brain/zoro.js';
import { SearchWalk } from '../brain/forage.js';
import {
  buildMaze, sense, resolveCollision, lineOfSight, cellCentre, MAZE, ROOM, BODY_RADIUS,
} from '../world/maze.js';
import { buildPlayer, applyWeaponPose, gripTargets } from '../world/player.js';
import { VARIANTS } from '../world/human.js';
import { buildFly, FLY_HIT_RADIUS } from '../world/fly.js';
import { Swing } from '../world/sword.js';
import { Bolts } from '../world/laser.js';
import { Score, SCORING } from '../score.js';
import { moveAndSlide, moveToward, planarSpeed } from '../world/body3d.js';

// Same controller the scene runs -- see world/body3d.js. These tools exist so
// the march can be measured without a browser, and a tool that integrates
// movement its own way is measuring its own integration.
const WALK_ACCEL = 9.0;
const WALK_BRAKE = 11.0;

import { makeRandom, wrapPi, clamp } from '../brain/neuron.js';

const DT = 1 / 120;
const MAX_FLIES = 3;

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
 * @param {object} opts
 * @param {number} opts.seed
 * @param {number} [opts.seconds]
 * @param {boolean} [opts.escapeEnabled] false hides the bolts from LPLC2, so
 *   the giant fiber never trips and the fly flies on as if unthreatened.
 * @param {string} [opts.variantId]
 * @param {function} [opts.onStep] called every 120 steps with a state snapshot,
 *   for diagnosing runs that go wrong rather than guessing at them.
 */
export function runDuel(opts) {
  const seconds = opts.seconds ?? 150;
  const escapeEnabled = opts.escapeEnabled !== false;

  const scene = new THREE.Scene();
  // Open arena, not the maze -- see the `open` note in world/maze.js.
  const world = buildMaze({ seed: opts.seed, open: true });
  scene.add(world.group);
  const player = buildPlayer(opts.variantId || VARIANTS[0].id);
  scene.add(player.group);
  const bolts = new Bolts(scene, { speed: AIM.boltSpeed });

  const rng = makeRandom(opts.seed);
  const brain = new FlyBrain({ seed: opts.seed, sex: 'male' });
  const zoro = new ZoroBrain();
  const swing = new Swing();
  const search = new SearchWalk({ seed: opts.seed + 7 });
  const score = new Score();

  const body = { x: -7.0, z: 3.0, y: 0, vx: 0, vy: 0, vz: 0, onFloor: true, yaw: 0.6, yawRate: 0 };
  brain.anchor(body.yaw);
  const env = { obstacles: [], hw: MAZE.outerR + 1, hd: MAZE.outerR + 1, maxY: MAZE.height - 0.1 };
  const nav = { bearing: 0, targetVisible: true };

  // Somewhere standable in the maze, at least `minFrom` from the character.
  const freePoint = (minFrom = 0) => {
    for (let t = 0; t < 200; t++) {
      const id = 1 + (Math.floor(rng() * (world.graph.n - 1)) % (world.graph.n - 1));
      const c = cellCentre(world.graph, id);
      if (Math.hypot(c.x - body.x, c.z - body.z) >= minFrom) return c;
    }
    return { x: world.start.x, z: world.start.z };
  };

  const flies = [];
  for (let i = 0; i < MAX_FLIES; i++) {
    const view = buildFly();
    scene.add(view.group);
    const p = freePoint(3.0);
    const f = {
      id: i,
      view,
      flyBrain: new FlyFlightBrain({ seed: opts.seed + 1000 + i * 97 }),
      state: { x: p.x, y: 1.45, z: p.z, yaw: rng() * 6.283, yawRate: 0, stun: 0 },
      alive: true, respawnIn: 0, escapes: 0, wasEscaping: false,
    };
    f.flyBrain.anchor(f.state.yaw);
    flies.push(f);
  }

  const muzzle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const bladeA = new THREE.Vector3();
  const bladeB = new THREE.Vector3();

  let prevMiss = 0;
  let escapes = 0;
  let meleeFrames = 0;
  let walked = 0;
  let px = body.x;
  let pz = body.z;

  const STEPS = Math.round(seconds * 120);
  for (let i = 0; i < STEPS; i++) {
    score.step(DT);
    zoro.cooldownScale = score.cooldownScale;

    for (const f of flies) {
      if (!f.alive) {
        f.respawnIn -= DT;
        if (f.respawnIn <= 0) {
          const p = freePoint(3);
          Object.assign(f.state, {
            x: p.x, z: p.z, y: 1.45, yaw: rng() * 6.283, yawRate: 0, stun: 0.3,
          });
          f.flyBrain.anchor(f.state.yaw);
          f.alive = true;
        }
        continue;
      }

      const out = f.flyBrain.step(DT, {
        pos: f.state, yaw: f.state.yaw, yawRate: f.state.yawRate,
        zoro: { x: body.x, y: 1.25, z: body.z },
        bolts: escapeEnabled ? bolts.liveBolts : [],
        bounds: env,
      });
      if (out.escaping && !f.wasEscaping) escapes++;
      f.wasEscaping = out.escaping;

      f.state.stun = Math.max(0, f.state.stun - DT);
      const sp = f.state.stun > 0 ? out.speed * 0.2 : out.speed;
      f.state.yawRate = out.yawRate;
      f.state.yaw = wrapPi(f.state.yaw + out.yawRate * DT);
      f.state.x += Math.sin(f.state.yaw) * sp * DT;
      f.state.z += Math.cos(f.state.yaw) * sp * DT;
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
        radius: 0.30, wallT: MAZE.wallT, props: false,
        floorY: 0.5, ceilingY: MAZE.height - 0.4,
      });
    }

    const candidates = [];
    for (const f of flies) {
      if (!f.alive) continue;
      const dx = f.state.x - body.x;
      const dz = f.state.z - body.z;
      const range = Math.hypot(dx, dz);
      const bearing = wrapPi(Math.atan2(dx, dz) - body.yaw);
      // Frontal field, in range, and not through a partition.
      const clear = lineOfSight(world, body.x, body.z, f.state.x, f.state.z);
      const vis = Math.abs(bearing) < 1.31 && range < AIM.maxRange && clear;
      candidates.push({
        id: f.id, fly: f, range, bearing,
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

    const searchBearing = search.step(DT, {
      hasTarget: Boolean(engaged), x: body.x, z: body.z, yaw: body.yaw, bounds: env,
    });
    // Nothing in the frontal field but something audible: turn toward it.
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
    body.vx = v.x;
    body.vz = v.z;
    moveAndSlide(world, body, DT, {
      radius: BODY_RADIUS, wallT: MAZE.wallT, gravity: true, floorY: 0,
    });

    walked += Math.hypot(body.x - px, body.z - pz);
    px = body.x;
    pz = body.z;

    if (opts.onStep && i % 120 === 0) {
      opts.onStep({
        t: i / 120, x: body.x, z: body.z, yaw: body.yaw,
        speed: motor.speed, impair,
        contact: reading.contact, proxL: reading.proxL, proxR: reading.proxR,
        engaged: engaged ? engaged.id : null,
        targetDistance: reading.targetDistance,
        mdn: brain.dn.mdn.rate, dnp09: brain.dn.dnp09.rate,
        stunned: score.stunned,
      });
    }

    const st = brain.state();
    player.group.position.set(body.x, 0, body.z);
    player.group.rotation.y = body.yaw;
    swing.step(DT);
    applyWeaponPose(player, zoro, swing, DT);
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
    if (zoro.weapon === 'sword') meleeFrames++;

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
        const d = segDist(bladeA.x, bladeA.y, bladeA.z, bladeB.x, bladeB.y, bladeB.z,
          f.state.x, f.state.y, f.state.z);
        if (d <= FLY_HIT_RADIUS + 0.05) {
          f.alive = false;
          f.respawnIn = 1.3;
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
      if (f && f.alive) {
        zoro.hits++;
        f.alive = false;
        f.respawnIn = 1.3;
        score.shotKill();
      }
    }
    score.missedShots(bolts.missCount - prevMiss);
    prevMiss = bolts.missCount;

    for (const f of flies) {
      if (!f.alive) continue;
      const d = Math.hypot(
        f.state.x - body.x, f.state.y - SCORING.landingHeight, f.state.z - body.z,
      );
      if (d <= SCORING.landingRadius && score.flyLanded()) {
        const away = Math.atan2(f.state.x - body.x, f.state.z - body.z);
        f.state.x = body.x + Math.sin(away) * 1.9;
        f.state.z = body.z + Math.cos(away) * 1.9;
        f.state.stun = 0.3;
      }
    }
  }

  return {
    shots: zoro.shots,
    hits: zoro.hits,
    cuts: score.cuts,
    landings: score.landings,
    misses: score.misses,
    points: score.points,
    escapes,
    switches: zoro.switches,
    meleeFraction: meleeFrames / STEPS,
    walked,
    seconds,
  };
}

export { MAX_FLIES, FLY_HIT_RADIUS, AIM };
