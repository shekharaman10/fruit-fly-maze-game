// The large brain: perception, prediction and fire control.
//
// ---------------------------------------------------------------------------
// WHAT "ONE MILLION TIMES MORE COMPLEX" MEANS HERE, STATED PLAINLY
// ---------------------------------------------------------------------------
// The male CNS connectome measures 166,700 neurons and 25,582,938 connections.
// A millionfold brain is therefore a spec of:
//
//     1.667e11 neurons        2.558e13 connections
//
// For scale, the human brain is about 8.6e10 neurons, so that spec is roughly
// twice a human brain. NOTHING HERE SIMULATES THAT. This file runs eight small
// modules. The multiplier is a design budget -- it says what CAPABILITIES the
// character is granted -- and the neuron figure is nominal, not a count of
// anything computed. Claiming otherwise would be the exact overclaim
// docs/roadmap-3d.md warns about.
//
// What the budget is spent on, and why each one is genuinely beyond the fly:
//
//   1. Working memory        The fly loses a target it cannot see. This keeps a
//                            state estimate running through occlusion.
//   2. Forward model         The fly steers by nulling bearing error, which is
//                            PURSUIT: it aims where the target IS. This solves
//                            for where the target WILL BE and aims there.
//   3. Velocity estimation   Requires differentiating a noisy observation over
//                            time, which a bearing-nulling circuit never does.
//   4. Decoupled aim         Weapon pointing runs independently of locomotion,
//                            rather than the whole body turning to look.
//   5. Fire control          A decision with a confidence threshold, instead of
//                            a reflex with a fixed latency.
//
// What is deliberately NOT upgraded: walking. The legs are still driven by the
// fly circuit in vnc.js. The contrast is the point -- the extra capacity buys
// perception and aiming, and the gait underneath is unchanged.

import { clamp, wrapPi, makeRandom } from './neuron.js';
import { MEASURED } from './connectome.js';

export const CAPACITY = {
  multiplier: 1e6,
  flyNeurons: MEASURED.neurons,
  flyConnections: MEASURED.connections,
  get neurons() { return this.flyNeurons * this.multiplier; },
  get connections() { return this.flyConnections * this.multiplier; },
  humanNeurons: 8.6e10,
  get vsHuman() { return this.neurons / this.humanNeurons; },
  // Modules actually executed per step. The honest number.
  modulesSimulated: 8,
};

export const AIM = {
  boltSpeed: 22,        // m/s -- slow enough that leading a moving target matters
  // Reflexes. Every one of these was set for eight slow flies; against eighty
  // the old numbers meant he was still bringing the weapon round while the next
  // one landed on him. Measured effect in tools/pressure.mjs.
  slewRate: 6.4,        // rad/s, how fast the weapon can be brought onto a target
  fireTolerance: 0.055, // rad of aim error permitted before firing
  confidenceToFire: 0.40,
  cooldown: 0.26,       // s between shots
  maxRange: 11,
  // Melee. Inside this the rifle is useless and the sword comes out; the
  // strike itself only lands inside reach.
  meleeRange: 1.9,
  meleeReach: 1.10,     // MEASURED: blade tip reaches 0.79 m horizontally, plus
                        // the 0.38 m hit tolerance. Swinging from further is a
                        // guaranteed miss, which is what 1.40 was producing.
  meleeArc: 1.0,        // rad half-angle the strike can cover
  // The edge is not live the instant the swing is ordered: the blade has to be
  // wound up and driven first. MEASURED at 0.217 s by tools/swing.mjs, which
  // prints the live window for whatever the swing constants currently are.
  //
  // This matters because a fly crosses about a fifth of a metre in that time,
  // which is most of the reach. Testing where it IS orders a swing at a place
  // it has already left. Testing where it WILL BE is the same leading solution
  // the rifle already uses, applied to the other weapon.
  swingLead: 0.217,     // s from ordering a cut to the edge going live
  // Target selection hysteresis: how much closer a rival has to be, as a
  // fraction, before the tracker will abandon a lock. Without this it thrashes
  // between two flies at similar range and never solves either.
  switchMargin: 0.60,
  // Peripheral awareness. The precise channel is the frontal +/-75 deg visual
  // field; this is the coarse one that covers the other 210 degrees.
  //
  // It is not a second pair of eyes. A fly in this scene beats its wings at
  // 13.7 Hz (see scale.js) and that is the cue: it gives PRESENCE and a rough
  // BEARING, nothing else -- no range, no velocity, and far too coarse to aim
  // with. All it can do is start a turn, which is exactly what it does. Humans
  // work the same way: something is heard off to one side, the body turns, and
  // only then does the accurate channel get a look at it.
  hearingRange: 6.5,    // m, omnidirectional but short
  hearingNoise: 0.22,   // rad of bearing error -- enough to turn toward, not to shoot at
  // Observation noise the tracker has to work through.
  bearingNoise: 0.018,  // rad
  rangeNoise: 0.06,     // m
  // Alpha-beta filter gains. Higher alpha trusts the new observation more, so
  // the estimate converges in fewer frames -- noisier, but a solution that
  // arrives late is worth nothing.
  alpha: 0.62,
  beta: 0.19,
  memoryHalfLife: 1.5,  // s of confidence decay while the target is unseen
};

/**
 * Alpha-beta tracker over a 3D point. Keeps position and velocity, coasts on
 * the forward model when the target is not observable, and reports how much it
 * trusts its own estimate.
 */
export class TargetTracker {
  constructor(cfg = AIM) {
    this.cfg = cfg;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.confidence = 0;
    this.locked = false;
    this.timeUnseen = Infinity;
  }

  /**
   * @param {number} dt
   * @param {?object} obs noisy observed position {x,y,z}, or null if not visible
   */
  step(dt, obs) {
    // Forward model: where the target should be now, given what we last knew.
    const px = this.pos.x + this.vel.x * dt;
    const py = this.pos.y + this.vel.y * dt;
    const pz = this.pos.z + this.vel.z * dt;

    if (obs) {
      const rx = obs.x - px;
      const ry = obs.y - py;
      const rz = obs.z - pz;

      if (!this.locked) {
        // First sight: take the observation whole, no velocity yet.
        this.pos = { x: obs.x, y: obs.y, z: obs.z };
        this.vel = { x: 0, y: 0, z: 0 };
        this.locked = true;
      } else {
        const a = this.cfg.alpha;
        const b = this.cfg.beta / Math.max(dt, 1e-4);
        this.pos = { x: px + a * rx, y: py + a * ry, z: pz + a * rz };
        this.vel = {
          x: this.vel.x + b * rx,
          y: this.vel.y + b * ry,
          z: this.vel.z + b * rz,
        };
      }
      this.timeUnseen = 0;
      this.confidence = Math.min(1, this.confidence + dt * 2.2);
    } else {
      // Coast. This is the working-memory case: the estimate survives, but
      // trust in it decays, and the fire threshold will eventually refuse.
      this.pos = { x: px, y: py, z: pz };
      this.timeUnseen += dt;
      const k = Math.pow(0.5, dt / this.cfg.memoryHalfLife);
      this.confidence *= k;
      if (this.confidence < 0.02) { this.locked = false; this.confidence = 0; }
    }

    return this.confidence;
  }

  speed() {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }
}

/**
 * Where to aim so a bolt leaving `from` at `speed` meets the tracked target.
 * Returns null when no positive-time solution exists (target outrunning the bolt).
 */
export function interceptPoint(from, pos, vel, speed) {
  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  const dz = pos.z - from.z;

  const a = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z - speed * speed;
  const b = 2 * (dx * vel.x + dy * vel.y + dz * vel.z);
  const c = dx * dx + dy * dy + dz * dz;

  let t;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-9) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    const cands = [t1, t2].filter((v) => v > 1e-4).sort((p, q) => p - q);
    if (!cands.length) return null;
    t = cands[0];
  }
  if (!Number.isFinite(t) || t <= 0 || t > 6) return null;

  return { x: pos.x + vel.x * t, y: pos.y + vel.y * t, z: pos.z + vel.z * t, t };
}

/**
 * The whole upper brain. Locomotion is NOT handled here -- FlyBrain still does
 * that. This consumes an observation and produces aim and fire commands.
 */
export class ZoroBrain {
  constructor(cfg = {}) {
    this.cfg = { ...AIM, ...cfg };
    this.tracker = new TargetTracker(this.cfg);

    this.aimYaw = 0;    // torso-relative, rad
    this.aimPitch = 0;
    this.aiming = 0;    // 0..1 pose blend
    this.aimError = Math.PI;
    this.cooldown = 0;
    this.wantsFire = false;
    this.lead = null;
    this.shots = 0;
    this.hits = 0;

    this.targetId = null;   // which fly is being tracked
    this.weapon = 'rifle';  // 'rifle' | 'sword'
    this.wantsSwing = false;
    this.meleeRange = Infinity;
    this.switches = 0;
    this.cooldownScale = 1;

    // Peripheral channel.
    this.orientBearing = null; // egocentric bearing worth turning toward
    this.swingRange = Infinity; // predicted range at the moment the edge lives
    this.heardCount = 0;
    this.random = cfg.random || makeRandom(cfg.seed || 31337);
  }

  /**
   * Choose which fly to engage from the visible candidates.
   *
   * The fly circuit cannot do this: bearing-nulling steers to whatever is in
   * front of it. Holding several targets and picking between them is part of
   * what the budget in CAPACITY is spent on.
   *
   * @param {Array} candidates [{ id, observed|null, range }]
   * @returns {?object} the chosen candidate
   */
  selectTarget(candidates) {
    let best = null;
    let bestScore = Infinity;

    for (const c of candidates) {
      if (!c.observed) continue;
      // Nearest wins, but the incumbent gets a discount so the lock is sticky.
      const score = c.id === this.targetId ? c.range * this.cfg.switchMargin : c.range;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    // --- peripheral ---------------------------------------------------------
    // Only consulted when the frontal field is empty. Something audible behind
    // the character is a reason to TURN, never a reason to shoot: the bearing
    // carries too much error and there is no range at all.
    this.orientBearing = null;
    this.heardCount = 0;
    if (!best) {
      let nearest = null;
      for (const c of candidates) {
        if (c.observed || !c.heard) continue;
        this.heardCount++;
        if (!nearest || c.range < nearest.range) nearest = c;
      }
      if (nearest) {
        const noise = (this.random() - 0.5) * 2 * this.cfg.hearingNoise;
        this.orientBearing = wrapPi(nearest.bearing + noise);
      }
    }

    if (best && best.id !== this.targetId) {
      // A different object: the velocity estimate belonged to the old one and
      // carrying it over would aim at a lead computed from the wrong motion.
      this.tracker.locked = false;
      this.tracker.confidence = 0;
      this.tracker.vel = { x: 0, y: 0, z: 0 };
      if (this.targetId !== null) this.switches++;
      this.targetId = best.id;
    }
    return best;
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {object} s.muzzle    world position the bolt leaves from
   * @param {number} s.bodyYaw   world yaw of the character
   * @param {?object} s.observed noisy world position of the target, or null
   * @param {number} s.range     m to the target, for the range gate
   */
  step(dt, s) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const conf = this.tracker.step(dt, s.observed);

    // Solve the intercept against the tracked estimate, not the observation --
    // this is what makes it prediction rather than pursuit.
    const lead = conf > 0.05
      ? interceptPoint(s.muzzle, this.tracker.pos, this.tracker.vel, this.cfg.boltSpeed)
      : null;
    this.lead = lead;

    const engage = lead && conf > 0.05 && s.range < this.cfg.maxRange;
    this.aiming += ((engage ? 1 : 0) - this.aiming) * Math.min(1, dt * 11);

    if (engage) {
      // Desired direction, expressed relative to the body so the pose can use it.
      const dx = lead.x - s.muzzle.x;
      const dy = lead.y - s.muzzle.y;
      const dz = lead.z - s.muzzle.z;
      const horiz = Math.hypot(dx, dz);

      const worldYaw = Math.atan2(dx, dz);
      const wantYaw = wrapPi(worldYaw - s.bodyYaw);
      const wantPitch = Math.atan2(dy, horiz);

      // Finite slew: the weapon cannot snap onto a target instantly.
      const maxStep = this.cfg.slewRate * dt;
      this.aimYaw += clamp(wrapPi(wantYaw - this.aimYaw), -maxStep, maxStep);
      this.aimPitch += clamp(wantPitch - this.aimPitch, -maxStep, maxStep);

      this.aimError = Math.hypot(wrapPi(wantYaw - this.aimYaw), wantPitch - this.aimPitch);
    } else {
      this.aimError = Math.PI;
    }

    // --- weapon choice ------------------------------------------------------
    // Close in, a 22 m/s bolt aimed at a leading solution is the wrong tool:
    // flight time is near zero, the aim slew cannot keep up with the angular
    // rate, and the edge covers the whole reach at once.
    this.meleeRange = s.range;
    const wantMelee = s.range < this.cfg.meleeRange && conf > 0.05;
    this.weapon = wantMelee ? 'sword' : 'rifle';

    // Swing when the target will be inside reach as the edge goes live, and is
    // roughly in front. The tracker already carries a velocity, so this is the
    // position it is about to be in rather than the one it is in.
    const bearingOk = Math.abs(wrapPi(this.aimYaw)) < this.cfg.meleeArc;
    const lt = this.cfg.swingLead;
    const sx = this.tracker.pos.x + this.tracker.vel.x * lt - s.muzzle.x;
    const sy = this.tracker.pos.y + this.tracker.vel.y * lt - s.muzzle.y;
    const sz = this.tracker.pos.z + this.tracker.vel.z * lt - s.muzzle.z;
    this.swingRange = Math.hypot(sx, sy, sz);
    this.wantsSwing = Boolean(
      wantMelee && this.swingRange < this.cfg.meleeReach && bearingOk,
    );

    this.wantsFire = Boolean(
      engage
      && !wantMelee
      && this.cooldown <= 0
      && this.aimError < this.cfg.fireTolerance
      && conf >= this.cfg.confidenceToFire,
    );

    return {
      aiming: this.aiming,
      aimYaw: this.aimYaw,
      aimPitch: this.aimPitch,
      fire: this.wantsFire,
      weapon: this.weapon,
      swing: this.wantsSwing,
      lead,
      confidence: conf,
    };
  }

  /**
   * Called by the scene once a bolt has actually been spawned.
   * `cooldownScale` is set from the reward streak in score.js -- the one place
   * the scoring reaches back into behaviour rather than just being displayed.
   */
  didFire() {
    this.cooldown = this.cfg.cooldown * (this.cooldownScale || 1);
    this.shots++;
  }

  state() {
    return {
      confidence: this.tracker.confidence,
      locked: this.tracker.locked,
      timeUnseen: this.tracker.timeUnseen,
      targetSpeed: this.tracker.speed(),
      aimError: this.aimError,
      aiming: this.aiming,
      cooldown: this.cooldown,
      shots: this.shots,
      hits: this.hits,
      leadTime: this.lead ? this.lead.t : 0,
      targetId: this.targetId,
      orientBearing: this.orientBearing,
      heardCount: this.heardCount,
      weapon: this.weapon,
      switches: this.switches,
      range: this.meleeRange,
    };
  }
}
