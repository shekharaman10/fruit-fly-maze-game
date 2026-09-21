// The circular maze as geometry: walls, collision, sight lines and pictures.
//
// world/mazeGraph.js decides which corridors exist. This turns that into a
// scene, and exposes the same sensing surface the three-room plan did
// (sense / resolveCollision / lineOfSight / wallSegments) so nothing upstream
// has to know the world changed shape.
//
// Walls are line segments, not boxes. A circular maze is mostly arcs, and an
// axis-aligned box test cannot represent an arc at all -- the old collision
// would have let the character walk straight through every curved wall.

import * as THREE from '../vendor/three.module.js';
import { makeRandom } from '../brain/neuron.js';
import { ART } from '../art/index.mjs';
import { buildFurniture } from './furniture.js';
import {
  buildGraph, carve, coverageRoute, bfsPath, edgeKey, CENTRE, RING_CELLS,
} from './mazeGraph.js';
import { buildPlants, PLANT_RADIUS } from './plant.js';

export const MAZE = {
  centreR: 1.7,   // radius of the goal disc
  ringW: 2.0,     // corridor width. 1.6 left only 0.39 m of clearance either
                  // side of the body and the march ground along the walls.
  rings: RING_CELLS.length,
  height: 2.6,
  wallT: 0.09,    // half-thickness
};

MAZE.outerR = MAZE.centreR + MAZE.rings * MAZE.ringW;

// A bounding box, for anything that still wants one (camera clamp, bolt bounds).
export const ROOM = { w: MAZE.outerR * 2, d: MAZE.outerR * 2, h: MAZE.height };

const BODY_RADIUS = 0.32;
const CONTACT_MARGIN = 0.035;
const SENSE_RANGE = 2.4;

const TWO_PI = Math.PI * 2;

// Deep red carpet. The weave is generated rather than loaded: a 128 px tile
// of directional noise, tiled across the floor, which is enough to stop 300 m2
// of one flat colour reading as painted concrete. It needs a canvas, so it only
// happens in a browser -- node gets the flat colour and does not care, since
// nothing headless looks at the floor.
// Leafy green. The weave tile below takes its colour from here, so this is
// the only place the floor is set.
const CARPET = 0x7fb069;

function carpetTexture() {
  if (typeof document === 'undefined') return null;
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;

  const img = ctx.createImageData(N, N);
  const base = new THREE.Color(CARPET);
  const rnd = makeRandom(9091);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Pile: fine speckle, plus a faint ribbing every few pixels so the nap
      // has a direction the way a woven carpet does.
      const rib = 0.035 * Math.sin((x + y * 0.35) * 1.9);
      const k = 0.82 + rnd() * 0.30 + rib;
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, base.r * 255 * k);
      img.data[i + 1] = Math.min(255, base.g * 255 * k);
      img.data[i + 2] = Math.min(255, base.b * 255 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // ~0.5 m per tile across a 32 m floor.
  tex.repeat.set(MAZE.outerR * 4, MAZE.outerR * 4);
  tex.anisotropy = 8;
  return tex;
}

/** +X from sin, +Z from cos, matching the yaw convention used everywhere else. */
const polar = (radius, angle) => ({ x: radius * Math.sin(angle), z: radius * Math.cos(angle) });

export const innerR = (r) => MAZE.centreR + r * MAZE.ringW;
export const outerRadius = (r) => innerR(r) + MAZE.ringW;
const midR = (r) => innerR(r) + MAZE.ringW / 2;

/** World position of a graph node. */
export function cellCentre(graph, id) {
  const nd = graph.nodes[id];
  if (!nd || nd.r < 0) return { x: 0, z: 0 };
  const step = TWO_PI / graph.ringCells[nd.r];
  return polar(midR(nd.r), (nd.i + 0.5) * step);
}

/** Which ring a point is in: -1 for the centre disc, `rings` for outside. */
export function ringAt(x, z) {
  const d = Math.hypot(x, z);
  if (d < MAZE.centreR) return -1;
  const r = Math.floor((d - MAZE.centreR) / MAZE.ringW);
  return Math.min(r, MAZE.rings);
}

// ---------------------------------------------------------------------------
// Wall extraction
// ---------------------------------------------------------------------------

function arcSegments(radius, a0, a1, out) {
  // One segment per ~0.35 m of arc, so a corridor wall never reads as a chord.
  const span = a1 - a0;
  const steps = Math.max(2, Math.ceil(Math.abs(span) * radius / 0.35));
  let prev = polar(radius, a0);
  for (let s = 1; s <= steps; s++) {
    const p = polar(radius, a0 + (span * s) / steps);
    out.push({ x1: prev.x, z1: prev.z, x2: p.x, z2: p.z, arc: true, radius });
    prev = p;
  }
}

/**
 * Every wall in the maze, as 2D segments.
 * A wall exists wherever two adjacent cells have no carved passage between them.
 */
export function extractWalls(graph, passages, entranceCell, shellR = MAZE.outerR) {
  const segs = [];
  const arcs = [];   // kept separately: these are the ones big enough to hang art on

  // Centre disc boundary.
  {
    const n = graph.ringCells[0];
    const step = TWO_PI / n;
    for (let i = 0; i < n; i++) {
      if (passages.has(edgeKey(CENTRE, graph.nodeId(0, i)))) continue;
      const a0 = i * step;
      arcSegments(MAZE.centreR, a0, a0 + step, segs);
      arcs.push({ radius: MAZE.centreR, a0, a1: a0 + step, facing: 1 });
    }
  }

  for (let r = 0; r < graph.rings; r++) {
    const n = graph.ringCells[r];
    const step = TWO_PI / n;

    // Radial walls, between neighbours around the ring.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (n > 1 && passages.has(edgeKey(graph.nodeId(r, i), graph.nodeId(r, j)))) continue;
      const a = j * step;
      const p0 = polar(innerR(r), a);
      const p1 = polar(outerRadius(r), a);
      segs.push({ x1: p0.x, z1: p0.z, x2: p1.x, z2: p1.z, arc: false });
    }

    // Outward walls.
    if (r + 1 < graph.rings) {
      const out = graph.ringCells[r + 1];
      const split = out / n;
      const outStep = TWO_PI / out;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < split; k++) {
          const childIndex = i * split + k;
          if (passages.has(edgeKey(graph.nodeId(r, i), graph.nodeId(r + 1, childIndex)))) continue;
          const a0 = childIndex * outStep;
          arcSegments(outerRadius(r), a0, a0 + outStep, segs);
          // BOTH FACES. A wall between two rings has a corridor on each side,
          // and hanging on only one meant every second wall you walked past
          // showed the blank back of a picture hung for the ring next door --
          // measured: all 70 interior arcs carried facing 1, so half the walls
          // in view were bare by construction. Two entries, two corridors, and
          // the gallery roughly doubles to ~140 places without adding geometry.
          arcs.push({ radius: outerRadius(r), a0, a1: a0 + outStep, facing: 1 });
          arcs.push({ radius: outerRadius(r), a0, a1: a0 + outStep, facing: -1 });
        }
      }
    }
  }

  // Outer shell, with one cell left open as the entrance.
  {
    const r = graph.rings - 1;
    const n = graph.ringCells[r];
    const step = TWO_PI / n;
    for (let i = 0; i < n; i++) {
      if (i === entranceCell) continue;
      const a0 = i * step;
      arcSegments(shellR, a0, a0 + step, segs);
      // `shell: true` keeps these out of the picture hang. See hangPictures().
      arcs.push({ radius: shellR, a0, a1: a0 + step, facing: -1, shell: true });
    }
  }

  return { segs, arcs };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

// The picture list is GENERATED from whatever is in art/, by
// tools/artManifest.mjs. It used to be typed in here with the sizes alongside,
// which broke the moment a file was added or deleted: a frame cut for an image
// that never arrives, or a 404 leaving a blank canvas on a wall.
//
// Every picture hangs on the same diagonal rather than the same width or the
// same height, so a portrait and a landscape read as the same size of object.
const ART_DIAGONAL = 1.15;
const ART_CENTRE_Y = 1.45;

function frameSize(px, py) {
  const k = ART_DIAGONAL / Math.hypot(px, py);
  return { w: px * k, h: py * k };
}

function loadTexture(file, material) {
  if (typeof document === 'undefined') return false; // node runs these modules too
  const url = new URL(`../art/${file}`, import.meta.url).href;
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    material.map = tex;
    material.color.setHex(0xffffff);
    material.roughness = 0.86;
    material.needsUpdate = true;
  });
  return true;
}

/**
 * Where a plant may stand: in the closed end of a dead end, behind the
 * waypoint rather than beside it.
 *
 * A dead end is a node with one neighbour in the carved tree -- the pockets the
 * character walks into and has to back out of, which are exactly the places a
 * maze of identical corridors most needs something to tell them apart.
 *
 * TWO EARLIER PLACEMENTS DID NOT WORK, and the reason is the same both times:
 * a 2.0 m corridor has very little room to spare once a 0.32 m body and a
 * 0.09 m wall are taken out of it.
 *
 *   1. At the cell centre, the plant sat on the route's own waypoint and
 *      `tools/maze.mjs` caught it: 16 cell centres stopped being standable.
 *   2. Offset sideways toward the outer wall, the waypoint cleared but the
 *      corridor did not. The character had to squeeze past 0.40 m of gap with
 *      no path planner, and the march stalled at ring 4 having reached 23 of
 *      163 waypoints.
 *
 * So the offset is taken AWAY FROM THE ONE OPEN NEIGHBOUR. The plant ends up in
 * the dead half of the pocket, which nothing ever walks through: the character
 * arrives from the open side, touches the waypoint and leaves the same way. It
 * is in shot the whole time and never in the path.
 */
function plantSpots(graph, tree, entranceNode, seed) {
  const rand = makeRandom(seed);
  const ends = [];

  for (let id = 0; id < tree.length; id++) {
    if (id === CENTRE || id === entranceNode) continue;
    const nd = graph.nodes[id];
    if (!nd || nd.r < 0) continue;
    if (tree[id].length === 1) ends.push(id);
  }

  for (let i = ends.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    [ends[i], ends[j]] = [ends[j], ends[i]];
  }

  const spots = [];
  for (const id of ends) {
    const here = cellCentre(graph, id);
    const back = cellCentre(graph, tree[id][0]);
    let dx = here.x - back.x;
    let dz = here.z - back.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    dx /= len;
    dz /= len;

    // Scale and facing are drawn once per pocket, not per candidate: the
    // filters below test against the radius, so the candidates for one dead end
    // have to be the same plant in different places rather than different
    // plants.
    const scale = 0.85 + rand() * 0.15;
    const yaw = rand() * TWO_PI;

    // Pushed as deep into the pocket as the cell allows. 0.62 m was not far
    // enough: it cleared the waypoint but left the plant 8 cm from the lane
    // between waypoints, and the caller rejected every one of them. How much
    // room there is depends on which way the pocket faces -- a circumferential
    // dead end on an outer ring is nearly 3 m across, a radial one is 2 m --
    // so the offset is tried long first and the caller drops what does not fit.
    // Also shifted sideways, so the plant ends up in the CORNER of the pocket
    // against a wall rather than standing in the middle of it. The sideways
    // axis is perpendicular to the pocket, and the caller drops any that then
    // overlap a wall.
    // SEVERAL CANDIDATES PER POCKET, deepest and most tucked-in first, because
    // the caller filters and keeps the first that survives. One candidate per
    // pocket is what the oversampling factor was reaching for and could not
    // get: with a single position per dead end there is nothing to oversample,
    // and sixteen pockets yielded three plants.
    //
    // How much room a pocket has depends on which way it faces -- a
    // circumferential dead end on an outer ring is nearly 3 m across, a radial
    // one is 2 m -- so the depths are tried long first and the short ones are
    // there for the pockets that cannot take a long one.
    const sx = -dz;
    const sz = dx;
    for (const depth of [1.00, 0.86, 0.72, 0.58]) {
      for (const [lateral, sides] of [[0.34, [1, -1]], [0.18, [1, -1]], [0, [1]]]) {
        for (const side of sides) {
          spots.push({
            cell: id,
            x: here.x + dx * depth + sx * side * lateral,
            z: here.z + dz * depth + sz * side * lateral,
            yaw,
            scale,
          });
        }
      }
    }
  }
  return spots;
}

/**
 * Hang pictures on the arc walls. Arcs are used rather than radial walls
 * because a radial wall is only one corridor wide and a picture on it would be
 * seen edge-on from almost everywhere.
 */
// Bare wall left at each end of an arc, and between neighbours on the same
// arc. Frames butted together read as one long strip rather than as pictures.
const ART_END_MARGIN = 0.35;
const ART_GAP = 0.45;

function hangPictures(group, arcs, seed) {
  const rand = makeRandom(seed);

  // NOT THE OUTER SHELL. Its arcs carry facing: -1, and the offset below reads
  // that as "hang on the far side", which for the shell is the side with no
  // maze on it: measured, a shell picture landed at radius 15.802 against a
  // shell at 15.700 -- on the outward face, pointing at nothing. Flipping the
  // sign would put them on the inner face and they would be visible from the
  // outermost corridor, but a picture on the boundary wall is the one the
  // character walks past with its back to the rest of the maze, so they are
  // dropped rather than moved.
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)) % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const walls = shuffle(arcs.filter((a) => !a.shell));

  // MORE THAN ONE PER ARC. One picture per arc capped the gallery at the number
  // of interior walls, which the art folder overtook: at 77 files against 70
  // arcs, seven were dropped -- and not at random. The manifest is alphabetical
  // and the old loop walked it in order against the shuffled arcs, so the last
  // seven names were excluded on every single load. `wolverine.jpg` could never
  // appear.
  //
  // Arcs run 1.34 to 3.81 m and the widest frame is about 1.0 m, so most arcs
  // have room for two and the longest for three. Filling them takes capacity
  // from 70 to roughly 114 without touching the shell, the radial walls, or the
  // size of the maze.
  const queue = shuffle(ART.slice());
  const hung = [];

  for (const a of walls) {
    if (!queue.length) break;

    const usable = (a.a1 - a.a0) * a.radius - 2 * ART_END_MARGIN;
    if (usable <= 0) continue;

    // Greedy, but scanning the whole queue rather than only its head: a wide
    // picture at the front would otherwise block a narrow one that fits, and
    // stall the arc with room to spare.
    const take = [];
    let used = 0;
    for (let i = 0; i < queue.length; i++) {
      const [, px, py] = queue[i];
      const { w, h } = frameSize(px, py);
      const need = used + (take.length ? ART_GAP : 0) + w;
      if (need > usable) continue;
      used = need;
      take.push({ art: queue[i], w, h });
      queue.splice(i, 1);
      i--;
    }
    if (!take.length) continue;

    const mid = (a.a0 + a.a1) / 2;
    // Pushed just off the wall, on the side the corridor is on.
    const rr = a.radius - a.facing * (MAZE.wallT + 0.012);

    // Laid out centred on the arc, measured in metres along it and converted
    // to an angle by the radius. Doing it in metres is what keeps the gaps even
    // on an inner ring and an outer one alike.
    let cursor = -used / 2;
    for (const t of take) {
      const [file] = t.art;
      const along = cursor + t.w / 2;
      cursor += t.w + ART_GAP;

      const ang = mid + along / a.radius;
      const p = polar(rr, ang);

      const holder = new THREE.Group();
      holder.position.set(p.x, ART_CENTRE_Y, p.z);
      // Face out of the wall: the wall normal is radial.
      holder.rotation.y = ang + (a.facing > 0 ? Math.PI : 0);
      group.add(holder);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(t.w + 0.05, t.h + 0.05, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.6 }),
      );
      frame.castShadow = true;
      holder.add(frame);

      const mat = new THREE.MeshStandardMaterial({ color: 0xb9b9b4, roughness: 0.9 });
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(t.w, t.h), mat);
      canvas.position.z = 0.017;
      holder.add(canvas);
      loadTexture(file, mat);

      // Position and facing are kept so main.js can make the character stop and
      // actually look at each one. `viewFrom` is a standing spot out in the
      // corridor, in front of the picture rather than inside the wall it hangs
      // on.
      hung.push({
        file, w: t.w, h: t.h, facing: a.facing,
        x: p.x, z: p.z, yaw: holder.rotation.y,
        viewFrom: {
          x: p.x - a.facing * Math.sin(ang) * 1.05,
          z: p.z - a.facing * Math.cos(ang) * 1.05,
        },
      });
    }
  }

  // Whatever is left over found no wall. Returned rather than swallowed, so
  // tools/maze.mjs can fail on it instead of the folder quietly outgrowing the
  // maze again.
  return { hung, unhung: queue.map(([file]) => file) };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {number[]} [opts.ringCells] Override the ring layout, e.g. to build a
 *   smaller arena for a test.
 * @param {boolean} [opts.open] Carve every corridor, leaving an open circular
 *   arena inside the outer shell. Used by tools/duel.mjs: that benchmark
 *   measures the escape reflex against the fire control, and in a real maze the
 *   flies are almost never in line of sight -- occlusion noise swamps the
 *   effect being measured. A controlled measurement needs a controlled space.
 */
export function buildMaze(opts = {}) {
  const seed = opts.seed ?? 20260917;
  const ringCells = opts.ringCells || RING_CELLS;
  const graph = buildGraph(ringCells);
  const carved = carve(graph, seed);
  const tree = carved.tree;
  const passages = opts.open
    ? new Set(graph.edges.map((e) => edgeKey(e.a, e.b)))
    : carved.passages;

  const outerCells = graph.ringCells[graph.rings - 1];
  const entranceCell = opts.entranceCell ?? 0;
  const entranceNode = graph.nodeId(graph.rings - 1, entranceCell);

  const { segs, arcs } = extractWalls(
    graph, passages, entranceCell, MAZE.centreR + ringCells.length * MAZE.ringW,
  );

  const route = coverageRoute(tree, entranceNode, CENTRE);
  const shortest = bfsPath(tree, entranceNode, CENTRE);

  const group = new THREE.Group();

  // Carpet, not a floor slab: rough, unlit-flat, and dark enough that the
  // white walls and the pictures both read against it.
  const mFloor = new THREE.MeshStandardMaterial({
    color: CARPET, roughness: 0.99, metalness: 0.0,
  });
  const carpet = carpetTexture();
  if (carpet) {
    mFloor.map = carpet;
    mFloor.color.setHex(0xffffff);   // the tile already carries the colour
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(MAZE.outerR + 0.6, 96), mFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // The goal disc, marked so it is obvious from a distance.
  const goal = new THREE.Mesh(
    new THREE.CircleGeometry(MAZE.centreR - 0.15, 48),
    new THREE.MeshStandardMaterial({
      color: 0x2f7d46, emissive: 0x1d5c31, emissiveIntensity: 0.55, roughness: 0.7,
    }),
  );
  goal.rotation.x = -Math.PI / 2;
  goal.position.y = 0.012;
  group.add(goal);

  // Walls. One InstancedMesh for the run and one for the skirting, rather than
  // a Mesh per segment: an arc is cut into ~0.35 m pieces, so the full maze is
  // roughly 900 segments and a mesh each would be ~1800 draw calls every frame,
  // doubled again by the shadow pass. Two instanced draws do the same work.
  const mWall = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.94 });
  // Dark, and deliberately so. At 0xdededa the skirting was near-white on a
  // near-white wall and separated nothing; against red carpet the join needs a
  // line, and the only way a baseboard draws one is by being darker than both
  // the things it sits between.
  const mSkirt = new THREE.MeshStandardMaterial({ color: 0x2f2a2c, roughness: 0.82 });

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const wallMesh = new THREE.InstancedMesh(unit, mWall, segs.length);
  const skirtMesh = new THREE.InstancedMesh(unit, mSkirt, segs.length);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  skirtMesh.receiveShadow = true;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  let placed = 0;
  for (const sg of segs) {
    const dx = sg.x2 - sg.x1;
    const dz = sg.z2 - sg.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;

    // Slight overlap along the run, so a segmented arc has no visible gaps.
    q.setFromAxisAngle(up, Math.atan2(dx, dz));
    pos.set((sg.x1 + sg.x2) / 2, MAZE.height / 2, (sg.z1 + sg.z2) / 2);
    scl.set(MAZE.wallT * 2, MAZE.height, len + MAZE.wallT * 2);
    wallMesh.setMatrixAt(placed, m4.compose(pos, q, scl));

    pos.y = 0.055;
    scl.set(MAZE.wallT * 2.3, 0.11, len + MAZE.wallT * 2);
    skirtMesh.setMatrixAt(placed, m4.compose(pos, q, scl));
    placed++;
  }
  wallMesh.count = placed;
  skirtMesh.count = placed;
  wallMesh.instanceMatrix.needsUpdate = true;
  skirtMesh.instanceMatrix.needsUpdate = true;
  group.add(wallMesh);
  group.add(skirtMesh);

  // Table and chair in the middle, turned by the seed so the chair is not
  // always on the same side. DECORATION ONLY -- not in segs, so not in
  // collision and not in sight lines. Making them solid would put an obstacle
  // on the one waypoint the route has to finish on.
  const furniture = buildFurniture({ angle: (seed % 360) * (Math.PI / 180) });
  group.add(furniture.group);

  const art = hangPictures(group, arcs, seed + 11);
  const pictures = art.hung;

  // Decor, and the only thing in the maze that is not a wall, a picture or a
  // light. Instanced across every plant at once -- see world/plant.js.
  // Plants must clear the LANE, not just the waypoints.
  //
  // The previous check asked only whether a plant sat on a route waypoint, and
  // none did -- yet the march still jammed at ring 4. The plant that stopped it
  // was 0.62 m from waypoint 41, which clears the waypoint, but it stood beside
  // the straight line from 41 to 42 and left 8 cm of lane. The character steers
  // at the waypoint and has no path planner, so 8 cm is a wall.
  //
  // So the test is against the route SEGMENTS, which are the lanes actually
  // walked, with a margin for steering slop.
  const LANE_CLEAR = BODY_RADIUS + PLANT_RADIUS + 0.16;
  const routePts = route.map((id) => cellCentre(graph, id));
  const clearsWalls = (sp) => {
    const r = PLANT_RADIUS * (sp.scale || 1);
    for (const sg of segs) {
      if (closestOnSeg(sg, sp.x, sp.z).dist < r + MAZE.wallT + 0.04) return false;
    }
    return true;
  };

  const clearsRoute = (sp) => {
    const r = PLANT_RADIUS * (sp.scale || 1);
    const need = BODY_RADIUS + r + 0.16;
    for (let i = 0; i < routePts.length - 1; i++) {
      const a = routePts[i];
      const b = routePts[i + 1];
      const d = closestOnSeg({ x1: a.x, z1: a.z, x2: b.x, z2: b.z }, sp.x, sp.z).dist;
      if (d < need) return false;
    }
    return true;
  };

  // First surviving candidate per pocket, up to the limit. Taking the first
  // rather than the best is deliberate: plantSpots() already orders them
  // deepest-and-most-tucked first, so the first that clears both tests is the
  // most out of the way one that fits.
  // No plants in the open arena. `open: true` exists because a benchmark needs
  // a controlled space -- tools/duel.mjs says so above -- and a plant is a
  // physical obstacle in the middle of it. With them in, the character in
  // tools/smoke.mjs went from 175 melee frames and a cut to zero of both: it
  // could still shoot, but it could no longer close. Decor that changes what a
  // measurement measures is not decor.
  const wanted = opts.plants ?? (opts.open ? 0 : 16);
  const used = new Set();
  const spots = [];
  for (const sp of plantSpots(graph, tree, entranceNode, seed + 23)) {
    if (spots.length >= wanted) break;
    if (used.has(sp.cell)) continue;
    if (!clearsWalls(sp) || !clearsRoute(sp)) continue;
    used.add(sp.cell);
    spots.push(sp);
  }
  const plants = buildPlants(spots, seed + 37);
  group.add(plants.group);

  // Compass landmark: high above the centre, so the ER pathway has something to
  // anchor to from anywhere in the maze. Walls are floor to ceiling, so a
  // landmark at eye level would be invisible from most of the plan.
  const landmark = new THREE.Group();
  landmark.position.set(0, MAZE.height + 1.6, 0);
  group.add(landmark);
  landmark.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xfff3dd, emissive: 0xffd98a, emissiveIntensity: 2.2, roughness: 0.4,
    }),
  ));
  const landmarkLight = new THREE.PointLight(0xffe9c4, 34, 40, 2);
  landmarkLight.position.copy(landmark.position);
  group.add(landmarkLight);

  // Invisible carrier, so sense() can report a bearing to whatever is being
  // chased -- same trick the three-room plan used.
  const target = new THREE.Group();
  target.visible = false;
  target.position.set(0, -50, 0);
  group.add(target);

  const rings = ringCells.length;
  const shellR = MAZE.centreR + rings * MAZE.ringW;
  const entrance = cellCentre(graph, entranceNode);
  const step = TWO_PI / outerCells;
  const entranceAngle = (entranceCell + 0.5) * step;
  const outside = polar(shellR + 0.9, entranceAngle);

  const world = {
    group, graph, passages, tree, segs, arcs, pictures, ringCells, shellR,
    // Files that found no wall. Should be empty; see tools/maze.mjs.
    unhungPictures: art.unhung,
    // Round obstacles, unlike the walls. They block walking and they show up on
    // the proximity probes, but NOT on lineOfSight: a plant is 1.05 m and the
    // flies hover above it, so occluding on one in 2D would be a lie in the
    // other direction.
    props: plants.props,
    plants: plants.count,
    route,
    routePoints: route.map((id) => cellCentre(graph, id)),
    shortest,
    // The BFS path as waypoints, for the mode that ignores the cover-every-
    // corridor rule and just goes to the middle.
    shortestPoints: shortest.map((id) => cellCentre(graph, id)),
    entranceNode,
    entranceAngle,
    start: { x: entrance.x, z: entrance.z },
    outside,
    centre: { x: 0, z: 0 },
    landmark, landmarkLight, target, furniture,
    obstacles: [], // nothing is an AABB any more; kept so old callers do not crash
  };
  // Broad phase, built once the segment list is final.
  world.grid = buildGrid(segs);
  return world;
}

// ---------------------------------------------------------------------------
// Broad phase
// ---------------------------------------------------------------------------
//
// The maze is about 880 wall segments. Testing every one for every query was
// fine with one character and three flies. At eighty flies it is not: collision
// alone would be 80 x 880 x 2 passes x 120 steps a second, which is seventeen
// million distance tests a second before anything is drawn.
//
// A uniform grid fixes it. Each segment is filed into every cell its bounding
// box touches, and a query only looks at the cells it overlaps. The walls are
// spread evenly through a maze, so a 2 m cell holds a handful and a collision
// query touches four cells instead of the whole plan.

const GRID_CELL = 2.0;

function buildGrid(segs) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minZ = Math.min(minZ, s.z1, s.z2);
    maxZ = Math.max(maxZ, s.z1, s.z2);
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / GRID_CELL) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / GRID_CELL) + 1);
  const buckets = new Array(cols * rows);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    s._id = i;
    const c0 = Math.floor((Math.min(s.x1, s.x2) - minX) / GRID_CELL);
    const c1 = Math.floor((Math.max(s.x1, s.x2) - minX) / GRID_CELL);
    const r0 = Math.floor((Math.min(s.z1, s.z2) - minZ) / GRID_CELL);
    const r1 = Math.floor((Math.max(s.z1, s.z2) - minZ) / GRID_CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        buckets[r * cols + c].push(s);
      }
    }
  }

  // A stamp per segment stops a wall being returned twice when a query spans
  // several cells, without allocating a Set on every call.
  return {
    minX, minZ, cols, rows, buckets,
    stamp: new Int32Array(segs.length), tick: 0,
  };
}

/** Segments whose cells overlap the box, written into `out`. Returns the count. */
function segsInBox(world, ax, az, bx, bz, out) {
  const g = world.grid;
  if (!g) {
    for (let i = 0; i < world.segs.length; i++) out[i] = world.segs[i];
    return world.segs.length;
  }
  const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - g.minX) / GRID_CELL));
  const c1 = Math.min(g.cols - 1, Math.floor((Math.max(ax, bx) - g.minX) / GRID_CELL));
  const r0 = Math.max(0, Math.floor((Math.min(az, bz) - g.minZ) / GRID_CELL));
  const r1 = Math.min(g.rows - 1, Math.floor((Math.max(az, bz) - g.minZ) / GRID_CELL));

  g.tick++;
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = g.buckets[r * g.cols + c];
      for (let i = 0; i < bucket.length; i++) {
        const s = bucket[i];
        if (g.stamp[s._id] === g.tick) continue;
        g.stamp[s._id] = g.tick;
        out[n++] = s;
      }
    }
  }

  // Sorted back into segment order. resolveCollision is an iterative solver --
  // each wall pushes the point, and the result depends on the order the walls
  // are visited. Bucket order is not segment order, so without this the grid
  // would be a behaviour change rather than an optimisation: measured, it moved
  // 5% of resolutions and that was enough to change which flies a 150 s run
  // ended up in melee with. Insertion sort, because n is single digits.
  for (let i = 1; i < n; i++) {
    const v = out[i];
    let j = i - 1;
    while (j >= 0 && out[j]._id > v._id) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = v;
  }
  return n;
}

// Scratch, reused so the hot paths allocate nothing.
const _near = [];

// ---------------------------------------------------------------------------
// Sensing, collision, sight
// ---------------------------------------------------------------------------

/** Closest point on segment s to (px,pz), and the distance to it. */
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

/** Push a circle out of any wall it overlaps. */
/**
 * @param {object} [opts]
 * @param {boolean} [opts.props] Pass false to ignore the plants. Anything not
 *   at body height should: the camera flies at 2.25 m and the flies hover
 *   above 1.05 m of foliage, and a 2D push-out cannot tell that on its own.
 *   Getting this wrong parked the camera outside every dead end that had a
 *   plant in it.
 */
export function resolveCollision(world, x, z, radius = BODY_RADIUS, opts = {}) {
  const useProps = opts.props !== false;
  const clearance = radius + MAZE.wallT;
  // Two passes: one is not enough in a corner between an arc and a radial wall.
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;

    for (const pr of (useProps ? world.props : null) || []) {
      const dx = x - pr.x;
      const dz = z - pr.z;
      const need = radius + pr.radius;
      const d = Math.hypot(dx, dz);
      if (d >= need) continue;
      if (d < 1e-6) { x += 0.01; moved = true; continue; }
      const push = (need - d) / d;
      x += dx * push;
      z += dz * push;
      moved = true;
    }

    // The candidate set is gathered once per pass, but x and z MOVE inside the
    // pass as each wall pushes them, so a wall that only becomes relevant after
    // a push would be missed. Widening the query by three clearances covers the
    // furthest a point can travel in one pass; at 1.9% of positions the narrow
    // box gave a different answer from testing every segment.
    const reach = clearance * 3;
    const n = segsInBox(world, x - reach, z - reach, x + reach, z + reach, _near);
    for (let k = 0; k < n; k++) {
      const s = _near[k];
      const { cx, cz, dist } = closestOnSeg(s, x, z);
      if (dist >= clearance) continue;
      if (dist < 1e-6) {
        x += (x - cx) || 0.01;
        z += (z - cz) || 0.01;
        moved = true;
        continue;
      }
      const push = (clearance - dist) / dist;
      x += (x - cx) * push;
      z += (z - cz) * push;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** True when the body circle is touching a wall. */
function touching(world, x, z, radius = BODY_RADIUS) {
  const clearance = radius + MAZE.wallT + CONTACT_MARGIN;
  const n = segsInBox(world, x - clearance, z - clearance, x + clearance, z + clearance, _near);
  for (let k = 0; k < n; k++) {
    if (closestOnSeg(_near[k], x, z).dist < clearance) return true;
  }
  for (const pr of world.props || []) {
    if (Math.hypot(x - pr.x, z - pr.z) < radius + pr.radius + CONTACT_MARGIN) return true;
  }
  return false;
}

function segmentsCross(ax, az, bx, bz, s) {
  const r1 = bx - ax;
  const r2 = bz - az;
  const s1 = s.x2 - s.x1;
  const s2 = s.z2 - s.z1;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((s.x1 - ax) * s2 - (s.z1 - az) * s1) / den;
  const u = ((s.x1 - ax) * r2 - (s.z1 - az) * r1) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/** Clear line between two points, i.e. no wall in the way. */
/**
 * Distance from a point to the nearest wall FACE. Negative inside a wall.
 *
 * Collision only ever answers "is this position legal for a circle of radius r",
 * which says nothing about the geometry hanging off the thing standing there. A
 * katana on a 0.86 m arc is swung by a body that only has to keep 0.32 m clear,
 * so the weapons need to know how much room there actually is.
 */
export function roomAround(world, x, z) {
  const half = MAZE.wallT / 2;
  // Two metres covers the widest corridor, so the grid query is a small set.
  const n = segsInBox(world, x - 2, z - 2, x + 2, z + 2, _near);
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const d = closestOnSeg(_near[k], x, z).dist;
    if (d < best) best = d;
  }
  return best - half;
}

export function lineOfSight(world, ax, az, bx, bz) {
  const n = segsInBox(world, ax, az, bx, bz, _near);
  for (let k = 0; k < n; k++) {
    if (segmentsCross(ax, az, bx, bz, _near[k])) return false;
  }
  return true;
}

/**
 * Distance along a ray to the nearest wall or plant, capped at `max`.
 *
 * Plants are in here although they are not in lineOfSight. They are solid at
 * body height, so walking into one is a collision the avoidance pathway should
 * see coming; they are not solid at fly height, so they cannot hide a target.
 */
function rayDistance(world, ox, oz, dx, dz, max) {
  const bx = ox + dx * max;
  const bz = oz + dz * max;
  let best = max;

  for (const pr of world.props || []) {
    // Ray against circle, nearest forward hit only.
    const mx = ox - pr.x;
    const mz = oz - pr.z;
    const b = mx * dx + mz * dz;
    const c = mx * mx + mz * mz - pr.radius * pr.radius;
    if (c > 0 && b > 0) continue;               // pointing away from it
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < best) best = t;
  }

  const count = segsInBox(world, ox, oz, bx, bz, _near);
  for (let k = 0; k < count; k++) {
    const s = _near[k];
    const r1 = bx - ox;
    const r2 = bz - oz;
    const s1 = s.x2 - s.x1;
    const s2 = s.z2 - s.z1;
    const den = r1 * s2 - r2 * s1;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((s.x1 - ox) * s2 - (s.z1 - oz) * s1) / den;
    const u = ((s.x1 - ox) * r2 - (s.z1 - oz) * r1) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) best = Math.min(best, t * max);
  }
  return best;
}

/**
 * Everything the brain is given each frame. Same shape the three-room plan
 * returned, so brain/index.js needs no changes.
 */
export function sense(world, pose, nav) {
  const { x, z, yaw } = pose;
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);

  const probe = (angle) => {
    const a = yaw + angle;
    const d = rayDistance(world, x, z, Math.sin(a), Math.cos(a), SENSE_RANGE);
    return Math.max(0, 1 - d / SENSE_RANGE);
  };
  const centreProbe = probe(0);
  const proxL = Math.max(probe(0.56), centreProbe * 0.85);
  const proxR = Math.max(probe(-0.56), centreProbe * 0.85);

  const tp = world.target.position;
  const tdx = tp.x - x;
  const tdz = tp.z - z;
  const targetDistance = Math.hypot(tdx, tdz);
  const targetBearing = Math.atan2(
    tdx * fwdZ - tdz * fwdX,
    tdx * fwdX + tdz * fwdZ,
  );

  return {
    trueHeading: yaw,
    proxL,
    proxR,
    contact: touching(world, x, z) ? 1 : 0,
    // The beacon sits above the maze, so it is never occluded; strength still
    // falls off with distance.
    landmarkStrength: Math.max(0.3, 1 - Math.hypot(x, z) / (MAZE.outerR * 1.6)),
    targetBearing,
    targetDistance,
    targetVisible: nav.targetVisible !== false,
    wanderBearing: nav.bearing || 0,
  };
}

/** Wall segments for the radar, as flat [x1,z1,x2,z2] tuples. */
export function wallSegments(world) {
  return world.segs.map((s) => [s.x1, s.z1, s.x2, s.z2]);
}

export { BODY_RADIUS, SENSE_RANGE, CENTRE };
