// Dark academia: the maze as a college library after hours.
//
// Press N. The sky goes out, the sun goes with it, and what is left is the
// pictures — each under its own small brass lamp, each dropping a pool of light
// on the floor beneath it. The corridors between them go almost black, so the
// gallery reads as a sequence of lit things rather than a lit room.
//
// NO EXTRA LIGHTS. That is the whole trick and it is worth being explicit
// about, because the obvious implementation is one point light per picture and
// there are eighty-odd pictures. Eighty point lights would not merely be slow;
// three.js compiles a shader whose cost scales with the light count, so it
// would cost that much on every surface in the scene whether or not a picture
// was anywhere near it.
//
// Instead:
//
//   - each picture lights ITSELF, by taking its own texture as an emissiveMap.
//     A lit painting is mostly its own colours brightened, which is exactly
//     what an emissive map does, and it costs nothing.
//   - the lamp above it is a small emissive bar, and the pool beneath it is a
//     disc with a radial-gradient texture on additive blending. Both are
//     geometry pretending to be light, both are instanced, and together they
//     are two draw calls for the whole gallery.
//
// So the night has no lights in it at all beyond the two dim directionals that
// were already there. It is all material.

import * as THREE from '../vendor/three.module.js';

// Daylight, as built in main.js and world/maze.js. Kept so the toggle can go
// back rather than guess.
export const DAY = {
  sky: 0x87ceeb,
  fogNear: 20,
  fogFar: 52,
  hemi: 0.55,
  sun: 1.35,
  fill: 0.30,
  exposure: 0.98,
  floor: 0x2f7d46,
  wall: 0xf4f4f2,
  skirt: 0x2f2a2c,
};

// After hours. Not black -- a black scene reads as a bug rather than as night,
// and the walls still need to be legible enough to walk. Deep and warm, with
// the blue kept out of the walls so they read as old panelling and not as
// moonlight.
export const NIGHT = {
  sky: 0x07070b,
  // Not 6/30. That swallowed corridors nicely from inside and then swallowed
  // the entire maze from the free camera, which sits fifty metres out -- press
  // N from the opening view and the screen went black. The darkness has to come
  // from the light levels, not from fog tight enough to hide the building.
  fogNear: 14,
  fogFar: 78,
  hemi: 0.10,
  sun: 0.07,
  fill: 0.05,
  exposure: 1.18,
  floor: 0x241a12,     // dark boards, almost oxblood
  wall: 0x2b2722,      // panelling
  skirt: 0x14110f,
};

const LAMP_COLOUR = 0xffd9a0;    // warm tungsten, not white
const POOL_COLOUR = 0xffae57;

/**
 * A radial falloff, for the pool of light on the floor. Drawn rather than
 * loaded, like everything else here. Browser only; headless gets null and the
 * pools are simply left out.
 */
function poolTexture() {
  if (typeof document === 'undefined') return null;
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  // Not linear: a light pool has a hot centre and a long soft edge, and a
  // straight ramp reads as a grey disc.
  g.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.70, 'rgba(255,255,255,0.09)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the lamps and pools, hidden, and return a function that switches the
 * whole scene between day and night.
 *
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.world       from buildMaze()
 * @param {THREE.HemisphereLight} o.hemi
 * @param {THREE.DirectionalLight} o.sun
 * @param {THREE.DirectionalLight} o.fill
 * @returns {{ set: (on: boolean) => void, dispose: () => void }}
 *
 * The maze is rebuilt on every run, so this is too, and `dispose` exists
 * because the lamps are added straight to the scene rather than to the maze
 * group that gets cleared.
 */
export function createNightMode({ scene, renderer, world, hemi, sun, fill }) {
  const pictures = world.pictures || [];
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  if (pictures.length) {
    const lampGeo = new THREE.BoxGeometry(1, 0.035, 0.07);
    // Emissive 1.0, not 2.4. ACES tone mapping clips anything much above one to
    // white, so a "warm tungsten" lamp at 2.4 renders as a plain white slab and
    // the warmth it was given is thrown away before it reaches the screen.
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x6b5836, emissive: LAMP_COLOUR, emissiveIntensity: 1.0, roughness: 0.45,
      metalness: 0.7,
    });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, pictures.length);

    const poolTex = poolTexture();
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const poolMat = new THREE.MeshBasicMaterial({
      color: POOL_COLOUR,
      map: poolTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Additive adds the tint to whatever is under it, so a high opacity walks
      // the colour toward white and the pool goes grey. Kept low, and the tint
      // pushed well into amber, so what lands on the boards reads as lamplight.
      opacity: 0.5,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, pictures.length);
    pools.renderOrder = 2;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const flat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2,
    );

    pictures.forEach((p, i) => {
      // Which way the picture faces. Taken from viewFrom -- the standing spot
      // the tour walks to -- rather than recomputed from the angle, because
      // that spot is already known to be out in the corridor on the right side
      // of the wall.
      let nx = (p.viewFrom?.x ?? p.x) - p.x;
      let nz = (p.viewFrom?.z ?? p.z) - p.z;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const yaw = Math.atan2(nx, nz);

      // The lamp, on its little arm just above and just proud of the frame.
      q.setFromAxisAngle(up, yaw);
      pos.set(p.x + nx * 0.11, 1.45 + p.h / 2 + 0.13, p.z + nz * 0.11);
      scl.set(Math.max(0.22, p.w * 0.55), 1, 1);
      lamps.setMatrixAt(i, m.compose(pos, q, scl));

      // The pool, on the floor, pushed out from the wall so it sits where a
      // downward-angled lamp would actually put it.
      q.setFromAxisAngle(up, yaw);
      q.multiply(flat);
      const r = Math.max(1.0, p.w * 1.9);
      pos.set(p.x + nx * r * 0.42, 0.012, p.z + nz * r * 0.42);
      scl.set(r, r, 1);
      pools.setMatrixAt(i, m.compose(pos, q, scl));
    });

    lamps.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    group.add(lamps);
    if (poolTex) group.add(pools);
  }

  const { floor, wall, skirt } = world.materials || {};

  // The carpet texture carries its own colour, so the floor material sits at
  // white and is tinted by the map. Darkening it therefore has to go through
  // the tint, not through a colour it is ignoring.
  const floorHasMap = Boolean(floor && floor.map);

  let current = null;

  function setNight(on) {
    if (on === current) return;
    current = on;
    const P = on ? NIGHT : DAY;

    scene.background = new THREE.Color(P.sky);
    if (scene.fog) {
      scene.fog.color.setHex(P.sky);
      scene.fog.near = P.fogNear;
      scene.fog.far = P.fogFar;
    }
    if (hemi) {
      hemi.intensity = P.hemi;
      hemi.color.setHex(on ? 0x223046 : DAY.sky);
      hemi.groundColor.setHex(on ? 0x120c08 : 0x6e181f);
    }
    if (sun) {
      sun.intensity = P.sun;
      sun.color.setHex(on ? 0x9fb4d8 : 0xfff4e6);   // what little there is, is moon
    }
    if (fill) fill.intensity = P.fill;
    if (renderer) renderer.toneMappingExposure = P.exposure;

    if (floor) {
      if (floorHasMap) floor.color.setHex(on ? 0x4a3a2c : 0xffffff);
      else floor.color.setHex(P.floor);
    }
    if (wall) wall.color.setHex(P.wall);
    if (skirt) skirt.color.setHex(P.skirt);

    for (const p of pictures) {
      if (!p.mat) continue;
      if (on) {
        // The picture lights itself. emissiveMap needs a map to multiply, and
        // the textures load asynchronously, so this is re-applied on every
        // toggle rather than once at build time.
        p.mat.emissiveMap = p.mat.map || null;
        p.mat.emissive.setHex(0xffffff);
        p.mat.emissiveIntensity = p.mat.map ? 0.78 : 0.10;
      } else {
        p.mat.emissiveMap = null;
        p.mat.emissive.setHex(0x000000);
        p.mat.emissiveIntensity = 1;
      }
      p.mat.needsUpdate = true;
      if (p.frameMat) {
        // Brass at night, near-black by day.
        p.frameMat.color.setHex(on ? 0x6a5630 : 0x17171a);
        p.frameMat.metalness = on ? 0.8 : 0;
        p.frameMat.roughness = on ? 0.35 : 0.6;
      }
    }

    group.visible = on;
  }

  function dispose() {
    setNight(false);
    scene.remove(group);
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    });
  }

  return { set: setNight, dispose };
}
