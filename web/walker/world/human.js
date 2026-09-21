// Four selectable characters, built to adult human proportions.
//
// Proportions are standard anthropometry as fractions of stature H = 1.78 m:
// hip joint 0.530H, knee 0.285H, shoulder 0.818H, biacromial width 0.259H,
// upper arm 0.186H, forearm 0.146H, foot length 0.152H. The previous build was
// chibi-proportioned; this is not, which matters because the gait timing in
// ../scale.js was derived for a 1.78 m body and only now matches the body it
// drives.
//
// HONEST LIMIT: the reference images are photoreal renders. This is primitives
// and MeshStandardMaterial in a dependency-free browser scene. It cannot and
// does not reach that. What it matches is what a silhouette carries -- hair
// shape and volume, glasses, facial hair, shirt colour, build -- at a stylised
// fidelity. Calling it photoreal would be a lie about the renderer.

import * as THREE from '../vendor/three.module.js';
import { makeRandom } from '../brain/neuron.js';
import { legAngles, armAngles, pelvisState, TRUNK } from './gait.js';

export const HEIGHT = 1.78;

// Sitting. Both joints fold to a RIGHT ANGLE, which is not a stylistic choice:
// with the thigh horizontal and the shank vertical the pelvis sits exactly one
// shank above the ankle, 0.432 m, and the ankle lands on the floor at 0.075 m.
// The first attempt used 1.45 and 1.55 and the feet finished 5.9 cm through the
// floor, because a thigh that is not horizontal eats into that drop.
export const SIT_HIP = Math.PI / 2;
export const SIT_KNEE = Math.PI / 2;
export const SIT_ANKLE = 0;     // shank vertical, so the foot is already flat

// Joint heights, metres from the floor.
const J = {
  ankle: 0.075,
  knee: 0.507,
  hip: 0.943,
  waist: 1.12,
  chest: 1.33,
  shoulder: 1.456,
  chin: 1.549,
  head: 1.655,
};

const LEN = {
  thigh: J.hip - J.knee,   // 0.436
  shank: J.knee - J.ankle, // 0.432
  upper: 0.331,
  fore: 0.260,
  foot: 0.271,
};

const HIP_X = 0.088;
const SHOULDER_X = 0.195;

/**
 * The four. Skin tones and shirt colours are read off the reference renders;
 * hair and facial hair are described by shape because that is what primitives
 * can actually deliver.
 */
export const VARIANTS = [
  {
    id: 'curly',
    name: 'Curly, glasses',
    note: 'mustard polo',
    skin: 0xc98a5c,
    shirt: 0xb07a26,
    collar: 0x98681e,
    hair: { style: 'curly', color: 0x241a14 },
    facial: { style: 'mustache-beard', color: 0x201711 },
    glasses: { frame: 0x2a2a2e },
    build: 1.0,
  },
  {
    id: 'cropped',
    name: 'Cropped, glasses',
    note: 'light polo',
    skin: 0xb87a4e,
    shirt: 0xd5d5cd,
    collar: 0xc0c0b8,
    hair: { style: 'short', color: 0x181310 },
    facial: { style: 'full-beard', color: 0x161110 },
    glasses: { frame: 0x3a3a40 },
    build: 1.12,
  },
  {
    id: 'shaggy',
    name: 'Shaggy, no glasses',
    note: 'dark olive polo',
    skin: 0xc2875a,
    shirt: 0x33352a,
    collar: 0x272921,
    hair: { style: 'shaggy', color: 0x1c1512 },
    facial: { style: 'stubble', color: 0x1e1712 },
    glasses: null,
    build: 1.0,
  },
  {
    id: 'silver',
    name: 'Silver, cropped',
    note: 'slate polo',
    skin: 0xd0a074,
    shirt: 0x4a5560,
    collar: 0x3c4650,
    trouser: 0x35383f,
    hair: { style: 'short', color: 0x9a9a95 },
    facial: { style: 'full-beard', color: 0x8e8e88 },
    glasses: null,
    eye: 0x4a5a58,
    build: 1.06,
  },
  {
    id: 'raven',
    name: 'Raven, shaggy',
    note: 'oxblood polo',
    skin: 0x8d5a38,
    shirt: 0x6b2b2b,
    collar: 0x552222,
    trouser: 0x23262b,
    hair: { style: 'shaggy', color: 0x120f0e },
    facial: { style: 'stubble', color: 0x141110 },
    glasses: { frame: 0x1e1e22 },
    eye: 0x241a14,
    build: 0.95,
  },
  {
    id: 'clay',
    name: 'Untextured',
    note: 'base mesh, wireframe',
    skin: 0xb4b4b4,
    shirt: 0xb4b4b4,
    collar: 0xa8a8a8,
    hair: { style: 'none', color: 0xb4b4b4 },
    facial: { style: 'none', color: 0xb4b4b4 },
    glasses: null,
    clay: true,
    build: 1.0,
  },
];

// ---------------------------------------------------------------------------
// Procedural surfaces
// ---------------------------------------------------------------------------
//
// The body carried no maps at all: flat MeshStandardMaterial colours, which is
// why it read as plastic however well it was lit. Nothing about the figure was
// wrong, it simply had no surface.
//
// There are no image files for the character and there is not going to be a
// texturing pass, so the maps are generated -- the same approach world/fly.js
// takes for the compound eye and the chitin. Three of them do nearly all the
// work:
//
//   skin     pores and blotch, so it is not one flat tone across a whole limb
//   knit     the pique grid of a polo shirt, which is what makes it read as
//            a knitted shirt rather than as painted plastic
//   twill    the diagonal of trouser cloth
//
// All three need a canvas, so all three only exist in a browser; node gets the
// flat colours back and does not care, because nothing headless looks at him.
// Each is built once and shared by every variant -- they are greyscale detail
// modulating `color`, not the colour itself.

const _tex = {};

/** Shared xorshift so every surface is the same every run. */
function makeNoise(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvasTexture(key, size, draw, repeat = 1) {
  if (key in _tex) return _tex[key];
  if (typeof document === 'undefined') return (_tex[key] = false);
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  _tex[key] = tex;
  return tex;
}

/** Skin: fine pores over a slow blotch, so a limb is not one flat tone. */
function skinTexture() {
  return canvasTexture('skin', 256, (c, N) => {
    const rnd = makeNoise(20260918);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, N, N);
    // Slow variation first -- big soft patches, barely visible on their own but
    // the thing that stops a forearm looking like a painted dowel.
    for (let i = 0; i < 90; i++) {
      const r = 12 + rnd() * 46;
      const g = c.createRadialGradient(rnd() * N, rnd() * N, 0, 0, 0, r);
      const v = 236 + Math.floor(rnd() * 18);
      g.addColorStop(0, `rgba(${v},${v - 6},${v - 10},0.55)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, N, N);
    }
    for (let i = 0; i < 5200; i++) {
      const v = 216 + Math.floor(rnd() * 30);
      c.fillStyle = `rgba(${v},${v - 8},${v - 12},0.5)`;
      c.fillRect(rnd() * N, rnd() * N, 1, 1);
    }
  }, 2);
}

/** Polo pique: a knitted grid, slightly irregular so it is not graph paper. */
function knitTexture() {
  return canvasTexture('knit', 256, (c, N) => {
    const rnd = makeNoise(4242);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, N, N);
    const step = 6;
    for (let y = 0; y < N; y += step) {
      for (let x = 0; x < N; x += step) {
        const jx = (rnd() - 0.5) * 1.2;
        const jy = (rnd() - 0.5) * 1.2;
        const v = 222 + Math.floor(rnd() * 24);
        c.fillStyle = `rgba(${v},${v},${v},1)`;
        c.fillRect(x + jx, y + jy, step - 2, step - 2);
      }
    }
    // Shadow under each stitch row gives the knit some depth.
    c.fillStyle = 'rgba(120,120,120,0.16)';
    for (let y = 0; y < N; y += step) c.fillRect(0, y, N, 1);
  }, 5);
}

/** Trouser twill: the diagonal rib of woven cloth. */
function twillTexture() {
  return canvasTexture('twill', 256, (c, N) => {
    const rnd = makeNoise(777);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, N, N);
    c.lineWidth = 1.4;
    for (let i = -N; i < N * 2; i += 4) {
      const v = 200 + Math.floor(rnd() * 40);
      c.strokeStyle = `rgba(${v},${v},${v},0.85)`;
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + N, N);
      c.stroke();
    }
    for (let i = 0; i < 2400; i++) {
      const v = 190 + Math.floor(rnd() * 50);
      c.fillStyle = `rgba(${v},${v},${v},0.35)`;
      c.fillRect(rnd() * N, rnd() * N, 1, 1);
    }
  }, 6);
}

/**
 * @param {number} color
 * @param {number} [rough]
 * @param {number} [metal]
 * @param {false|THREE.Texture} [map] greyscale detail, modulating `color`
 */
/** Blend two hex colours, for tones derived from a variant's own colour. */
function mix(a, b, k) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16)
    | (Math.round(ag + (bg - ag) * k) << 8)
    | Math.round(ab + (bb - ab) * k);
}

const std = (color, rough = 0.78, metal = 0.02, map = null) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (map) m.map = map;
  return m;
};

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A tapered limb segment running down -Y from the joint. */
function limb(rTop, rBot, length, material) {
  const g = new THREE.CylinderGeometry(rTop, rBot, length, 14, 1);
  const m = mesh(g, material, 0, -length / 2, 0);
  return m;
}

// ---------------------------------------------------------------- hair -----

function buildHair(head, variant, rnd) {
  const { style, color } = variant.hair;
  if (style === 'none') return;

  // Three tones, not two. Hair is never one colour: the strands that catch the
  // light and the ones in the shadow of the ones above them are what give it
  // volume, and with a single tone a head of curls reads as a moulded helmet.
  const mHair = std(color, 0.74);
  const mHairLo = std(mix(color, 0x000000, 0.42), 0.82);
  const mHairHi = std(mix(color, 0xc8a882, 0.30), 0.62);
  const tone = (r) => (r < 0.42 ? mHair : r < 0.78 ? mHairLo : mHairHi);

  if (style === 'short') {
    // Close crop: a thin shell over the upper skull, with a hairline that
    // stops above the brow.
    const cap = mesh(
      new THREE.SphereGeometry(0.102, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
      mHair, 0, 0.004, -0.004,
    );
    cap.scale.set(1.02, 1.06, 1.04);
    head.add(cap);
    // Sides, kept tight.
    for (const sx of [1, -1]) {
      const s = mesh(new THREE.SphereGeometry(0.052, 12, 10), mHairLo, sx * 0.082, -0.012, -0.012);
      s.scale.set(0.5, 1.0, 1.1);
      head.add(s);
    }
    return;
  }

  if (style === 'curly') {
    // Volume built from clustered spheres. The reference has height on top and
    // tighter sides, so the cluster radius is biased upward.
    const base = mesh(
      new THREE.SphereGeometry(0.103, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      mHair, 0, 0.012, -0.006,
    );
    base.scale.set(1.04, 1.1, 1.06);
    head.add(base);

    const curlGeo = new THREE.SphereGeometry(0.030, 9, 8);
    for (let i = 0; i < 104; i++) {
      const phi = Math.acos(1 - rnd() * 0.92);
      const theta = rnd() * Math.PI * 2;
      // Keep the face clear.
      if (phi > 0.8 && Math.cos(theta) > 0.3) continue;
      const r = 0.100;
      const x = r * Math.sin(phi) * Math.sin(theta) * 1.02;
      // 1.10, not 1.18. More curls than before means the cluster reaches
      // higher for the same bias, and the measured height had crept to 1.837 m
      // against the 1.84 m the smoke test allows -- three millimetres of margin
      // is not margin.
      const y = r * Math.cos(phi) * 1.10 + 0.016;
      const z = r * Math.sin(phi) * Math.cos(theta) * 1.04 - 0.008;
      const c = mesh(curlGeo, tone(rnd()), x, y, z);
      // Squashed and turned at random: identical spheres in a cluster read as
      // bubbles, and a curl is not a sphere.
      c.scale.set(0.62 + rnd() * 0.6, 0.55 + rnd() * 0.5, 0.62 + rnd() * 0.6);
      c.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      head.add(c);
    }
    return;
  }

  if (style === 'shaggy') {
    const cap = mesh(
      new THREE.SphereGeometry(0.105, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
      mHair, 0, 0.006, -0.008,
    );
    cap.scale.set(1.05, 1.08, 1.08);
    head.add(cap);

    // Locks hanging over the ears and the back of the neck.
    const lockGeo = new THREE.SphereGeometry(0.042, 10, 8);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      // Skip the front, so the face stays visible.
      if (Math.cos(a) > 0.45 && Math.abs(Math.sin(a)) < 0.55) continue;
      const r = 0.098;
      const drop = -0.045 - rnd() * 0.055;
      const l = mesh(lockGeo, rnd() > 0.6 ? mHairLo : mHair,
        r * Math.sin(a) * 1.02, drop, r * Math.cos(a) * 1.02);
      l.scale.set(0.75, 1.5 + rnd() * 0.7, 0.75);
      head.add(l);
    }
    // A fringe, swept.
    const fringe = mesh(new THREE.SphereGeometry(0.05, 12, 10), mHair, 0.028, 0.052, 0.082);
    fringe.scale.set(1.5, 0.55, 0.7);
    fringe.rotation.z = 0.3;
    head.add(fringe);
  }
}

// --------------------------------------------------------- facial hair -----

function buildFacialHair(head, variant) {
  const { style, color } = variant.facial;
  if (style === 'none') return;

  const light = style === 'stubble';
  const mB = std(color, 0.88);
  mB.transparent = light;
  mB.opacity = light ? 0.55 : 1;

  if (style !== 'stubble') {
    // Jawline beard: a shell over the lower face, opened at the mouth.
    const beard = mesh(new THREE.SphereGeometry(0.0985, 22, 18), mB, 0, -0.030, 0.004);
    beard.scale.set(1.0, 0.72, 1.0);
    head.add(beard);
    // Cut the beard back off the cheeks so it reads as a beard, not a mask.
    const cheek = mesh(new THREE.SphereGeometry(0.094, 18, 14), std(variant.skin, 0.72), 0, 0.028, 0.012);
    cheek.scale.set(1.0, 0.82, 1.0);
    head.add(cheek);
  } else {
    const beard = mesh(new THREE.SphereGeometry(0.0975, 20, 16), mB, 0, -0.040, 0.002);
    beard.scale.set(0.98, 0.52, 0.98);
    head.add(beard);
  }

  // Mustache, on everything but bare stubble.
  if (style !== 'stubble') {
    const m = mesh(new THREE.BoxGeometry(0.048, 0.013, 0.018), mB, 0, -0.020, 0.092);
    head.add(m);
  }
}

// ------------------------------------------------------------- glasses -----

function buildGlasses(head, variant) {
  if (!variant.glasses) return;
  const mF = new THREE.MeshStandardMaterial({
    color: variant.glasses.frame, roughness: 0.38, metalness: 0.55,
  });
  const mLens = new THREE.MeshPhysicalMaterial({
    color: 0xdfe9f2, roughness: 0.06, metalness: 0,
    transmission: 0.9, thickness: 0.002, transparent: true, opacity: 0.22,
  });

  const g = new THREE.Group();
  g.position.set(0, 0.012, 0.079);
  head.add(g);

  for (const sx of [1, -1]) {
    const rim = mesh(new THREE.TorusGeometry(0.0285, 0.0042, 8, 22), mF, sx * 0.034, 0, 0.004);
    rim.scale.set(1.12, 0.84, 1);
    g.add(rim);

    const lens = mesh(new THREE.CircleGeometry(0.028, 20), mLens, sx * 0.034, 0, 0.002);
    lens.scale.set(1.12, 0.84, 1);
    g.add(lens);

    // Temple arm running back to the ear.
    const arm = mesh(new THREE.BoxGeometry(0.004, 0.004, 0.072), mF, sx * 0.068, 0.004, -0.034);
    arm.rotation.y = sx * 0.30;
    g.add(arm);
  }
  // Bridge.
  g.add(mesh(new THREE.BoxGeometry(0.018, 0.004, 0.005), mF, 0, 0.006, 0.004));
}

// ------------------------------------------------------------ assembly -----

/**
 * A hand, closed round a grip.
 *
 * It was one sphere scaled to (0.72, 1.25, 0.5) -- a mitten. Both hands are
 * wrapped round a weapon at all times by design, which puts them nearer the
 * camera than anything except the face, and a mitten holding a katana is the
 * first thing that reads as unfinished.
 *
 * Both hands are always gripping, so the fingers are built curled and stay
 * curled. There is no case in this scene where a hand opens, and a rig for
 * fingers that never move would be cost with nothing bought.
 *
 * @param {THREE.Group} hand the wrist group, +Y toward the elbow
 * @param {THREE.Material} mSkin
 * @param {number} sx +1 is the figure's left
 */
function buildHand(hand, mSkin, sx) {
  // Palm: a flattened box rather than a sphere, because a palm has edges.
  const palm = mesh(new THREE.BoxGeometry(0.052, 0.072, 0.034), mSkin, 0, -0.030, 0);
  hand.add(palm);
  // Rounded off at the knuckles and the heel.
  const knuck = mesh(new THREE.SphereGeometry(0.027, 14, 12), mSkin, 0, -0.062, 0.002);
  knuck.scale.set(0.96, 0.62, 0.62);
  hand.add(knuck);
  const heel = mesh(new THREE.SphereGeometry(0.026, 12, 10), mSkin, 0, -0.004, 0);
  heel.scale.set(1.0, 0.7, 0.62);
  hand.add(heel);

  // Four fingers, curled in toward the palm. Each is two segments so the curl
  // has a knuckle in it rather than being one bent tube.
  const FING = [
    { x: -0.019, len: 0.030, curl: 1.15 },
    { x: -0.006, len: 0.033, curl: 1.20 },
    { x: 0.007, len: 0.031, curl: 1.18 },
    { x: 0.019, len: 0.026, curl: 1.10 },
  ];
  for (const f of FING) {
    const root = new THREE.Group();
    root.position.set(f.x * (sx >= 0 ? 1 : -1), -0.068, 0.004);
    root.rotation.x = -f.curl;
    hand.add(root);
    root.add(mesh(new THREE.CapsuleGeometry(0.0092, f.len, 4, 8), mSkin, 0, -f.len / 2, 0));

    const mid = new THREE.Group();
    mid.position.y = -f.len;
    mid.rotation.x = -f.curl * 0.85;
    root.add(mid);
    mid.add(mesh(new THREE.CapsuleGeometry(0.0082, f.len * 0.8, 4, 8), mSkin,
      0, -f.len * 0.4, 0));
  }

  // Thumb, across the grip rather than alongside the fingers -- that opposition
  // is most of what makes a hand read as holding something.
  const thumb = new THREE.Group();
  thumb.position.set(-0.026 * (sx >= 0 ? 1 : -1), -0.030, 0.008);
  thumb.rotation.set(-0.55, 0, sx >= 0 ? -0.95 : 0.95);
  hand.add(thumb);
  thumb.add(mesh(new THREE.CapsuleGeometry(0.0105, 0.030, 4, 8), mSkin, 0, -0.015, 0));
  const tip = new THREE.Group();
  tip.position.y = -0.030;
  tip.rotation.x = -0.7;
  thumb.add(tip);
  tip.add(mesh(new THREE.CapsuleGeometry(0.0095, 0.024, 4, 8), mSkin, 0, -0.012, 0));
}

export function buildHuman(variantId = 'curly') {
  const variant = VARIANTS.find((v) => v.id === variantId) || VARIANTS[0];
  const rnd = makeRandom(9001);

  const root = new THREE.Group();
  root.name = `human:${variant.id}`;

  // The clay variant is the base mesh on purpose, so it keeps the flat colours
  // and shows the geometry rather than the surfacing.
  const surf = variant.clay ? () => null : (f) => f();
  const mSkin = std(variant.skin, 0.66, 0.02, surf(skinTexture));
  const mShirt = std(variant.shirt, 0.86, 0.01, surf(knitTexture));
  const mCollar = std(variant.collar, 0.86, 0.01, surf(knitTexture));
  const mTrouser = std(variant.clay ? 0xb4b4b4 : (variant.trouser ?? 0x2f3238),
    0.88, 0.01, surf(twillTexture));
  const mShoe = std(variant.clay ? 0xa8a8a8 : (variant.shoe ?? 0x1d1d20), 0.48, 0.12);

  // body carries the pelvis rise and sway.
  const body = new THREE.Group();
  root.add(body);

  // pelvis carries rotation and list.
  const pelvis = new THREE.Group();
  pelvis.position.y = J.hip;
  body.add(pelvis);

  pelvis.add(mesh(new THREE.CapsuleGeometry(0.108 * variant.build, 0.10, 6, 16), mTrouser, 0, 0.035, 0));

  // torso carries lean and counter-rotation, and everything above the waist.
  const torso = new THREE.Group();
  torso.position.y = 0.06;
  pelvis.add(torso);

  const chestH = J.shoulder - J.hip - 0.06;
  const chest = mesh(
    new THREE.CapsuleGeometry(0.152 * variant.build, chestH * 0.62, 8, 18),
    mShirt, 0, chestH * 0.52, 0,
  );
  chest.scale.set(1.14, 1, 0.78);
  torso.add(chest);

  // Polo placket and collar.
  torso.add(mesh(new THREE.BoxGeometry(0.036, 0.13, 0.02), mCollar, 0, chestH * 0.80, 0.116));
  const collar = mesh(new THREE.CylinderGeometry(0.072, 0.086, 0.036, 16, 1, true), mCollar, 0, J.chin - J.hip - 0.20, 0);
  collar.material = new THREE.MeshStandardMaterial({
    color: variant.collar, roughness: 0.84, side: THREE.DoubleSide,
  });
  torso.add(collar);

  // Neck and head.
  torso.add(mesh(new THREE.CylinderGeometry(0.050, 0.058, 0.10, 14), mSkin, 0, J.shoulder - J.hip - 0.10, 0));

  const head = new THREE.Group();
  head.position.y = J.head - J.hip - 0.06;
  torso.add(head);

  const skull = mesh(new THREE.SphereGeometry(0.098, 28, 22), mSkin);
  skull.scale.set(0.92, 1.14, 1.0);
  head.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.086, 20, 16), mSkin, 0, -0.040, 0.008);
  jaw.scale.set(0.94, 0.86, 1.0);
  head.add(jaw);

  // Cheekbones and brow ridge. A skull and a jaw alone give a head with no
  // structure in it, which is what made the face read as a mask: the light had
  // nothing to catch between the eyes and the chin.
  for (const sx of [1, -1]) {
    const cheek = mesh(new THREE.SphereGeometry(0.030, 14, 12), mSkin,
      sx * 0.052, -0.004, 0.058);
    cheek.scale.set(0.9, 0.62, 0.7);
    head.add(cheek);

    const ear = mesh(new THREE.SphereGeometry(0.023, 14, 12), mSkin,
      sx * 0.090, 0.004, -0.004);
    ear.scale.set(0.40, 1.0, 0.72);
    head.add(ear);
    // Ears have a rim and a hollow, and at this size that is all it takes.
    const lobe = mesh(new THREE.TorusGeometry(0.014, 0.0052, 8, 16), mSkin,
      sx * 0.093, 0.006, -0.004);
    lobe.rotation.y = sx * Math.PI / 2;
    lobe.scale.set(1.0, 1.18, 1.0);
    head.add(lobe);
  }
  const ridge = mesh(new THREE.SphereGeometry(0.062, 16, 12), mSkin, 0, 0.032, 0.052);
  ridge.scale.set(1.05, 0.34, 0.72);
  head.add(ridge);

  // Nose: a bridge, a tip and two nostrils rather than one cone. The cone had
  // the silhouette of a beak from the side.
  const bridge = mesh(new THREE.CapsuleGeometry(0.0098, 0.038, 4, 10), mSkin,
    0, 0.004, 0.083);
  bridge.rotation.x = 0.30;
  head.add(bridge);
  const tipN = mesh(new THREE.SphereGeometry(0.0155, 14, 12), mSkin, 0, -0.019, 0.095);
  tipN.scale.set(1.0, 0.86, 1.0);
  head.add(tipN);
  for (const sx of [1, -1]) {
    const wing = mesh(new THREE.SphereGeometry(0.0105, 10, 8), mSkin,
      sx * 0.0145, -0.021, 0.089);
    wing.scale.set(0.8, 0.9, 1.0);
    head.add(wing);
  }

  if (!variant.clay) {
    const mBrow = std(variant.hair.color, 0.8);
    const mEye = std(0xf4f2ee, 0.22);
    const mIris = std(variant.eye ?? 0x3a2a1e, 0.28, 0.05);
    const mLid = std(variant.skin, 0.66);
    const mLip = std(variant.lip ?? 0x9c5f4e, 0.62);

    for (const sx of [1, -1]) {
      const eye = mesh(new THREE.SphereGeometry(0.0158, 18, 14), mEye,
        sx * 0.034, 0.012, 0.081);
      eye.scale.set(1.15, 0.74, 0.5);
      head.add(eye);
      head.add(mesh(new THREE.SphereGeometry(0.0074, 14, 12), mIris,
        sx * 0.035, 0.010, 0.0905));
      // Pupil, tiny but the thing that makes the eye look at you.
      head.add(mesh(new THREE.SphereGeometry(0.0034, 10, 8),
        std(0x0d0a09, 0.2), sx * 0.035, 0.010, 0.0935));

      // Lids. A bare eyeball on a face is the single most artificial thing
      // about a low-poly head -- an eye is mostly hidden by its lid.
      const upper = mesh(new THREE.SphereGeometry(0.0176, 16, 12), mLid,
        sx * 0.034, 0.0175, 0.079);
      upper.scale.set(1.14, 0.56, 0.52);
      head.add(upper);
      const lower = mesh(new THREE.SphereGeometry(0.0168, 14, 10), mLid,
        sx * 0.034, 0.0015, 0.079);
      lower.scale.set(1.1, 0.4, 0.5);
      head.add(lower);

      const brow = mesh(new THREE.BoxGeometry(0.038, 0.0092, 0.011), mBrow,
        sx * 0.035, 0.037, 0.0865);
      brow.rotation.z = sx * -0.14;
      head.add(brow);
    }

    // Mouth: an upper and a lower lip with a line between them.
    const upLip = mesh(new THREE.SphereGeometry(0.019, 16, 10), mLip, 0, -0.051, 0.079);
    upLip.scale.set(1.25, 0.32, 0.5);
    head.add(upLip);
    const loLip = mesh(new THREE.SphereGeometry(0.018, 16, 10), mLip, 0, -0.062, 0.078);
    loLip.scale.set(1.15, 0.36, 0.52);
    head.add(loLip);
    const line = mesh(new THREE.BoxGeometry(0.040, 0.0022, 0.004),
      std(0x5e3a31, 0.7), 0, -0.0565, 0.0885);
    head.add(line);
    // The groove under the nose. Small, and the face looks wrong without it.
    const phil = mesh(new THREE.BoxGeometry(0.0075, 0.016, 0.005), mLid, 0, -0.037, 0.0895);
    head.add(phil);
  }

  buildFacialHair(head, variant);
  buildHair(head, variant, rnd);
  buildGlasses(head, variant);

  if (variant.clay) {
    // The reference fourth panel is an untextured mesh with its wireframe
    // showing. Overlay the head only -- wireframing the whole body reads as
    // noise at this scale.
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(0.099, 14, 10)),
      new THREE.LineBasicMaterial({ color: 0x6e6e6e, transparent: true, opacity: 0.55 }),
    );
    wire.scale.set(0.92, 1.14, 1.0);
    head.add(wire);
  }

  // ------------------------------------------------------------- arms -----
  const arms = [];
  for (const sx of [1, -1]) { // +X is the figure's left
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER_X, J.shoulder - J.hip - 0.06, 0);
    torso.add(shoulder);

    shoulder.add(mesh(new THREE.SphereGeometry(0.058, 12, 10), mShirt, 0, 0.012, 0));
    // Polo sleeve stops partway down the upper arm.
    const sleeve = mesh(new THREE.CylinderGeometry(0.056, 0.050, 0.11, 14), mShirt, 0, -0.055, 0);
    shoulder.add(sleeve);
    shoulder.add(limb(0.046, 0.039, LEN.upper, mSkin));

    const elbow = new THREE.Group();
    elbow.position.y = -LEN.upper;
    shoulder.add(elbow);
    elbow.add(limb(0.039, 0.031, LEN.fore, mSkin));

    const hand = new THREE.Group();
    hand.position.y = -LEN.fore;
    elbow.add(hand);
    buildHand(hand, mSkin, sx);

    arms.push({ shoulder, elbow, hand, side: sx });
  }

  // ------------------------------------------------------------- legs -----
  const legs = [];
  for (const sx of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * HIP_X, 0, 0);
    pelvis.add(hip);
    hip.add(limb(0.082 * variant.build, 0.062, LEN.thigh, mTrouser));

    const knee = new THREE.Group();
    knee.position.y = -LEN.thigh;
    hip.add(knee);
    knee.add(limb(0.060, 0.044, LEN.shank, mTrouser));

    const ankle = new THREE.Group();
    ankle.position.y = -LEN.shank;
    knee.add(ankle);

    // Shoe: heel behind the ankle, toe in front, so the roll reads.
    const shoe = mesh(new THREE.BoxGeometry(0.094, 0.062, LEN.foot), mShoe, 0, -0.044, 0.062);
    ankle.add(shoe);
    const toe = mesh(new THREE.SphereGeometry(0.047, 12, 10), mShoe, 0, -0.044, 0.155);
    toe.scale.set(1.0, 0.68, 0.9);
    ankle.add(toe);
    ankle.add(mesh(new THREE.SphereGeometry(0.048, 12, 10), mShoe, 0, -0.026, -0.018));

    legs.push({ hip, knee, ankle, side: sx });
  }

  // Weapon anchor rides the torso.
  const weaponAnchor = new THREE.Group();
  weaponAnchor.position.set(0, chestH * 0.34, 0.06);
  torso.add(weaponAnchor);

  const parts = { body, pelvis, torso, head, arms, legs, weaponAnchor, variant };
  return { group: root, parts, variant, pose: (s) => poseHuman(parts, s) };
}

// ------------------------------------------------------------- posing -----

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * Two-bone IK. Points the arm so the hand lands on `targetLocal`, expressed in
 * the shoulder parent's space. `pole` rolls the elbow around the shoulder-hand
 * axis so it breaks outward instead of wherever the minimal rotation puts it.
 */
export function solveArm(arm, targetLocal, pole = 0) {
  const a = LEN.upper;
  const b = LEN.fore;

  _d.copy(targetLocal).sub(arm.shoulder.position);
  let L = _d.length();
  const maxL = (a + b) * 0.998;
  const minL = Math.abs(a - b) + 0.02;
  L = Math.min(Math.max(L, minL), maxL);

  // Elbow interior angle from the law of cosines.
  const cosF = (L * L - a * a - b * b) / (2 * a * b);
  const f = Math.acos(Math.min(1, Math.max(-1, cosF)));
  arm.elbow.rotation.x = -f;

  // Where the hand sits in shoulder space with that elbow bend.
  _h.set(0, -a - b * Math.cos(f), b * Math.sin(f)).normalize();
  _d.normalize();

  _q.setFromUnitVectors(_h, _d);
  if (pole) {
    _q2.setFromAxisAngle(_d, pole);
    _q.premultiply(_q2);
  }
  arm.shoulder.quaternion.copy(_q);
}

/**
 * @param {object} parts
 * @param {object} s
 * @param {number[]} s.legPhase   [left, right] radians, from the VNC
 * @param {number} s.speed        m/s
 * @param {number} s.turnCommand  -1..1
 * @param {number} [s.armHold]    0..1, 0 = free gait swing, 1 = holding a weapon
 * @param {number} [s.armHoldLeft]  per-arm override, so the hand that is not on
 *   the weapon being used can keep some of the gait swing
 * @param {number} [s.armHoldRight]
 * @param {number} [s.swingTwist] rad of extra torso rotation from a sword cut
 * @param {number} [s.swingLean]  0..1 of weight dropped into that cut
 * @param {THREE.Vector3} [s.rightHandTarget] torso-space, used when armHold > 0
 * @param {THREE.Vector3} [s.leftHandTarget]
 */
export function poseHuman(parts, s) {
  const moving = Math.min(Math.abs(s.speed) / 0.9, 1);

  // Phase in cycles, 0 = heel strike. The VNC hands over radians.
  const tL = s.legPhase[0] / (Math.PI * 2);
  const tR = s.legPhase[1] / (Math.PI * 2);
  const t = [tL, tR];

  // Seated blends over the walk rather than replacing it, so sitting down and
  // standing up are a lerp rather than a snap.
  const sit = Math.min(Math.max(s.sit || 0, 0), 1);

  for (let i = 0; i < parts.legs.length; i++) {
    const leg = parts.legs[i];
    const g = legAngles(t[i]);
    // Standing still still needs a slight knee bend, or the figure locks out.
    const hipW = -g.hip * moving;
    const kneeW = g.knee * moving + 0.05 * (1 - moving);
    const ankW = -g.ankle * moving;

    leg.hip.rotation.x = hipW * (1 - sit) + -SIT_HIP * sit;
    // Knees a little apart when seated; two legs folded in the same plane reads
    // as a mannequin hinged twice rather than someone sitting down.
    leg.hip.rotation.z = leg.side * 0.10 * sit;
    leg.knee.rotation.x = kneeW * (1 - sit) + SIT_KNEE * sit;
    leg.ankle.rotation.x = ankW * (1 - sit) + -SIT_ANKLE * sit;
  }

  const p = pelvisState(tL);
  // Dropped to seat height: with both joints folded the pelvis sits one shank
  // above the ankle, and the difference from standing is how far it comes down.
  const seatedDrop = J.hip - (J.ankle + LEN.shank);
  parts.body.position.y = p.rise * moving * (1 - sit) - seatedDrop * sit;
  parts.body.position.x = p.sway * moving;
  parts.pelvis.rotation.y = p.rotation * moving;
  parts.pelvis.rotation.z = p.list * moving;

  parts.torso.rotation.x = TRUNK.leanDeg * (Math.PI / 180) * moving * (1 - sit)
    + -0.06 * sit;   // sitting back, not hunched forward
  parts.torso.rotation.y = -p.rotation * moving * (TRUNK.counterRotDeg / 4);
  // A cut is thrown from the hips: the torso leads the blade round and the
  // weight drops into it. Both come from the Swing's integrated state, so they
  // stay in step with the blade without a second clock to keep in sync.
  const twist = s.swingTwist || 0;
  const lean = s.swingLean || 0;
  parts.torso.rotation.y += twist;
  parts.torso.rotation.z = -0.10 * (s.turnCommand || 0) * moving + twist * 0.18;
  parts.torso.rotation.x -= lean * 0.30;

  // The head stays on the target while the shoulders go round under it, which
  // is the thing that makes a swing look aimed rather than thrown.
  parts.head.rotation.y = 0.22 * (s.turnCommand || 0) * moving - parts.torso.rotation.y;
  parts.head.rotation.x = -parts.torso.rotation.x * 0.7;

  // Arms: free counter-swing, blended toward a weapon hold. Per arm, because
  // the two hands are rarely doing the same thing -- one is on the weapon being
  // used and the other is only carrying.
  const holdBoth = Math.min(Math.max(s.armHold || 0, 0), 1);
  const holdL = Math.min(Math.max(s.armHoldLeft ?? holdBoth, 0), 1);
  const holdR = Math.min(Math.max(s.armHoldRight ?? holdBoth, 0), 1);

  for (let i = 0; i < parts.arms.length; i++) {
    const arm = parts.arms[i];
    const hold = i === 0 ? holdL : holdR;
    // Arm counter-swings the OPPOSITE leg.
    const ga = armAngles(t[1 - i]);
    const freeShoulder = -ga.shoulder * moving;
    const freeElbow = -ga.elbow * moving - 0.12;

    const target = i === 0 ? s.leftHandTarget : s.rightHandTarget;

    if (hold > 0.001 && target) {
      // Solve to the grip, then blend back toward the free swing so the
      // transition into and out of a weapon does not snap.
      arm.shoulder.rotation.set(0, 0, 0);
      solveArm(arm, target, arm.side * 0.32);

      if (hold < 0.999) {
        _q.setFromEuler(new THREE.Euler(freeShoulder, 0, arm.side * 0.06));
        arm.shoulder.quaternion.slerp(_q, 1 - hold);
        arm.elbow.rotation.x = arm.elbow.rotation.x * hold + freeElbow * (1 - hold);
      }
    } else {
      arm.shoulder.quaternion.setFromEuler(
        new THREE.Euler(freeShoulder, 0, arm.side * 0.06),
      );
      arm.elbow.rotation.x = freeElbow;
    }
  }
}

/**
 * Height the pelvis sits at when seated, with the root on the floor. The figure
 * is built at true size, so this is metres and needs no scaling.
 */
export const SEATED_PELVIS_Y = J.ankle + LEN.shank;

export { J as JOINTS, LEN as LENGTHS };
