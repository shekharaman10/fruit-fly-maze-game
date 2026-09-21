// Third-person camera placement.
//
// Lives in its own module so the headless tests can check it. It was inside
// main.js, which only runs in a browser, and the consequence was a regression
// that no suite could see: once the plan grew interior partitions the boom
// pushed the camera straight through one, and the whole view became a white
// wall with the back of a painting filling the frame.

import { resolveCollision, lineOfSight, ROOM, MAZE } from '../world/maze.js';

const EDGE = 0.45;     // m clearance from the outer shell
// Corridors are narrow, so the boom has to be allowed much closer than it did
// in the open rooms or every placement collapses onto the subject.
export const MIN_BOOM = 0.85; // never closer to the subject than this
const STEPS = 16;

/** Hold a camera position inside the outer shell. */
export function clampToRoom(v) {
  const hw = ROOM.w / 2;
  const hd = ROOM.d / 2;
  v.x = Math.min(Math.max(v.x, -hw + EDGE), hw - EDGE);
  v.z = Math.min(Math.max(v.z, -hd + EDGE), hd - EDGE);
  // NOT clamped to the ceiling. ROOM.h is the wall height, and clamping to it
  // pinned the camera at 2.35 m -- just under the 2.6 m walls -- which is
  // exactly where it cannot see anything. A camera above the maze is the
  // point, so the ceiling here is generous and only stops it leaving orbit.
  v.y = Math.min(Math.max(v.y, 0.4), MAZE.height * 4);
  return v;
}

/**
 * Pull the camera in until it has clear line of sight to the subject and is not
 * inside anything. Reuses the same lineOfSight() the perception code uses, so
 * the camera and the brain agree about what counts as a wall.
 *
 * @param {object} world   from buildRoom()
 * @param {number} sx, sz  the subject
 * @param {{x:number,y:number,z:number}} want  desired position, mutated
 */
export function pullCameraIn(world, sx, sz, want) {
  clampToRoom(want);

  // ABOVE THE WALLS, NOTHING IS IN THE WAY. lineOfSight is a 2D test and knows
  // nothing about height, so it rejected every camera position in a corridor --
  // the boom collapsed to its minimum and the view became the back of the
  // character's head with a wall filling the rest. Walls stop at MAZE.height,
  // so a camera above them has a clear look down and needs no test at all.
  if (want.y > MAZE.height + 0.25) return want;

  const dx = want.x - sx;
  const dz = want.z - sz;
  const full = Math.hypot(dx, dz);
  if (full < 1e-3) return want;

  for (let i = 0; i <= STEPS; i++) {
    const d = Math.max(full * (1 - i / STEPS), MIN_BOOM);
    const x = sx + (dx / full) * d;
    const z = sz + (dz / full) * d;

    // Plants skipped: the camera rides at 2.25 m and the tallest plant is
    // 1.05 m, so pushing out of one would shove the shot for nothing.
    const fixed = resolveCollision(world, x, z, 0.28, { props: false });
    const solid = Math.hypot(fixed.x - x, fixed.z - z) > 1e-6;
    if (!solid && lineOfSight(world, sx, sz, x, z)) {
      want.x = x;
      want.z = z;
      return want;
    }
    if (d <= MIN_BOOM) break;
  }

  // Nothing clear anywhere along the boom: sit on the subject rather than
  // inside a wall. Ugly, but it never shows the inside of a partition.
  want.x = sx;
  want.z = sz;
  return want;
}
