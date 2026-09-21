// Katana, and the slash that uses it.
//
// Laid out along +X from the grip at the origin, matching world/rifle.js, so
// both weapons mount on the same anchor and the hand IK targets are found the
// same way.
//
// Proportions are a real katana: 0.70 m blade, 0.26 m tsuka, gentle sori
// (curve) built from short segments rather than a lathe, because a segmented
// curve is easier to keep flat-sided and a katana is not a round bar.

import * as THREE from '../vendor/three.module.js';

const STEEL = 0xcdd6dd;
const STEEL_DARK = 0x6f7a84;
const WRAP = 0x1b1b20;
const FITTING = 0x2c2c32;

const BLADE_LEN = 0.70;
const TSUKA_LEN = 0.26;
const SEGMENTS = 10;
const SORI = 0.055; // total rise of the blade tip above the straight line

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildSword() {
  const g = new THREE.Group();
  g.name = 'katana';

  const mSteel = new THREE.MeshStandardMaterial({
    color: STEEL, roughness: 0.14, metalness: 0.95,
  });
  const mEdge = new THREE.MeshStandardMaterial({
    color: 0xf2f7fa, roughness: 0.06, metalness: 0.9,
  });
  const mSpine = new THREE.MeshStandardMaterial({
    color: STEEL_DARK, roughness: 0.3, metalness: 0.9,
  });
  const mWrap = new THREE.MeshStandardMaterial({ color: WRAP, roughness: 0.82 });
  const mFit = new THREE.MeshStandardMaterial({
    color: FITTING, roughness: 0.38, metalness: 0.7,
  });

  // --- tsuka, the handle -----------------------------------------------------
  g.add(mesh(new THREE.BoxGeometry(TSUKA_LEN, 0.030, 0.021), mWrap, -TSUKA_LEN / 2, -0.004, 0));
  // Ito wrap, as alternating diamonds down the handle.
  for (let i = 0; i < 7; i++) {
    const x = -0.022 - i * 0.034;
    const d = mesh(new THREE.BoxGeometry(0.016, 0.033, 0.024), mFit, x, -0.004, 0);
    d.rotation.x = Math.PI / 4;
    g.add(d);
  }
  // Kashira, the butt cap.
  g.add(mesh(new THREE.BoxGeometry(0.016, 0.034, 0.025), mFit, -TSUKA_LEN - 0.006, -0.004, 0));

  // --- tsuba, the guard ------------------------------------------------------
  const tsuba = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.008, 22), mFit, 0.004, 0, 0);
  tsuba.rotation.z = Math.PI / 2;
  tsuba.scale.set(1, 1, 0.82);
  g.add(tsuba);
  g.add(mesh(new THREE.BoxGeometry(0.018, 0.036, 0.026), mFit, 0.018, 0, 0)); // habaki

  // --- blade, curved ---------------------------------------------------------
  // Each segment is placed along a shallow arc and rotated to match its slope,
  // so the sides stay flat and the edge stays a line.
  const segLen = BLADE_LEN / SEGMENTS;
  const bladeStart = 0.030;
  for (let i = 0; i < SEGMENTS; i++) {
    const u0 = i / SEGMENTS;
    const u1 = (i + 1) / SEGMENTS;
    const um = (u0 + u1) / 2;

    const x = bladeStart + um * BLADE_LEN;
    const y = SORI * um * um;              // curve rises toward the tip
    const slope = Math.atan(2 * SORI * um / BLADE_LEN);

    const taper = 1 - um * 0.22;
    const last = i === SEGMENTS - 1;

    const body = mesh(
      new THREE.BoxGeometry(segLen * 1.02, 0.029 * taper, 0.0072 * taper),
      mSteel, x, y, 0,
    );
    body.rotation.z = slope;
    g.add(body);

    // Ha, the cutting edge, along the lower face.
    const edge = mesh(
      new THREE.BoxGeometry(segLen * 1.02, 0.006, 0.0030 * taper),
      mEdge, x, y - 0.0145 * taper, 0,
    );
    edge.rotation.z = slope;
    g.add(edge);

    // Mune, the blunt spine.
    const spine = mesh(
      new THREE.BoxGeometry(segLen * 1.02, 0.004, 0.0076 * taper),
      mSpine, x, y + 0.0145 * taper, 0,
    );
    spine.rotation.z = slope;
    g.add(spine);

    if (last) {
      // Kissaki, the angled tip.
      const tip = mesh(new THREE.ConeGeometry(0.0115, 0.052, 4), mEdge,
        x + segLen / 2 + 0.024, y + SORI * 0.16, 0);
      tip.rotation.z = -Math.PI / 2 + slope;
      tip.rotation.x = Math.PI / 4;
      g.add(tip);
    }
  }

  g.userData.grip = new THREE.Vector3(-0.10, -0.004, 0);      // right hand
  g.userData.gripLow = new THREE.Vector3(-0.215, -0.004, 0);  // left hand, two-handed
  g.userData.tip = new THREE.Vector3(bladeStart + BLADE_LEN + 0.05, SORI, 0);
  g.userData.bladeStart = bladeStart;
  g.userData.bladeLength = BLADE_LEN;

  return g;
}
// ---------------------------------------------------------------------------
// The slash
// ---------------------------------------------------------------------------
//
// INTEGRATED, NOT KEYFRAMED. The first version eased a parameter from 0 to 1
// with a smoothstep, which describes a position, not a motion: the blade had no
// momentum, the wind-up and the follow-through were the same curve reversed,
// and the arc read as pushed rather than swung.
//
// The blade is a one-degree-of-freedom rigid body here. `u` is where it is
// along its arc and `w` is how fast; the only things written per frame are
// TORQUES, and everything else falls out of integrating them:
//
//     u" = T(phase) - c u'            semi-implicit Euler, substepped
//
//   wind-up   a small negative torque cocks it back over the shoulder
//   drive     a large positive torque; this is the muscular effort
//   follow    a BRAKE -- a torque that opposes motion and quits at zero, which
//             is what arms do to a cut. A constant negative torque instead of a
//             brake yanked the blade back up the arc it had just come down.
//   recover   a critically damped spring back to the carry
//
// So the blade is slowest at the top of the wind-up and at the end of the
// follow-through, fastest a little past the middle, and it carries past the
// target line because it has momentum. Nothing draws that in; it is what the
// equation does.
//
// MEASURED with these constants: peak tip speed 25 m/s, live window 100 ms,
// wind-up to u = -0.23, follow-through stopping at u = 0.99. A hard human cut
// is somewhere around 20-30 m/s at the tip, so the blade is moving at about the
// right speed rather than at an animator's speed.
//
// The contact test comes off the same state: the edge is live where the blade
// IS and while it is moving fast enough to cut, not during a fixed slice of the
// clock. A blade that has been slowed by anything is no longer cutting.
//
// AXES. The blade runs along +X, so for the mount:
//   roll  (rotation.z) is ELEVATION -- it lifts and drops the tip
//   yaw   (rotation.y) is AZIMUTH   -- it sweeps across the front
//   pitch (rotation.x) only rotates the edge about the blade axis
// These were mixed up in the first version, which is why the cut swept between
// 0.56 and 1.12 m and passed under every fly in the room.

// Carried low across the body, tip forward and down.
const REST = { yaw: -2.17, pitch: -0.70, roll: -0.50 };

// The two ends of the cut, as mount angles. `u` interpolates between them and
// is free to run outside 0..1: below 0 is the cocked guard above the shoulder,
// past 1 is the follow-through.
//
// Kesa-giri: high on the figure's right, down across to the left. The elevation
// sweep is centred so the edge crosses fly height during the live window rather
// than at the ends of the arc. MEASURED: the blade axis sweeps 2.83 rad over
// one unit of u, which is where `arcRadians` comes from.
const CUT = {
  yaw0: -2.30, yaw1: -0.70,
  pitch0: -0.90, pitch1: 0.20,
  roll0: 0.62, roll1: -0.68,
};

export const SWING = {
  // Torques are in u per second squared. Tuned against the targets above with
  // tools/swing.mjs, which prints the trajectory these produce.
  windUp: { t: 0.09, torque: -55, damp: 6 },
  drive: { t: 0.165, torque: 112, damp: 5.0 },
  follow: { t: 0.11, brake: 130, damp: 6 },
  recover: { stiffness: 300, damp: 35 },
  // Blade axis swept per unit of u, and the tip's distance from the mount.
  // Together they turn w into a tip speed in m/s.
  arcRadians: 2.826,
  tipRadius: 0.86,
  // The edge cuts between these points on the arc, and only above this speed.
  liveFrom: 0.18,
  liveTo: 1.05,
  liveSpeed: 6.0,   // m/s at the tip
};

export class Swing {
  constructor(opts = {}) {
    this.cfg = {
      ...SWING,
      ...opts,
      windUp: { ...SWING.windUp, ...(opts.windUp || {}) },
      drive: { ...SWING.drive, ...(opts.drive || {}) },
      follow: { ...SWING.follow, ...(opts.follow || {}) },
      recover: { ...SWING.recover, ...(opts.recover || {}) },
    };
    this.cooldown = opts.cooldown ?? 0.26;
    // End of the follow-through. The strike is over here; what comes after is
    // the blade travelling back to the carry, which is why the cooldown starts
    // at this point rather than when the arm has finished returning.
    this.strikeEnd = this.cfg.windUp.t + this.cfg.drive.t + this.cfg.follow.t;
    // Kept for callers that used to read it as the length of a strike.
    this.duration = this.strikeEnd;

    this.t = -1;        // -1 = idle
    this.u = 0;         // where the blade is along its arc
    this.w = 0;         // how fast, in u per second
    this._cool = 0;
    this.hasCut = false;
    this.peakTipSpeed = 0;
  }

  get active() { return this.t >= 0; }
  get ready() { return this._cool <= 0 && (this.t < 0 || this.t >= this.strikeEnd); }

  /** Tip speed in m/s, from the integrated state rather than from the clock. */
  get tipSpeed() {
    return Math.abs(this.w) * this.cfg.arcRadians * this.cfg.tipRadius;
  }

  /**
   * True while the edge can register a cut: inside the live arc AND travelling
   * forward fast enough to cut. Both come from the integrated state, so a swing
   * that has been slowed is not quietly still lethal.
   */
  get contacting() {
    if (this.t < 0) return false;
    return this.u >= this.cfg.liveFrom && this.u <= this.cfg.liveTo
      && this.w > 0 && this.tipSpeed >= this.cfg.liveSpeed;
  }

  /** Which part of the strike this is, for the torque and for the pose. */
  phase() {
    const c = this.cfg;
    if (this.t < 0) return 'idle';
    if (this.t < c.windUp.t) return 'windup';
    if (this.t < c.windUp.t + c.drive.t) return 'drive';
    if (this.t < this.strikeEnd) return 'follow';
    return 'recover';
  }

  start() {
    if (!this.ready) return false;
    this.t = 0;
    this.u = 0;
    this.w = 0;
    this.hasCut = false;
    this.peakTipSpeed = 0;
    return true;
  }

  step(dt) {
    if (this._cool > 0) this._cool = Math.max(0, this._cool - dt);
    if (this.t < 0) return;

    const c = this.cfg;
    const wasStriking = this.t < this.strikeEnd;

    // Substepped, so a long frame cannot integrate the drive torque into a
    // blade that has teleported through the target between two contact tests.
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.t += h;
      const ph = this.phase();
      let torque;
      let damp;
      if (ph === 'windup') {
        torque = c.windUp.torque;
        damp = c.windUp.damp;
      } else if (ph === 'drive') {
        torque = c.drive.torque;
        damp = c.drive.damp;
      } else if (ph === 'follow') {
        // A brake, not a reverse drive: it resists motion and does nothing once
        // the blade has stopped.
        torque = this.w > 0 ? -c.follow.brake : 0;
        damp = c.follow.damp;
      } else {
        torque = -c.recover.stiffness * this.u;
        damp = c.recover.damp;
      }
      const wPrev = this.w;
      this.w += (torque - damp * this.w) * h;
      // The brake stops the blade; it does not push it back up its own arc.
      if (ph === 'follow' && wPrev > 0 && this.w < 0) this.w = 0;
      this.u += this.w * h;
      if (this.w > 0 && this.tipSpeed > this.peakTipSpeed) {
        this.peakTipSpeed = this.tipSpeed;
      }
    }

    // The strike is over at the end of the follow-through, so the next one can
    // be cued while the blade is still travelling home.
    if (wasStriking && this.t >= this.strikeEnd) this._cool = this.cooldown;

    // Idle again only when the blade has actually arrived, not when a clock
    // says so. The backstop is for a recovery that somehow never settles;
    // nothing has been seen to need it, but without it a stuck swing would
    // hold the sword out of the carry for the rest of the run.
    if (this.t >= this.strikeEnd
      && ((Math.abs(this.u) < 0.05 && Math.abs(this.w) < 1.0)
        || this.t > this.strikeEnd + 1.2)) {
      this.t = -1;
      this.u = 0;
      this.w = 0;
      this.hasCut = false;
    }
  }

  /**
   * Weapon orientation for this moment, plus what the body does about it. All
   * of it read straight off the integrated state, which is what keeps the torso
   * and the blade in sync for free.
   *
   * @returns {{yaw:number, pitch:number, roll:number, blur:number,
   *            twist:number, lean:number, u:number, speed:number}}
   */
  pose() {
    if (this.t < 0) {
      return { ...REST, blur: 0, twist: 0, lean: 0, u: 0, speed: 0 };
    }
    const u = this.u;
    return {
      yaw: CUT.yaw0 + u * (CUT.yaw1 - CUT.yaw0),
      pitch: CUT.pitch0 + u * (CUT.pitch1 - CUT.pitch0),
      roll: CUT.roll0 + u * (CUT.roll1 - CUT.roll0),
      // Blur tracks speed, because that is what blur is.
      blur: Math.min(1, this.tipSpeed / 16),
      // A cut is thrown from the hips: the torso leads the blade and finishes
      // turned over, and the weight drops into it.
      twist: -0.44 * u,
      lean: 0.17 * Math.max(0, u),
      u,
      speed: this.tipSpeed,
    };
  }
}

// ---------------------------------------------------------------------------
// The arc the blade leaves behind
// ---------------------------------------------------------------------------
//
// This was a fixed ring geometry with its opacity turned up during the cut,
// which meant the "trail" was in the same place whatever the blade did. A
// motion trail is a record of where something has been, so this records it: the
// blade's root and tip are sampled every frame into a ring buffer and the
// buffer is drawn as a ribbon, newest end bright and oldest end gone.
//
// The ribbon lives in the player's own space rather than the sword's. In the
// sword's space the blade never moves relative to the trail, so there would be
// nothing to draw; in world space it would be left behind as he walks. His own
// space is the one where the arc hangs off him the way the references show.

const TRAIL_SAMPLES = 26;

export function buildSwingTrail() {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const alpha = new Float32Array(TRAIL_SAMPLES * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

  // Two triangles per pair of samples, stitched root-to-tip.
  const idx = [];
  for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);

  // A plain shader rather than a MeshBasicMaterial, so the fade can run along
  // the ribbon instead of being one opacity for the whole thing.
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xdcecff) },
      uHot: { value: new THREE.Color(0xfff2d0) },
      uStrength: { value: 0 },
    },
    vertexShader: `
      attribute float aAlpha;
      varying float vA;
      void main() {
        vA = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uStrength;
      varying float vA;
      void main() {
        float a = vA * uStrength;
        if (a < 0.004) discard;
        // The leading edge of the arc is where the energy is, so it runs hot
        // and the tail cools off behind it.
        gl_FragColor = vec4(mix(uColor, uHot, vA * vA), a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  m.frustumCulled = false;   // the ribbon's bounds change every frame
  m.visible = false;
  m.userData.count = 0;      // samples written so far this swing
  return m;
}

const _root = new THREE.Vector3();
const _tip = new THREE.Vector3();

/**
 * Record one frame of the blade into the trail, or fade what is there.
 *
 * @param {THREE.Mesh} trail from buildSwingTrail, parented to the player group
 * @param {THREE.Object3D} sword
 * @param {THREE.Object3D} space the object whose local space the ribbon is in
 * @param {object} p the pose from Swing.pose()
 * @param {boolean} active whether a cut is in progress
 * @param {number} dt
 * @param {boolean} fresh true on the first frame of a new cut, which clears the
 *   previous arc; without it a second cut begun before the first has faded
 *   drags the old samples along behind it
 */
export function updateSwingTrail(trail, sword, space, p, active, dt = 1 / 60, fresh = false) {
  const pos = trail.geometry.getAttribute('position');
  const alpha = trail.geometry.getAttribute('aAlpha');

  if (fresh) trail.userData.count = 0;

  if (!active) {
    // Fade out what is left rather than cutting it off mid-arc. Per second,
    // not per frame, so the arc does not hang about at a low frame rate.
    const s = trail.material.uniforms.uStrength;
    s.value *= Math.exp(-dt * 13);
    trail.visible = s.value > 0.01;
    if (!trail.visible) trail.userData.count = 0;
    return;
  }

  sword.updateWorldMatrix(true, false);
  _root.set(sword.userData.bladeStart, 0, 0);
  sword.localToWorld(_root);
  space.worldToLocal(_root);
  _tip.copy(sword.userData.tip);
  sword.localToWorld(_tip);
  space.worldToLocal(_tip);

  // Shift the buffer down one and write the newest pair at the end. A ring
  // buffer would avoid the copy, but 26 samples is 156 floats and the index
  // arithmetic for a ring that has to stay in draw order is not worth it.
  const n = TRAIL_SAMPLES;
  const arr = pos.array;
  arr.copyWithin(0, 6, n * 6);
  const o = (n - 1) * 6;
  arr[o] = _root.x; arr[o + 1] = _root.y; arr[o + 2] = _root.z;
  arr[o + 3] = _tip.x; arr[o + 4] = _tip.y; arr[o + 5] = _tip.z;

  trail.userData.count = Math.min(n, trail.userData.count + 1);
  const filled = trail.userData.count;

  // Age fade, plus a hard zero on the samples from before this swing started so
  // a short arc does not drag a stale one behind it.
  const aa = alpha.array;
  for (let i = 0; i < n; i++) {
    const age = (i - (n - filled)) / Math.max(1, filled - 1);
    const v = i < n - filled ? 0 : Math.max(0, age) ** 1.6;
    aa[i * 2] = v * 0.55;      // root edge, dimmer
    aa[i * 2 + 1] = v;         // tip edge
  }

  pos.needsUpdate = true;
  alpha.needsUpdate = true;
  trail.material.uniforms.uStrength.value = p.blur * 0.85;
  trail.visible = p.blur > 0.02;
}
