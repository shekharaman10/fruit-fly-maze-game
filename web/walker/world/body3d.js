// A kinematic body that accelerates, falls, and slides along walls.
//
// This is Godot's `CharacterBody3D` reduced to what this project needs, and
// borrowed deliberately rather than invented: `move_toward` for acceleration,
// `move_and_slide` for contact, `is_on_floor` for ground state. Godot is not a
// dependency and cannot be -- it is a separate engine -- but its character
// controller is a well-worn answer to the exact problem here, and the answer
// ports in about a hundred lines.
//
// WHAT IT REPLACES. Movement used to be written straight onto the position:
//
//     body.x += sin(yaw) * speed * dt
//     resolveCollision(...)          // then shove out of any overlap
//
// That has two faults. The body reaches full speed in one frame and stops in
// one frame, which is why every start and stop looked like a cut rather than a
// move. And the push-out fights the command: the brain keeps steering into the
// wall, the push-out keeps shoving back, and the body buzzes along the surface
// -- `tools/maze.mjs` measures 11% of the march spent in contact.
//
// Sliding fixes the second properly. Instead of only moving the body out of
// the wall, it removes the INTO-THE-WALL COMPONENT OF THE VELOCITY, so what is
// left runs along the surface. The body stops pushing and starts sliding, and
// the buzz has nothing left to feed on.
//
// WHAT IT IS NOT. There is no mass, no inertia tensor, no restitution and no
// joints. Nothing here would let the character trip, and `docs/walker.md` still
// lists the missing balance model as a limitation. A kinematic controller that
// is honest about being kinematic is the Godot lesson worth taking; reaching
// for a rigid-body engine would have meant a WASM dependency, a build step, and
// tests that can no longer run these same modules under node.

/** Gravity. Only the character uses it; the flies are aerial. */
export const GRAVITY = 9.81;

/** How many times one move may bend around obstacles before giving up. */
const MAX_SLIDES = 4;

/**
 * Godot's `Vector.move_toward`: step `from` toward `to` by at most `delta`,
 * without overshooting. The whole of the acceleration model.
 */
export function moveToward(fromX, fromZ, toX, toZ, delta) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d <= delta || d < 1e-9) return { x: toX, z: toZ };
  const k = delta / d;
  return { x: fromX + dx * k, z: fromZ + dz * k };
}

/** Closest point on a segment, and the distance to it. */
function closestOnSeg(s, px, pz) {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((px - s.x1) * dx + (pz - s.z1) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.x1 + dx * t;
  const cz = s.z1 + dz * t;
  return { cx, cz, dist: Math.hypot(px - cx, pz - cz) };
}

/**
 * Resolve one body against the walls and, optionally, the plants.
 *
 * Returns the corrected position and the velocity with every into-surface
 * component removed. Two passes, because a corner between an arc and a radial
 * wall needs the second one -- the same reason `resolveCollision` in
 * `world/maze.js` takes two.
 */
function slide(world, x, z, vx, vz, radius, wallT, useProps) {
  let hit = false;

  for (let pass = 0; pass < 2; pass++) {
    let moved = false;

    if (useProps) {
      for (const pr of world.props || []) {
        const dx = x - pr.x;
        const dz = z - pr.z;
        const need = radius + pr.radius;
        const d = Math.hypot(dx, dz);
        if (d >= need) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        x += nx * (need - d);
        z += nz * (need - d);
        const into = vx * nx + vz * nz;
        if (into < 0) { vx -= into * nx; vz -= into * nz; }
        moved = true;
        hit = true;
      }
    }

    const clearance = radius + wallT;
    for (const s of world.segs) {
      const { cx, cz, dist } = closestOnSeg(s, x, z);
      if (dist >= clearance) continue;

      // Degenerate: dead on the segment, so there is no normal to recover.
      // Nudge along the segment's own perpendicular instead of guessing.
      let nx;
      let nz;
      if (dist < 1e-6) {
        const sx = s.x2 - s.x1;
        const sz = s.z2 - s.z1;
        const l = Math.hypot(sx, sz) || 1;
        nx = -sz / l;
        nz = sx / l;
      } else {
        nx = (x - cx) / dist;
        nz = (z - cz) / dist;
      }

      x = cx + nx * clearance;
      z = cz + nz * clearance;

      // The slide itself: drop the component heading into the surface and keep
      // whatever runs along it.
      const into = vx * nx + vz * nz;
      if (into < 0) { vx -= into * nx; vz -= into * nz; }

      moved = true;
      hit = true;
    }

    if (!moved) break;
  }

  return { x, z, vx, vz, hit };
}

/**
 * Integrate one body for `dt` and resolve it.
 *
 * `s` is mutated: { x, y, z, vx, vy, vz, onFloor }.
 *
 * @param {object} opts
 * @param {number} opts.radius
 * @param {number} opts.wallT        wall half-thickness
 * @param {boolean} [opts.gravity]   default false; the flies do not fall
 * @param {number} [opts.floorY]     default 0
 * @param {number} [opts.ceilingY]   clamps upward motion when given
 * @param {boolean} [opts.props]     default true; false ignores the plants
 * @returns {boolean} whether anything was touched
 */
export function moveAndSlide(world, s, dt, opts) {
  const radius = opts.radius;
  const wallT = opts.wallT ?? 0;
  const useProps = opts.props !== false;

  if (opts.gravity) s.vy -= GRAVITY * dt;

  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.y += (s.vy || 0) * dt;

  const floorY = opts.floorY ?? 0;
  s.onFloor = false;
  if (s.y <= floorY) {
    s.y = floorY;
    if (s.vy < 0) s.vy = 0;
    s.onFloor = true;
  }
  if (opts.ceilingY !== undefined && s.y > opts.ceilingY) {
    s.y = opts.ceilingY;
    if (s.vy > 0) s.vy = 0;
  }

  let hit = false;
  for (let i = 0; i < MAX_SLIDES; i++) {
    const r = slide(world, s.x, s.z, s.vx, s.vz, radius, wallT, useProps);
    s.x = r.x;
    s.z = r.z;
    s.vx = r.vx;
    s.vz = r.vz;
    if (!r.hit) break;
    hit = true;
  }
  return hit;
}

/** Horizontal speed, which is what the gait should be posed from. */
export const planarSpeed = (s) => Math.hypot(s.vx, s.vz);
