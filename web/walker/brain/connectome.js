// Which real cell types each modelled population stands for, and the weights
// wiring them together.
//
// Source for the dataset: the male Drosophila CNS connectome (Janelia FlyEM +
// Google Research + partners), covering brain and ventral nerve cord. Public
// snapshot `male-cns:v1.0`, CC BY 4.0. Counts below are the ones amfly measures
// from the v1.0 files directly (amfly/config.py MEASURED), not the rounded
// figures in press coverage:
//   166,700 neurons   25,582,938 connections   124,177,617 synapses
//   1,314 descending neurons   708 VNC leg motor neurons
// Those first three are different quantities and are routinely conflated.
//   https://male-cns.janelia.org/   https://neuprint.janelia.org/
//
// IMPORTANT, so nobody is misled: this file contains hand-tuned weights for a
// ~10-population circuit model. It is NOT a reconstruction of measured synapse
// counts. The *topology* -- who talks to whom, and with what sign -- follows the
// published circuit; the gains are tuned so the figure walks nicely.
// `tools/fetch_connectome.mjs` pulls the real per-type connection weights from
// neuPrint if you want to replace the tuned numbers with measured ones.

// Measured from the male-cns v1.0 files by amfly/data/loader.py and asserted in
// tests/test_loader.py. Not copied from press coverage -- the widely repeated
// 165,122 is a stale v0.9 figure. These are three different quantities.
export const MEASURED = {
  neurons: 166700,
  connections: 25582938,
  synapses: 124177617,
  descendingNeurons: 1314,
  vncLegMotorNeurons: 708,
  cellTypes: 11691,
};

export const CELL_TYPES = {
  EPG: {
    region: 'Ellipsoid body (central complex)',
    role: 'Head-direction compass. A single activity bump tracks where the animal faces.',
    note: 'Also called E-PG / compass neurons. 16 wedges tile 360 degrees.',
  },
  PEN: {
    region: 'Protocerebral bridge -> ellipsoid body',
    role: 'Rotates the compass bump in proportion to angular velocity.',
    note: 'PEN-L and PEN-R shift the bump in opposite directions; this is the integrator.',
  },
  ER: {
    region: 'Bulb -> ellipsoid body (ring neurons)',
    role: 'Visual landmark input that pins the compass to the outside world.',
    note: 'Without it the bump drifts, exactly as it does in a featureless arena.',
  },
  FC2: {
    region: 'Fan-shaped body',
    role: 'Holds the goal direction the animal is currently steering toward.',
  },
  PFL3: {
    region: 'Fan-shaped body -> lateral accessory lobe',
    role: 'Compares heading against goal and emits a turn command when they differ.',
    note: 'Left and right PFL3 populations read the compass at +/-90 deg offsets, so their '
        + 'difference is proportional to sin(goal - heading).',
  },
  DNa02: {
    region: 'Descending neuron, brain -> ventral nerve cord',
    role: 'Steering. The right-minus-left difference sets turning rate.',
    note: 'PFL3 synapses directly onto DNa02; the R-L difference is linearly related to '
        + 'the fly\'s subsequent rotational velocity.',
  },
  DNa01: {
    region: 'Descending neuron',
    role: 'Slower steering bias, folded in here as a smoothed copy of DNa02.',
  },
  DNp09: {
    region: 'Descending neuron',
    role: 'Drives goal-directed forward walking; silencing it stops the animal.',
  },
  MDN: {
    region: 'Moonwalker descending neuron',
    role: 'Drives backward walking. Recruited here when the front sensors hit something.',
  },
  LoVP92: {
    region: 'Lobula -> ventrolateral protocerebrum',
    role: 'Male-specific visual neuron named for the "love spot". Biases the goal toward a '
        + 'detected target.',
    note: 'Reported in the male CNS connectome release as a male-specific type in the '
        + 'visual-to-motor courtship pathway.',
  },
  AOTU012: {
    region: 'Anterior optic tubercle',
    role: 'Sexually dimorphic: present in both sexes but wired to different downstream partners.',
    note: 'The release highlights AOTU012 as dimorphic. Toggling `sex` in the config rewires '
        + 'its output, which is the whole point of the demonstration.',
  },
  LegCPG: {
    region: 'Ventral nerve cord, leg neuromeres T1-T3',
    role: 'Six coupled step oscillators producing the tripod gait.',
    note: 'The VNC is included in this connectome, which is what makes brain-to-leg '
        + 'pathways traceable end to end.',
  },
};

// ---------------------------------------------------------------------------
// Weights. Grouped by pathway so each one is readable next to its cell types.
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  // --- Ellipsoid body ring attractor -------------------------------------
  eb: {
    wedges: 16,          // EPG wedges tiling 360 deg
    tau: 0.045,          // s
    selfExcite: 1.35,    // cosine-tuned recurrent excitation
    globalInhib: 0.55,   // uniform subtraction; plus activity normalisation
    activityTarget: 4.0, // total EPG activity held constant by global inhibition
    penGain: 1.9,        // strength of the PEN shift pathway
    penVelocityGain: 0.062, // MEASURED, not chosen: tools/validate.mjs fits the slope of
                            // bump rotation against body rotation and this is the value that
                            // puts it at 1.0. Above ~0.4 the PEN rectifier saturates at normal
                            // turn rates and the compass runs fast and nonlinear.
    erGain: 0.45,        // visual landmark pull; lower = more dead-reckoning drift
    erNoise: 0.10,       // rad, noise on the landmark estimate
    bias: 0.06,
  },

  // --- Fan-shaped body goal + PFL3 steering ------------------------------
  fb: {
    goalWidth: 2.2,      // von Mises concentration of the FC2 goal bump
    pfl3Offset: Math.PI / 2, // the +/-90 deg readout offset that makes R-L ~ sin(error)
    pfl3Gain: 3.6,
    pfl3Tau: 0.06,
  },

  // --- Descending neurons -------------------------------------------------
  dn: {
    dna02Gain: 1.0,
    dna02Tau: 0.055,
    turnRateMax: 1.8,    // rad/s at full DNa02 asymmetry, ~103 deg/s
    dna01Tau: 0.30,      // slow bias
    dna01Gain: 0.35,
    dnp09Tau: 0.20,
    dnp09Gain: 1.0,
    mdnTau: 0.12,
    mdnGain: 1.6,
    mdnHold: 0.9,        // s of backward walking once triggered
  },

  // --- Visual / sensory ---------------------------------------------------
  vis: {
    loomGain: 2.4,       // obstacle avoidance drive
    loomTau: 0.08,
    lovp92Gain: 1.5,     // target-orienting drive
    lovp92Tau: 0.15,
    lovp92FovDeg: 70,    // half-angle of the frontal field LoVP92 responds in
    aotu012Tau: 0.20,
  },

  // --- Ventral nerve cord CPGs -------------------------------------------
  // Step frequencies START from a derivation and are then pushed past it. See
  // ../scale.js: a fly steps at 5-20 Hz, the character is 712x longer, and
  // Froude similarity scales gait frequency by sqrt(L_fly/L_char) = 1/26.7,
  // predicting 0.19-0.75 Hz.
  //
  // The scene ran 0.95 Hz (gain 1.27x) and now runs 1.24 Hz (gain 1.65x), which
  // is 1.75 m/s -- a brisk walk, above the 1.4 m/s a person actually manages.
  // That was asked for, and the honest description is that the derivation sets
  // the order of magnitude and the last factor is taste. It is stated here and
  // on screen rather than buried.
  vnc: {
    legs: 6,
    baseFreq: 0.8,       // rad/s at zero drive -- idle leg tone
    driveFreq: 7.0,      // rad/s added at full DNp09 drive -> 7.8 rad/s = 1.24 Hz
    maxFreq: 8.2,        // was 6.3, which silently clamped the raised drive back
                         // to 1.00 Hz. tools/validate.mjs printed the real figure.
    coupling: 9.0,       // Kuramoto coupling holding the tripod together
    turnAsymmetry: 0.38, // fraction of step frequency shifted side-to-side when turning
    strideLength: 1.41,  // m of ground covered per leg cycle, 0.79 body lengths
  },
};

// Tripod gait groups. Leg order is [L1, L2, L3, R1, R2, R3] -- front to hind,
// left side then right side.
export const LEG_NAMES = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
export const TRIPOD_A = [0, 4, 2]; // L1, R2, L3
export const TRIPOD_B = [3, 1, 5]; // R1, L2, R3

/** Which tripod each leg index belongs to (0 or 1). */
export const LEG_TRIPOD = (() => {
  const t = new Array(6);
  for (const i of TRIPOD_A) t[i] = 0;
  for (const i of TRIPOD_B) t[i] = 1;
  return t;
})();

/** Target phase offset between leg j and leg i: 0 within a tripod, pi across. */
export function targetPhaseOffset(i, j) {
  return LEG_TRIPOD[i] === LEG_TRIPOD[j] ? 0 : Math.PI;
}
