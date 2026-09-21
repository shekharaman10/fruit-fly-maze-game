// Descending neurons: the brain-to-body bottleneck.
//
// The male CNS connectome contains 1,314 descending neurons. Four of them carry
// everything the body needs here -- two for steering, one for forward drive,
// one for reverse.

import { Unit, relu, clamp } from './neuron.js';
import { WEIGHTS } from './connectome.js';

export class DescendingNeurons {
  constructor(opts = {}) {
    const w = { ...WEIGHTS.dn, ...(opts.dn || {}) };
    this.w = w;

    // DNa02, one per hemisphere. Ipsilateral: right DNa02 turns the body right.
    this.dna02L = new Unit('DNa02_L', w.dna02Tau);
    this.dna02R = new Unit('DNa02_R', w.dna02Tau);

    // DNa01 is slower. It holds a standing bias rather than a moment-to-moment
    // correction, so the same error drives it through a long time constant.
    this.dna01L = new Unit('DNa01_L', w.dna01Tau);
    this.dna01R = new Unit('DNa01_R', w.dna01Tau);

    this.dnp09 = new Unit('DNp09', w.dnp09Tau); // forward walking
    this.mdn = new Unit('MDN', w.mdnTau);       // backward walking

    this._mdnTimer = 0;
    this._mdnRefractory = 0;

    this.turnCommand = 0;  // -1..1, normalised left-minus-right difference
    this.yawRate = 0;      // rad/s, positive = left turn
    this.forwardDrive = 0; // 0..1
    this.backward = 0;     // 0..1
  }

  step(dt, s) {
    const w = this.w;

    // Steering. PFL3 drives its ipsilateral DNa02. The looming pathway adds a
    // direct bias that never passes through the goal representation, which is
    // why obstacle dodges resolve faster than course corrections.
    const inL = w.dna02Gain * s.pfl3L + (s.avoidR || 0) * WEIGHTS.vis.loomGain;
    const inR = w.dna02Gain * s.pfl3R + (s.avoidL || 0) * WEIGHTS.vis.loomGain;

    this.dna02L.step(inL, dt);
    this.dna02R.step(inR, dt);
    this.dna01L.step(w.dna01Gain * inL, dt);
    this.dna01R.step(w.dna01Gain * inR, dt);

    const diff = (this.dna02L.rate + this.dna01L.rate)
               - (this.dna02R.rate + this.dna01R.rate);
    const mag = 1 + this.dna02L.rate + this.dna02R.rate;
    this.turnCommand = clamp(diff / mag, -1, 1);

    // MDN latches backward walking for a short hold on contact, so the body
    // clears the obstacle instead of stuttering against it -- then refuses to
    // re-trigger until the refractory has elapsed, so forward drive always gets
    // a turn even while contact persists.
    if (s.contact > 0.5 && this._mdnRefractory <= 0) {
      this._mdnTimer = w.mdnHold;
      this._mdnRefractory = w.mdnHold + w.mdnRefractory;
    }
    this._mdnRefractory = Math.max(0, this._mdnRefractory - dt);
    this._mdnTimer = Math.max(0, this._mdnTimer - dt);
    this.mdn.step(this._mdnTimer > 0 ? w.mdnGain : 0, dt);
    this.backward = clamp(this.mdn.rate, 0, 1);

    // DNp09: forward drive, suppressed while reversing.
    this.dnp09.step(w.dnp09Gain * relu(s.walkDrive) * (1 - this.backward), dt);
    this.forwardDrive = clamp(this.dnp09.rate, 0, 1);

    this.yawRate = w.turnRateMax * this.turnCommand;

    return {
      turnCommand: this.turnCommand,
      yawRate: this.yawRate,
      forwardDrive: this.forwardDrive,
      backward: this.backward,
    };
  }
}
