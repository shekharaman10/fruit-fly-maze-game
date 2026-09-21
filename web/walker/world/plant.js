// Potted plants, built from primitives, instanced across the whole maze.
//
// Modelled on the reference render: Medinilla magnifica -- a dark matte pot,
// a short woody stem, whorls of big deep-green ovate leaves, and pink flower
// panicles that hang and droop rather than standing up. What carries it at a
// glance is the droop and the leaf whorls, so those are what is built; the
// rest is a pot.
//
// NOT a loaded 3D model. This project vendors three.js and nothing else -- no
// GLTFLoader, no .glb, and node runs these same modules in the tests where
// there is no loader to fetch with. Every leaf here is a ShapeGeometry and
// every bloom is a sphere, the same way the characters and the flies are
// built.
//
// THE WHOLE THING IS INSTANCED. One InstancedMesh per part kind, shared by
// every plant in the maze, so sixteen plants cost eight draw calls rather than
// sixteen times forty. The maze walls were taken from 1756 meshes down to two
// draws; decor that gave that back would not be worth having.

import * as THREE from '../vendor/three.module.js';
import { makeRandom } from '../brain/neuron.js';

/**
 * Collision radius: the POT, not the canopy.
 *
 * The leaves reach past 0.30 and the panicles further still, but foliage is
 * something a body brushes through and a pot is something it trips over, so
 * the solid part is the solid part. It also has to be: a corridor is 2.0 m, a
 * body is 0.32, and the route walks cell centre to cell centre. A plant wide
 * enough to block a waypoint cannot also fit against the wall. See the offset
 * in plantSpots() in world/maze.js, which this number is balanced against.
 */
export const PLANT_RADIUS = 0.22;
export const PLANT_HEIGHT = 1.05;

const TWO_PI = Math.PI * 2;

// One ovate blade, lying in XY with the length along +X and the tip at x = 1.
// Two quadratic curves, which is the cheapest thing that still reads as a leaf
// rather than as a rectangle.
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.34, 0.17, 1, 0);
  s.quadraticCurveTo(0.34, -0.17, 0, 0);
  return new THREE.ShapeGeometry(s, 14);
}

const std = (color, rough, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, ...opts });

// Part kinds, in the order they are built. Each becomes one InstancedMesh.
function kinds() {
  return {
    pot:    { geo: new THREE.CylinderGeometry(0.20, 0.145, 0.30, 20, 1),
              mat: std(0x3a3b3d, 0.92), shadow: true },
    rim:    { geo: new THREE.CylinderGeometry(0.208, 0.204, 0.035, 20, 1),
              mat: std(0x46474b, 0.86), shadow: true },
    soil:   { geo: new THREE.CylinderGeometry(0.184, 0.184, 0.02, 18, 1),
              mat: std(0x5d5342, 0.98), shadow: false },
    pebble: { geo: new THREE.SphereGeometry(0.019, 6, 5),
              mat: std(0x8d8478, 0.9), shadow: false },
    stem:   { geo: new THREE.CylinderGeometry(0.014, 0.019, 1, 6, 1),
              mat: std(0x6f7f4a, 0.82), shadow: true },
    leaf:   { geo: leafGeometry(),
              mat: std(0x1f4d2a, 0.66, { side: THREE.DoubleSide }), shadow: true,
              vary: true },
    bract:  { geo: leafGeometry(),
              mat: std(0xdd76a0, 0.72, { side: THREE.DoubleSide }), shadow: false,
              vary: true },
    bloom:  { geo: new THREE.SphereGeometry(1, 7, 6),
              mat: std(0xef9ab8, 0.74), shadow: false, vary: true },
  };
}

/**
 * Compose position * yaw * pitch * flat * scale into `out`.
 *
 * `flat` lays a leaf blade down: the geometry is built in XY, so it is rotated
 * -90 degrees about X to put the blade in the horizontal plane with its normal
 * up. Pitch then lifts or drops the tip, and yaw swings it round the stem.
 */
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function blade(out, x, y, z, yaw, pitch, len, wide) {
  _q.setFromAxisAngle(AXIS_Y, yaw);
  _qa.setFromAxisAngle(AXIS_Z, pitch);
  _q.multiply(_qa);
  _qa.setFromAxisAngle(AXIS_X, -Math.PI / 2);
  _q.multiply(_qa);
  return out.compose(_p.set(x, y, z), _q, _s.set(len, wide, 1));
}

function upright(out, x, y, z, yaw, tilt, len, thick = 1) {
  _q.setFromAxisAngle(AXIS_Y, yaw);
  _qa.setFromAxisAngle(AXIS_Z, tilt);
  _q.multiply(_qa);
  return out.compose(_p.set(x, y, z), _q, _s.set(thick, len, thick));
}

/**
 * One plant's parts, in its own space, appended to `bins` after `world` is
 * applied. Keeping the plant in local space and multiplying through means the
 * shape is written once and the maze only decides where it stands.
 */
function emitPlant(bins, world, rand) {
  const m = new THREE.Matrix4();
  const push = (kind) => bins[kind].push(new THREE.Matrix4().multiplyMatrices(world, m));

  // --- the pot ---
  m.compose(_p.set(0, 0.15, 0), _q.identity(), _s.set(1, 1, 1));
  push('pot');
  m.compose(_p.set(0, 0.297, 0), _q.identity(), _s.set(1, 1, 1));
  push('rim');
  m.compose(_p.set(0, 0.30, 0), _q.identity(), _s.set(1, 1, 1));
  push('soil');
  for (let i = 0; i < 6; i++) {
    const a = rand() * TWO_PI;
    const r = 0.04 + rand() * 0.12;
    m.compose(_p.set(Math.sin(a) * r, 0.312, Math.cos(a) * r), _q.identity(),
      _s.set(1, 0.6, 1));
    push('pebble');
  }

  // --- stems: one main, two shorter offset ones ---
  const stems = [
    { x: 0, z: 0, h: 0.56, tilt: 0.0, yaw: 0 },
    { x: 0.055, z: -0.03, h: 0.40, tilt: 0.13, yaw: 1.9 },
    { x: -0.05, z: 0.04, h: 0.46, tilt: 0.11, yaw: 4.4 },
  ];
  for (const st of stems) {
    upright(m, st.x, 0.31 + st.h / 2, st.z, st.yaw, st.tilt, st.h);
    push('stem');

    // --- leaf whorls up the stem ---
    // Three whorls, each rotated off the one below so the plant does not read
    // as a stack of identical stars from above.
    const whorls = 3;
    for (let w = 0; w < whorls; w++) {
      const t = (w + 1) / (whorls + 0.6);
      const y = 0.31 + st.h * t;
      const n = w === whorls - 1 ? 4 : 5;
      const base = rand() * TWO_PI;
      const len = (0.26 - 0.05 * w) * (0.9 + rand() * 0.2);
      for (let i = 0; i < n; i++) {
        const yaw = base + (i / n) * TWO_PI + (rand() - 0.5) * 0.25;
        // Lower leaves sit flatter, upper ones lift toward the light.
        const pitch = 0.10 + 0.34 * t + (rand() - 0.5) * 0.14;
        blade(m, st.x + Math.sin(yaw) * 0.03, y, st.z + Math.cos(yaw) * 0.03,
          yaw, pitch, len, 0.62 + rand() * 0.16);
        push('leaf');
      }
    }
  }

  // --- panicles: the part that makes it this plant and not a rubber tree ---
  // Pink, pendent, and hung from under the leaves so they fall clear of them.
  const panicles = 3;
  for (let p = 0; p < panicles; p++) {
    const yaw = (p / panicles) * TWO_PI + rand() * 0.8;
    const top = 0.62 + rand() * 0.10;

    // Two bracts flaring at the head of the panicle.
    for (const side of [-1, 1]) {
      blade(m, Math.sin(yaw) * 0.10, top, Math.cos(yaw) * 0.10,
        yaw + side * 0.42, -0.30, 0.15, 0.9);
      push('bract');
    }

    // The chain: out and down, accelerating, shrinking toward the tip.
    const beads = 9;
    for (let i = 0; i < beads; i++) {
      const t = i / (beads - 1);
      const r = 0.10 + 0.20 * t;
      const y = top - 0.50 * t * t - 0.06 * t;
      const size = 0.050 * (1 - 0.55 * t);
      const jitter = (rand() - 0.5) * 0.05;
      m.compose(
        _p.set(Math.sin(yaw + jitter) * r, y, Math.cos(yaw + jitter) * r),
        _q.identity(),
        _s.set(size, size * 0.78, size),
      );
      push('bloom');
    }
  }
}

/**
 * @param {Array<{x:number,z:number,yaw:number,scale:number}>} spots
 * @returns {{group: THREE.Group, props: Array<{x,z,radius}>}}
 */
export function buildPlants(spots, seed = 7) {
  const group = new THREE.Group();
  const spec = kinds();
  const bins = {};
  for (const k of Object.keys(spec)) bins[k] = [];

  const rand = makeRandom(seed);
  const world = new THREE.Matrix4();
  const props = [];

  for (const sp of spots) {
    const s = sp.scale ?? 1;
    world.compose(
      _p.set(sp.x, 0, sp.z),
      _q.setFromAxisAngle(AXIS_Y, sp.yaw ?? 0),
      _s.set(s, s, s),
    );
    emitPlant(bins, world, rand);
    props.push({ x: sp.x, z: sp.z, radius: PLANT_RADIUS * s });
  }

  // A second RNG for colour, so changing the layout does not reshuffle the
  // greens and vice versa.
  const tint = makeRandom(seed + 101);
  const colour = new THREE.Color();

  for (const [name, def] of Object.entries(spec)) {
    const list = bins[name];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, list.length);
    mesh.castShadow = def.shadow;
    mesh.receiveShadow = def.shadow;
    for (let i = 0; i < list.length; i++) {
      mesh.setMatrixAt(i, list[i]);
      if (!def.vary) continue;
      // Per-instance lightness only. Hue drift turns a whorl of leaves into a
      // fruit salad; a leaf that catches more light does not change colour.
      colour.setHex(def.mat.color.getHex()).multiplyScalar(0.84 + tint() * 0.32);
      mesh.setColorAt(i, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return { group, props, count: spots.length };
}
