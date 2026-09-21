// Ventral nerve cord: six leg oscillators, and the mapping onto two legs.
//
// The male CNS connectome is the first to include the nerve cord alongside the
// brain, which is what makes a brain-to-leg pathway traceable end to end. The
// VNC carries 708 leg motor neurons across neuromeres T1-T3.
//
// What is real and what is authored, stated plainly:
//   REAL      -- the tripod coordination pattern, and the fact that flies turn
//                by stepping asymmetrically rather than by pivoting.
//   AUTHORED  -- these are six coupled phase oscillators, not 708 motor neurons.
//                Spike-to-muscle-force has no established mapping, so this is an
//                engineered gait whose parameters are modulated by circuit
//                activity. It is not "the connectome walks the body".
//
// The biped mapping: a fly walks in two alternating tripods, {L1,R2,L3} and
// {R1,L2,R3}. A biped alternates two legs. So each tripod drives one leg of the
// figure. The gait the figure walks is genuinely the gait the oscillators
// produce -- it is six legs collapsed to two, not a walk cycle played back.

import { circularMean, clamp, wrapTwoPi, TWO_PI } from './neuron.js';
import { WEIGHTS, TRIPOD_A, TRIPOD_B, LEG_TRIPOD, LEG_NAMES, targetPhaseOffset } from './connectome.js';

export class VentralNerveCord {
  constructor(opts = {}) {
    const w = { ...WEIGHTS.vnc, ...(opts.vnc || {}) };
    this.w = w;
    this.n = w.legs;

    this.phase = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.phase[i] = LEG_TRIPOD[i] === 0 ? 0 : Math.PI;
    }

    // Precompute the target offset matrix once.
    this._offset = [];
    for (let i = 0; i < this.n; i++) {
      const row = new Float64Array(this.n);
      for (let j = 0; j < this.n; j++) row[j] = targetPhaseOffset(i, j);
      this._offset.push(row);
    }

    this.stepFrequency = 0; // rad/s
    this.speed = 0;         // m/s, signed
    this.legPhase = [0, Math.PI]; // [left leg, right leg] for the biped
    this.tripodSync = 1;    // 0..1, how well the tripods hold their pattern
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {number} s.forwardDrive 0..1 from DNp09
   * @param {number} s.turnCommand  -1..1 from DNa02
   * @param {number} s.backward     0..1 from MDN
   */
  step(dt, s) {
    const w = this.w;
    const n = this.n;

    const drive = clamp(s.forwardDrive + s.backward, 0, 1);
    const freq = clamp(w.baseFreq + w.driveFreq * drive, 0, w.maxFreq);
    const dir = s.backward > 0.5 ? -1 : 1; // MDN reverses the phase sweep

    // Turning is stepping asymmetry: the inside legs take shorter, slower steps.
    // Left legs are 0..2, right legs 3..5.
    const asym = w.turnAsymmetry * s.turnCommand;

    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const side = i < 3 ? -1 : 1; // positive turnCommand = left turn = slow left legs
      const omega = freq * (1 + side * asym) * dir;

      let couple = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        couple += Math.sin(this.phase[j] - this.phase[i] - this._offset[i][j]);
      }
      couple *= w.coupling / (n - 1);

      next[i] = this.phase[i] + dt * (omega + couple);
    }
    for (let i = 0; i < n; i++) this.phase[i] = wrapTwoPi(next[i]);

    this.stepFrequency = freq * dir;

    // Speed follows the oscillator so the feet do not skate: one full phase
    // cycle carries the body exactly one stride.
    this.speed = w.strideLength * (freq / TWO_PI) * dir * (drive > 0.01 ? 1 : 0);

    // Collapse the two tripods onto the two legs of the figure.
    this.legPhase[0] = circularMean(TRIPOD_A.map((i) => this.phase[i]));
    this.legPhase[1] = circularMean(TRIPOD_B.map((i) => this.phase[i]));

    this.tripodSync = this._syncScore();

    return { legPhase: this.legPhase, speed: this.speed, phase: this.phase };
  }

  /** 1 when both tripods are tight and antiphase, 0 when the pattern has broken. */
  _syncScore() {
    const r = (group) => {
      let x = 0;
      let y = 0;
      for (const i of group) {
        x += Math.cos(this.phase[i]);
        y += Math.sin(this.phase[i]);
      }
      return Math.hypot(x, y) / group.length;
    };
    const a = circularMean(TRIPOD_A.map((i) => this.phase[i]));
    const b = circularMean(TRIPOD_B.map((i) => this.phase[i]));
    const anti = (1 - Math.cos(a - b)) / 2; // 1 when exactly pi apart
    return clamp(((r(TRIPOD_A) + r(TRIPOD_B)) / 2) * anti, 0, 1);
  }

  /** Per-leg stance/swing, for the gait raster in the HUD. */
  stance() {
    const out = [];
    for (let i = 0; i < this.n; i++) {
      out.push({ name: LEG_NAMES[i], tripod: LEG_TRIPOD[i], swing: Math.sin(this.phase[i]) > 0 });
    }
    return out;
  }
}
