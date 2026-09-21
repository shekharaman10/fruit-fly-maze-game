// Looking at the pictures, and the rule that the centre stays shut until they
// have been looked at.
//
// This was inside main.js, which only runs in a browser, so there was no way to
// answer "is it actually stopping at them?" except by watching. It is a module
// now and tools/maze.mjs counts them during the headless march.
//
// THE NOTICE RADIUS IS NOT A GUESS. Measured against the coverage route, the
// furthest any picture's standing spot sits from the nearest route point is
// 2.15 m. At the original 1.7 m only 23 to 29 of the 36 were ever reachable,
// so "see every picture" was a rule the maze could not satisfy. 2.4 m clears
// the worst case with a margin.

export const TOUR = {
  // 1.2 s, not 3.5. At 3.5 s across sixty-odd pictures the character stood
  // still for most of the run and it read as faulting rather than thorough.
  dwell: 1.2,    // s of actually looking, not of standing nearby
  notice: 2.4,   // m from the standing spot in front of a picture
  // He slows to a third instead of halting. A dead stop at every frame is
  // what made the march look broken.
  slow: 0.32,
  facing: 0.45,  // rad; the dwell only counts down inside this
  // GIVING UP. `notice` decides which picture is worth stopping for, but it
  // only ever gated ACQUIRING one: once a picture was current there was no
  // distance limit and no time limit at all.
  //
  // That is invisible with nothing else going on, because an attempt runs
  // straight through in about `dwell`. In the scene the tour only runs with the
  // ground clear, so with eighty flies about an attempt is cut off within a
  // second or two and resumed whenever it next clears -- by which time he has
  // marched on. It then steers him BACK, from anywhere, with the march
  // suppressed the whole time.
  //
  // MEASURED in tools/stall.mjs at the duty cycle eighty flies produce: one
  // picture held him for 71.8 s and steered him from 19.0 m away, most of the
  // width of the maze. That is the "always stuck at the same poster" this fixes.
  //
  // Both limits are needed. Distance alone leaves him stuck in front of one he
  // genuinely cannot face; time alone lets him walk the maze backwards first.
  abandonAt: 3.8,   // m from the picture -- 1.6x notice, so shuffling is fine
  abandonAfter: 5,  // s of actually attempting it
};

export class Tour {
  /**
   * @param {Array} pictures from buildMaze(), each with { x, z, viewFrom }
   * @param {object} [opts]
   * @param {number} [opts.required] how many must be seen before the centre
   *   opens; defaults to 10, not to all of them
   */
  constructor(pictures, opts = {}) {
    this.pictures = pictures;
    this.cfg = { ...TOUR, ...opts };
    this.required = Math.min(opts.required ?? 10, pictures.length);
    this.viewed = new Set();
    // { index, left, spent } -- `spent` is time actually attempting, which is
    // not wall-clock: the frames where the tour is suppressed do not count
    // against it, or a busy room would abandon every picture untried.
    this.current = null;
    this.abandoned = 0;
  }

  get viewedCount() { return this.viewed.size; }
  get satisfied() { return this.viewed.size >= this.required; }
  get remaining() { return Math.max(0, this.required - this.viewed.size); }
  get active() { return this.current !== null; }

  reset() {
    this.viewed.clear();
    this.current = null;
    this.abandoned = 0;
  }

  /** The nearest picture still to be seen, or null. */
  nearestUnviewed(x, z) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.pictures.length; i++) {
      if (this.viewed.has(i)) continue;
      const v = this.pictures[i].viewFrom;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best === null ? null : { index: best, distance: bestD };
  }

  /**
   * @param {number} dt
   * @param {object} body { x, z, yaw }
   * @returns {?object} { bearing, stop, index, left } while looking, else null
   */
  step(dt, body) {
    // Once the quota is met he stops volunteering. He used to keep claiming
    // every one of the sixty-nine pictures he walked past, so `required` only
    // decided when the centre opened and changed nothing about the walk: the
    // interruptions ran to the end of the route either way. A picture already
    // being looked at is still finished.
    if (!this.current && !this.satisfied) {
      for (let i = 0; i < this.pictures.length; i++) {
        if (this.viewed.has(i)) continue;
        const v = this.pictures[i].viewFrom;
        if (Math.hypot(v.x - body.x, v.z - body.z) < this.cfg.notice) {
          this.current = { index: i, left: this.cfg.dwell, spent: 0 };
          break;
        }
      }
    }
    if (!this.current) return null;

    const pic = this.pictures[this.current.index];

    // Two ways to give up, both of them necessary -- see `abandonAt` above.
    // The picture is NOT marked viewed: he simply stops being steered to it,
    // and may pick it up again if the march brings him past it.
    this.current.spent += dt;
    const away = Math.hypot(pic.x - body.x, pic.z - body.z);
    if (away > this.cfg.abandonAt || this.current.spent > this.cfg.abandonAfter) {
      this.current = null;
      this.abandoned++;
      return null;
    }
    let bearing = Math.atan2(pic.x - body.x, pic.z - body.z) - body.yaw;
    bearing = ((bearing + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

    // Only counts down while he is actually facing it. Walking past with the
    // picture off to one side is not looking at it.
    if (Math.abs(bearing) < this.cfg.facing) this.current.left -= dt;

    const out = {
      bearing,
      stop: true,
      index: this.current.index,
      left: Math.max(0, this.current.left),
    };
    if (this.current.left <= 0) {
      this.viewed.add(this.current.index);
      this.current = null;
      out.completed = true;
    }
    return out;
  }

  state() {
    return {
      viewed: this.viewed.size,
      required: this.required,
      total: this.pictures.length,
      satisfied: this.satisfied,
      looking: this.current ? this.current.index : null,
      left: this.current ? Math.max(0, this.current.left) : 0,
      abandoned: this.abandoned,
    };
  }
}
