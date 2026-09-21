// The table and chair that stand in the centre of the maze.
//
// Dimensions are the ones on the reference sheet, in metres:
//
//   table   800 mm top, 750 mm high, 500 mm pedestal foot
//   chair   500 mm wide, 500 mm deep, 820 mm to the top of the back,
//           450 mm seat
//
// Built from primitives rather than loaded as FBX/OBJ, because this project
// ships no model loader and no binary assets -- everything in the scene is
// generated. The silhouette is what the reference carries, and that is what is
// reproduced: a round top on a slim column with a disc foot, and a chair with a
// rounded back and four square legs.

import * as THREE from '../vendor/three.module.js';

export const TABLE = { top: 0.80, height: 0.75, foot: 0.50 };
export const CHAIR = { width: 0.50, depth: 0.50, back: 0.82, seat: 0.45 };

const WHITE = 0xf2f2ef;
const WHITE_SHADE = 0xe3e3df;

function mat(color, rough = 0.62) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.03 });
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Round pedestal table, 800 mm across and 750 mm high. */
export function buildTable() {
  const g = new THREE.Group();
  g.name = 'table';
  const white = mat(WHITE);
  const shade = mat(WHITE_SHADE, 0.7);

  // Top, with a thin rounded edge so it does not read as a cardboard disc.
  g.add(mesh(new THREE.CylinderGeometry(TABLE.top / 2, TABLE.top / 2, 0.035, 48),
    white, 0, TABLE.height - 0.018, 0));
  // Group.add returns the GROUP, not the mesh, so the rim is built and rotated
  // before it is added -- chaining the rotation onto add() spins the table.
  const rim = mesh(new THREE.TorusGeometry(TABLE.top / 2 - 0.004, 0.018, 8, 48),
    white, 0, TABLE.height - 0.030, 0);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  // Column, slightly waisted like the reference.
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.075, TABLE.height - 0.10, 24),
    white, 0, (TABLE.height - 0.10) / 2 + 0.04, 0));

  // Foot: a shallow dome on a disc.
  g.add(mesh(new THREE.CylinderGeometry(TABLE.foot / 2, TABLE.foot / 2, 0.022, 40),
    shade, 0, 0.011, 0));
  const dome = mesh(new THREE.SphereGeometry(TABLE.foot / 2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    white, 0, 0.018, 0);
  dome.scale.set(1, 0.34, 1);
  g.add(dome);

  return g;
}

/**
 * Chair, 820 mm to the top of the back, seat at 450 mm.
 * Built facing +Z, so the sitter faces +Z when seated.
 */
export function buildChair() {
  const g = new THREE.Group();
  g.name = 'chair';
  const white = mat(WHITE);
  const shade = mat(WHITE_SHADE, 0.7);

  const w = CHAIR.width;
  const d = CHAIR.depth;
  const seatY = CHAIR.seat;

  // Seat pan, chamfered at the front.
  g.add(mesh(new THREE.BoxGeometry(w, 0.035, d), white, 0, seatY, 0));
  g.add(mesh(new THREE.BoxGeometry(w, 0.030, 0.05), shade, 0, seatY - 0.018, d / 2 - 0.02));

  // Legs. Square section, tapering very slightly, set in from the corners.
  const legGeo = new THREE.CylinderGeometry(0.019, 0.015, seatY, 8);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(legGeo, white, sx * (w / 2 - 0.035), seatY / 2, sz * (d / 2 - 0.035)));
    }
  }

  // Back: two uprights carrying a rounded panel, leaning back a little.
  const back = new THREE.Group();
  back.position.set(0, seatY, -d / 2 + 0.03);
  back.rotation.x = 0.13;
  g.add(back);

  const upH = CHAIR.back - seatY;
  for (const sx of [-1, 1]) {
    back.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, upH, 8),
      white, sx * (w / 2 - 0.035), upH / 2, 0));
  }

  // The panel, curved by bending a box into a shallow arc of segments.
  const panelH = 0.24;
  const panelY = upH - panelH / 2 - 0.02;
  const SEG = 7;
  const span = w - 0.04;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG - 0.5;
    const x = t * span;
    // Shallow arc: the middle sits 3 cm further back than the edges.
    const z = -0.03 * (1 - (t * 2) ** 2);
    const seg = mesh(new THREE.BoxGeometry(span / SEG + 0.004, panelH, 0.022),
      white, x, panelY, z);
    seg.rotation.y = -t * 0.5;
    back.add(seg);
  }

  return g;
}

/**
 * Table and chair as one group, plus where a sitter goes.
 *
 * `seat` is the point the pelvis ends up over, and `facing` is the yaw that
 * puts the sitter looking across the table. The chair is offset from the table
 * rather than tucked under it, so the figure is not clipping through the top.
 */
export function buildFurniture(opts = {}) {
  const g = new THREE.Group();
  const angle = opts.angle ?? 0;

  const table = buildTable();
  g.add(table);

  const chair = buildChair();
  // Placed on the far side and turned to face the table.
  const reach = TABLE.top / 2 + CHAIR.depth / 2 + 0.13;
  const cx = Math.sin(angle) * reach;
  const cz = Math.cos(angle) * reach;
  chair.position.set(cx, 0, cz);
  chair.rotation.y = angle + Math.PI; // +Z of the chair points back at the table
  g.add(chair);

  return {
    group: g,
    table,
    chair,
    // Pelvis sits a little above the pan and a little back from its centre.
    seat: {
      x: cx - Math.sin(angle) * 0.04,
      y: CHAIR.seat + 0.055,
      z: cz - Math.cos(angle) * 0.04,
    },
    facing: angle + Math.PI,
    radius: reach + CHAIR.depth / 2,
  };
}
