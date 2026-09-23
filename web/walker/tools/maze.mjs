// The maze, the route, and a full march to the centre -- with no renderer.
//
//   node tools/maze.mjs
//
// This is the test that matters for the objective: it walks the character from
// the rim to the middle using the same brain, the same collision and the same
// route the browser uses, and checks it actually arrives.

import * as THREE from '../vendor/three.module.js';
import {
  buildGraph, carve, bfsPath, coverageRoute, routeEdges, CENTRE,
} from '../world/mazeGraph.js';
import {
  buildMaze, sense, resolveCollision, lineOfSight, cellCentre, ringAt, MAZE, BODY_RADIUS,
} from '../world/maze.js';
import { FlyBrain } from '../brain/index.js';
import { buildPlayer, applyWeaponPose, gripTargets } from '../world/player.js';
import { VARIANTS } from '../world/human.js';
import { ZoroBrain } from '../brain/zoro.js';
import { Swing } from '../world/sword.js';
import { pullCameraIn } from '../render/camera.js';
import { moveAndSlide, moveToward, planarSpeed } from '../world/body3d.js';

// Same controller the scene runs -- see world/body3d.js. These tools exist so
// the march can be measured without a browser, and a tool that integrates
// movement its own way is measuring its own integration.
const WALK_ACCEL = 9.0;
const WALK_BRAKE = 11.0;

import { wrapPi } from '../brain/neuron.js';
import { Tour, TOUR } from '../tour.js';
import { ART } from '../art/index.mjs';
import { readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DT = 1 / 120;
let failures = 0;
const check = (name, pass, detail) => {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`);
};

// ------------------------------------------------- 1. generation ----------
console.log('\n1. maze generation is a perfect maze');
{
  const g = buildGraph();
  console.log(`  cells             : ${g.n} over ${g.rings} rings`);
  console.log(`  possible corridors: ${g.edges.length}`);

  for (const seed of [1, 7, 4242]) {
    const { passages, tree } = carve(g, seed);
    // A spanning tree over n nodes has exactly n-1 edges and no cycles.
    const spanning = passages.size === g.n - 1;

    let reached = 0;
    const seen = new Uint8Array(g.n);
    const q = [CENTRE];
    seen[CENTRE] = 1;
    for (let h = 0; h < q.length; h++) {
      reached++;
      for (const nb of tree[q[h]]) if (!seen[nb]) { seen[nb] = 1; q.push(nb); }
    }
    check(`seed ${seed}: spanning tree, every cell reachable`,
      spanning && reached === g.n, `${passages.size} corridors, ${reached}/${g.n} reachable`);
  }
}

// ------------------------------------------------- 2. the route -----------
console.log('\n2. the route covers every corridor and ends at the centre');
{
  const g = buildGraph();
  for (const seed of [1, 7, 23, 99, 4242]) {
    const { passages, tree } = carve(g, seed);
    const start = g.nodeId(g.rings - 1, 0);
    const route = coverageRoute(tree, start, CENTRE);
    const used = routeEdges(route);
    const shortest = bfsPath(tree, start, CENTRE);

    let missing = 0;
    for (const p of passages) if (!used.has(p)) missing++;

    const ok = route[0] === start
      && route[route.length - 1] === CENTRE
      && missing === 0;
    check(`seed ${seed}: ${route.length} moves, ${used.size}/${passages.size} corridors, ends at centre`,
      ok, ok ? `shortest path is ${shortest.length}` : `${missing} uncovered`);
  }

  // The coverage walk must be longer than simply going straight there --
  // otherwise it is not covering anything extra.
  const { tree, passages } = carve(g, 7);
  const start = g.nodeId(g.rings - 1, 0);
  const route = coverageRoute(tree, start, CENTRE);
  const shortest = bfsPath(tree, start, CENTRE);
  console.log(`  coverage ${route.length} moves vs shortest ${shortest.length}`);
  check('covering every corridor costs more than the direct path',
    route.length > shortest.length * 1.5, `${route.length} vs ${shortest.length}`);
  check('and no more than twice the corridors',
    route.length <= passages.size * 2 + 1, `${route.length} <= ${passages.size * 2 + 1}`);
}

// ------------------------------------------------- 3. geometry ------------
console.log('\n3. geometry is walkable');
const world = buildMaze({ seed: 20260917 });
{
  console.log(`  outer radius      : ${MAZE.outerR.toFixed(1)} m`);
  console.log(`  wall segments     : ${world.segs.length}`);
  console.log(`  pictures hung     : ${world.pictures.length}`);

  let stuck = 0;
  for (let id = 0; id < world.graph.n; id++) {
    const c = cellCentre(world.graph, id);
    const f = resolveCollision(world, c.x, c.z);
    if (Math.hypot(f.x - c.x, f.z - c.z) > 1e-6) stuck++;
  }
  check('every cell centre is standable', stuck === 0, `${stuck} blocked`);

  let blocked = 0;
  let longest = 0;
  for (let i = 0; i < world.routePoints.length - 1; i++) {
    const a = world.routePoints[i];
    const b = world.routePoints[i + 1];
    longest = Math.max(longest, Math.hypot(b.x - a.x, b.z - a.z));
    if (!lineOfSight(world, a.x, a.z, b.x, b.z)) blocked++;
  }
  console.log(`  longest route hop : ${longest.toFixed(2)} m`);
  check('no route hop crosses a wall', blocked === 0, `${blocked} blocked`);
  // A fresh clone has an empty art/ -- the folder is gitignored, see
  // art/README.md -- and an empty gallery is a legitimate state, not a
  // failure. Skip the gallery assertions rather than fail somebody who has
  // simply not put their pictures in yet.
  if (!ART.length) {
    console.log('  art/ is empty, so the gallery checks are skipped.');
    console.log('  Drop images into web/walker/art/ to hang them.');
  } else {
  check('pictures were hung', world.pictures.length > 20, `${world.pictures.length}`);

  // Every file finds a wall, or this fails loudly. It used to fail silently and
  // alphabetically: one picture per arc capped the gallery at the interior wall
  // count, and the manifest is sorted, so once art/ outgrew the maze the same
  // tail of names was dropped on every load.
  check('every picture found a wall', world.unhungPictures.length === 0,
        world.unhungPictures.length
          ? `${world.unhungPictures.length} homeless: ${world.unhungPictures.join(', ')}`
          : `${world.pictures.length} hung`);

  // Frames on the same arc must not overlap each other.
  let tightest = Infinity;
  for (let i = 0; i < world.pictures.length; i++) {
    for (let j = i + 1; j < world.pictures.length; j++) {
      const a = world.pictures[i];
      const b = world.pictures[j];
      // Only compare pictures hung on the SAME face. Two on opposite sides of
      // one wall are ~0.2 m apart in plan and would read as overlapping, when
      // in fact they are back to back and face opposite corridors.
      if (a.facing !== b.facing) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - (a.w + b.w) / 2;
      tightest = Math.min(tightest, gap);
    }
  }
  check('no two frames overlap', tightest > 0, `${tightest.toFixed(3)} m clear at the tightest`);

  // None on the outer shell. Its arcs face outward, so a picture hung there
  // lands on the far side of the boundary wall, pointing away from the maze --
  // measured at radius 15.802 against a shell of 15.700 before they were
  // excluded. Nothing in the scene can see it and nothing in the tour can
  // reach it, so it would silently make "look at every picture" unsatisfiable.
  let onShell = 0;
  let farthest = 0;
  for (const pic of world.pictures) {
    const r = Math.hypot(pic.x, pic.z);
    farthest = Math.max(farthest, r);
    if (r > world.shellR - 0.3) onShell++;
  }
  console.log(`  furthest picture  : ${farthest.toFixed(2)} m (shell ${world.shellR.toFixed(2)} m)`);
  check('no picture on the outer shell', onShell === 0, `${onShell} on it`);

  // The manifest is generated from art/, so it can drift the moment a file is
  // added or deleted without re-running the tool. A picture that 404s leaves a
  // blank canvas on a wall and nothing else complains.
  const artDir = fileURLToPath(new URL('../art/', import.meta.url));
  let missing = 0;
  for (const [file] of ART) {
    try {
      await access(join(artDir, file));
    } catch {
      missing++;
      console.log(`     MISSING: ${file}`);
    }
  }
  // One level deep, matching artManifest.mjs: art/generated/ holds the drawn
  // plates, and counting only the top level made the manifest look as though it
  // had invented two dozen files.
  const ents = await readdir(artDir, { withFileTypes: true });
  let onDisk = 0;
  for (const e of ents) {
    if (e.isDirectory()) {
      const sub = await readdir(join(artDir, e.name));
      onDisk += sub.filter((f) => /[.](jpe?g|png|webp)$/i.test(f)).length;
    } else if (/[.](jpe?g|png|webp)$/i.test(e.name)) {
      onDisk++;
    }
  }
  console.log(`  manifest entries  : ${ART.length}, files on disk: ${onDisk}`);
  check('every manifest entry exists on disk', missing === 0, `${missing} missing`);
  check('the manifest covers every image in art/', ART.length === onDisk,
    `${ART.length} vs ${onDisk} -- run node tools/artManifest.mjs`);
  }

  // A wall must actually stop sight: the centre should not be visible from the
  // rim, or the maze is not a maze.
  const rim = world.routePoints[0];
  check('the centre is not visible from the entrance',
    !lineOfSight(world, rim.x, rim.z, 0, 0));
}

// ------------------------------------------------- 4. the march -----------
console.log('\n4. the character marches to the centre');
{
  const player = buildPlayer(VARIANTS[0].id);
  const scene = new THREE.Scene();
  scene.add(world.group);
  scene.add(player.group);

  const brain = new FlyBrain({ seed: 4242, sex: 'male' });
  const zoro = new ZoroBrain({ seed: 11 });
  const swing = new Swing();

  const body = {
    x: world.outside.x,
    z: world.outside.z,
    y: 0, vx: 0, vy: 0, vz: 0, onFloor: true,
    yaw: Math.atan2(-world.outside.x, -world.outside.z),
    yawRate: 0,
  };
  brain.anchor(body.yaw);

  const nav = { bearing: 0, targetVisible: false };
  const tour = new Tour(world.pictures);
  let gateSmooth = 1;
  let marchIndex = 0;
  let walked = 0;
  let px = body.x;
  let pz = body.z;
  let contactFrames = 0;
  // How much of the run is spent not walking at full speed. This is the
  // number the complaint was about.
  let slowFrames = 0;
  let arrived = false;
  let arrivedAt = 0;

  const WIN_R = MAZE.centreR - 0.35;
  // Generous: anything missed on the route has to be walked back to.
  const LIMIT = 120 * 60 * 25;

  for (let i = 0; i < LIMIT; i++) {
    // Same priority the scene uses: look at a picture if there is one to look
    // at, otherwise march; go back for anything missed once the route is done.
    let gate = 1;   // this frame's intent; gateSmooth is what is applied
    const look = tour.step(DT, body);
    if (look) {
      nav.bearing = look.bearing;
      // Slowed, not stopped -- the same gate main.js applies.
      gate = TOUR.slow;
    } else if (marchIndex >= world.routePoints.length - 1 && !tour.satisfied) {
      const want = tour.nearestUnviewed(body.x, body.z);
      const v = world.pictures[want.index].viewFrom;
      nav.bearing = wrapPi(Math.atan2(v.x - body.x, v.z - body.z) - body.yaw);
    } else {
      const wp = world.routePoints[Math.min(marchIndex, world.routePoints.length - 1)];
      if (Math.hypot(wp.x - body.x, wp.z - body.z) < 0.55
        && marchIndex < world.routePoints.length - 1) marchIndex++;
      nav.bearing = wrapPi(Math.atan2(wp.x - body.x, wp.z - body.z) - body.yaw);
    }

    if (gate < 1) slowFrames++;
    const reading = sense(world, body, nav);
    if (reading.contact) contactFrames++;
    // Same stop the scene uses: `halt` drops walkDrive so the legs wind down,
    // and the gate eases rather than switching so the body rolls the same
    // 13 cm into the standing spot. Without both, this march is not the march
    // main.js runs and the dwell counts here would not mean anything.
    const motor = brain.step(DT, {
      ...reading, angularVelocity: body.yawRate, halt: gate === 0,   // never, now
    });
    gateSmooth += (gate - gateSmooth) * (1 - Math.exp(-DT / 0.12));

    body.yawRate = motor.yawRate;
    body.yaw = wrapPi(body.yaw + body.yawRate * DT);
    const wish = motor.speed * gateSmooth;
    const rate = (wish > planarSpeed(body) ? WALK_ACCEL : WALK_BRAKE) * DT;
    const v = moveToward(body.vx, body.vz,
      Math.sin(body.yaw) * wish, Math.cos(body.yaw) * wish, rate);
    body.vx = v.x;
    body.vz = v.z;
    moveAndSlide(world, body, DT, {
      radius: BODY_RADIUS, wallT: MAZE.wallT, gravity: true, floorY: 0,
    });
    const f = { x: body.x, z: body.z };
    body.x = f.x;
    body.z = f.z;

    walked += Math.hypot(body.x - px, body.z - pz);
    px = body.x;
    pz = body.z;

    if (!Number.isFinite(body.x) || !Number.isFinite(body.z)) break;

    // The centre is no longer gated on the art: flies come first, art last, and
    // the exit is not a toll booth. Pictures are still counted below.
    if (Math.hypot(body.x, body.z) < WIN_R) {
      arrived = true;
      arrivedAt = i * DT;
      break;
    }
  }

  console.log(`  waypoints reached : ${marchIndex} / ${world.routePoints.length - 1}`);
  console.log(`  distance walked   : ${walked.toFixed(1)} m`);
  console.log(`  simulated time    : ${arrivedAt.toFixed(1)} s`);
  const frames = Math.max(1, Math.round(arrivedAt / DT));
  console.log(`  frames in contact : ${(100 * contactFrames / frames).toFixed(0)}% of frames`);
  console.log(`  final ring        : ${ringAt(body.x, body.z)}`);
  console.log(`  pictures looked at: ${tour.viewedCount} / ${world.pictures.length}`
    + ` (${tour.required} required)`);
  console.log(`  time not at full speed: ${(100 * slowFrames / frames).toFixed(0)}% of frames`);

  // Nothing forces this any more, so it is a measurement of whether the route
  // actually passes the art rather than a rule the run had to obey.
  if (world.pictures.length) {
    check('he looks at art on the way past', tour.viewedCount >= tour.required,
      `${tour.viewedCount}/${tour.required}`);
  }
  // The point of the change: he is slowed for pictures, not parked. If this
  // ever creeps back over a third of the run, the march reads as faulting
  // again and the complaint that started this comes back.
  check('he spends most of the run walking', slowFrames / frames < 0.34,
    `${(100 * slowFrames / frames).toFixed(0)}% slowed`);
  check('the character reaches the centre', arrived,
    arrived ? `${arrivedAt.toFixed(0)} s` : `stopped at ring ${ringAt(body.x, body.z)}`);
  check('it followed the whole route', marchIndex >= world.routePoints.length - 2,
    `${marchIndex}/${world.routePoints.length - 1}`);
  check('it never left the maze', Math.hypot(body.x, body.z) <= MAZE.outerR + 1.5);
  check('the walk is longer than the straight-line distance', walked > MAZE.outerR,
    `${walked.toFixed(0)} m`);
}

// ------------------------------------------------- 5. camera --------------
console.log('\n5. the character ends up sitting on the chair');
{
  const f = world.furniture;
  const p = buildPlayer(VARIANTS[0].id);
  const sc = new THREE.Scene();
  sc.add(p.group);

  // The state the finale eases into: on the seat, facing the table, folded.
  p.group.position.set(f.seat.x, 0, f.seat.z);
  p.group.rotation.y = f.facing;
  const g = gripTargets(p);
  p.human.pose({
    legPhase: [0, Math.PI], speed: 0, turnCommand: 0, armHold: 1, sit: 1,
    rightHandTarget: g.right, leftHandTarget: g.left,
  });
  p.group.updateMatrixWorld(true);

  const pel = new THREE.Vector3();
  p.parts.pelvis.getWorldPosition(pel);
  const box = new THREE.Box3().setFromObject(p.human.group);
  const seatErr = Math.hypot(pel.x - f.seat.x, pel.y - f.seat.y, pel.z - f.seat.z);

  // Facing the table means facing the origin, since the table is the centre.
  const toTable = Math.atan2(-pel.x, -pel.z);
  const facingErr = Math.abs(wrapPi(f.facing - toTable));

  console.log(`  pelvis to seat    : ${(seatErr * 1000).toFixed(0)} mm`);
  console.log(`  lowest point      : ${(box.min.y * 1000).toFixed(0)} mm`);
  console.log(`  distance from mid : ${Math.hypot(pel.x, pel.z).toFixed(2)} m (disc ${MAZE.centreR})`);
  console.log(`  facing error      : ${(facingErr * 180 / Math.PI).toFixed(1)} deg`);

  check('the pelvis lands on the seat', seatErr < 0.03, `${(seatErr * 1000).toFixed(0)} mm`);
  check('the feet rest on the floor', Math.abs(box.min.y) < 0.02,
    `${(box.min.y * 1000).toFixed(0)} mm`);
  check('he is inside the centre disc', Math.hypot(pel.x, pel.z) < MAZE.centreR - 0.2);
  check('he faces the table', facingErr < 0.2, `${(facingErr * 180 / Math.PI).toFixed(1)} deg`);
  check('the furniture fits the centre disc', f.radius < MAZE.centreR - 0.15,
    `${f.radius.toFixed(2)} m in ${MAZE.centreR} m`);
}

console.log('\n6. camera stays out of the maze walls');
{
  const cam = { x: 0, y: 2.25, z: 0 };
  let blocked = 0;
  let inside = 0;
  let tested = 0;
  let s = 12345;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  for (let i = 0; i < 2500; i++) {
    const id = 1 + (Math.floor(rand() * (world.graph.n - 1)) % (world.graph.n - 1));
    const c = cellCentre(world.graph, id);
    const yaw = rand() * Math.PI * 2;
    cam.x = c.x - Math.sin(yaw) * 3.4 + Math.cos(yaw) * 1.1;
    cam.y = 2.25;
    cam.z = c.z - Math.cos(yaw) * 3.4 - Math.sin(yaw) * 1.1;
    pullCameraIn(world, c.x, c.z, cam);
    tested++;
    if (!lineOfSight(world, c.x, c.z, cam.x, cam.z)) blocked++;
    // props: false, to match render/camera.js. The camera rides at 2.25 m
    // and the plants top out at 1.05 m, so counting one as 'inside a wall'
    // asserts something that is false by construction.
    const solid = resolveCollision(world, cam.x, cam.z, 0.28, { props: false });
    if (Math.hypot(solid.x - cam.x, solid.z - cam.z) > 1e-6) inside++;
  }
  console.log(`  placements tested : ${tested}`);
  check('camera always sees the character', blocked === 0, `${blocked} blocked`);
  check('camera is never inside a wall', inside === 0, `${inside} inside`);
}

console.log(`\n${failures === 0 ? 'maze test passed' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
