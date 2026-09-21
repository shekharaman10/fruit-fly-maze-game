// What the sword actually does, in numbers.
//
//   node tools/swing.mjs
//
// The swing is integrated from torques rather than keyframed (see
// world/sword.js), which means its trajectory is a RESULT and can be wrong in
// ways a keyframe cannot: it can overshoot its own arc, bounce back up the line
// it just came down, or reach peak speed somewhere the target is not.
//
// So this prints the trajectory and checks the three things the cut has to get
// right to be a cut at all:
//
//   it has to reach the flies       they hover at 1.42 m; a blade that sweeps
//                                   between 0.56 and 1.12 m passes under every
//                                   one of them, which is what the first
//                                   version did
//   it has to be moving             peak tip speed in the region of a real cut,
//                                   20-30 m/s, and fastest near the target line
//                                   rather than at the ends of the arc
//   it must not come back up        a brake that overshoots into a negative
//                                   torque drags the blade back through the
//                                   arc, which reads as a flinch

import * as THREE from '../vendor/three.module.js';
import { buildPlayer, applyWeaponPose } from '../world/player.js';
import { VARIANTS } from '../world/human.js';
import { Swing, SWING } from '../world/sword.js';
import { AIM } from '../brain/zoro.js';
import { FLY_HIT_RADIUS } from '../world/fly.js';

const DT = 1 / 120;
const FLY_HEIGHT = 1.42;   // what the flight brain holds them at

let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

const player = buildPlayer(VARIANTS[0].id);
const scene = new THREE.Scene();
scene.add(player.group);
player.group.position.set(0, 0, 0);
player.group.rotation.y = 0;

// A stand-in for the aim state; the sword does not read it, but applyWeaponPose
// does and it has to be given something.
const zoro = { weapon: 'sword', aiming: 0, aimYaw: 0, aimPitch: 0 };
const swing = new Swing();

const a = new THREE.Vector3();
const b = new THREE.Vector3();

console.log('\n1. the trajectory');
console.log(`  phases            : windup ${SWING.windUp.t}s, drive ${SWING.drive.t}s, `
  + `follow ${SWING.follow.t}s`);
console.log(`  strike length     : ${swing.strikeEnd.toFixed(3)} s `
  + `(+${swing.cooldown}s cooldown, overlapping the recovery)`);

swing.start();
const rows = [];
let t = 0;
let peak = 0;
let uMax = -Infinity;
let uMin = Infinity;
// Set once the blade is travelling forward. Before that, u still falls after
// the wind-up torque stops -- the blade coasts a little further back on its own
// momentum, which is the behaviour, not a fault.
let driving = false;
let reversed = false;
let prevU = 0;
let liveFrom = null;
let liveTo = 0;
let edgeLow = Infinity;
let edgeHigh = -Infinity;
let liveLow = Infinity;
let liveHigh = -Infinity;
let peakAtU = 0;

for (let i = 0; i < 600 && swing.active; i++) {
  swing.step(DT);
  t += DT;
  applyWeaponPose(player, zoro, swing, DT);
  player.group.updateMatrixWorld(true);

  const sw = player.sword;
  sw.updateWorldMatrix(true, false);
  a.set(sw.userData.bladeStart, 0, 0);
  sw.localToWorld(a);
  b.copy(sw.userData.tip);
  sw.localToWorld(b);

  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  edgeLow = Math.min(edgeLow, lo);
  edgeHigh = Math.max(edgeHigh, hi);

  if (swing.contacting) {
    if (liveFrom === null) liveFrom = t;
    liveTo = t;
    liveLow = Math.min(liveLow, lo);
    liveHigh = Math.max(liveHigh, hi);
  }

  if (swing.tipSpeed > peak && swing.w > 0) { peak = swing.tipSpeed; peakAtU = swing.u; }
  uMax = Math.max(uMax, swing.u);
  uMin = Math.min(uMin, swing.u);
  // Once it is going forward, any drop in u during the strike is the blade
  // travelling back up the arc it just came down -- a flinch, which is what an
  // overshooting brake produces and what the brake is written to avoid.
  if (swing.w > 0.5) driving = true;
  if (driving && t < swing.strikeEnd && swing.u < prevU - 1e-4) reversed = true;
  prevU = swing.u;

  if (i % 6 === 0) {
    rows.push(`  ${t.toFixed(3)}  ${swing.phase().padEnd(7)}`
      + ` u=${swing.u.toFixed(3).padStart(7)}`
      + ` tip=${swing.tipSpeed.toFixed(1).padStart(5)} m/s`
      + ` edge y ${lo.toFixed(2)}..${hi.toFixed(2)} m`
      + (swing.contacting ? '  LIVE' : ''));
  }
}

console.log(rows.join('\n'));
console.log(`  total             : ${t.toFixed(3)} s to back in the carry`);

console.log('\n2. speed');
console.log(`  peak tip speed    : ${peak.toFixed(1)} m/s at u = ${peakAtU.toFixed(2)}`);
console.log(`  wind-up reaches   : u = ${uMin.toFixed(2)}`);
console.log(`  follow-through to : u = ${uMax.toFixed(2)}`);
// A hard human cut is roughly 20-30 m/s at the tip. Slower than that and the
// blade is being waved; much faster and it is not a person swinging it.
check('the tip moves at about the speed of a real cut', peak > 18 && peak < 32,
  `${peak.toFixed(1)} m/s`);
check('it is fastest near the target line, not at the ends',
  peakAtU > 0.2 && peakAtU < 0.9, `u = ${peakAtU.toFixed(2)}`);
check('it winds up before it cuts', uMin < -0.12, `u = ${uMin.toFixed(2)}`);
check('it follows through past the target line', uMax > 0.9, `u = ${uMax.toFixed(2)}`);
check('the blade never travels back up its own arc once it is cutting', !reversed);

console.log('\n3. where the edge goes');
console.log(`  edge sweeps       : ${edgeLow.toFixed(2)} .. ${edgeHigh.toFixed(2)} m`);
console.log(`  live window       : ${liveFrom === null ? 'never' : (liveFrom.toFixed(3) + '..' + liveTo.toFixed(3) + ' s ('
  + ((liveTo - liveFrom) * 1000).toFixed(0) + ' ms)')}`);
console.log(`  live edge sweeps  : ${liveLow.toFixed(2)} .. ${liveHigh.toFixed(2)} m`);
console.log(`  flies hover at    : ${FLY_HEIGHT} m (hit radius ${FLY_HIT_RADIUS} m)`);

// The aiming brain orders a cut against where the fly will be when the edge
// goes live, and that delay is a number it has to be told. If the swing is
// retuned and this is not, every strike is ordered against the wrong instant.
console.log(`  brain's swingLead : ${AIM.swingLead} s`);
check('the brain knows when the edge goes live',
  liveFrom !== null && Math.abs(AIM.swingLead - liveFrom) < 0.02,
  `AIM.swingLead ${AIM.swingLead} vs measured ${liveFrom === null ? 'never' : liveFrom.toFixed(3)}`);
check('the edge is live for long enough to be aimed',
  liveFrom !== null && (liveTo - liveFrom) > 0.04,
  liveFrom === null ? 'never live' : `${((liveTo - liveFrom) * 1000).toFixed(0)} ms`);
// The whole point. The first version swept 0.56-1.12 m and passed under every
// fly in the room; a live window that cannot reach the target is not a weapon.
check('the live edge reaches fly height',
  liveLow - FLY_HIT_RADIUS <= FLY_HEIGHT && liveHigh + FLY_HIT_RADIUS >= FLY_HEIGHT,
  `${liveLow.toFixed(2)}..${liveHigh.toFixed(2)} m vs ${FLY_HEIGHT} m`);

console.log('\n4. the cooldown does not stall the next one');
{
  const s2 = new Swing();
  s2.start();
  let tt = 0;
  let readyAt = null;
  for (let i = 0; i < 600; i++) {
    s2.step(DT);
    tt += DT;
    if (readyAt === null && s2.ready) readyAt = tt;
  }
  console.log(`  next strike after : ${readyAt === null ? 'never' : readyAt.toFixed(3) + ' s'}`);
  check('he can cut again inside a second', readyAt !== null && readyAt < 1.0,
    readyAt === null ? 'never' : `${readyAt.toFixed(2)} s`);
}

console.log(`\n${failures === 0 ? 'swing measured' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
