// Human walking kinematics, from measured gait analysis.
//
// WHY THIS FILE EXISTS, AND WHAT IT IS NOT
//
// The reference for this work is HuMoR (Rempe, Birdal, Hertzmann, Yang,
// Sridhar, Guibas -- ICCV 2021): a conditional VAE that learns the distribution
// of pose CHANGE at each step, trained on AMASS, used as a motion prior for
// robust pose estimation.
//
// HuMoR is not integrated here and cannot be. It needs a parametric body model,
// trained weights and a PyTorch runtime; this project is dependency-free
// JavaScript that runs offline in a browser. Claiming otherwise would be a lie
// about the pipeline.
//
// What IS taken from it is the principle: joint angles should come from a model
// of how people actually move, not from a sine wave that happens to look busy.
// The tables below are normative sagittal-plane kinematics from clinical gait
// analysis -- the same phenomenon HuMoR learns from mocap, encoded directly
// because 24 numbers do not need a neural network.
//
// The signature of a real walk, and the thing a sine wave never gets right, is
// the KNEE DOUBLE BUMP: a small flexion wave at loading response (~15%), a
// partial extension at midstance (~40%), then the large swing flexion (~70%).
// A single sinusoid gives one bump and reads as a cartoon.
//
// Convention: one gait cycle is 0..1, heel strike at 0. Angles in radians,
// flexion positive.

const DEG = Math.PI / 180;

/**
 * Keyframe tables, [fraction of cycle, degrees]. Values are normative adult
 * walking at about 1.4 m/s. Held as degrees because that is how gait analysis
 * reports them, and converted once at lookup.
 */
export const KINEMATICS = {
  // Hip: flexed at heel strike, extending through stance, flexing through swing.
  hip: [
    [0.00, 25], [0.10, 22], [0.20, 15], [0.30, 8], [0.40, 1],
    [0.50, -6], [0.60, -10], [0.70, -3], [0.80, 10], [0.90, 20], [1.00, 25],
  ],

  // Knee: the double bump.
  knee: [
    [0.00, 5], [0.05, 12], [0.15, 18], [0.25, 12], [0.40, 4],
    [0.50, 10], [0.60, 35], [0.70, 62], [0.78, 55], [0.88, 25],
    [0.96, 6], [1.00, 5],
  ],

  // Ankle: controlled plantarflexion after heel strike, dorsiflexion through
  // midstance, then the push-off plantarflexion at toe-off.
  ankle: [
    [0.00, 0], [0.08, -5], [0.20, 2], [0.40, 10], [0.50, 12],
    [0.58, 5], [0.62, -15], [0.66, -20], [0.75, -6], [0.85, 0], [1.00, 0],
  ],

  // Shoulder, counter-swinging the ipsilateral leg.
  shoulder: [
    [0.00, -14], [0.25, -4], [0.50, 16], [0.75, 4], [1.00, -14],
  ],

  // Elbow is never straight during a walk.
  elbow: [
    [0.00, 16], [0.30, 12], [0.50, 28], [0.75, 22], [1.00, 16],
  ],
};

// Toe-off. Everything before this is stance, everything after is swing.
export const TOE_OFF = 0.62;

// Pelvis, which is what separates a walk from a shuffle.
export const PELVIS = {
  riseM: 0.022,      // vertical oscillation amplitude, twice per stride
  rotationDeg: 4,    // transverse rotation, once per stride
  listDeg: 4,        // obliquity: the pelvis drops on the swing side
  swayM: 0.026,      // lateral weight shift
};

export const TRUNK = { leanDeg: 4, counterRotDeg: 3 };

/** Linear interpolation over a wrapped [0,1) keyframe table, returning radians. */
export function curve(table, t) {
  let x = t % 1;
  if (x < 0) x += 1;

  // Tables are short; a scan is cheaper than the bookkeeping to avoid one.
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, v0] = table[i];
    const [t1, v1] = table[i + 1];
    if (x >= t0 && x <= t1) {
      const k = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
      return (v0 + (v1 - v0) * k) * DEG;
    }
  }
  return table[table.length - 1][1] * DEG;
}

/** Joint angles for one leg at cycle fraction `t`. */
export function legAngles(t) {
  return {
    hip: curve(KINEMATICS.hip, t),
    knee: curve(KINEMATICS.knee, t),
    ankle: curve(KINEMATICS.ankle, t),
    stance: (t % 1 + 1) % 1 < TOE_OFF,
  };
}

/** Arm angles for the arm that counter-swings leg at cycle fraction `t`. */
export function armAngles(t) {
  return {
    shoulder: curve(KINEMATICS.shoulder, t),
    elbow: curve(KINEMATICS.elbow, t),
  };
}

/**
 * Fraction of the cycle with both feet on the ground, given the two legs are
 * offset by `offset` (0.5 for a normal walk).
 *
 * Derived rather than asserted: with a 0.62 duty factor and a half-cycle
 * offset, double support falls out at 2 * (0.62 - 0.5) = 0.24, which is the
 * 20-25% that gait labs measure. It is checked in tools/validate.mjs.
 */
export function doubleSupportFraction(duty = TOE_OFF, offset = 0.5) {
  const overlap = Math.max(0, duty - offset);
  return 2 * overlap;
}

/**
 * Where the pelvis sits, given the cycle fraction of the LEFT leg.
 * Rise peaks twice per stride, at each midstance.
 */
export function pelvisState(tLeft) {
  const phase = tLeft * Math.PI * 2;
  return {
    rise: -PELVIS.riseM * 0.5 * (1 - Math.cos(2 * phase)),
    sway: PELVIS.swayM * Math.sin(phase),
    rotation: PELVIS.rotationDeg * DEG * Math.sin(phase),
    list: PELVIS.listDeg * DEG * Math.sin(phase + Math.PI / 2),
  };
}
