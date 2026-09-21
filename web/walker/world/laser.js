// Laser bolts, muzzle flash and impacts.
//
// Bolts travel at a finite 22 m/s. That is deliberate and it is what makes the
// fire control in brain/zoro.js mean anything: at instant hit speed, leading a
// target is unnecessary and the prediction would be invisible.
//
// Hit tests are segment-based. At 22 m/s and a 1/120 s step a bolt advances
// 0.18 m. That was over the old 0.11 m hit radius, where a point test tunnelled
// through the fly about half the time; at the current 0.33 m it would still
// miss narrow passes. The sweep costs nothing and removes the question.

import * as THREE from '../vendor/three.module.js';

const MAX_BOLTS = 10;
const MAX_IMPACTS = 12;
const BOLT_LIFE = 1.6;   // s
const CORE = 0xbff4ff;
const GLOW = 0x2fd4ff;

/** Shortest distance from point P to segment AB, and where along it that falls. */
function segmentPointDistance(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const cz = az + dz * t;
  return { dist: Math.hypot(px - cx, py - cy, pz - cz), t, x: cx, y: cy, z: cz };
}

export class Bolts {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.speed = opts.speed || 22;
    this.bolts = [];
    this.impacts = [];
    // A bolt that expires or hits the room without touching a fly is a miss.
    // The score needs it, and nothing else was counting it.
    this.missCount = 0;

    this.group = new THREE.Group();
    scene.add(this.group);

    // One geometry and material shared by every bolt.
    this.coreGeo = new THREE.CapsuleGeometry(0.018, 0.30, 4, 8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: CORE });
    this.glowGeo = new THREE.SphereGeometry(0.075, 12, 10);
    this.glowMat = new THREE.MeshBasicMaterial({
      color: GLOW, transparent: true, opacity: 0.38, depthWrite: false,
    });

    this.impactGeo = new THREE.RingGeometry(0.03, 0.12, 20);
    this.impactMat = new THREE.MeshBasicMaterial({
      color: GLOW, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false,
    });

    // Muzzle flash, reused.
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshBasicMaterial({ color: CORE, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.group.add(this.flash);
    this.flashLight = new THREE.PointLight(GLOW, 0, 4, 2);
    this.group.add(this.flashLight);
    this._flashT = 0;
  }

  /** @param {THREE.Vector3} origin @param {THREE.Vector3} dir unit */
  spawn(origin, dir) {
    if (this.bolts.length >= MAX_BOLTS) return null;

    const core = new THREE.Mesh(this.coreGeo, this.coreMat);
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    core.position.copy(origin);
    this.group.add(core);

    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.position.copy(origin);
    this.group.add(glow);

    const bolt = {
      pos: { x: origin.x, y: origin.y, z: origin.z },
      vel: { x: dir.x * this.speed, y: dir.y * this.speed, z: dir.z * this.speed },
      life: BOLT_LIFE,
      core, glow,
    };
    this.bolts.push(bolt);

    this.flash.position.copy(origin);
    this.flashLight.position.copy(origin);
    this._flashT = 0.07;
    return bolt;
  }

  /**
   * @param {number} dt
   * @param {object} env { obstacles, hw, hd, maxY }
   * @param {Array} targets [{ pos:{x,y,z}, radius, id }]
   * @returns {Array} hits [{ id, x, y, z }]
   */
  update(dt, env, targets) {
    const hits = [];

    this._flashT = Math.max(0, this._flashT - dt);
    const f = this._flashT / 0.07;
    this.flash.material.opacity = f * 0.9;
    this.flash.scale.setScalar(0.6 + (1 - f) * 0.9);
    this.flashLight.intensity = f * 9;

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const ax = b.pos.x;
      const ay = b.pos.y;
      const az = b.pos.z;
      const bx = ax + b.vel.x * dt;
      const by = ay + b.vel.y * dt;
      const bz = az + b.vel.z * dt;

      let consumed = false;
      let hitTarget = false;

      // --- targets, swept ---------------------------------------------------
      for (const t of targets) {
        const s = segmentPointDistance(ax, ay, az, bx, by, bz, t.pos.x, t.pos.y, t.pos.z);
        if (s.dist <= t.radius) {
          hits.push({ id: t.id, x: s.x, y: s.y, z: s.z });
          this._impact(s.x, s.y, s.z, true);
          consumed = true;
          hitTarget = true;
          break;
        }
      }

      // --- room ------------------------------------------------------------
      if (!consumed) {
        const outside = Math.abs(bx) > env.hw || Math.abs(bz) > env.hd
                     || by < 0.02 || by > env.maxY;
        let inBox = false;
        if (!outside) {
          for (const o of env.obstacles) {
            if (bx > o.minX && bx < o.maxX && bz > o.minZ && bz < o.maxZ && by < 1.9) {
              inBox = true;
              break;
            }
          }
        }
        if (outside || inBox) {
          this._impact(bx, by, bz, false);
          consumed = true;
        }
      }

      b.pos.x = bx;
      b.pos.y = by;
      b.pos.z = bz;
      b.life -= dt;

      if (consumed || b.life <= 0) {
        if (!hitTarget) this.missCount++;
        this.group.remove(b.core);
        this.group.remove(b.glow);
        this.bolts.splice(i, 1);
        continue;
      }

      b.core.position.set(bx, by, bz);
      b.glow.position.set(bx, by, bz);
    }

    // --- impact rings -------------------------------------------------------
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.t += dt;
      const k = im.t / im.dur;
      if (k >= 1) {
        this.group.remove(im.mesh);
        im.mesh.material.dispose();
        this.impacts.splice(i, 1);
        continue;
      }
      im.mesh.scale.setScalar(0.4 + k * (im.big ? 3.4 : 1.8));
      im.mesh.material.opacity = (1 - k) * 0.85;
      im.mesh.lookAt(im.face);
    }

    return hits;
  }

  _impact(x, y, z, big) {
    if (this.impacts.length >= MAX_IMPACTS) return;
    const mesh = new THREE.Mesh(this.impactGeo, this.impactMat.clone());
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.impacts.push({
      mesh, t: 0, dur: big ? 0.45 : 0.28, big,
      face: new THREE.Vector3(x, y + 1, z + 1),
    });
  }

  get liveBolts() {
    return this.bolts;
  }
}
