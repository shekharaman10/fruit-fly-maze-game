// Live readout of the circuit, drawn on a 2D canvas over the scene.
//
// Three panels: the compass ring as it actually is (16 EPG wedges, not a needle),
// the descending-neuron bars, and a scrolling gait raster so the tripod pattern
// is visible as a pattern rather than as a claim.

const COL = {
  bg: '#0e0e12',
  grid: '#24242c',
  dim: '#5c5c62',
  text: '#9a9aa2',
  bright: '#d8d8de',
  epg: '#4f9e57',
  goal: '#e0b341',
  heading: '#e05a45',
  truth: '#4a7fd0',
  left: '#5aa6d8',
  right: '#d88a5a',
  drive: '#4f9e57',
  reverse: '#b4402a',
  courtship: '#d05a8f',
  swing: '#4f9e57',
  stance: '#2c3a30',
};

const RASTER_LEN = 190;
const RADAR_RANGE = 14;  // m from the centre to the rim: covers the whole maze

/**
 * Circular radar, player-centred and heading-up.
 *
 * It draws WHAT THE BRAIN KNOWS, not what is there. A fly in the frontal field
 * with clear line of sight is a solid blip; one the tracker is coasting on from
 * memory is a hollow ring; a fly the character has never seen or has entirely
 * forgotten is not drawn at all. That makes occlusion legible -- walk behind a
 * partition and watch a contact go hollow and then vanish -- and it keeps the
 * display honest about the difference between the world and the estimate.
 */
export class Radar {
  constructor(canvas, walls) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.walls = walls;
    this.size = 272;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {object} s
   * @param {number} s.x, s.z, s.yaw  the character
   * @param {Array} s.contacts [{ x, z, seen, targeted }]
   * @param {Array} s.heard    egocentric bearings, coarse channel, no range
   * @param {?object} s.estimate { x, z, confidence } tracker position
   * @param {string} s.room
   */
  draw(s) {
    const c = this.ctx;
    const R = this.size / 2 - 6;
    const cx = this.size / 2;
    const cy = this.size / 2;
    const k = R / RADAR_RANGE;

    c.clearRect(0, 0, this.size, this.size);
    c.fillStyle = COL.bg;
    c.fillRect(0, 0, this.size, this.size);

    // Heading-up: rotate world deltas by -yaw so forward maps to screen up.
    const cs = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const to = (wx, wz) => {
      const dx = wx - s.x;
      const dz = wz - s.z;
      return [cx + (dx * cs - dz * sn) * k, cy - (dx * sn + dz * cs) * k];
    };

    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.clip();

    // Range rings.
    c.strokeStyle = COL.grid;
    c.lineWidth = 1;
    for (let r = 2.5; r <= RADAR_RANGE; r += 2.5) {
      c.beginPath();
      c.arc(cx, cy, r * k, 0, Math.PI * 2);
      c.stroke();
    }

    // Walls, with the openings genuinely open.
    c.strokeStyle = '#3a3a44';
    c.lineWidth = 2;
    c.beginPath();
    for (const [x1, z1, x2, z2] of this.walls) {
      const a = to(x1, z1);
      const b = to(x2, z2);
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
    }
    c.stroke();

    // Field of view the observations come from: +/-75 deg, 11 m.
    c.fillStyle = 'rgba(79,158,87,.08)';
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, 11 * k, -Math.PI / 2 - 1.31, -Math.PI / 2 + 1.31);
    c.closePath();
    c.fill();

    // Remembered estimate, if the tracker is coasting.
    if (s.estimate && s.estimate.confidence > 0.02) {
      const p = to(s.estimate.x, s.estimate.z);
      c.strokeStyle = COL.goal;
      c.globalAlpha = 0.35 + 0.5 * s.estimate.confidence;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(p[0], p[1], 6, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }

    // Heard but not seen. Bearing only, so it is drawn at the rim as a wedge
    // rather than as a point somewhere in the room -- there is no range to
    // place it at, and drawing one would invent information.
    for (const b of (s.heard || [])) {
      const a = -Math.PI / 2 + b; // radar is heading-up, so bearing 0 is up
      c.strokeStyle = COL.reverse;
      c.globalAlpha = 0.85;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, R - 5, a - 0.12, a + 0.12);
      c.stroke();
      c.globalAlpha = 1;
    }

    // Contacts.
    for (const t of s.contacts) {
      const p = to(t.x, t.z);
      if (t.targeted) {
        c.strokeStyle = COL.heading;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(p[0], p[1], 9, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = t.seen ? COL.epg : COL.dim;
      c.beginPath();
      c.arc(p[0], p[1], 4, 0, Math.PI * 2);
      c.fill();
    }

    // The character, at the centre, facing up.
    c.fillStyle = COL.bright;
    c.beginPath();
    c.moveTo(cx, cy - 7);
    c.lineTo(cx - 5, cy + 5);
    c.lineTo(cx + 5, cy + 5);
    c.closePath();
    c.fill();

    c.restore();

    c.strokeStyle = COL.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();

    c.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = COL.dim;
    c.fillText(`${RADAR_RANGE} m`, 8, 14);
    c.fillText(s.room || '-', 8, this.size - 8);
    c.textAlign = 'right';
    const heard = (s.heard || []).length;
    c.fillText(`${s.contacts.filter((t) => t.seen).length} seen`
      + (heard ? `  ${heard} heard` : ''), this.size - 8, 14);
    c.fillText('heading up', this.size - 8, this.size - 8);
    c.textAlign = 'left';
  }
}

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 286;
    this.h = 604;
    this.raster = []; // newest last
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {object} s FlyBrain.state() for the character
   * @param {number} trueHeading
   * @param {object} [extra] { zoro: ZoroBrain.state(), fly: FlyFlightBrain.state() }
   */
  draw(s, trueHeading, extra) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = COL.bg;
    c.fillRect(0, 0, this.w, this.h);

    this._compass(c, s, trueHeading, 143, 104, 78);
    this._bars(c, s, 14, 214);
    this._pushRaster(s);
    this._gait(c, 14, 344);
    if (extra) this._agents(c, extra, 14, 452);
  }

  // --- the two brains, side by side -----------------------------------------
  _agents(c, extra, x, y) {
    const { zoro, fly } = extra;
    const w = this.w - x * 2;

    c.strokeStyle = COL.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y - 16);
    c.lineTo(x + w, y - 16);
    c.stroke();

    this._label(c, 'CHARACTER - 1e6x BUDGET (8 MODULES RUN)', x, y - 4);

    // Weapon and target, top right of the block.
    if (extra.flies) {
      c.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
      c.fillStyle = zoro.weapon === 'sword' ? COL.heading : COL.dim;
      c.fillText(zoro.weapon.toUpperCase(), x + w - 78, y - 4);
      c.fillStyle = COL.dim;
      c.fillText(`fly ${extra.flies.alive}/${extra.flies.total}`, x + w - 34, y - 4);
    }
    c.font = '10px ui-monospace, Menlo, Consolas, monospace';

    const meter = (label, val, max, color, yy) => {
      c.fillStyle = COL.dim;
      c.fillText(label, x, yy + 7);
      c.fillStyle = '#17171d';
      c.fillRect(x + 66, yy, w - 108, 8);
      c.fillStyle = color;
      c.fillRect(x + 66, yy, (w - 108) * Math.max(0, Math.min(val / max, 1)), 8);
      c.fillStyle = COL.text;
      c.fillText(val.toFixed(2), x + w - 38, yy + 7);
    };

    meter('track', zoro.confidence, 1, COL.truth, y + 6);

    // Aim error, shown against the tolerance that actually gates firing.
    const tol = 0.045;
    const errNorm = Math.min(zoro.aimError / (tol * 6), 1);
    c.fillStyle = COL.dim;
    c.fillText('aim err', x, y + 27);
    c.fillStyle = '#17171d';
    c.fillRect(x + 66, y + 20, w - 108, 8);
    c.fillStyle = zoro.aimError < tol ? COL.epg : COL.goal;
    c.fillRect(x + 66, y + 20, (w - 108) * (1 - errNorm), 8);
    c.fillStyle = COL.text;
    c.fillText((zoro.aimError * 1000).toFixed(0) + 'mr', x + w - 42, y + 27);

    c.fillStyle = COL.dim;
    c.fillText('lead', x, y + 41);
    c.fillStyle = zoro.leadTime > 0 ? COL.goal : COL.grid;
    c.fillText(zoro.leadTime > 0 ? (zoro.leadTime * 1000).toFixed(0) + ' ms ahead' : 'no solution', x + 40, y + 41);

    c.fillStyle = COL.dim;
    c.fillText('state', x, y + 55);
    const coasting = zoro.locked && zoro.timeUnseen > 0.05;
    c.fillStyle = coasting ? COL.goal : zoro.locked ? COL.epg : COL.grid;
    c.fillText(coasting ? 'COASTING ON MEMORY' : zoro.locked ? 'TRACKING' : 'no target', x + 40, y + 55);

    c.fillStyle = COL.dim;
    c.fillText('kills', x, y + 69);
    c.fillStyle = COL.text;
    const cuts = extra.flies ? extra.flies.cuts : 0;
    c.fillText(`${zoro.hits} shot  ${cuts} cut`, x + 40, y + 69);

    c.fillStyle = COL.dim;
    c.fillText('target', x, y + 83);
    c.fillStyle = zoro.targetId === null ? COL.grid : COL.text;
    c.fillText(zoro.targetId === null ? 'none' : `fly ${zoro.targetId}`, x + 40, y + 83);
    c.fillStyle = COL.dim;
    c.fillText(`switches ${zoro.switches}`, x + 110, y + 83);

    // --- the fly --------------------------------------------------------------
    this._label(c, 'FLY - LPLC2 / GIANT FIBER ESCAPE', x, y + 104);
    meter('loom', fly.loom, 1, COL.reverse, y + 110);
    meter('LPLC2', fly.lplc2, 1, COL.reverse, y + 124);

    c.fillStyle = COL.dim;
    c.fillText('giant fiber', x, y + 145);
    if (fly.escaping) {
      c.fillStyle = COL.reverse;
      c.fillText('ESCAPE - 5 ms reflex, no model', x + 66, y + 145);
    } else {
      c.fillStyle = COL.grid;
      c.fillText('quiet', x + 66, y + 145);
    }
  }

  // --- compass ---------------------------------------------------------------
  _compass(c, s, trueHeading, cx, cy, R) {
    c.save();
    this._label(c, 'ELLIPSOID BODY - EPG COMPASS', 14, 22);

    // Wedge bars radiating from the ring.
    let peak = 1e-6;
    for (let i = 0; i < s.epg.length; i++) peak = Math.max(peak, s.epg[i]);

    for (let i = 0; i < s.epg.length; i++) {
      // Screen angle: 0 rad points up (+Z forward), increasing counterclockwise,
      // matching the world convention in main.js.
      const a = -s.epgTheta[i] - Math.PI / 2;
      const v = s.epg[i] / peak;
      const r0 = R * 0.56;
      const r1 = r0 + R * 0.40 * v;
      c.strokeStyle = COL.epg;
      c.globalAlpha = 0.25 + 0.75 * v;
      c.lineWidth = 7;
      c.lineCap = 'butt';
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    c.globalAlpha = 1;

    c.strokeStyle = COL.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, R * 0.54, 0, Math.PI * 2);
    c.stroke();

    const arrow = (angle, len, color, width) => {
      const a = -angle - Math.PI / 2;
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      c.stroke();
    };

    arrow(trueHeading, R * 0.46, COL.truth, 1.5);      // where the body really faces
    arrow(s.headingEstimate, R * 0.50, COL.heading, 2.5); // what the compass believes
    arrow(s.goalAngle, R * 0.94, COL.goal, 2);            // where it wants to go

    const errDeg = (s.steerError * 180 / Math.PI);
    const compassErr = ((((s.headingEstimate - trueHeading) + Math.PI) % (Math.PI * 2)
      + Math.PI * 2) % (Math.PI * 2) - Math.PI) * 180 / Math.PI;

    c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = COL.dim;
    c.fillText('goal', 14, 186);
    c.fillStyle = COL.goal;
    c.fillText(`${errDeg >= 0 ? '+' : ''}${errDeg.toFixed(0)}°`, 48, 186);
    c.fillStyle = COL.dim;
    c.fillText('compass err', 96, 186);
    c.fillStyle = Math.abs(compassErr) > 20 ? COL.heading : COL.dim;
    c.fillText(`${compassErr >= 0 ? '+' : ''}${compassErr.toFixed(0)}°`, 178, 186);
    c.fillStyle = COL.dim;
    c.fillText(`bump ${s.bumpStrength.toFixed(2)}`, 218, 186);
    c.restore();
  }

  // --- descending neuron bars ------------------------------------------------
  _bars(c, s, x, y) {
    this._label(c, 'DESCENDING NEURONS', x, y - 10);

    const rows = [
      ['PFL3 L', s.pfl3L, COL.left, 3],
      ['PFL3 R', s.pfl3R, COL.right, 3],
      ['DNa02 L', s.dna02L, COL.left, 3],
      ['DNa02 R', s.dna02R, COL.right, 3],
      ['DNp09', s.dnp09, COL.drive, 1],
      ['MDN', s.mdn, COL.reverse, 1.6],
      ['LoVP92', s.lovp92, COL.courtship, 1.6],
      ['AOTU012', s.aotu012, COL.courtship, 1],
    ];

    const barX = x + 66;
    const barW = this.w - barX - 42;
    c.font = '10px ui-monospace, Menlo, Consolas, monospace';

    rows.forEach(([name, val, color, scale], i) => {
      const yy = y + i * 15;
      c.fillStyle = COL.dim;
      c.fillText(name, x, yy + 7);

      c.fillStyle = '#17171d';
      c.fillRect(barX, yy, barW, 8);

      const f = Math.max(0, Math.min(val / scale, 1));
      c.fillStyle = color;
      c.fillRect(barX, yy, barW * f, 8);

      c.fillStyle = f > 0.02 ? COL.text : COL.grid;
      c.fillText(val.toFixed(2), barX + barW + 6, yy + 7);
    });
  }

  // --- gait raster -----------------------------------------------------------
  _pushRaster(s) {
    this.raster.push(s.legStance.map((l) => l.swing));
    if (this.raster.length > RASTER_LEN) this.raster.shift();
  }

  _gait(c, x, y) {
    this._label(c, 'VENTRAL NERVE CORD - LEG CPGs', x, y - 10);

    const names = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
    const rowH = 11;
    const gx = x + 26;
    const gw = this.w - gx - 14;

    c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    for (let leg = 0; leg < 6; leg++) {
      const yy = y + leg * rowH;
      c.fillStyle = COL.dim;
      c.fillText(names[leg], x, yy + 8);
      c.fillStyle = '#15151a';
      c.fillRect(gx, yy, gw, rowH - 3);

      const n = this.raster.length;
      const cw = gw / RASTER_LEN;
      for (let t = 0; t < n; t++) {
        if (!this.raster[t][leg]) continue;
        c.fillStyle = COL.swing;
        c.fillRect(gx + t * cw, yy, Math.max(cw, 1), rowH - 3);
      }
    }

    c.fillStyle = COL.dim;
    c.fillText('swing shaded. tripods {L1,R2,L3} and {R1,L2,R3}', x, y + 6 * rowH + 10);
  }

  _label(c, text, x, y) {
    c.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    c.fillStyle = COL.dim;
    c.fillText(text, x, y);
  }
}
