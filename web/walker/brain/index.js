// The whole circuit, assembled.
//
//   world  ->  Sensory  ->  CentralComplex  ->  DescendingNeurons  ->  VNC  ->  body
//                 |               ^                                           |
//                 +-- ER landmark +                                           |
//                                 +------- PEN, angular velocity -------------+
//
// The loop is closed: the legs move the body, the body turns, and that turn
// comes back into the compass through PEN. Break the feedback and the compass
// stops tracking, which is the point of wiring it this way rather than reading
// the true heading off the transform.

import { Sensory } from './sensory.js';
import { CentralComplex } from './centralComplex.js';
import { DescendingNeurons } from './descending.js';
import { VentralNerveCord } from './vnc.js';
import { wrapPi, clamp } from './neuron.js';
import { CELL_TYPES } from './connectome.js';

export { CELL_TYPES };

export class FlyBrain {
  constructor(opts = {}) {
    this.sensory = new Sensory(opts);
    this.cx = new CentralComplex(opts);
    this.dn = new DescendingNeurons(opts);
    this.vnc = new VentralNerveCord(opts);
    this.sex = opts.sex || 'male';

    this.goalAngle = 0;
    this.motor = { speed: 0, yawRate: 0, legPhase: [0, Math.PI], backward: 0 };
  }

  setSex(sex) {
    this.sex = sex;
    this.sensory.sex = sex;
  }

  /** Align the compass with a known heading, e.g. at spawn. */
  anchor(heading) {
    this.cx.seedBump(heading);
  }

  /**
   * @param {number} dt seconds
   * @param {object} world readings supplied by the scene
   * @param {number} world.trueHeading      rad, for the ER landmark reading only
   * @param {number} world.angularVelocity  rad/s, measured from the body (PEN input)
   * @param {number} world.wanderBearing    rad, egocentric bearing to the current waypoint
   * @param {number} world.targetBearing    rad, egocentric bearing to the target object
   * @param {number} world.targetDistance   m
   * @param {boolean} world.targetVisible
   * @param {number} world.proxL, world.proxR 0..1 obstacle proximity
   * @param {number} world.contact          0..1
   * @param {number} world.landmarkStrength 0..1
   * @param {boolean} [world.halt] stand still: stop the legs, not just the body
   */
  step(dt, world) {
    const sen = this.sensory.step(dt, world);

    // Which bearing is being steered to. The courtship pathway wins when it is
    // active, which in the female configuration it never is.
    const approaching = sen.approachDrive > 0.15;
    const bearing = approaching ? sen.approachBearing : world.wanderBearing;

    // Egocentric bearing plus the current compass estimate gives an allocentric
    // goal -- the conversion the fan-shaped body has to make. Note it uses the
    // ESTIMATE, so when the compass drifts the animal walks off course, which is
    // the behaviour you want to be able to see.
    this.goalAngle = wrapPi(this.cx.headingEstimate + bearing);

    const cx = this.cx.step(dt, {
      angularVelocity: world.angularVelocity,
      landmarkHeading: sen.landmarkHeading,
      landmarkStrength: sen.landmarkStrength,
      goalAngle: this.goalAngle,
    });

    // Stop on arrival; otherwise walk. The threshold has to sit INSIDE the
    // sword reach (1.15 m) or the character halts just outside striking
    // distance and can never close the last hand-span.
    const arrived = approaching && world.targetDistance < 0.75;

    // Slow down to turn. Walking flat out at something 90 degrees off to the
    // side means walking into whatever is in front instead, which in a 2 m
    // corridor is a wall. Forward and angular velocity are anti-correlated in
    // walking flies too: forward speed drops through a saccade.
    const turnCost = Math.max(0.25, Math.cos(clamp(bearing, -Math.PI, Math.PI)));

    // `halt` is a deliberate stop from above -- standing in front of a picture,
    // or squaring up to something that is about to be dealt with. It has to
    // drop the drive HERE rather than be applied to the position afterwards.
    // Gating the position alone leaves the CPG running at full drive, and the
    // character marches on the spot: legs cycling, nothing moving. Dropping
    // walkDrive stops the legs too, and because DNp09 is a rate unit with a
    // time constant it decelerates into the stop instead of snapping.
    const walkDrive = (arrived || world.halt) ? 0 : turnCost;

    const dn = this.dn.step(dt, {
      pfl3L: cx.pfl3L,
      pfl3R: cx.pfl3R,
      walkDrive,
      contact: world.contact || 0,
      avoidL: sen.avoidL,
      avoidR: sen.avoidR,
    });

    const vnc = this.vnc.step(dt, {
      forwardDrive: dn.forwardDrive,
      turnCommand: dn.turnCommand,
      backward: dn.backward,
    });

    this.motor = {
      speed: vnc.speed,
      yawRate: dn.yawRate,
      legPhase: vnc.legPhase,
      backward: dn.backward,
      stepFrequency: this.vnc.stepFrequency,
    };
    return this.motor;
  }

  /** Flat snapshot for the HUD. */
  state() {
    return {
      sex: this.sex,
      headingEstimate: this.cx.headingEstimate,
      bumpStrength: this.cx.bumpStrength,
      goalAngle: this.goalAngle,
      steerError: this.cx.steerError,
      epg: this.cx.epg.rate,
      epgTheta: this.cx.epg.theta,
      pfl3L: this.cx.pfl3L,
      pfl3R: this.cx.pfl3R,
      dna02L: this.dn.dna02L.rate,
      dna02R: this.dn.dna02R.rate,
      dnp09: this.dn.dnp09.rate,
      mdn: this.dn.mdn.rate,
      lovp92: this.sensory.lovp92.rate,
      aotu012: this.sensory.aotu012.rate,
      turnCommand: this.dn.turnCommand,
      legPhase: this.vnc.legPhase,
      legStance: this.vnc.stance(),
      tripodSync: this.vnc.tripodSync,
      stepHz: Math.abs(this.vnc.stepFrequency) / (Math.PI * 2),
      speed: this.vnc.speed,
    };
  }
}
