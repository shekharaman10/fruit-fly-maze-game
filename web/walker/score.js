// Reward and punishment.
//
// WHAT THIS IS NOT: reinforcement learning. Nothing here adapts a policy from
// the reward signal. No weights change, no value function is estimated, and the
// character would behave identically with the scoring switched off except for
// the two explicit consequences below. Calling this "the agent learning" would
// be the same class of overclaim as calling the CPG "the connectome walking".
//
// WHAT IT IS: an outcome ledger with two hooks back into the simulation, so
// that reward and punishment are not merely displayed.
//
//   REWARD       A kill streak shortens the weapon cooldown, down to a floor.
//                Doing well makes it easier to keep doing well.
//
//   PUNISHMENT   A fly that reaches the character lands on him: points lost,
//                the streak reset, and the body briefly impaired so the next
//                engagement is genuinely harder.
//
// The scoring deliberately pays more for the sword. A cut has to be made inside
// 1.15 m, against something whose entire escape reflex triggers on approach,
// with an edge that is only live for a third of the swing. A bolt is fired from
// up to 11 m with a solved intercept. The payout follows the risk.

export const SCORING = {
  shotKill: 10,
  swordCut: 25,
  missedShot: -2,
  flyLanded: -15,

  // Doing the task pays. Without these the only scored events were combat and
  // being bitten, so a completed run finished deep in the red -- a measured
  // run came in at -125 with ten landings -- and the number said nothing about
  // whether the maze had been solved. Now it does.
  pictureViewed: 5,
  centreReached: 150,

  // Punishment consequences.
  landingRadius: 0.68,   // m from the chest before a fly counts as landing
  landingHeight: 1.2,    // m, roughly chest height
  stunDuration: 0.9,     // s of impaired movement after a landing
  stunSpeedScale: 0.25,
  immunity: 1.6,         // s before the same thing can happen again

  // Reward consequence.
  streakMax: 5,
  cooldownFloor: 0.62,   // multiplier on weapon cooldown at full streak
};

export class Score {
  constructor(cfg = {}) {
    this.cfg = { ...SCORING, ...cfg };

    this.points = 0;
    this.best = 0;

    this.shotKills = 0;
    this.cuts = 0;
    this.misses = 0;
    this.landings = 0;

    this.streak = 0;
    this.bestStreak = 0;

    this.stun = 0;
    this.immunity = 0;

    // Most recent event, for the readout. Cleared after a short display time.
    this.lastEvent = null;
    this._eventT = 0;
  }

  _award(points, label) {
    this.points += points;
    this.best = Math.max(this.best, this.points);
    this.lastEvent = { label, points };
    this._eventT = 1.6;
  }

  shotKill() {
    this.shotKills++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this._award(this.cfg.shotKill, 'SHOT');
  }

  swordCut() {
    this.cuts++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this._award(this.cfg.swordCut, 'CUT');
  }

  /** A picture has been properly looked at. */
  pictureViewed() {
    this._award(this.cfg.pictureViewed, 'SEEN');
  }

  /** The centre, with the tour finished. */
  centreReached() {
    this._award(this.cfg.centreReached, 'CENTRE');
  }

  missedShots(n) {
    if (n <= 0) return;
    this.misses += n;
    this.points += this.cfg.missedShot * n;
  }

  /** A fly reached the character. Returns false if immunity was still up. */
  flyLanded() {
    if (this.immunity > 0) return false;
    this.landings++;
    this.streak = 0;
    this.stun = this.cfg.stunDuration;
    this.immunity = this.cfg.immunity;
    this._award(this.cfg.flyLanded, 'LANDED ON');
    return true;
  }

  step(dt) {
    this.stun = Math.max(0, this.stun - dt);
    this.immunity = Math.max(0, this.immunity - dt);
    if (this._eventT > 0) {
      this._eventT -= dt;
      if (this._eventT <= 0) this.lastEvent = null;
    }
  }

  /** Body impairment from the most recent landing. 1 = unimpaired. */
  get speedScale() {
    if (this.stun <= 0) return 1;
    // He walks it off; he is not switched between two speeds.
    //
    // This was a step function -- full speed to a quarter and back in one frame.
    // With eight flies that happened rarely enough to read as a stumble. With
    // eighty, a landing gets through every seven seconds or so and a run became
    // a series of jolts: the body has momentum and absorbs some of it, but
    // `yawRate` is scaled by this directly, so the TURN snapped every time.
    //
    // Easing back over the stun gives a limp that wears off, which is both what
    // being knocked about looks like and a speed that never changes
    // discontinuously.
    const k = 1 - this.stun / this.cfg.stunDuration;   // 0 the instant it lands
    const ease = k * k * (3 - 2 * k);
    return this.cfg.stunSpeedScale + (1 - this.cfg.stunSpeedScale) * ease;
  }

  get stunned() { return this.stun > 0; }

  /** Weapon cooldown multiplier earned by the current streak. */
  get cooldownScale() {
    const k = Math.min(this.streak, this.cfg.streakMax) / this.cfg.streakMax;
    return 1 + (this.cfg.cooldownFloor - 1) * k;
  }

  state() {
    return {
      points: this.points,
      shotKills: this.shotKills,
      cuts: this.cuts,
      misses: this.misses,
      landings: this.landings,
      streak: this.streak,
      bestStreak: this.bestStreak,
      stunned: this.stunned,
      stun: this.stun,
      cooldownScale: this.cooldownScale,
      lastEvent: this.lastEvent,
    };
  }
}
