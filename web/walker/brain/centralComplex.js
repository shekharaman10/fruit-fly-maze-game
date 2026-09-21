// Central complex: the head-direction compass and the steering command.
//
// EPG ring attractor  ->  PFL3 goal comparison  ->  left/right turn drive.
// This is the pathway described in the steering literature: PFL3 cells read the
// compass at +/-90 deg offsets, so their left-right difference is proportional
// to sin(goal - heading), and that difference is what DNa02 inherits.

import { RingPopulation, bump, wrapPi, relu } from './neuron.js';
import { WEIGHTS } from './connectome.js';

export class CentralComplex {
  constructor(opts = {}) {
    const w = { ...WEIGHTS.eb, ...(opts.eb || {}) };
    const f = { ...WEIGHTS.fb, ...(opts.fb || {}) };
    this.w = w;
    this.f = f;
    this.n = w.wedges;

    this.epg = new RingPopulation('EPG', this.n, w.tau);

    // Scratch buffers, allocated once -- this runs every frame.
    this._input = new Float64Array(this.n);
    this._pen = new Float64Array(this.n);
    this._er = new Float64Array(this.n);
    this._goal = new Float64Array(this.n);

    // cos(theta_i - theta_j) precomputed for the recurrent ring.
    this._cos = [];
    for (let i = 0; i < this.n; i++) {
      const row = new Float64Array(this.n);
      for (let j = 0; j < this.n; j++) {
        row[j] = Math.cos(this.epg.theta[i] - this.epg.theta[j]);
      }
      this._cos.push(row);
    }

    // The +/-90 deg PFL3 readout offset, expressed in wedges.
    this.offsetWedges = Math.round((f.pfl3Offset / (Math.PI * 2)) * this.n);

    // Readouts for the HUD.
    this.headingEstimate = 0;
    this.bumpStrength = 0;
    this.goalAngle = 0;
    this.pfl3L = 0;
    this.pfl3R = 0;
    this.steerError = 0;

    this.seedBump(0);
  }

  /** Place the compass bump at `angle`. Used at spawn and when re-anchoring. */
  seedBump(angle) {
    bump(this.epg.rate, this.epg.theta, angle, 2.0, 1);
    for (let i = 0; i < this.n; i++) this.epg.v[i] = this.epg.rate[i];
    this.epg.normalise(this.w.activityTarget);
    this.headingEstimate = angle;
  }

  step(dt, s) {
    const w = this.w;
    const n = this.n;
    const rate = this.epg.rate;

    // --- PEN: split the bump into two copies weighted by angular velocity,
    // then project each one wedge around the ring in opposite directions.
    const kv = w.penVelocityGain;
    const gR = relu(0.5 + kv * s.angularVelocity);
    const gL = relu(0.5 - kv * s.angularVelocity);
    for (let i = 0; i < n; i++) {
      const jR = (i - 1 + n) % n; // PEN-R at j projects to j+1
      const jL = (i + 1) % n;     // PEN-L at j projects to j-1
      this._pen[i] = w.penGain * (rate[jR] * gR + rate[jL] * gL);
    }

    // --- ER: visual landmark pins the compass to the world. Without it the
    // bump integrates its own noise and drifts, which is the real behaviour in
    // a featureless arena.
    const landmarkStrength = s.landmarkStrength === undefined ? 1 : s.landmarkStrength;
    const erStrength = w.erGain * landmarkStrength;
    if (erStrength > 1e-6) {
      bump(this._er, this.epg.theta, s.landmarkHeading, 1.6, erStrength);
    } else {
      this._er.fill(0);
    }

    // --- Recurrent ring: cosine-tuned excitation minus uniform inhibition.
    let total = 0;
    for (let i = 0; i < n; i++) total += rate[i];

    for (let i = 0; i < n; i++) {
      const row = this._cos[i];
      let rec = 0;
      for (let j = 0; j < n; j++) rec += rate[j] * row[j];
      this._input[i] = w.selfExcite * rec - w.globalInhib * total
                     + this._pen[i] + this._er[i] + w.bias;
    }

    this.epg.step(this._input, dt);
    this.epg.normalise(w.activityTarget); // global inhibition, as a constraint

    const dec = this.epg.decode();
    this.headingEstimate = dec.angle;
    this.bumpStrength = dec.strength;

    // --- FC2: the goal being steered toward, as a bump on the same ring.
    this.goalAngle = s.goalAngle;
    bump(this._goal, this.epg.theta, s.goalAngle, this.f.goalWidth, 1);

    // --- PFL3: overlap the compass with the goal bump shifted +/-90 deg.
    // rawA peaks when heading sits 90 deg one way from goal, rawB the other way,
    // so rawB - rawA is a clean sinusoid in the heading error.
    const d = this.offsetWedges;
    let rawA = 0;
    let rawB = 0;
    for (let i = 0; i < n; i++) {
      rawA += rate[i] * this._goal[(i - d + n) % n];
      rawB += rate[i] * this._goal[(i + d) % n];
    }

    // Proportional to sin(goal - heading): zero on course, sign gives the turn
    // direction, and it reverses past +/-90 deg as the real circuit does.
    const drive = this.f.pfl3Gain * (rawB - rawA);

    // Split into the two populations; the active one drives its DNa02 partner.
    this.pfl3L = relu(drive);
    this.pfl3R = relu(-drive);
    this.steerError = wrapPi(s.goalAngle - this.headingEstimate);

    return { pfl3L: this.pfl3L, pfl3R: this.pfl3R };
  }
}
