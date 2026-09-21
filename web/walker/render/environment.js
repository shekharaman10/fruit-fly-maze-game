// Image-based lighting, built from the maze's own colours.
//
// WHY THIS IS THE FIRST THING AND NOT THE MESH. A MeshStandardMaterial is a PBR
// material, and PBR splits what you see into diffuse and specular. Lights feed
// the diffuse term. The specular term -- every reflection, every sheen, the
// bright edge along a curved surface that tells you it is curved -- comes from
// an ENVIRONMENT MAP, and the scene had none. Without one, `metalness` does
// nothing at all and `roughness` barely does: a steel blade and a cotton shirt
// resolve to the same flat wash of colour.
//
// That is most of why the characters read as plastic blocks. It is not the
// geometry; a photoreal mesh dropped into a scene with no environment still
// looks like a toy.
//
// NO FILE IS LOADED. The usual answer is an HDRI, which would be a multi-
// megabyte image and another thing to fetch. Instead this builds a six-sided
// box in the palette the maze is actually made of -- sky above, red carpet
// below, white walls around -- and pre-filters it with PMREMGenerator. The
// reflections then agree with the room the character is standing in, which an
// off-the-shelf HDRI of somebody's studio would not.
//
// Browser only: PMREM needs a live WebGL renderer. Node gets null and nothing
// downstream cares, which is the same bargain the textures and the carpet make.

import * as THREE from '../vendor/three.module.js';

// Matched to main.js SKY and world/maze.js CARPET. If those move, move these.
const SKY = 0x87ceeb;
const CARPET = 0x6e181f;
const WALL = 0xf4f4f2;

/** A face of the environment box, facing inward. */
function panel(scene, colour, w, h, pos, rot) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // Basic, not Standard: these panels ARE the light. Nothing lights them.
    new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }),
  );
  m.position.copy(pos);
  m.rotation.copy(rot);
  scene.add(m);
}

function environmentScene() {
  const s = new THREE.Scene();
  const R = 10;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const e = (x, y, z) => new THREE.Euler(x, y, z);

  // Sky overhead, carpet underfoot, white all round.
  panel(s, SKY, R * 2, R * 2, v(0, R, 0), e(Math.PI / 2, 0, 0));
  panel(s, CARPET, R * 2, R * 2, v(0, -R, 0), e(-Math.PI / 2, 0, 0));
  panel(s, WALL, R * 2, R * 2, v(0, 0, -R), e(0, 0, 0));
  panel(s, WALL, R * 2, R * 2, v(0, 0, R), e(0, Math.PI, 0));
  panel(s, WALL, R * 2, R * 2, v(-R, 0, 0), e(0, Math.PI / 2, 0));
  panel(s, WALL, R * 2, R * 2, v(R, 0, 0), e(0, -Math.PI / 2, 0));

  // Two bright panels standing in for the sun and its bounce. Without a hot
  // spot somewhere there is nothing for a glossy surface to catch, and a katana
  // with a perfectly even environment looks like grey plastic again.
  panel(s, 0xffffff, R * 0.8, R * 0.8, v(R * 0.55, R * 0.92, R * 0.4),
    e(-Math.PI / 2, 0, 0));
  panel(s, 0xdfeaf6, R * 0.5, R * 0.5, v(-R * 0.6, R * 0.9, -R * 0.5),
    e(-Math.PI / 2, 0, 0));

  return s;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {?THREE.Texture} assign to `scene.environment`, or null headless.
 */
export function buildEnvironment(renderer) {
  if (!renderer || typeof document === 'undefined') return null;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = environmentScene();
  const target = pmrem.fromScene(scene, 0.04);

  // The source scene has done its job; only the pre-filtered cubemap is kept.
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.dispose();
  });
  pmrem.dispose();

  return target.texture;
}
