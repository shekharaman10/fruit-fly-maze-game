// Does anything go through a wall?
//
//   node tools/clearance.mjs
//
// Reported from the browser: the sword, the carbine and the flies all pass
// through the partitions. Collision in this project is a circle in the XZ plane
// -- the character keeps BODY_RADIUS clear and each fly keeps 0.30 m -- which
// says nothing about the geometry hanging off them. A katana on a 0.86 m arc
// swung by a body that is only required to keep 0.32 m clear will obviously
// come out the other side of a 0.09 m wall.
//
// So this measures the WORLD-SPACE extent of the things that stick out, at many
// positions and many angles, and reports how far past the wall face they reach.
// Numbers first: it is worth knowing which of the three is actually a problem
// and by how much before any of them is changed.

import * as THREE from '../vendor/three.module.js';
import { buildMaze, cellCentre, MAZE, BODY_RADIUS } from '../world/maze.js';
import { buildPlayer, applyWeaponPose } from '../world/player.js';
import { VARIANTS } from '../world/human.js';
import { buildFly, FLY_LENGTH, FLY_CLEAR_RADIUS } from '../world/fly.js';
import { Swing } from '../world/sword.js';
import { makeRandom } from '../brain/neuron.js';

const DT = 1 / 120;

let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

const world = buildMaze({ seed: 20260917 });
// world.segs, not wallSegments(): that helper flattens each one to a bare
// [x1,z1,x2,z2] array, and reading .x1 off an array is undefined, which makes
// every distance NaN and every comparison false. The first run of this tool
// reported a tidy 0% penetration for exactly that reason.
const segs = world.segs;
const HALF_T = MAZE.wallT / 2;

/** Distance from a point to the nearest wall FACE, negative if inside one. */
function toNearestWall(x, z) {
  let best = Infinity;
  for (const s of segs) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 1e-12 ? ((x - s.x1) * dx + (z - s.z1) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
    if (d < best) best = d;
  }
  return best - HALF_T;
}

// Sample standing spots the character can actually reach: cell centres, which
// is where the route runs.
const rng = makeRandom(4242);
const spots = [];
for (let id = 1; id < world.graph.n; id++) {
  const c = cellCentre(world.graph, id);
  if (toNearestWall(c.x, c.z) > BODY_RADIUS * 0.5) spots.push(c);
}

console.log(`\n1. how much room there is to begin with`);
{
  let tightest = Infinity;
  let sum = 0;
  for (const c of spots) {
    const r = toNearestWall(c.x, c.z);
    tightest = Math.min(tightest, r);
    sum += r;
  }
  console.log(`  standing spots    : ${spots.length}`);
  console.log(`  room to the wall  : ${tightest.toFixed(2)} m tightest, `
    + `${(sum / spots.length).toFixed(2)} m average`);
  console.log(`  body keeps clear  : ${BODY_RADIUS} m`);
  console.log(`  corridor is       : ${MAZE.ringW} m less ${MAZE.wallT} m of wall`);
}

// ---------------------------------------------------------------- sword ----
console.log('\n2. the katana, through a whole swing');
{
  const player = buildPlayer(VARIANTS[0].id);
  const scene = new THREE.Scene();
  scene.add(player.group);
  const zoro = { weapon: 'sword', aiming: 0, aimYaw: 0, aimPitch: 0 };

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  let worst = 0;
  let worstAt = null;
  let through = 0;
  let tested = 0;
  let reach = 0;

  for (let i = 0; i < 260; i++) {
    const c = spots[Math.floor(rng() * spots.length) % spots.length];
    const yaw = rng() * Math.PI * 2;
    player.group.position.set(c.x, 0, c.z);
    player.group.rotation.y = yaw;

    const swing = new Swing();
    swing.start();
    let poked = false;
    for (let f = 0; f < 200 && swing.active; f++) {
      swing.step(DT);
      applyWeaponPose(player, zoro, swing, DT, toNearestWall(c.x, c.z));
      player.group.updateMatrixWorld(true);
      const sw = player.sword;
      sw.updateWorldMatrix(true, false);
      a.set(sw.userData.bladeStart, 0, 0);
      sw.localToWorld(a);
      b.copy(sw.userData.tip);
      sw.localToWorld(b);

      // Sample along the edge; the tip is not always the part that is out.
      for (let k = 0; k <= 8; k++) {
        const px = a.x + (b.x - a.x) * (k / 8);
        const pz = a.z + (b.z - a.z) * (k / 8);
        const py = a.y + (b.y - a.y) * (k / 8);
        reach = Math.max(reach, Math.hypot(px - c.x, pz - c.z));
        // Only counts if it is at wall height. Above 2.6 m it is over the top.
        if (py > MAZE.height || py < 0) continue;
        const d = toNearestWall(px, pz);
        if (d < 0) {
          poked = true;
          if (-d > worst) { worst = -d; worstAt = { x: c.x, z: c.z, u: swing.u }; }
        }
      }
    }
    tested++;
    if (poked) through++;
  }

  console.log(`  swings tested     : ${tested}`);
  console.log(`  blade reaches     : ${reach.toFixed(2)} m from the body centre`);
  console.log(`  swings that went through a wall: ${through} `
    + `(${(100 * through / tested).toFixed(0)}%)`);
  console.log(`  deepest           : ${worst.toFixed(2)} m past the wall face`
    + (worstAt ? ` at u = ${worstAt.u.toFixed(2)}` : ''));
  check('the blade stays out of the walls', through === 0,
    `${through}/${tested} swings, ${worst.toFixed(2)} m deep`);
}

// --------------------------------------------------------------- carbine ---
console.log('\n3. the carbine, across the aim range');
{
  const player = buildPlayer(VARIANTS[0].id);
  const scene = new THREE.Scene();
  scene.add(player.group);
  const swing = new Swing();
  const m = new THREE.Vector3();

  let worst = 0;
  let through = 0;
  let tested = 0;
  let reach = 0;

  for (let i = 0; i < 400; i++) {
    const c = spots[Math.floor(rng() * spots.length) % spots.length];
    const yaw = rng() * Math.PI * 2;
    player.group.position.set(c.x, 0, c.z);
    player.group.rotation.y = yaw;

    // Anywhere in the frontal field, aiming or carried.
    const zoro = {
      weapon: 'rifle',
      aiming: rng() < 0.5 ? 1 : 0,
      aimYaw: (rng() - 0.5) * 2 * 1.31,
      aimPitch: (rng() - 0.5) * 0.8,
    };
    applyWeaponPose(player, zoro, swing, DT, toNearestWall(c.x, c.z));
    player.group.updateMatrixWorld(true);
    player.muzzle.updateWorldMatrix(true, false);
    player.muzzle.getWorldPosition(m);

    reach = Math.max(reach, Math.hypot(m.x - c.x, m.z - c.z));
    tested++;
    if (m.y > 0 && m.y < MAZE.height) {
      const d = toNearestWall(m.x, m.z);
      if (d < 0) { through++; worst = Math.max(worst, -d); }
    }
  }

  console.log(`  poses tested      : ${tested}`);
  console.log(`  muzzle reaches    : ${reach.toFixed(2)} m from the body centre`);
  console.log(`  muzzles inside a wall: ${through} (${(100 * through / tested).toFixed(0)}%)`);
  console.log(`  deepest           : ${worst.toFixed(2)} m past the wall face`);
  check('the muzzle stays out of the walls', through === 0,
    `${through}/${tested} poses, ${worst.toFixed(2)} m deep`);
}

// ----------------------------------------------------------------- flies ---
console.log('\n4. the flies');
{
  const proto = buildFly();
  proto.group.position.set(0, 0, 0);
  proto.group.rotation.y = 0;
  proto.pose({ wingPhase: 0, thrust: 1, bank: 0, pitch: 0, escaping: false });
  proto.group.updateMatrixWorld(true);

  // The widest the model gets in the XZ plane, measured rather than assumed --
  // the wings and legs stick out well past the body it is scaled by.
  const box = new THREE.Box3().setFromObject(proto.group);
  const half = Math.max(
    Math.abs(box.min.x), Math.abs(box.max.x),
    Math.abs(box.min.z), Math.abs(box.max.z),
  );
  // Worst case over yaw is the corner of the footprint.
  const spin = Math.hypot(
    Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    Math.max(Math.abs(box.min.z), Math.abs(box.max.z)),
  );

  const FLY_COLLIDE = FLY_CLEAR_RADIUS;
  console.log(`  body length       : ${FLY_LENGTH.toFixed(3)} m`);
  console.log(`  model half extent : ${half.toFixed(3)} m, ${spin.toFixed(3)} m at the corner`);
  console.log(`  collision radius  : ${FLY_COLLIDE} m`);
  // resolveCollision keeps radius + wallT from the CENTRE line, and the face is
  // only half a thickness in from that, so this is the clearance it really gets.
  const fromFace = FLY_COLLIDE + MAZE.wallT / 2;
  console.log(`  clear of the face : ${fromFace.toFixed(3)} m`);
  console.log(`  sticks out by     : ${Math.max(0, spin - fromFace).toFixed(3)} m at the worst yaw`);

  check('a fly is kept clear by at least its own size', fromFace >= spin,
    `${fromFace.toFixed(3)} m of clearance vs ${spin.toFixed(3)} m of fly`);
}

console.log(`\n${failures === 0 ? 'nothing goes through a wall' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
