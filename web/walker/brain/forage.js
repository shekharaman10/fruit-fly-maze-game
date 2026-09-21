// Search: where to walk when there is no fly in sight.
//
// The previous build picked random waypoints and walked to them, which produced
// straight legs between fixed points -- a route, not a hunt. This replaces it
// with the thing animals actually do when looking for something.
//
// Two documented components, both genuinely stochastic (seeded, so a run is
// reproducible, but never a repeating path):
//
//   CORRELATED RANDOM WALK
//     Heading drifts continuously by a small mean-reverting noise process.
//     Successive headings are correlated, so the path is smooth rather than
//     jittery, but it never repeats and has no destination.
//
//   RUN AND TUMBLE
//     Poisson-timed reorientation events draw a large turn. Between tumbles the
//     walker runs roughly straight. This is what gives search its characteristic
//     long-leg / sharp-turn structure.
//
//   AREA-RESTRICTED SEARCH
//     After a target is lost, turn rate and tumble rate both rise for a few
//     seconds, concentrating the search near where the target went missing,
//     then relax back to cruising. This is a real and well-described foraging
//     transition, and here it is driven by the same working-memory timer the
//     tracker uses -- so losing a fly visibly changes how the character moves.
//
// Output is an EGOCENTRIC bearing, the same currency sense() hands over for a
// target, so the central complex converts it to an allocentric goal the same way
// and nothing downstream needs to know which one it got.

import { makeRandom, wrapPi, clamp } from './neuron.js';

export const SEARCH = {
  // Correlated random walk.
  driftSigma: 0.55,     // rad/sqrt(s) of heading noise while cruising
  driftReturn: 0.9,     // mean reversion, keeps the drift from wandering off
  // Run and tumble.
  tumbleRateCruise: 0.22, // events/s
  tumbleRateArs: 0.95,    // events/s during area-restricted search
  tumbleSigma: 1.25,      // rad, spread of a tumble turn
  // Area-restricted search.
  arsDuration: 4.5,     // s of tightened search after losing a target
  arsDriftGain: 2.4,
  // Staying off the walls.
  wallMargin: 1.5,      // m at which the search starts biasing inward
  wallGain: 1.3,
};

export class SearchWalk {
  constructor(opts = {}) {
    this.cfg = { ...SEARCH, ...opts };
    this.random = opts.random || makeRandom(opts.seed || 5150);

    this.bearing = 0;   // egocentric, what the caller uses
    this.drift = 0;
    this.ars = 0;       // remaining area-restricted search time
    this.mode = 'cruise';
    this.tumbles = 0;
    this._hadTarget = false;
  }

  /** Standard normal, Box-Muller over the seeded uniform stream. */
  _gauss() {
    let u = 0;
    let v = 0;
    while (u <= 1e-9) u = this.random();
    while (v <= 1e-9) v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {boolean} s.hasTarget  a fly is currently being engaged
   * @param {number} s.x, s.z      position, for the wall bias
   * @param {number} s.yaw
   * @param {object} s.bounds      { hw, hd }
   * @returns {number} egocentric bearing to steer toward
   */
  step(dt, s) {
    // Losing a target is the trigger for area-restricted search.
    if (this._hadTarget && !s.hasTarget) this.ars = this.cfg.arsDuration;
    this._hadTarget = s.hasTarget;

    if (s.hasTarget) {
      // Pursuit is handled upstream by the courtship/approach pathway; the
      // search still runs so it is warm when the target is lost again.
      this.ars = 0;
      this.mode = 'pursuit';
    } else {
      this.ars = Math.max(0, this.ars - dt);
      this.mode = this.ars > 0 ? 'area-restricted' : 'cruise';
    }

    const arsK = this.ars > 0 ? this.cfg.arsDriftGain : 1;

    // --- correlated random walk ---------------------------------------------
    // Ornstein-Uhlenbeck on the drift: noise in, mean reversion out.
    this.drift += (-this.cfg.driftReturn * this.drift * dt)
      + this.cfg.driftSigma * arsK * this._gauss() * Math.sqrt(dt);
    this.drift = clamp(this.drift, -2.2, 2.2);

    // --- run and tumble -----------------------------------------------------
    const rate = this.ars > 0 ? this.cfg.tumbleRateArs : this.cfg.tumbleRateCruise;
    if (this.random() < rate * dt) {
      this.bearing = wrapPi(this.bearing + this._gauss() * this.cfg.tumbleSigma);
      this.tumbles++;
    }

    // Relax the standing bearing toward the drift, so between tumbles the
    // heading wanders instead of locking.
    this.bearing = wrapPi(this.bearing + (this.drift - this.bearing) * Math.min(1, dt * 1.4));

    // --- keep off the walls -------------------------------------------------
    // Without this the walk grinds along a wall: the drift has no idea the room
    // has edges, and the looming reflex alone only turns it parallel.
    const { hw, hd } = s.bounds;
    const nearX = Math.max(0, Math.abs(s.x) - (hw - this.cfg.wallMargin));
    const nearZ = Math.max(0, Math.abs(s.z) - (hd - this.cfg.wallMargin));
    if (nearX > 0 || nearZ > 0) {
      // Bearing that points back toward the middle of the room.
      const inward = Math.atan2(-Math.sign(s.x) * nearX, -Math.sign(s.z) * nearZ);
      const rel = wrapPi(inward - s.yaw);
      const w = clamp((nearX + nearZ) / this.cfg.wallMargin * this.cfg.wallGain, 0, 1);
      this.bearing = wrapPi(this.bearing + wrapPi(rel - this.bearing) * w);
    }

    return this.bearing;
  }

  state() {
    return {
      mode: this.mode,
      bearing: this.bearing,
      ars: this.ars,
      tumbles: this.tumbles,
    };
  }
}
