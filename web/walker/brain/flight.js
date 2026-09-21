// Flight, for the fly in the scene.
//
// The fly keeps the fly circuit. Heading still comes from the EPG ring
// attractor and steering still comes out of PFL3 -> DNa02, exactly as in the
// walking case. What changes below the neck: wings instead of legs, an altitude
// loop, and the escape reflex.
//
// The escape is the real one, and it is the fly's entire answer to being shot
// at. LPLC2 loom detectors in the lobula report an expanding edge; they drive
// the Giant Fiber, which triggers a takeoff/turn in about 5 ms. It is a reflex
// with a fixed latency and no target model. That asymmetry against the
// predictive fire control in zoro.js is the whole point of the scene:
//
//   large brain  ->  estimates velocity, solves an intercept, aims AHEAD
//   fly brain    ->  detects expansion, fires a fixed reflex, jinks
//
// Neither is cheating. They are different circuits doing what they actually do.

import { CentralComplex } from './centralComplex.js';
import { DescendingNeurons } from './descending.js';
import { Unit, clamp, wrapPi, wrapTwoPi, makeRandom } from './neuron.js';
import { sceneWingbeatHz, LENGTHS_M } from '../scale.js';

export const FLIGHT = {
  // Halved from 2.3 / 5.2 so the fly can be engaged. Authored for playability,
  // NOT derived -- see FLY_SIZE_NOTE in ../scale.js.
  cruiseSpeed: 1.15,     // m/s
  escapeSpeed: 2.6,      // m/s during the giant-fiber burst
  maxClimb: 1.3,         // m/s
  hoverY: 1.42,          // m, preferred altitude -- chest/head height
  hoverBand: 0.55,       // m of wander around it
  // LPLC2 / giant fiber.
  loomThreshold: 0.42,   // normalised expansion rate that trips the reflex
  gfLatency: 0.005,      // s -- the real figure, about 5 ms
  escapeHold: 0.65,      // s of committed evasion once triggered
  escapeTurn: 1.7,       // rad of heading change the reflex commands
  // Bolt awareness: how close a bolt must pass to register as looming.
  threatRadius: 1.5,
  // Close-range flight. A fly does not hold station next to something chasing
  // it; it breaks away and climbs. Without this the orbit walks straight into
  // the hunter and the scene becomes one long collision.
  // Deliberately SHORT. The fly pressing in is the threat the scoring punishes,
  // and the sword is the answer to it, so the fly must actually close. It
  // breaks away at the last moment -- inside sword reach, not outside it.
  fleeRange: 0.95,
  fleeSpeed: 1.8,
  fleeClimb: 0.30,
  // Approach runs. The fly holds a wide orbit and commits to a run at the
  // character every few seconds. This is what gives the scene a rhythm: mostly
  // ranged engagement, punctuated by a close pass that can be cut or can land.
  standoff: 3.6,
  approachEvery: [5.0, 11.0], // s, drawn uniformly
  approachHold: 2.0,          // s of committed approach
  approachSpeed: 1.7,
};

export class FlyFlightBrain {
  constructor(opts = {}) {
    this.cx = new CentralComplex(opts);
    this.dn = new DescendingNeurons(opts);
    this.random = opts.random || makeRandom(opts.seed || 99);

    // LPLC2 population, and the giant fiber it drives.
    this.lplc2 = new Unit('LPLC2', 0.02);
    this.gf = new Unit('GiantFiber', 0.008);

    this.wingPhase = 0;
    this.wingbeatHz = sceneWingbeatHz();
    this.thrust = 0;

    this._gfTimer = 0;      // remaining committed escape time
    this._latency = 0;      // counts down the 5 ms before the reflex lands
    this._pendingEscape = null;
    this.escapeDir = 0;
    this.escaping = false;
    this.fleeing = false;
    this.loom = 0;

    this.goalAngle = 0;
    this.climb = 0;
    this.approaching = false;
    this._approachHold = 0;
    this._approachTimer = 2 + this.random() * 5;
    this._wanderPhase = this.random() * Math.PI * 2;
  }

  anchor(yaw) { this.cx.seedBump(yaw); }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {object} s.pos      {x,y,z} of the fly
   * @param {number} s.yaw      current heading
   * @param {number} s.yawRate  measured, fed back as the PEN input
   * @param {object} s.zoro     {x,y,z} of the character
   * @param {Array}  s.bolts    live bolts [{pos:{x,y,z}, vel:{x,y,z}}]
   * @param {object} s.bounds   {hw, hd, maxY} room half-extents
   */
  step(dt, s) {
    // --- LPLC2: how fast is something expanding on the retina? --------------
    // Approximated the way the cell actually behaves: an object closing fast
    // and nearly head-on expands quickly, one passing wide barely at all.
    let loom = 0;
    for (const b of s.bolts) {
      const dx = b.pos.x - s.pos.x;
      const dy = b.pos.y - s.pos.y;
      const dz = b.pos.z - s.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 6) continue;

      // Closing speed along the line of sight.
      const closing = -(dx * b.vel.x + dy * b.vel.y + dz * b.vel.z) / Math.max(dist, 1e-3);
      if (closing <= 0) continue;

      // Miss distance: how near it passes if nothing changes.
      const t = dist / Math.max(closing, 1e-3);
      const mx = dx + b.vel.x * t;
      const my = dy + b.vel.y * t;
      const mz = dz + b.vel.z * t;
      const miss = Math.hypot(mx, my, mz);
      if (miss > FLIGHT.threatRadius) continue;

      // Angular expansion rate: closing speed over distance squared, the term
      // LPLC2 is tuned to. Scaled so a bolt on a collision course saturates.
      loom = Math.max(loom, clamp((closing / Math.max(dist * dist, 0.05)) * 0.55, 0, 1));
    }
    this.loom = loom;
    this.lplc2.step(loom, dt);

    // --- Giant fiber: threshold, fixed latency, committed burst -------------
    const tripped = this.lplc2.rate > FLIGHT.loomThreshold;
    this.gf.step(tripped ? 1 : 0, dt);

    if (tripped && this._gfTimer <= 0 && this._latency <= 0 && !this._pendingEscape) {
      // Commit now, act after the latency. Direction is NOT computed from a
      // target model -- the reflex just picks a side and goes.
      this._latency = FLIGHT.gfLatency;
      this._pendingEscape = (this.random() > 0.5 ? 1 : -1) * FLIGHT.escapeTurn;
    }
    if (this._latency > 0) {
      this._latency -= dt;
      if (this._latency <= 0 && this._pendingEscape !== null) {
        this.escapeDir = this._pendingEscape;
        this._gfTimer = FLIGHT.escapeHold;
        this._pendingEscape = null;
      }
    }
    this._gfTimer = Math.max(0, this._gfTimer - dt);
    this.escaping = this._gfTimer > 0;

    // --- Where to go --------------------------------------------------------
    const dzx = s.zoro.x - s.pos.x;
    const dzz = s.zoro.z - s.pos.z;
    const rangeToZoro = Math.hypot(dzx, dzz);
    const bearingToZoro = wrapPi(Math.atan2(dzx, dzz) - s.yaw);

    // --- approach runs ------------------------------------------------------
    // Committed, timed, and NOT a response to anything the character does: a
    // fly is attracted to a large warm object and periodically goes for it.
    this._approachTimer -= dt;
    if (this._approachTimer <= 0 && this._approachHold <= 0 && !this.escaping) {
      const [lo, hi] = FLIGHT.approachEvery;
      this._approachHold = FLIGHT.approachHold;
      this._approachTimer = lo + this.random() * (hi - lo);
    }
    this._approachHold = Math.max(0, this._approachHold - dt);
    this.approaching = this._approachHold > 0;

    // Orbit rather than collide: hold a standoff ring and circle it.
    this._wanderPhase = wrapTwoPi(this._wanderPhase + dt * 0.55);
    const standoff = FLIGHT.standoff;
    const ringError = rangeToZoro - standoff;
    // Tangential component keeps it circling, radial closes or opens the range.
    let bearing = bearingToZoro + Math.sign(Math.sin(this._wanderPhase)) * (Math.PI / 2)
                * clamp(1 - Math.abs(ringError) / 2.2, 0, 1);

    this.fleeing = false;
    if (this.escaping) {
      bearing = this.escapeDir; // reflex overrides everything
    } else if (this.approaching) {
      // Committed: it does not break off just because he is close. This is the
      // window in which it can be cut, and the window in which it can land.
      bearing = bearingToZoro;
    } else if (rangeToZoro < FLIGHT.fleeRange) {
      // Break away from the hunter. This is ordinary avoidance, not the giant
      // fiber: it is graded with distance and has no fixed latency.
      bearing = wrapPi(bearingToZoro + Math.PI);
      this.fleeing = true;
    } else {
      // Stay inside the room: turn away from a wall that is close.
      const m = 1.1;
      if (s.pos.x > s.bounds.hw - m) bearing = wrapPi(Math.atan2(-1, 0) - s.yaw);
      else if (s.pos.x < -s.bounds.hw + m) bearing = wrapPi(Math.atan2(1, 0) - s.yaw);
      else if (s.pos.z > s.bounds.hd - m) bearing = wrapPi(Math.atan2(0, -1) - s.yaw);
      else if (s.pos.z < -s.bounds.hd + m) bearing = wrapPi(Math.atan2(0, 1) - s.yaw);
    }

    this.goalAngle = wrapPi(this.cx.headingEstimate + bearing);

    const cx = this.cx.step(dt, {
      angularVelocity: s.yawRate,
      landmarkHeading: s.yaw,      // the fly sees the same room landmark
      landmarkStrength: 0.8,
      goalAngle: this.goalAngle,
    });

    const dn = this.dn.step(dt, {
      pfl3L: cx.pfl3L,
      pfl3R: cx.pfl3R,
      walkDrive: 1,
      contact: 0,
      avoidL: 0,
      avoidR: 0,
    });

    // --- Altitude -----------------------------------------------------------
    let wantY = FLIGHT.hoverY
      + Math.sin(this._wanderPhase * 1.7) * FLIGHT.hoverBand * 0.6;
    if (this.escaping) wantY += 0.9; // the reflex is a takeoff: it goes up
    if (this.fleeing) wantY += FLIGHT.fleeClimb; // climb out of sword reach
    const dy = wantY - s.pos.y;
    this.climb = clamp(dy * 2.6, -FLIGHT.maxClimb, FLIGHT.maxClimb);

    // --- Wings --------------------------------------------------------------
    const speed = this.escaping ? FLIGHT.escapeSpeed
      : this.fleeing ? FLIGHT.fleeSpeed
      : this.approaching ? FLIGHT.approachSpeed
      : FLIGHT.cruiseSpeed;
    this.thrust = clamp(speed / FLIGHT.escapeSpeed, 0.35, 1);
    // Wingbeat rises with thrust, as it does in a real fly.
    const hz = this.wingbeatHz * (0.72 + 0.38 * this.thrust);
    this.wingPhase = wrapTwoPi(this.wingPhase + dt * hz * Math.PI * 2);

    return {
      yawRate: dn.yawRate * (this.escaping ? 2.6 : 1),
      speed,
      climb: this.climb,
      wingPhase: this.wingPhase,
      wingbeatHz: hz,
      escaping: this.escaping,
    };
  }

  state() {
    return {
      loom: this.loom,
      lplc2: this.lplc2.rate,
      gf: this.gf.rate,
      escaping: this.escaping,
      fleeing: this.fleeing,
      approaching: this.approaching,
      headingEstimate: this.cx.headingEstimate,
      goalAngle: this.goalAngle,
      wingbeatHz: this.wingbeatHz,
      bodyLength: LENGTHS_M.sceneFly,
    };
  }
}
