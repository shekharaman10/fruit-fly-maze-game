// How much the character can take before the flies finish him.
//
// Scoring already punished a landing with points and a stun, but nothing ever
// ended: a run could be bitten a hundred times and still stroll to the centre.
// This is the consequence that was missing.
//
// It is a plain counter, not a simulation of anything. Eighty flies at large
// means landings are frequent, so the pool is deep enough to survive bad luck
// and shallow enough that ignoring them loses the run.

// MEASURED, not chosen. tools/pressure.mjs runs the real march with the swarm
// present and reports what happens. At eighty flies a landing gets through
// about every seven seconds and a full coverage run takes nine or ten minutes,
// so a run has to absorb something like ninety of them.
//
// The sweep, three seeds each:
//   12 points            every run over inside 90 s, about a seventh of the
//                        route -- which is the "eliminated too easily" this
//                        replaced
//   48, one back per 3s  recovery outran the landings; no run could be lost
//   60, one back per 5s  1 of 3 reached the centre, the other two lost at 84%
//                        and 92% of the route
//   72                   as below
//
// The grace window matters more than the pool: at eighty flies eleven clear
// seconds is rare, so recovery is something that happens when he has actually
// cleared the area rather than a trickle that makes the pool meaningless.
//
// Re-measured after FLY_CLEAR_RADIUS went from 0.30 to 0.40 to stop the flies
// hanging through the walls. Keeping them clear of the walls puts more of them
// in the open corridor where he is, so landings went from 82-97 a run to
// 87-113 and 72 stopped being survivable. A correctness fix moving a balance
// number is the normal case, not a surprise; the pool follows the measurement.
export const LIFE = {
  max: 88,          // landings survivable
  regenAfter: 11,   // s unbitten before one comes back
  regenEvery: 5,    // s per point recovered after that
};

export class Life {
  constructor(cfg = {}) {
    this.cfg = { ...LIFE, ...cfg };
    this.hp = this.cfg.max;
    this.sinceHit = 0;
    this._regen = 0;
    this.hits = 0;
  }

  get alive() { return this.hp > 0; }
  get fraction() { return Math.max(0, this.hp / this.cfg.max); }

  reset() {
    this.hp = this.cfg.max;
    this.sinceHit = 0;
    this._regen = 0;
    this.hits = 0;
  }

  /** A fly got through. Returns true if that was the last one. */
  hit(n = 1) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - n);
    this.hits += n;
    this.sinceHit = 0;
    this._regen = 0;
    return this.hp <= 0;
  }

  step(dt) {
    if (!this.alive) return;
    this.sinceHit += dt;
    if (this.sinceHit < this.cfg.regenAfter) return;
    // Slow recovery once they have been kept off for a while, so keeping the
    // swarm down is worth something without making the pool meaningless.
    this._regen += dt;
    while (this._regen >= this.cfg.regenEvery && this.hp < this.cfg.max) {
      this._regen -= this.cfg.regenEvery;
      this.hp++;
    }
  }

  state() {
    return {
      hp: this.hp,
      max: this.cfg.max,
      fraction: this.fraction,
      alive: this.alive,
      hits: this.hits,
      regenIn: Math.max(0, this.cfg.regenAfter - this.sinceHit),
    };
  }
}
