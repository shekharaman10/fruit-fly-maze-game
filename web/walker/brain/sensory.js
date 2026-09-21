// Sensory front end: what the body hands the brain each frame.
//
// Two cell types here come straight from the male CNS release rather than from
// the navigation literature, and they are the reason this scene is built on the
// MALE connectome specifically:
//
//   LoVP92   -- male-specific, named for the "love spot", in the visual-to-motor
//               courtship pathway. Here it biases the goal toward a seen target.
//   AOTU012  -- sexually dimorphic: present in both sexes, wired to DIFFERENT
//               downstream partners in each. Toggling `sex` rewires its output,
//               which is the whole point of including it.
//
// Both are used at the level the release describes: a male-specific orienting
// drive, and a type whose downstream partner depends on sex. Neither is a
// simulation of the measured cell.

import { Unit, relu, clamp, wrapPi, makeRandom } from './neuron.js';
import { WEIGHTS } from './connectome.js';

export class Sensory {
  constructor(opts = {}) {
    const v = { ...WEIGHTS.vis, ...(opts.vis || {}) };
    this.v = v;
    this.sex = opts.sex || 'male';
    this.random = opts.random || makeRandom(opts.seed || 7);

    this.loomL = new Unit('loom_L', v.loomTau);
    this.loomR = new Unit('loom_R', v.loomTau);
    this.lovp92 = new Unit('LoVP92', v.lovp92Tau);
    this.aotu012 = new Unit('AOTU012', v.aotu012Tau);

    this.landmarkHeading = 0;
    this.targetBearing = 0;
    this.targetSeen = 0;
  }

  /**
   * @param {object} s raw world readings
   * @param {number} s.trueHeading     rad
   * @param {number} s.landmarkStrength 0..1
   * @param {number} s.proxL, s.proxR  0..1 obstacle proximity in each front quadrant
   * @param {number} s.targetBearing   rad, signed angle from facing to the target
   * @param {number} s.targetDistance  m
   * @param {boolean} s.targetVisible
   */
  step(dt, s) {
    const v = this.v;

    // ER pathway: the landmark gives an absolute heading reading, with noise.
    // Gaussian-ish via two uniforms, which is plenty for a sensor model.
    const noise = (this.random() + this.random() - 1) * WEIGHTS.eb.erNoise;
    this.landmarkHeading = wrapPi(s.trueHeading + noise);

    // Looming: near obstacles on one side drive avoidance on that side.
    this.loomL.step(relu(s.proxL), dt);
    this.loomR.step(relu(s.proxR), dt);

    // AOTU012 responds to the target regardless of sex -- the dimorphism is in
    // where its output goes, not in whether it fires.
    const targetDrive = s.targetVisible ? clamp(1 - s.targetDistance / 8, 0, 1) : 0;
    this.aotu012.step(targetDrive, dt);

    // LoVP92 is male-specific and only responds in the frontal field.
    const inFov = s.targetVisible
      && Math.abs(s.targetBearing) < (v.lovp92FovDeg * Math.PI) / 180;
    const maleGate = this.sex === 'male' ? 1 : 0;
    this.lovp92.step(maleGate * (inFov ? v.lovp92Gain * this.aotu012.rate : 0), dt);

    this.targetBearing = s.targetBearing;
    this.targetSeen = inFov ? 1 : 0;

    // Where AOTU012 sends its output. This is the dimorphic rewiring.
    //   male   -> courtship pathway: approach the target.
    //   female -> navigation pathway: the target is a landmark, not a goal.
    const approachDrive = this.sex === 'male' ? this.lovp92.rate : 0;

    return {
      landmarkHeading: this.landmarkHeading,
      landmarkStrength: s.landmarkStrength,
      avoidL: this.loomL.rate,
      avoidR: this.loomR.rate,
      approachDrive,
      approachBearing: s.targetBearing,
      lovp92: this.lovp92.rate,
      aotu012: this.aotu012.rate,
    };
  }
}
