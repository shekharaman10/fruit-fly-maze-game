// The fly, built at 534 mm body length -- about 30% of the character, and 214x
// a real Drosophila. See ../scale.js for the size note and the wingbeat.
//
// Built along +Z forward, matching the character, so a heading yaw rotates both
// the same way.

import * as THREE from '../vendor/three.module.js';
import { LENGTHS_M, sceneWingbeatHz } from '../scale.js';

export const FLY_LENGTH = LENGTHS_M.sceneFly; // 0.534 m
export const FLY_HIT_RADIUS = 0.33;           // m, scaled with the body

// How much room a fly has to be kept from a wall, which is NOT the same as how
// big it is to shoot at.
//
// MEASURED by tools/clearance.mjs from the built model: the widest the fly gets
// in the XZ plane is 0.329 m, and 0.422 m at the corner of its footprint, which
// is the worst case once it can be at any yaw. Wings and legs stick out well
// past the 0.534 m body the model is scaled by.
//
// resolveCollision keeps `radius + MAZE.wallT` from a wall's CENTRE line while
// the face is only half a thickness away, so the clearance a fly actually gets
// from the face is radius + wallT/2. It was flown at 0.30, which put the face
// 0.345 m away and left 0.077 m of fly on the other side of the wall.
//
//   0.422 - 0.045 = 0.377 minimum, and 0.40 for a little margin.
export const FLY_CLEAR_RADIUS = 0.40;

const C = {
  chitin: 0x53483a,
  chitinDark: 0x332c22,
  thorax: 0x6b5c45,
  eye: 0xc0392b,
  eyeDark: 0x7d2318,
  wing: 0xdfe8f0,
  bristle: 0x241f18,
};

// ---------------------------------------------------------------------------
// Procedural detail
// ---------------------------------------------------------------------------
//
// The reference is a photoreal render with painted maps. This project ships no
// image files for the fly, so the maps are generated instead. Two of them carry
// most of what makes a fly read as a fly rather than as a brown bead:
//
//   the compound eye   a dense hexagonal facet grid, which is the single most
//                      recognisable thing about the animal
//   the chitin         fine speckle and banding, so the body catches light
//                      unevenly instead of shading like a billiard ball
//
// Both need a canvas, so both only exist in a browser. node gets the flat
// colours and does not care -- nothing headless looks at a fly.

let _eyeTex = null;
let _chitinTex = null;

function eyeTexture() {
  if (_eyeTex !== null) return _eyeTex;
  if (typeof document === 'undefined') return (_eyeTex = false);

  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#8e2118';
  ctx.fillRect(0, 0, N, N);

  // Hexagonal packing: every other row offset by half a cell.
  const r = 5.2;
  const dx = r * 1.74;
  const dy = r * 1.5;
  for (let row = 0; row * dy < N + dy; row++) {
    for (let col = 0; col * dx < N + dx; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * dy;
      // Each facet is a tiny lens: bright at the top, dark at the rim.
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#e8705a');
      g.addColorStop(0.55, '#b83426');
      g.addColorStop(1, '#5e1610');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * r * 0.97;
        const py = cy + Math.sin(a) * r * 0.97;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _eyeTex = tex;
  return tex;
}

function chitinTexture() {
  if (_chitinTex !== null) return _chitinTex;
  if (typeof document === 'undefined') return (_chitinTex = false);

  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#5b5040';
  ctx.fillRect(0, 0, N, N);

  // Speckle. Deterministic, so every fly is the same fly.
  let s = 20260918;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(30 + rand() * 90);
    ctx.fillStyle = `rgba(${v},${Math.floor(v * 0.88)},${Math.floor(v * 0.66)},0.5)`;
    ctx.fillRect(rand() * N, rand() * N, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Faint banding across the abdomen direction.
  for (let y = 0; y < N; y += 8) {
    ctx.fillStyle = 'rgba(20,16,12,0.18)';
    ctx.fillRect(0, y, N, 2);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _chitinTex = tex;
  return tex;
}

const std = (color, rough = 0.55, metal = 0.15) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildFly() {
  const root = new THREE.Group();
  root.name = 'fly';

  const body = new THREE.Group();
  root.add(body);

  // Split into two halves at the thorax/abdomen waist, so a sword cut has
  // something real to separate. The fly is assembled into these rather than
  // into `body` directly.
  const front = new THREE.Group(); // head, thorax, wings, legs
  const rear = new THREE.Group();  // abdomen, halteres
  body.add(front);
  body.add(rear);

  const mChitin = std(C.chitin, 0.42, 0.35);
  const mDark = std(C.chitinDark, 0.5, 0.3);
  const mThorax = std(C.thorax, 0.5, 0.2);
  // Chitin is closer to a beetle shell than to plastic: fairly smooth, quite
  // metallic, and never uniform.
  const chit = chitinTexture();
  if (chit) {
    for (const m of [mChitin, mDark, mThorax]) {
      m.map = chit;
      m.color.setHex(0xffffff);
      m.needsUpdate = true;
    }
    mChitin.map.repeat.set(2, 2);
  }

  // --- thorax ---------------------------------------------------------------
  const thorax = mesh(new THREE.SphereGeometry(0.033, 20, 16), mThorax, 0, 0, 0.006);
  thorax.scale.set(1.0, 0.92, 1.55);
  front.add(thorax);

  // Bristles, a few, just enough to break the silhouette.
  const bristleGeo = new THREE.ConeGeometry(0.0022, 0.020, 4);
  const mBristle = std(C.bristle, 0.8, 0.0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = mesh(bristleGeo, mBristle,
      Math.cos(a) * 0.020, 0.024 + Math.sin(a * 2) * 0.004, 0.010 + Math.sin(a) * 0.028);
    b.rotation.set(-0.5 + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.5);
    front.add(b);
  }

  // --- head -----------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 0.004, 0.058);
  front.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.026, 18, 14), mDark);
  skull.scale.set(1.1, 0.95, 0.85);
  head.add(skull);

  // Compound eyes: most of the head, as they should be.
  const mEye = new THREE.MeshStandardMaterial({
    color: C.eye, roughness: 0.22, metalness: 0.15,
    emissive: C.eyeDark, emissiveIntensity: 0.22,
  });
  const eyeTex = eyeTexture();
  if (eyeTex) {
    mEye.map = eyeTex;
    mEye.map.repeat.set(3, 2);   // facets small enough to read as facets
    mEye.color.setHex(0xffffff);
    mEye.needsUpdate = true;
  }
  for (const sx of [1, -1]) {
    const eye = mesh(new THREE.SphereGeometry(0.0225, 18, 14), mEye, sx * 0.0175, 0.004, 0.004);
    eye.scale.set(0.95, 1.18, 1.0);
    head.add(eye);
  }
  // Arista, the feathery antennae.
  for (const sx of [1, -1]) {
    const a = mesh(new THREE.ConeGeometry(0.0022, 0.022, 5), mBristle, sx * 0.008, -0.008, 0.022);
    a.rotation.set(1.1, 0, sx * 0.3);
    head.add(a);
  }
  // Proboscis.
  head.add(mesh(new THREE.ConeGeometry(0.008, 0.016, 8), mDark, 0, -0.018, 0.010));

  // --- abdomen --------------------------------------------------------------
  const abdomen = new THREE.Group();
  abdomen.position.set(0, 0.002, -0.028);
  rear.add(abdomen);
  const seg = mesh(new THREE.SphereGeometry(0.030, 20, 16), mChitin, 0, 0, -0.028);
  seg.scale.set(0.92, 0.88, 1.9);
  abdomen.add(seg);
  // Dark bands.
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const r = 0.0285 * (1 - t * 0.55);
    const band = mesh(new THREE.TorusGeometry(r, 0.0035, 6, 20), mDark, 0, 0, -0.008 - i * 0.0165);
    band.scale.set(0.95, 0.88, 1);
    abdomen.add(band);
  }

  // --- legs -----------------------------------------------------------------
  // Six, tucked, because the fly in this scene is flying rather than walking.
  const mLeg = std(C.chitinDark, 0.7, 0.1);
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const sx = i < 3 ? 1 : -1;
    const k = i % 3;
    const leg = new THREE.Group();
    leg.position.set(sx * 0.020, -0.018, 0.024 - k * 0.026);
    const upper = mesh(new THREE.CapsuleGeometry(0.0028, 0.030, 4, 6), mLeg, 0, -0.016, 0);
    upper.rotation.z = sx * 0.9;
    leg.add(upper);
    const lower = mesh(new THREE.CapsuleGeometry(0.0022, 0.032, 4, 6), mLeg, sx * 0.024, -0.030, -0.010);
    lower.rotation.set(0.7, 0, sx * 0.3);
    leg.add(lower);
    front.add(leg);
    legs.push(leg);
  }

  // --- wings ----------------------------------------------------------------
  // A wing shape rather than a plane, so the silhouette reads at rest.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.03, 0.012, 0.115, 0.020, 0.150, 0.006);
  wingShape.bezierCurveTo(0.120, -0.014, 0.045, -0.020, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 24);

  const mWing = new THREE.MeshPhysicalMaterial({
    color: C.wing, roughness: 0.16, metalness: 0,
    transmission: 0.82, thickness: 0.002, transparent: true, opacity: 0.42,
    side: THREE.DoubleSide, iridescence: 0.6, iridescenceIOR: 1.3,
  });

  // The stroke envelope: at 24 Hz the wing itself aliases at any frame rate a
  // browser can offer, so a faint swept arc carries the motion and the wing
  // mesh reads as a snapshot inside it. This is a rendering choice, not physics.
  const envGeo = new THREE.RingGeometry(0.030, 0.150, 20, 1, -0.9, 1.8);
  const mEnv = new THREE.MeshBasicMaterial({
    color: 0xcfe0ee, transparent: true, opacity: 0.0,
    side: THREE.DoubleSide, depthWrite: false,
  });

  const wings = [];
  for (const sx of [1, -1]) {
    const hinge = new THREE.Group();
    hinge.position.set(sx * 0.018, 0.026, 0.004);
    front.add(hinge);

    const wing = new THREE.Mesh(wingGeo, mWing);
    wing.scale.x = sx;
    hinge.add(wing);

    const env = new THREE.Mesh(envGeo, mEnv.clone());
    env.scale.x = sx;
    env.rotation.y = Math.PI / 2;
    hinge.add(env);

    wings.push({ hinge, wing, env, side: sx });
  }

  // Halteres, the vestigial hindwings that do the fly's gyroscopy.
  for (const sx of [1, -1]) {
    const h = new THREE.Group();
    h.position.set(sx * 0.016, 0.008, -0.020);
    rear.add(h);
    h.add(mesh(new THREE.CapsuleGeometry(0.0018, 0.012, 4, 6), mLeg, 0, -0.008, 0));
    h.add(mesh(new THREE.SphereGeometry(0.0045, 8, 6), mDark, 0, -0.016, 0));
  }

  // Scale so the built body measures FLY_LENGTH nose to tail.
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(body);
  const rawLen = bbox.max.z - bbox.min.z;
  root.scale.setScalar(FLY_LENGTH / rawLen);

  const parts = { body, front, rear, head, abdomen, wings, legs, thorax };
  return {
    group: root,
    parts,
    rawLength: rawLen,
    pose: (s) => poseFly(parts, s),
  };
}

/**
 * @param {object} s
 * @param {number} s.wingPhase rad
 * @param {number} s.thrust    0..1
 * @param {number} s.bank      rad, roll into the turn
 * @param {number} s.pitch     rad
 * @param {boolean} s.escaping
 */
export function poseFly(parts, s) {
  const ph = s.wingPhase;

  for (const w of parts.wings) {
    // Stroke: the wing sweeps through a large arc about the body axis.
    const stroke = Math.sin(ph) * 1.15;
    // Deviation and pitch lag the stroke by a quarter cycle, which is what
    // gives a real wing its figure-of-eight path.
    const dev = Math.cos(ph) * 0.34;
    const feather = Math.cos(ph) * 0.9;

    w.hinge.rotation.set(dev, w.side * feather * 0.5, w.side * (0.35 + stroke));
    w.env.material.opacity = 0.10 + 0.22 * s.thrust;
  }

  // Abdomen swings a little as the fly manoeuvres -- it is a real control
  // surface, and flies steer partly by moving it.
  parts.abdomen.rotation.x = 0.10 * s.thrust + (s.pitch || 0) * 0.5;
  parts.abdomen.rotation.y = -(s.bank || 0) * 0.35;

  parts.head.rotation.x = -(s.pitch || 0) * 0.4;

  // Legs tuck tighter at speed.
  const tuck = 0.35 + 0.5 * s.thrust;
  for (const leg of parts.legs) leg.rotation.x = tuck;

  parts.body.rotation.z = -(s.bank || 0);
  parts.body.rotation.x = s.pitch || 0;
}

/**
 * Two debris objects matching the fly as it is posed right now, for a sword
 * kill. Cloned rather than detached, because the fly itself respawns and the
 * halves have to outlive it.
 *
 * Returns world-space objects; the caller adds them to the scene and advects
 * them. The cut plane is the thorax/abdomen waist, which is where the model is
 * already divided.
 */
export function makeHalves(view) {
  view.group.updateMatrixWorld(true);

  const out = [];
  for (const half of [view.parts.front, view.parts.rear]) {
    const clone = half.clone(true);
    // Bake the world transform so the piece keeps its pose once reparented.
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.applyMatrix4(half.matrixWorld);
    clone.matrixAutoUpdate = true;
    out.push(clone);
  }
  return { front: out[0], rear: out[1] };
}

export { sceneWingbeatHz };
