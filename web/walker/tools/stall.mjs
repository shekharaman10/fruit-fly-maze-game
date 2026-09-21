// Does any one picture hold the character up, and for how long?
//
//   node tools/stall.mjs [seeds...]
//
// Reported from the browser as "always stuck at the pulp fiction poster". The
// march test passes, so whatever this is does not stop him reaching the centre
// -- it just costs an unreasonable amount of time somewhere the march test only
// sees as a slightly longer run.
//
// So this runs the same march and watches the tour rather than the route: how
// long each picture holds him, how far he moves while it does, and how far away
// he gets from it in the meantime.
//
// THE FLIES ARE THE POINT. Without them the tour is never interrupted and
// nothing goes wrong -- every picture costs about `dwell` and he walks on. In
// the scene the tour only runs with the ground clear, so an attempt is cut off
// the moment something shows up and resumed whenever it next clears. This
// simulates that with a duty cycle rather than eighty flies, because the thing
// under test is the tour's bookkeeping, not the swarm.

import * as THREE from '../vendor/three.module.js';
import { FlyBrain } from '../brain/index.js';
import { buildMaze, sense, MAZE, BODY_RADIUS } from '../world/maze.js';
import { Tour, TOUR } from '../tour.js';
import { moveAndSlide, moveToward, planarSpeed } from '../world/body3d.js';
import { wrapPi } from '../brain/neuron.js';

const DT = 1 / 120;
const GATE_TAU = 0.12;
const WALK_ACCEL = 9.0;
const WALK_BRAKE = 11.0;
const WAYPOINT_REACHED = 0.55;

let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

function march(seed) {
  const world = buildMaze({ seed });
  const brain = new FlyBrain({ seed, sex: 'male' });
  const tour = new Tour(world.pictures);
  const body = {
    x: world.outside.x,
    z: world.outside.z,
    yaw: Math.atan2(-world.outside.x, -world.outside.z),
    yawRate: 0,
    vx: 0,
    vz: 0,
  };
  brain.anchor(body.yaw);
  const nav = { bearing: 0, targetVisible: false };

  let gate = 1;
  let marchIndex = 0;
  const pts = world.routePoints;

  // Per-attempt bookkeeping: which picture, since when, from where.
  let attempt = null;
  const attempts = [];

  // Stands in for "a fly is about" -- the condition main.js gates the tour on.
  // Roughly the measured rate at eighty flies: busy about a third of the time,
  // in bursts of a couple of seconds.
  let busyUntil = 0;
  let nextBusy = 4;

  const LIMIT = 120 * 60 * 20;
  for (let i = 0; i < LIMIT; i++) {
    const t = i * DT;
    let want = 1;

    if (INTERRUPT && t > nextBusy) {
      busyUntil = t + BUSY_FOR;
      nextBusy = t + BUSY_EVERY;
    }
    const clear = !INTERRUPT || t > busyUntil;

    const look = clear ? tour.step(DT, body) : null;
    if (look) {
      nav.bearing = look.bearing;
      want = TOUR.slow;
      if (!attempt || attempt.index !== look.index) {
        attempt = {
          index: look.index,
          file: world.pictures[look.index].file,
          from: t,
          x0: body.x,
          z0: body.z,
          contact: 0,
          frames: 0,
          farthest: 0,
        };
        attempts.push(attempt);
      }
      attempt.frames++;
    }

    const wp = pts[Math.min(marchIndex, pts.length - 1)];
    if (Math.hypot(wp.x - body.x, wp.z - body.z) < WAYPOINT_REACHED
      && marchIndex < pts.length - 1) marchIndex++;
    if (!look) nav.bearing = wrapPi(Math.atan2(wp.x - body.x, wp.z - body.z) - body.yaw);

    const reading = sense(world, body, nav);
    if (look && reading.contact) attempt.contact++;
    const motor = brain.step(DT, { ...reading, angularVelocity: body.yawRate, halt: false });
    gate += (want - gate) * (1 - Math.exp(-DT / GATE_TAU));

    body.yawRate = motor.yawRate;
    body.yaw = wrapPi(body.yaw + body.yawRate * DT);
    const wish = motor.speed * gate;
    const rate = (wish > planarSpeed(body) ? WALK_ACCEL : WALK_BRAKE) * DT;
    const v = moveToward(body.vx, body.vz,
      Math.sin(body.yaw) * wish, Math.cos(body.yaw) * wish, rate);
    body.vx = v.x;
    body.vz = v.z;
    moveAndSlide(world, body, DT, {
      radius: BODY_RADIUS, wallT: MAZE.wallT, gravity: true, floorY: 0,
    });

    if (look) {
      const pic = world.pictures[look.index];
      attempt.to = t;
      attempt.moved = Math.hypot(body.x - attempt.x0, body.z - attempt.z0);
      // How far he is being steered from, which is the number that matters:
      // `notice` is 2.4 m and only gates ACQUIRING a picture. Once one is
      // current there is no distance limit at all, so an attempt interrupted
      // and resumed can drag him back across the maze.
      attempt.farthest = Math.max(attempt.farthest,
        Math.hypot(pic.x - body.x, pic.z - body.z));
    }

    if (Math.hypot(body.x, body.z) < MAZE.centreR - 0.35) {
      return { world, attempts, arrived: true, seconds: t, marchIndex };
    }
  }
  return { world, attempts, arrived: false, seconds: LIMIT * DT, marchIndex };
}

const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
const SEEDS = seeds.length ? seeds : [20260917, 7, 991];

const INTERRUPT = !process.argv.includes('--clear');
// How much of the time something is about. MEASURED from tools/pressure.mjs: at
// eighty flies a run of ~570 s saw only ten pictures, so the ground is clear a
// small fraction of the time. --busy sets the duty cycle; the default is the
// heavy one, because that is the case that was reported broken.
const busyArg = process.argv.find((a) => a.startsWith('--busy='));
const BUSY = busyArg ? Number(busyArg.slice(7)) : 0.85;
const BUSY_EVERY = 6;
const BUSY_FOR = BUSY_EVERY * BUSY;

let worst = 0;
let worstFile = '';
let farthest = 0;
let farFile = '';
let totalStuck = 0;

for (const seed of SEEDS) {
  const r = march(seed);
  console.log(`\nseed ${seed}: ${r.arrived ? 'reached the centre' : 'DID NOT ARRIVE'}`
    + ` at ${r.seconds.toFixed(0)}s, ${r.attempts.length} pictures engaged`);

  // `engaged` is the time he was actually being steered at the picture, which
  // is the thing that can run away. `held` is wall clock from first touch to
  // last and includes every interruption in between, so it grows with the duty
  // cycle no matter how well the tour behaves -- worth printing, not worth
  // asserting on.
  const byTime = r.attempts
    .map((a) => ({ ...a, held: (a.to ?? a.from) - a.from, engaged: a.frames * DT }))
    .sort((x, y) => y.engaged - x.engaged);

  for (const a of byTime.slice(0, 5)) {
    console.log(`  ${a.engaged.toFixed(1).padStart(5)} s steering`
      + ` (${a.held.toFixed(1).padStart(5)} s wall clock)  ${a.file.padEnd(26)}`
      + ` up to ${a.farthest.toFixed(1)} m away`);
    if (a.engaged > worst) { worst = a.engaged; worstFile = a.file; }
    if (a.farthest > farthest) { farthest = a.farthest; farFile = a.file; }
  }
  // Summed over `engaged`, not `held`: the wall-clock spans overlap each other
  // and count every interruption twice over, so they add up to more than the
  // run itself at a high duty cycle.
  totalStuck += byTime.reduce((s, a) => s + a.engaged, 0);
}

console.log(`\nworst time steering at one picture: ${worst.toFixed(1)} s (${worstFile})`);
console.log(`steered from farthest              : ${farthest.toFixed(1)} m (${farFile})`);
console.log(`limits: give up past ${TOUR.abandonAt} m or after `
  + `${TOUR.abandonAfter} s of attempting\n`);

// A picture is meant to cost about `dwell` plus the turn onto it, and the tour
// gives up at `abandonAfter`. One frame of slack for the check that ends it.
check('no picture is attempted for longer than the give-up time',
  worst <= TOUR.abandonAfter + 0.05,
  `${worst.toFixed(1)} s on ${worstFile}, limit ${TOUR.abandonAfter} s`);
check('the tour does not dominate the run', totalStuck / SEEDS.length < 60,
  `${(totalStuck / SEEDS.length).toFixed(0)} s per run steering at pictures`);
// He is not meant to be dragged back to a picture he has walked away from. The
// notice radius decides which picture is worth stopping for; letting an attempt
// outlive it means the tour can pull him off the march from anywhere.
check('he is never steered to a picture he has walked away from',
  farthest <= TOUR.abandonAt + 0.15,
  `${farthest.toFixed(1)} m on ${farFile}, limit ${TOUR.abandonAt} m`);

console.log(`\n${failures === 0 ? 'no stalls' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
