// Checks the circuit does what it claims, before any of it is rendered.
//
//   run: node tools/validate.mjs
//
// Every number printed is measured from a run here, not asserted from theory.

import { FlyBrain } from '../brain/index.js';
import { CentralComplex } from '../brain/centralComplex.js';
import { VentralNerveCord } from '../brain/vnc.js';
import { wrapPi, circularMean } from '../brain/neuron.js';
import { TRIPOD_A, TRIPOD_B, WEIGHTS } from '../brain/connectome.js';

const DT = 1 / 120;
let failures = 0;

function check(name, pass, detail) {
  const tag = pass ? 'PASS' : 'FAIL';
  if (!pass) failures++;
  console.log(`  [${tag}] ${name}${detail ? '  ' + detail : ''}`);
}

// --- 1. The ring attractor holds a single bump -----------------------------
console.log('\n1. EPG bump formation');
{
  const cx = new CentralComplex();
  for (let t = 0; t < 400; t++) {
    cx.step(DT, { angularVelocity: 0, landmarkHeading: 0, landmarkStrength: 0, goalAngle: 0 });
  }
  check('bump is concentrated', cx.bumpStrength > 0.6,
        `strength=${cx.bumpStrength.toFixed(3)}`);

  // The bump settles a fraction of a wedge away from where it was seeded. That
  // is discretisation, not drift: 16 wedges are 22.5 deg apart and the attractor
  // has a preferred offset between them. What matters is that it then STAYS,
  // so stability is measured over time rather than absolute position.
  const settled = cx.headingEstimate;
  for (let t = 0; t < 1200; t++) {
    cx.step(DT, { angularVelocity: 0, landmarkHeading: 0, landmarkStrength: 0, goalAngle: 0 });
  }
  const drift = Math.abs(wrapPi(cx.headingEstimate - settled)) * 180 / Math.PI;
  const offset = Math.abs(wrapPi(settled)) * 180 / Math.PI;
  console.log(`     settling offset from seed: ${offset.toFixed(1)} deg (wedge spacing 22.5)`);
  console.log(`     drift over a further 10 s: ${drift.toFixed(3)} deg`);
  check('bump holds position once settled', drift < 1.0, `${drift.toFixed(3)} deg / 10 s`);
}

// --- 2. PEN gain: how fast does the bump rotate per rad/s of body rotation? -
// This is the one free parameter that cannot be reasoned to, so it is measured.
console.log('\n2. PEN velocity gain (landmark OFF, pure dead reckoning)');
{
  const measure = (omega) => {
    const cx = new CentralComplex();
    for (let t = 0; t < 200; t++) {
      cx.step(DT, { angularVelocity: 0, landmarkHeading: 0, landmarkStrength: 0, goalAngle: 0 });
    }
    const start = cx.headingEstimate;
    const steps = 240;
    let unwrapped = start;
    let prev = start;
    for (let t = 0; t < steps; t++) {
      cx.step(DT, { angularVelocity: omega, landmarkHeading: 0, landmarkStrength: 0, goalAngle: 0 });
      unwrapped += wrapPi(cx.headingEstimate - prev);
      prev = cx.headingEstimate;
    }
    return (unwrapped - start) / (steps * DT); // rad/s of bump motion
  };

  const tests = [-1.2, -0.6, -0.2, 0.2, 0.6, 1.2];
  let num = 0;
  let den = 0;
  console.log('     omega(rad/s)  bump(rad/s)   ratio');
  for (const w of tests) {
    const b = measure(w);
    console.log(`     ${w.toFixed(2).padStart(10)}  ${b.toFixed(3).padStart(11)}  ${(b / w).toFixed(3).padStart(7)}`);
    num += b * w;
    den += w * w;
  }
  const slope = num / den;
  console.log(`     least-squares slope: ${slope.toFixed(3)}  (want 1.000)`);
  console.log(`     -> penVelocityGain should be scaled by ${(1 / slope).toFixed(3)}`);
  check('bump rotation is linear in angular velocity, slope within 15% of 1',
        Math.abs(slope - 1) < 0.15, `slope=${slope.toFixed(3)}`);
}

// --- 3. The landmark corrects drift ----------------------------------------
console.log('\n3. ER landmark anchoring');
{
  const cx = new CentralComplex();
  // Bump starts at 0, landmark says the true heading is 2.0 rad.
  for (let t = 0; t < 600; t++) {
    cx.step(DT, { angularVelocity: 0, landmarkHeading: 2.0, landmarkStrength: 1, goalAngle: 0 });
  }
  const err = Math.abs(wrapPi(cx.headingEstimate - 2.0));
  check('compass pulls to the landmark', err < 0.2,
        `error=${(err * 180 / Math.PI).toFixed(1)} deg`);
}

// --- 4. Tripod gait --------------------------------------------------------
console.log('\n4. VNC tripod coordination');
{
  const vnc = new VentralNerveCord();
  for (let t = 0; t < 900; t++) {
    vnc.step(DT, { forwardDrive: 1, turnCommand: 0, backward: 0 });
  }
  const a = circularMean(TRIPOD_A.map((i) => vnc.phase[i]));
  const b = circularMean(TRIPOD_B.map((i) => vnc.phase[i]));
  const sep = Math.abs(wrapPi(a - b)) * 180 / Math.PI;

  const spread = (g) => {
    const m = circularMean(g.map((i) => vnc.phase[i]));
    return Math.max(...g.map((i) => Math.abs(wrapPi(vnc.phase[i] - m)))) * 180 / Math.PI;
  };

  console.log(`     tripod A spread: ${spread(TRIPOD_A).toFixed(2)} deg`);
  console.log(`     tripod B spread: ${spread(TRIPOD_B).toFixed(2)} deg`);
  console.log(`     A-B separation : ${sep.toFixed(2)} deg  (want 180)`);
  console.log(`     step frequency : ${(vnc.stepFrequency / (2 * Math.PI)).toFixed(3)} Hz`);
  console.log(`     speed          : ${vnc.speed.toFixed(3)} m/s`);
  check('legs within a tripod are in phase', spread(TRIPOD_A) < 5 && spread(TRIPOD_B) < 5);
  check('the two tripods are antiphase', Math.abs(sep - 180) < 5, `sep=${sep.toFixed(1)} deg`);
  // 1.75 m/s is ABOVE the ~1.4 m/s a person actually walks -- it was raised on
  // purpose to make the march less of a wait. The bound is widened to match that
  // decision rather than the biomechanics, and the gap is stated in scale.js and
  // on screen instead of being hidden here.
  check('speed is plausible for a 1.78 m body, if brisk',
        vnc.speed > 1.0 && vnc.speed < 1.95, `${vnc.speed.toFixed(2)} m/s`);
}

// --- 5. Turning is stepping asymmetry, not a pivot -------------------------
console.log('\n5. Turning asymmetry');
{
  const vnc = new VentralNerveCord();
  for (let t = 0; t < 300; t++) vnc.step(DT, { forwardDrive: 1, turnCommand: 0, backward: 0 });
  const before = vnc.phase.slice();
  for (let t = 0; t < 120; t++) vnc.step(DT, { forwardDrive: 1, turnCommand: 1, backward: 0 });
  let left = 0;
  let right = 0;
  for (let i = 0; i < 3; i++) left += wrapPi(vnc.phase[i] - before[i]);
  for (let i = 3; i < 6; i++) right += wrapPi(vnc.phase[i] - before[i]);
  check('right legs advance more than left on a left turn', right > left,
        `left=${(left / 3).toFixed(2)} right=${(right / 3).toFixed(2)} rad`);
}

// --- 6. Closed loop: does the whole brain hold a course? -------------------
console.log('\n6. Closed loop, brain steering a body');
{
  const brain = new FlyBrain({ seed: 11 });
  let yaw = 0;
  let x = 0;
  let z = 0;
  const goalWorld = 1.1; // rad, fixed direction to hold

  brain.anchor(yaw);
  let maxErrLate = 0;
  const T = 1400;
  for (let t = 0; t < T; t++) {
    // Egocentric bearing to the goal direction, the only thing the brain gets.
    const bearing = wrapPi(goalWorld - yaw);
    const m = brain.step(DT, {
      trueHeading: yaw,
      angularVelocity: brain.motor.yawRate,
      wanderBearing: bearing,
      targetBearing: 0,
      targetDistance: 99,
      targetVisible: false,
      proxL: 0, proxR: 0, contact: 0,
      landmarkStrength: 1,
    });
    yaw = wrapPi(yaw + m.yawRate * DT);
    x += Math.sin(yaw) * m.speed * DT;
    z += Math.cos(yaw) * m.speed * DT;
    if (t > T * 0.6) maxErrLate = Math.max(maxErrLate, Math.abs(wrapPi(goalWorld - yaw)));
  }
  const finalErr = Math.abs(wrapPi(goalWorld - yaw)) * 180 / Math.PI;
  const travelled = Math.hypot(x, z);
  const courseAngle = Math.atan2(x, z);
  console.log(`     final heading error : ${finalErr.toFixed(2)} deg`);
  console.log(`     worst error, last 40%: ${(maxErrLate * 180 / Math.PI).toFixed(2)} deg`);
  console.log(`     distance walked     : ${travelled.toFixed(2)} m over ${(T * DT).toFixed(1)} s`);
  console.log(`     course made good    : ${(courseAngle * 180 / Math.PI).toFixed(1)} deg (goal ${(goalWorld * 180 / Math.PI).toFixed(1)})`);
  check('heading converges to the goal', finalErr < 8, `${finalErr.toFixed(1)} deg`);
  check('it actually covers ground', travelled > 8, `${travelled.toFixed(1)} m`);
  check('course made good matches the goal',
        Math.abs(wrapPi(courseAngle - goalWorld)) * 180 / Math.PI < 25);
}

console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
