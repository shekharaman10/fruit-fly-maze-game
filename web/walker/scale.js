// Body size, and what it costs to move a gait between bodies.
//
// This exists because of a real problem. A fruit fly is about 2.5 mm long and
// steps at 5-20 Hz. The figure is about 700 times longer. Running fly step
// timings on a body that size produces something that looks like a bug on fast
// forward, not walking, and the reason is physics rather than taste.
//
// Legs are pendulums. Under dynamic similarity -- equal Froude number,
// Fr = v^2 / (g * L) -- time scales as sqrt(L / g), so step frequency between
// two bodies scales as sqrt(L_small / L_large). That factor is derived below
// rather than dialled in by eye.

export const LENGTHS_M = {
  fly: 0.0025,     // Drosophila melanogaster body length, 2-3 mm
  figure: 0.152,   // the collectible figure, 6 inches
  sceneFly: 0.534, // the fly IN THIS SCENE. See the note below.
  human: 1.78,     // the character at full height
};

export const G = 9.81;

// The scene fly is 534 mm: 214x a real Drosophila, and about 30% of the
// character's height. It was 178 mm (one tenth) and was tripled so it can
// actually be hit.
//
// This is an authored playability choice, not a scaling result, and the same
// goes for its speed: Froude similarity says a LARGER body should move FASTER
// (v scales as sqrt(L)), so tripling the size and then halving the speed is
// the opposite of what the physics argument gives. It is stated here rather
// than buried, because every other number in this file is derived and this one
// is not.
export const FLY_SIZE_NOTE = {
  previousM: 0.178,
  factor: 3,
  speedScale: 0.5,
  derived: false,
};

// Measured fly walking, for the range being mapped down.
export const FLY_GAIT = {
  stepHzSlow: 5,
  stepHzFast: 20,
  speedMax: 0.025,       // m/s, about 25 mm/s
  strideBodyLengths: 0.5, // a fly stride is roughly half a body length
};

/** Frequency ratio taking a gait from `from` to `to`. Below 1 means slower. */
export function frequencyRatio(from, to) {
  return Math.sqrt(LENGTHS_M[from] / LENGTHS_M[to]);
}

/** Everything the walker needs to know about running a fly gait at body scale. */
export function scaleReport(body = 'human') {
  const L = LENGTHS_M[body];
  const ratio = frequencyRatio('fly', body);
  const predictedHz = {
    slow: FLY_GAIT.stepHzSlow * ratio,
    fast: FLY_GAIT.stepHzFast * ratio,
  };

  // What the scene actually runs, from connectome.js WEIGHTS.vnc.
  const usedHz = 1.24;

  return {
    body,
    lengthM: L,
    lengthRatioToFly: L / LENGTHS_M.fly,
    frequencyRatio: ratio,
    predictedHz,
    usedHz,
    // The honest number. Froude is a first-order argument, not a law of gait,
    // and it under-predicts human walking: people walk near 0.9 Hz per leg,
    // which is already above what it gives. The scene runs 1.7x the prediction
    // because that is what normal walking actually is.
    authoredGain: usedHz / predictedHz.fast,
    strideM: LENGTHS_M[body] * 0.79, // stride per leg cycle, ~0.79 body lengths
  };
}

/** Rows for the on-screen size comparison. */
export function comparisonRows() {
  const fly = LENGTHS_M.fly;
  return [
    { label: 'Drosophila, real', mm: fly * 1000, times: 1 },
    { label: 'Fly in this scene', mm: LENGTHS_M.sceneFly * 1000, times: LENGTHS_M.sceneFly / fly },
    { label: 'Collectible figure', mm: LENGTHS_M.figure * 1000, times: LENGTHS_M.figure / fly },
    { label: 'Character', mm: LENGTHS_M.human * 1000, times: LENGTHS_M.human / fly },
  ];
}

// Wingbeat. A real Drosophila beats its wings near 200 Hz. The scene fly is
// 214x longer, and the same Froude argument that slowed the walk slows the
// beat: 200 * sqrt(2.5/534) = 13.7 Hz. Slow enough to read as individual
// strokes, which the 178 mm version at 23.7 Hz never was.
export const FLY_WINGBEAT_HZ_REAL = 200;

export function sceneWingbeatHz() {
  return FLY_WINGBEAT_HZ_REAL * frequencyRatio('fly', 'sceneFly');
}
