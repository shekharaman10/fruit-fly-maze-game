// Scene, and the loop that closes each brain with its body.
//
// The objective is the circular maze: enter at the rim, walk every corridor,
// finish at the centre. The route comes from world/mazeGraph.js -- a randomised
// DFS carves a perfect maze, BFS finds the entrance-to-centre path, and an
// ordered DFS produces a walk that covers every corridor and ends at the middle.
// The character follows that walk.
//
// LOCOMOTION AND WEAPONS ARE DECOUPLED, and that is what makes this work. The
// legs follow the route and nothing pulls them off it. Flies are dealt with by
// the aiming brain, which points independently of where the body is walking. If
// the approach pathway were left switched on, a fly drifting past would drag the
// character off the route and the march would never finish.

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { FlyBrain } from './brain/index.js';
import { FlyFlightBrain } from './brain/flight.js';
import { ZoroBrain, AIM, CAPACITY } from './brain/zoro.js';
import {
  buildMaze, sense, resolveCollision, lineOfSight, wallSegments, ringAt, roomAround, MAZE,
  BODY_RADIUS,
} from './world/maze.js';
import { moveAndSlide, moveToward, planarSpeed } from './world/body3d.js';
import { VARIANTS, HEIGHT as BODY_HEIGHT } from './world/human.js';
import { buildPlayer, applyWeaponPose, gripTargets } from './world/player.js';
import { FLY_HIT_RADIUS, FLY_CLEAR_RADIUS } from './world/fly.js';
import { FlySwarm } from './world/swarm.js';
import { Swing } from './world/sword.js';
import { Bolts } from './world/laser.js';
import { Hud, Radar } from './render/hud.js';
import { pullCameraIn } from './render/camera.js';
import { buildEnvironment } from './render/environment.js';
import { createNightMode } from './render/night.js';
import { scaleReport, comparisonRows, LENGTHS_M } from './scale.js';
import { doubleSupportFraction } from './world/gait.js';
import { Score, SCORING } from './score.js';
import { Tour, TOUR } from './tour.js';
import { Life } from './life.js';
import { makeRandom, wrapPi, clamp } from './brain/neuron.js';

const FIXED_DT = 1 / 120;
// He walks at one second per second. There was a 1x/2x/4x control here and it
// is gone: a person does not move at 4x, and a run that is watched at 4x is not
// the run. The length of a run is a property of the route, not of the clock --
// press M for the shortest path if the full coverage walk is more than is
// wanted.
//
// 16 substeps covers a frame as long as 133 ms, i.e. down to about 7 fps,
// before the accumulator has to drop time. Dropping time is the one thing that
// makes his pace INCONSISTENT -- he would visibly slow down whenever the frame
// rate dipped -- so the cap is set well below any frame rate worth rendering at.
const MAX_SUBSTEPS = 16;
// Ten times what it was. They are drawn by one instanced swarm rather than
// eighty models -- see world/swarm.js -- and the brain only ever evaluates the
// nearest few, because it can lock onto one at a time regardless.
const FLIES = 80;
const PERCEIVED = 10;   // nearest flies the aiming brain bothers to test
const WAYPOINT_REACHED = 0.55;
const WIN_RADIUS = MAZE.centreR - 0.35;
// Each picture gets a proper look on the way past. The dwell only counts down
// while he is actually facing it.
// MEASURED: at eighty flies a landing gets through about every seven seconds,
// so an eight-second grudge meant he was almost never marching -- one grudge ran
// into the next and the run took twice as long as it had any reason to. It also
// clears the moment the offending fly dies, and with the faster slew that is
// usually well inside this.
const RETALIATE_FOR = 2.5;   // s to spend settling a score before moving on
// The turn on the spot at the end. Slow enough to read as looking around
// rather than spinning.
const FINALE_TURN = Math.PI * 2;
// Walking the last step to the chair, then sitting down on it.
const FINALE_WALK = 2.6;   // s easing onto the seat and turning to face the table
const FINALE_SIT = 1.4;    // s folding into the chair
const FINALE_RATE = FINALE_TURN / 16;  // rad/s -- one full turn in 16 s

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

// --- how many pixels this is worth ----------------------------------------
//
// This was min(devicePixelRatio, 2). On a 2x display that is FOUR times the
// pixels of a 1x one for the same window, and the whole cost of the frame --
// shading, shadows, the lot -- scales with it. It is the single biggest lever
// on frame time and it was set to the most expensive position by default.
//
// 1.5 is the ceiling now, and a governor moves it between that and 0.7 from
// the frame time actually being achieved, so the machine it is running on
// decides rather than a constant written here. See the governor below.
const PR_CEILING = Math.min(window.devicePixelRatio || 1, 1.5);
const PR_FLOOR = 0.7;
let pixelRatio = PR_CEILING;
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;

const scene = new THREE.Scene();
// Open sky. The maze has walls and no ceiling, so what is overhead is
// genuinely visible from inside it, and the fog has to be the same colour as
// the sky or distant corridors fade toward a horizon that is not there.
const SKY = 0x87ceeb;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 20, 52);

// Field of view, and why there are two of them.
//
// three.js takes a VERTICAL fov, and one fixed vertical number cannot serve
// both a third-person shot and a first-person one. At 50 degrees vertical on a
// 16:9 window the horizontal field is only 79 degrees, which is a fine long
// lens for watching a character and a drinking straw to look through as one.
//
// POV is therefore specified HORIZONTALLY and the vertical is derived from the
// window. That is the Hor+ convention every first-person game uses, and it is
// the part that matters: with a fixed vertical fov, making the window wider
// gives you more picture, while making it narrower silently zooms you in.
//
// 100 degrees horizontal is a convention, not a measurement, and it is worth
// being clear about which. Geometric correctness -- the fov at which the screen
// subtends the same angle as the scene -- is about 40 degrees at a normal
// desk viewing distance, and it feels like a telescope precisely because it
// throws away the peripheral awareness a person actually has. Games widen to
// 90-100 to put some of that back. Human binocular vision is around 120 and no
// flat monitor reproduces it.
const FOV_CINEMATIC = 50;   // vertical degrees, for the shots that watch him
const POV_HFOV = 100;       // HORIZONTAL degrees, for the shot that is him
const POV_VFOV_MAX = 85;    // ceiling, so a tall window cannot fisheye it

// Eye height, from the same anthropometry world/human.js is built on: eye
// height standing is 0.936 of stature. Derived rather than dialled, like the
// hip at 0.530H and the shoulder at 0.818H.
const EYE_H = BODY_HEIGHT * 0.936;

const camera = new THREE.PerspectiveCamera(FOV_CINEMATIC, 1, 0.1, 120);

/**
 * Pick the fov for the current shot and window. Cheap to call every frame: it
 * only touches the projection matrix when the number actually moves.
 */
function applyFov() {
  let want = FOV_CINEMATIC;
  if (shot === 'pov') {
    want = 2 * Math.atan(Math.tan((POV_HFOV * Math.PI) / 360) / camera.aspect) * (180 / Math.PI);
    // Hor+ up to a point, then stop. On a tall or square window, holding 100
    // degrees horizontal drives the vertical to 100 as well, and that is a
    // fisheye. Past the clamp the horizontal gives way instead, which is the
    // lesser of the two distortions.
    want = Math.min(want, POV_VFOV_MAX);
  }
  if (Math.abs(camera.fov - want) < 0.01) return;
  camera.fov = want;
  camera.updateProjectionMatrix();
}
// Opens on the whole maze. In FREE -- the default -- nothing will ever move the
// camera on the viewer's behalf, so the first frame has to be somewhere worth
// starting from rather than in the middle of a corridor.
camera.position.set(0.01, MAZE.outerR * 2.05, MAZE.outerR * 0.75);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
// Free to swing almost all the way over the top and down to the floor, and to
// zoom. The old 0.49*PI cap and the per-frame camera writes meant the view could
// not really be moved at all: every drag was overwritten on the next frame.
controls.maxPolarAngle = Math.PI * 0.95;
controls.minPolarAngle = 0.05;
controls.minDistance = 1.2;
controls.maxDistance = 60;

// --- how the view responds to the hand -------------------------------------
//
// OrbitControls applies `dampingFactor` of the outstanding movement PER FRAME
// and decays the rest. Two things follow, and both were wrong here:
//
//   the factor is a per-frame fraction, not a speed. At 0.08 only a
//   twelfth of a drag lands each frame, so the camera trails the cursor
//   through the whole gesture rather than at the end of it.
//
//   because it is per frame, it is FRAME-RATE DEPENDENT. The same drag takes
//   twice as long in wall-clock at 30 fps as at 60. That is why the controls
//   went stiff when the fly count went up tenfold: the frame got longer, and
//   the camera got correspondingly slower to answer.
//
// So the factor is recomputed from the real frame time every frame against a
// fixed time constant, which is the same thing `k` does for the look target.
// CAM_RESPONSE is the time the view takes to cover about 63% of the distance to
// where it has been asked to go, at any frame rate.
const CAM_RESPONSE = 0.055;   // s

// Wheel zoom is MULTIPLICATIVE -- one notch scales the distance by
// 0.95^zoomSpeed. At 1.1 that is 5% a notch, so crossing the 1.2 m to 60 m
// range took about eighty of them.
controls.enableZoom = true;
controls.zoomSpeed = 2.4;
controls.rotateSpeed = 1.15;
// Pan is how the view is moved left, right, up and down without turning it,
// which is half of what "I want to move the camera myself" means. Screen space
// rather than ground plane, so dragging right moves the view right whatever
// angle it is looking down from.
controls.enablePan = true;
controls.panSpeed = 1.2;
controls.screenSpacePanning = true;

// Sky above, carpet below. Under an open sky most of the light in a shadow is
// skylight, so the hemisphere carries the ambient and the sun only has to draw
// the shadow -- which is what keeps the shadows subtle instead of black. The
// ground half is the carpet colour because that is what is actually bouncing.
// Image-based lighting. Every MeshStandardMaterial in the scene gets a
// specular response from this -- without it `metalness` does nothing and a
// steel blade renders the same flat wash as a cotton shirt. See
// render/environment.js; it loads no file.
scene.environment = buildEnvironment(renderer);

// Dropped from 1.00 because the environment now carries part of the ambient.
// Leaving it at 1.00 with an env map on top washes the scene out.
// Held rather than added anonymously: night mode dims it, and it cannot dim
// what it has no reference to.
const hemi = new THREE.HemisphereLight(SKY, 0x6e181f, 0.55);
scene.add(hemi);

// The sun. Higher and further round than the old key light, so the walls cast
// down the corridors rather than straight along them.
const key = new THREE.DirectionalLight(0xfff4e6, 1.35);
key.position.set(11, 21, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -16;
key.shadow.camera.right = 16;
key.shadow.camera.top = 16;
key.shadow.camera.bottom = -16;
key.shadow.camera.far = 48;
key.shadow.bias = -0.0012;
scene.add(key);

// Counter-fill from the opposite side, tinted sky rather than white, so the
// faces the sun misses sit in blue light instead of going flat grey.
const fill = new THREE.DirectionalLight(0xbcdcf2, 0.30);
fill.position.set(-10, 8, -9);
scene.add(fill);

const bolts = new Bolts(scene, { speed: AIM.boltSpeed });

const estRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.26, 32),
  new THREE.MeshBasicMaterial({
    color: 0x2fd4ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  }),
);
estRing.rotation.x = -Math.PI / 2;
estRing.position.y = 0.02;
scene.add(estRing);

const leadMark = new THREE.Group();
for (const rot of [0, Math.PI / 2]) {
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.20, 0.012, 0.012),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }),
  );
  bar.rotation.z = rot;
  leadMark.add(bar);
}
scene.add(leadMark);

const hud = new Hud(document.getElementById('hud'));
// One instanced swarm covering every fly. Built once; runs reuse it.
const swarm = new FlySwarm(scene, FLIES);
let radar = null;

// Dark academia. `nightOn` outlives a run; `night` is rebuilt with the maze.
let night = null;
let nightOn = false;

/**
 * Day <-> night. Reachable from the N key and from the NIGHT button, because a
 * key nobody is told about is a feature nobody finds -- this one sat in the
 * build unlisted, and the first question asked of it was where the switch was.
 */
function toggleNight() {
  nightOn = !nightOn;
  if (night) night.set(nightOn);
  const b = document.querySelector('.nightbtn');
  // Same `data-on` the view buttons use, so it lights up the same way.
  if (b) {
    if (nightOn) b.dataset.on = '1';
    else delete b.dataset.on;
  }
}

let world = null;
let player = null;
let rng = makeRandom(4242);
let brain = null;
let zoro = null;
let swing = null;
let score = null;

// Velocity is state now, not something recomputed from the heading each frame.
// That is the whole difference between a body that moves and one that is
// teleported: it can be halfway to its commanded speed, and it can still be
// carrying speed in a direction it is no longer facing.
const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0, onFloor: true };

// How hard the legs can change the body's velocity, m/s^2. Not free parameters:
// at 1.75 m/s cruise, 9.0 reaches speed in 0.19 s and 11.0 stops in 0.16 s,
// which is roughly what a person does and close to the 0.13 m roll-on the
// picture dwell was already tuned around. Higher and it is a teleport again;
// lower and he skates.
const WALK_ACCEL = 9.0;
const WALK_BRAKE = 11.0;
const nav = { bearing: 0, targetVisible: false };

const flies = [];
const debris = [];

let marchIndex = 0;
// 'coverage' walks every corridor, as the puzzle rule demands.
// 'shortest' is the BFS path straight to the middle. M switches.
let routeMode = 'coverage';
let won = false;
// Enough landings and the run is over. See life.js.
let life = new Life();
let dead = false;
// Arriving at the centre does not end it immediately. The character walks
// into the middle and turns slowly on the spot, and only then is the run
// declared over. `manualYaw` lets the viewer keep turning him afterwards.
let finale = null;   // { turned }
let manualYaw = 0;
let paused = false;
let autoFire = true;
let landmarkEnabled = true;
// TWO MODES, AND THEY DO NOT BLEND.
//
// There used to be one cycle of six shots with a half-and-half 'orbit' in it,
// where the angle was the viewer's but the target was dragged along behind the
// character. That is the worst of both: the view moves on its own AND does not
// frame anything in particular.
//
//   FREE    nothing in this file writes the camera. OrbitControls owns it
//           outright -- rotate, zoom, pan -- and it stays exactly where it is
//           put while the character walks the maze on his own.
//   FOLLOW  the rig owns the camera and the viewer's input is switched OFF,
//           because a drag that is overwritten on the next frame is worse than
//           a drag that does nothing. V switches; C picks the shot in FOLLOW.
//
// The separation is enforced in one place: `controls.enabled`. In FREE the
// camera is only ever moved by the viewer, in FOLLOW only ever by the rig.
let viewMode = 'free';
const SHOTS = ['follow', 'shoulder', 'pov', 'duel', 'top'];
let shot = 'follow';
let simTime = 0;
let prevMissCount = 0;
let runSeed = 20260917;
// Frontal visual field, half-angle. Outside this the rifle cannot be brought
// on, so the legs have to turn -- which is the whole of "if they are behind
// him, rotate and kill them".
const FRONTAL = 1.31;        // rad, matches the candidate visibility test
const ENGAGE_GATE = 0.40;    // walk speed while turning onto a fly
// Turning onto a fly overrides the march, so it has to be able to run out.
// MEASURED: without a budget, one run at twenty flies reached 59% of the route
// in twelve minutes -- a fly sat behind him, he turned toward it forever, and
// the march never advanced. He gets this long to deal with it and then walks on
// regardless; the rifle keeps tracking either way.
const ENGAGE_BUDGET = 1.6;   // s of turning before the march takes priority back
const ENGAGE_REST = 2.2;     // s of marching before he may turn again
// How clear the ground has to be before he will look at a picture. Art is the
// lowest priority, so with eighty flies about it is the thing that gets
// squeezed out -- MEASURED: with the test at "nothing seen or heard at all"
// (11 m, the full sight range) two runs in three looked at ZERO pictures in ten
// minutes. This is the distance at which a fly stops being something to deal
// with first; anything nearer, and the art waits.
const ART_CLEAR = 5.5;       // m

// The picture tour, and any fly owed a reckoning.
let tour = null;
let retaliate = null;    // { id, left } -- a fly that got a hit in
let engageLeft = ENGAGE_BUDGET;   // s of turning still allowed
let engageRest = 0;               // s of forced marching still to serve
let lastContacts = [];
let lastHeard = [];

const muzzleWorld = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const bladeA = new THREE.Vector3();
const bladeB = new THREE.Vector3();
const handR = new THREE.Vector3();
const handL = new THREE.Vector3();

const el = (id) => document.getElementById(id);

function clearScene() {
  if (world) scene.remove(world.group);
  if (swarm) swarm.update([]);   // collapse every instance
  flies.length = 0;
  for (const d of debris) scene.remove(d.obj);
  debris.length = 0;
}

function startRun(seed, variantId) {
  clearScene();
  runSeed = seed;
  rng = makeRandom(seed);

  world = buildMaze({ seed });
  scene.add(world.group);
  radar = new Radar(el('radar'), wallSegments(world));

  // The lamps hang off the pictures, so they are rebuilt with the maze. The
  // night/day state itself survives a restart -- it is a way of looking at the
  // place, not part of the run.
  if (night) night.dispose();
  night = createNightMode({ scene, renderer, world, hemi, sun: key, fill });
  night.set(nightOn);

  brain = new FlyBrain({ seed, sex: 'male' });
  zoro = new ZoroBrain({ seed: seed + 5 });
  swing = new Swing();
  score = new Score();

  // Start outside the rim, facing in, so the entrance is genuinely walked.
  body.x = world.outside.x;
  body.z = world.outside.z;
  body.yaw = Math.atan2(-body.x, -body.z);
  body.yawRate = 0;
  brain.anchor(body.yaw);

  marchIndex = 0;
  routeMode = 'coverage';
  finale = null;
  manualYaw = 0;
  tour = new Tour(world.pictures);
  engageLeft = ENGAGE_BUDGET;
  engageRest = 0;
  life.reset();
  dead = false;
  showDead(false);
  retaliate = null;
  won = false;
  paused = false;
  simTime = 0;
  prevMissCount = 0;
  bolts.missCount = 0;

  setPaused(false);
  setPlayer(variantId || (player ? player.variantId : VARIANTS[0].id));
  spawnFlies();
  showWin(false);
}

function setPlayer(variantId) {
  if (player) scene.remove(player.group);
  player = buildPlayer(variantId);
  scene.add(player.group);
  for (const b of document.querySelectorAll('.pick')) {
    if (b.dataset.id === variantId) b.dataset.on = '1';
    else delete b.dataset.on;
  }
}

/** Waypoints for the active mode. */
function activePoints() {
  return routeMode === 'shortest' ? world.shortestPoints : world.routePoints;
}

/** Switch route, resuming at whichever waypoint of the new one is nearest. */
function setRouteMode(mode) {
  if (routeMode === mode || won) return;
  routeMode = mode;
  const pts = activePoints();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - body.x, pts[i].z - body.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  marchIndex = best;
}

function cellPoint(id) {
  const nd = world.graph.nodes[id];
  if (!nd || nd.r < 0) return { x: 0, z: 0 };
  const step = (Math.PI * 2) / world.graph.ringCells[nd.r];
  const rr = MAZE.centreR + nd.r * MAZE.ringW + MAZE.ringW / 2;
  const a = (nd.i + 0.5) * step;
  return { x: rr * Math.sin(a), z: rr * Math.cos(a) };
}

function freePoint(minFrom = 3) {
  for (let t = 0; t < 200; t++) {
    const id = 1 + (Math.floor(rng() * (world.graph.n - 1)) % (world.graph.n - 1));
    const c = cellPoint(id);
    if (Math.hypot(c.x - body.x, c.z - body.z) >= minFrom) return c;
  }
  return { x: world.start.x, z: world.start.z };
}

function spawnFlies() {
  for (let i = 0; i < FLIES; i++) {
    const p = freePoint(4);
    const f = {
      id: i,
      flyBrain: new FlyFlightBrain({ seed: runSeed + 1000 + i * 97 }),
      state: { x: p.x, y: 1.35, z: p.z, yaw: rng() * Math.PI * 2, yawRate: 0, stun: 0 },
      alive: true,
      respawnIn: 0,
      escapes: 0,
      wasEscaping: false,
    };
    f.flyBrain.anchor(f.state.yaw);
    flies.push(f);
  }
}

function respawnFly(f) {
  const p = freePoint(5);
  f.state.x = p.x;
  f.state.z = p.z;
  f.state.y = 1.35;
  f.state.yaw = rng() * Math.PI * 2;
  f.state.yawRate = 0;
  f.state.stun = 0.35;
  f.flyBrain.anchor(f.state.yaw);
  f.alive = true;
}

function cutFly(f) {
  const halves = swarm.halvesFor(f);
  const dir = Math.atan2(f.state.x - body.x, f.state.z - body.z);
  for (let i = 0; i < 2; i++) {
    const obj = i === 0 ? halves.front : halves.rear;
    scene.add(obj);
    const side = i === 0 ? 1 : -1;
    debris.push({
      obj,
      vel: {
        x: Math.sin(dir) * 1.1 + Math.cos(dir) * side * 1.6 + (rng() - 0.5) * 0.4,
        y: 1.5 + rng() * 0.8,
        z: Math.cos(dir) * 1.1 - Math.sin(dir) * side * 1.6 + (rng() - 0.5) * 0.4,
      },
      spin: { x: (rng() - 0.5) * 14, y: (rng() - 0.5) * 14, z: (rng() - 0.5) * 14 },
      life: 2.4,
    });
  }
  f.alive = false;
  f.respawnIn = 2.5;
  score.swordCut();
}

function stepDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vel.y -= 9.81 * dt;
    d.obj.position.x += d.vel.x * dt;
    d.obj.position.y += d.vel.y * dt;
    d.obj.position.z += d.vel.z * dt;
    if (d.obj.position.y < 0.03) {
      d.obj.position.y = 0.03;
      d.vel.y *= -0.28;
      d.vel.x *= 0.55;
      d.vel.z *= 0.55;
      d.spin.x *= 0.4;
      d.spin.y *= 0.4;
      d.spin.z *= 0.4;
    }
    d.obj.rotation.x += d.spin.x * dt;
    d.obj.rotation.y += d.spin.y * dt;
    d.obj.rotation.z += d.spin.z * dt;
    d.life -= dt;
    if (!d.obj.userData.s0) d.obj.userData.s0 = d.obj.scale.x;
    if (d.life < 0.6) d.obj.scale.setScalar(Math.max(d.life / 0.6, 0) * d.obj.userData.s0);
    if (d.life <= 0) {
      scene.remove(d.obj);
      debris.splice(i, 1);
    }
  }
}

function segDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t), pz - (az + dz * t));
}

function stepSim(dt) {
  if (won) return;

  // The finish: cross the last step to the chair and sit down on it. This is
  // scripted rather than steered -- the position and yaw are eased directly
  // rather than coming out of DNa02 -- because the last metre onto a seat is
  // not something a bearing controller does gracefully, and the point is to
  // arrive on the chair rather than near it.
  if (finale) {
    finale.t += dt;
    const seat = world.furniture.seat;

    // Ease onto the seat and round to face the table.
    const k = Math.min(1, dt / 0.35);
    body.x += (seat.x - body.x) * k;
    body.z += (seat.z - body.z) * k;
    body.yaw = wrapPi(body.yaw + wrapPi(world.furniture.facing - body.yaw) * k);

    // Fold into the chair once he is over it.
    const sit = clamp((finale.t - FINALE_WALK) / FINALE_SIT, 0, 1);
    finale.sit = sit;

    const st0 = brain.state();
    player.group.position.set(body.x, 0, body.z);
    player.group.rotation.y = body.yaw + manualYaw;
    swing.step(dt);
    applyWeaponPose(player, zoro, swing, dt, roomAround(world, body.x, body.z));
    const g0 = gripTargets(player);
    player.human.pose({
      legPhase: st0.legPhase,
      // Legs shuffle while he is still crossing, and stop once he is sitting.
      speed: 0.45 * (1 - sit),
      turnCommand: 0,
      armHold: 1,
      armHoldLeft: g0.holdLeft,
      armHoldRight: g0.holdRight,
      sit,
      rightHandTarget: g0.right,
      leftHandTarget: g0.left,
    });

    if (finale.t >= FINALE_WALK + FINALE_SIT + 0.6) {
      score.centreReached();
      won = true;
      showWin(true);
    }
    simTime += dt;
    return;
  }

  score.step(dt);
  zoro.cooldownScale = score.cooldownScale;

  for (const f of flies) {
    if (!f.alive) {
      f.respawnIn -= dt;
      if (f.respawnIn <= 0) respawnFly(f);
      continue;
    }
    const out = f.flyBrain.step(dt, {
      pos: f.state,
      yaw: f.state.yaw,
      yawRate: f.state.yawRate,
      zoro: { x: body.x, y: 1.25, z: body.z },
      bolts: bolts.liveBolts,
      bounds: { hw: MAZE.outerR, hd: MAZE.outerR, maxY: MAZE.height - 0.2 },
    });
    if (out.escaping && !f.wasEscaping) f.escapes++;
    f.wasEscaping = out.escaping;

    f.state.stun = Math.max(0, f.state.stun - dt);
    const sp = f.state.stun > 0 ? out.speed * 0.2 : out.speed;
    f.state.yawRate = out.yawRate;
    f.state.yaw = wrapPi(f.state.yaw + out.yawRate * dt);
    // Velocity is written from the heading EVERY frame, so the flies get the
    // slide without gaining any inertia. That is deliberate: the escape reflex
    // is the thing tools/experiment.mjs measures, and a fly that has to
    // accelerate out of a jink is a different animal from the one those numbers
    // describe. What changes is only the wall response -- it slides along
    // instead of being shoved out while still steering into the wall.
    f.state.vx = Math.sin(f.state.yaw) * sp;
    f.state.vz = Math.cos(f.state.yaw) * sp;
    f.state.vy = out.climb;
    moveAndSlide(world, f.state, dt, {
      // Its whole rendered extent, not just its body -- see world/fly.js.
      radius: FLY_CLEAR_RADIUS, wallT: MAZE.wallT, props: false,
      floorY: 0.5, ceilingY: MAZE.height - 0.4,
    });
  }

  // Only the nearest handful are evaluated. The line-of-sight test against
  // ~880 wall segments is the expensive part, and the aiming brain locks onto
  // one fly at a time regardless, so testing all eighty every step buys
  // nothing. The cut is at AIM.maxRange, which is wider than hearingRange,
  // so nothing that could have been seen OR heard is dropped by it.
  const inRange = [];
  for (const f of flies) {
    if (!f.alive) continue;
    const d2 = (f.state.x - body.x) ** 2 + (f.state.z - body.z) ** 2;
    if (d2 < AIM.maxRange * AIM.maxRange) inRange.push({ f, d2 });
  }
  inRange.sort((a, b) => a.d2 - b.d2);
  if (inRange.length > PERCEIVED) inRange.length = PERCEIVED;

  const candidates = [];
  for (const near of inRange) {
    const f = near.f;
    const dx = f.state.x - body.x;
    const dz = f.state.z - body.z;
    const range = Math.hypot(dx, dz);
    const bearing = wrapPi(Math.atan2(dx, dz) - body.yaw);
    const clear = lineOfSight(world, body.x, body.z, f.state.x, f.state.z);
    const visible = Math.abs(bearing) < 1.31 && range < AIM.maxRange && clear;
    candidates.push({
      id: f.id,
      fly: f,
      range,
      bearing,
      heard: range < AIM.hearingRange && clear,
      observed: visible ? {
        x: f.state.x + (rng() - 0.5) * AIM.rangeNoise,
        y: f.state.y + (rng() - 0.5) * AIM.rangeNoise,
        z: f.state.z + (rng() - 0.5) * AIM.rangeNoise,
      } : null,
    });
  }

  const chosen = zoro.selectTarget(candidates);
  lastContacts = candidates
    .filter((c) => c.observed)
    .map((c) => ({
      x: c.observed.x, z: c.observed.z, seen: true, targeted: c.id === zoro.targetId,
    }));
  lastHeard = candidates.filter((c) => c.heard && !c.observed).map((c) => wrapPi(c.bearing));

  // The aiming brain gets a target; the LEGS never do. nav.targetVisible stays
  // false so the approach pathway cannot pull the march off its route.
  if (chosen) world.target.position.set(chosen.fly.state.x, chosen.fly.state.y, chosen.fly.state.z);
  else world.target.position.set(body.x + 1e4, -50, body.z + 1e4);

  // What the legs do, in priority order:
  //   1. settle a score with whatever just bit him
  //   2. turn onto a fly the rifle cannot reach from here
  //   3. look at a picture, but only with nothing about
  //   4. march
  // Only one of the four drives the heading at a time. Flies come before art in
  // every case: the art is what he does when there is nothing to shoot.
  let gateTarget = 1;

  // 1. Something hit him. Turn round and deal with it before anything else.
  if (retaliate) {
    const f = flies.find((x) => x.id === retaliate.id);
    retaliate.left -= dt;
    if (!f || !f.alive || retaliate.left <= 0) {
      retaliate = null;
    } else {
      nav.bearing = wrapPi(Math.atan2(f.state.x - body.x, f.state.z - body.z) - body.yaw);
      // Close, but do not run it down: the weapons reach further than the legs.
      gateTarget = Math.hypot(f.state.x - body.x, f.state.z - body.z) > 2.2 ? 1 : 0;
    }
  }

  // 2. Flies before art. The rifle slews independently of the body, so the legs
  //    only need to get involved when the fly is somewhere the rifle cannot be
  //    brought to bear from: behind him, or heard and not yet seen. He keeps
  //    walking while he shoots anything in front.
  let engaging = false;
  if (engageRest > 0) engageRest -= dt;
  if (!retaliate && engageRest <= 0) {
    if (chosen && Math.abs(chosen.bearing) > FRONTAL) {
      nav.bearing = chosen.bearing;
      engaging = true;
    } else if (!chosen && zoro.orientBearing !== null) {
      // Heard, not seen. Turning is the only useful response: the coarse
      // channel has no range and far too much bearing error to shoot on.
      nav.bearing = zoro.orientBearing;
      engaging = true;
    }
    // Slowed while turning onto it, so the turn finishes before he has walked
    // past. Not stopped -- he is still trying to get to the centre.
    if (engaging) gateTarget = ENGAGE_GATE;
  }
  if (engaging) {
    engageLeft -= dt;
    if (engageLeft <= 0) {
      // Out of patience. March, and do not look round again for a while.
      engaging = false;
      engageLeft = ENGAGE_BUDGET;
      engageRest = ENGAGE_REST;
    }
  } else if (engageRest <= 0) {
    engageLeft = Math.min(ENGAGE_BUDGET, engageLeft + dt * 0.6);
  }

  // 3. A picture not yet looked at -- and only with the ground clear. Nothing
  //    within ART_CLEAR, seen or heard, or the art waits.
  let nearestFly = Infinity;
  for (const c of candidates) {
    if (c.observed || c.heard) nearestFly = Math.min(nearestFly, c.range);
  }
  const clearOfFlies = !engaging && nearestFly > ART_CLEAR;
  const look = (retaliate || engaging || !clearOfFlies) ? null : tour.step(dt, body);
  if (look) {
    nav.bearing = look.bearing;
    // Slowed, not stopped. Standing dead still at every picture is what made
    // the march read as broken.
    gateTarget = TOUR.slow;
    if (look.completed) score.pictureViewed();
  }

  // 4. March: steer to the current waypoint, advance when it is reached.
  const pts = activePoints();
  const wp = pts[Math.min(marchIndex, pts.length - 1)];
  const routeDone = marchIndex >= pts.length - 1;

  // The waypoint is ticked off wherever he happens to have got to, whatever
  // was steering him. It used to be ticked off only on the frames the march
  // owned the heading; with eighty flies the march owns barely half of them,
  // and ground he had already covered while fighting did not count. MEASURED:
  // a run reached 73% of the route in twelve minutes because of it.
  const toWp = Math.hypot(wp.x - body.x, wp.z - body.z);
  if (toWp < WAYPOINT_REACHED && marchIndex < pts.length - 1) marchIndex++;

  if (!retaliate && !look && !engaging) {
    if (routeDone && !tour.satisfied) {
      // The route is walked but pictures were missed, so go back for them --
      // the run is not finished until both are done.
      const want = tour.nearestUnviewed(body.x, body.z);
      const v = world.pictures[want.index].viewFrom;
      nav.bearing = wrapPi(Math.atan2(v.x - body.x, v.z - body.z) - body.yaw);
    } else {
      nav.bearing = wrapPi(Math.atan2(wp.x - body.x, wp.z - body.z) - body.yaw);
    }
  }

  const reading = sense(world, body, nav);
  if (!landmarkEnabled) reading.landmarkStrength = 0;
  // The gate EASES rather than switching, and the same eased value drives the
  // position and the pose. Getting this wrong is what made him march on the
  // spot in front of every picture: the gate was binary and multiplied into the
  // position only, so the body froze while the CPG carried on at full drive and
  // the legs kept striding.
  //
  // It is also handed to the brain as `halt`, which drops walkDrive, so the
  // walking circuit knows it has stopped rather than being overruled after the
  // fact -- the HUD's gait raster reads the same stop the body does.
  //
  // 0.12 s of easing costs about 12 cm of roll-on. The standing spots sit
  // 0.85-1.15 m off the wall, so there is room for it, and it is the difference
  // between stopping and being switched off.
  const motor = brain.step(dt, {
    ...reading,
    angularVelocity: body.yawRate,
    halt: gateTarget === 0,
  });

  body.yawRate = motor.yawRate * score.speedScale;
  body.yaw = wrapPi(body.yaw + body.yawRate * dt);

  // The WISH velocity: where the legs are asking to go, not where the body is.
  // A stop is a wish of zero and nothing else -- the deceleration below is
  // WALK_BRAKE doing its job, rather than a smoothing factor applied to the
  // position afterwards, which is what used to stand in for it.
  // gateTarget is a FRACTION, not a switch: 0 to stand still, ENGAGE_GATE to
  // creep while turning onto a fly, TOUR.slow to ease up to a picture. It
  // scales the wish, so a partial gate is a slower walk rather than a stutter.
  const wish = motor.speed * score.speedScale * gateTarget;
  const wishX = Math.sin(body.yaw) * wish;
  const wishZ = Math.cos(body.yaw) * wish;
  const rate = (wish > planarSpeed(body) ? WALK_ACCEL : WALK_BRAKE) * dt;
  const v = moveToward(body.vx, body.vz, wishX, wishZ, rate);
  body.vx = v.x;
  body.vz = v.z;

  // Slides along walls rather than being shoved out of them, and falls, though
  // with nothing to fall off it stays on the floor. See world/body3d.js.
  moveAndSlide(world, body, dt, {
    radius: BODY_RADIUS, wallT: MAZE.wallT, gravity: true, floorY: 0,
  });

  const st = brain.state();
  player.group.position.set(body.x, body.y, body.z);
  player.group.rotation.y = body.yaw + manualYaw;
  swing.step(dt);
  applyWeaponPose(player, zoro, swing, dt, roomAround(world, body.x, body.z));
  const grips = gripTargets(player);
  handR.copy(grips.right);
  handL.copy(grips.left);
  player.human.pose({
    legPhase: st.legPhase,
    // The SAME number the body moved by. If the pose is given the ungated
    // speed it strides while the body stands, which is the whole bug.
    // The speed the body ACHIEVED, not the one the CPG asked for. During the
    // 0.19 s ramp the two differ, and posing from the command is what makes
    // feet slide over ground they are not covering.
    speed: planarSpeed(body),
    turnCommand: st.turnCommand,
    // Per arm: the hand on the weapon in use is clamped to its grip, the other
    // keeps some of the gait's counter-swing. See world/player.js.
    armHold: 1,
    armHoldLeft: grips.holdLeft,
    armHoldRight: grips.holdRight,
    swingTwist: player.swingPose.twist,
    swingLean: player.swingPose.lean,
    rightHandTarget: handR,
    leftHandTarget: handL,
  });
  player.muzzle.updateWorldMatrix(true, false);
  player.muzzle.getWorldPosition(muzzleWorld);

  const cmd = zoro.step(dt, {
    muzzle: muzzleWorld,
    bodyYaw: body.yaw,
    observed: chosen ? chosen.observed : null,
    range: chosen ? chosen.range : Infinity,
  });

  if (cmd.fire && autoFire && cmd.lead) {
    tmpDir
      .set(cmd.lead.x - muzzleWorld.x, cmd.lead.y - muzzleWorld.y, cmd.lead.z - muzzleWorld.z)
      .normalize();
    if (bolts.spawn(muzzleWorld, tmpDir)) zoro.didFire();
  }
  if (cmd.swing && autoFire) swing.start();

  if (swing.contacting && !swing.hasCut) {
    const sw = player.sword;
    sw.updateWorldMatrix(true, false);
    bladeA.set(sw.userData.bladeStart, 0, 0);
    sw.localToWorld(bladeA);
    bladeB.copy(sw.userData.tip);
    sw.localToWorld(bladeB);
    for (const f of flies) {
      if (!f.alive) continue;
      const hit = segDist(
        bladeA.x, bladeA.y, bladeA.z, bladeB.x, bladeB.y, bladeB.z,
        f.state.x, f.state.y, f.state.z,
      );
      if (hit <= FLY_HIT_RADIUS + 0.05) {
        cutFly(f);
        swing.hasCut = true;
        break;
      }
    }
  }

  const targets = flies
    .filter((f) => f.alive)
    .map((f) => ({ pos: f.state, radius: FLY_HIT_RADIUS, id: f.id }));
  const env = {
    obstacles: [], hw: MAZE.outerR + 1, hd: MAZE.outerR + 1, maxY: MAZE.height - 0.05,
  };
  for (const h of bolts.update(dt, env, targets)) {
    const f = flies.find((x) => x.id === h.id);
    if (f && f.alive) {
      zoro.hits++;
      f.alive = false;
          f.respawnIn = 2.5;
      score.shotKill();
    }
  }
  score.missedShots(bolts.missCount - prevMissCount);
  prevMissCount = bolts.missCount;

  for (const f of flies) {
    if (!f.alive) continue;
    const d = Math.hypot(
      f.state.x - body.x, f.state.y - SCORING.landingHeight, f.state.z - body.z,
    );
    if (d <= SCORING.landingRadius && score.flyLanded()) {
      const away = Math.atan2(f.state.x - body.x, f.state.z - body.z);
      f.state.x = body.x + Math.sin(away) * 1.6;
      f.state.z = body.z + Math.cos(away) * 1.6;
      f.state.stun = 0.3;
      // Turn round and settle it. This overrides the march and the pictures
      // until that fly is dead or the grudge times out.
      retaliate = { id: f.id, left: RETALIATE_FOR };
      // And it costs him. Enough of these and the run is over.
      if (life.hit()) {
        dead = true;
        showDead(true);
        return;
      }
    }
  }
  life.step(dt);

  stepDebris(dt);

  // Reaching the middle ends the run. It used to be gated on having looked at
  // every picture, which put the art ahead of the flies and ahead of the march;
  // the order is the other way round now, so the art is something he does with
  // a clear field rather than a toll on the exit.
  if (Math.hypot(body.x, body.z) < WIN_RADIUS && !finale) {
    finale = { t: 0, sit: 0 };
  }

  simTime += dt;
}

let last = performance.now();
let acc = 0;
let fps = 60;

function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min((now - last) / 1000, 0.25);
  last = now;
  fps += ((1 / Math.max(wall, 1e-4)) - fps) * 0.08;
  frameMs += (wall * 1000 - frameMs) * 0.08;
  stepGovernor(now);

  if (!paused && !won && !dead) {
    acc += wall;
    let n = 0;
    while (acc >= FIXED_DT && n < MAX_SUBSTEPS) {
      stepSim(FIXED_DT);
      acc -= FIXED_DT;
      n++;
    }
    if (n === MAX_SUBSTEPS) acc = 0;
  }

  // Once the run is over he stays in the chair; the arrows still turn him.
  if (won && player && world) {
    player.group.position.set(world.furniture.seat.x, 0, world.furniture.seat.z);
    player.group.rotation.y = world.furniture.facing + manualYaw;
    // One call. It was called twice, once per hand, which recomputed both
    // grips to get one vector each.
    const seatedGrips = gripTargets(player);
    player.human.pose({
      legPhase: [0, Math.PI],
      speed: 0,
      turnCommand: 0,
      armHold: 1,
      sit: 1,
      rightHandTarget: seatedGrips.right,
      leftHandTarget: seatedGrips.left,
    });
  }

  // One instanced swarm rather than eighty models; the posing happens inside.
  swarm.update(flies);

  const zs = zoro.state();
  estRing.position.set(zoro.tracker.pos.x, 0.02, zoro.tracker.pos.z);
  estRing.material.opacity = 0.12 + 0.45 * zs.confidence;
  estRing.visible = zs.confidence > 0.02;

  if (zoro.lead && zs.weapon === 'rifle') {
    leadMark.position.set(zoro.lead.x, zoro.lead.y, zoro.lead.z);
    leadMark.lookAt(camera.position);
    leadMark.visible = zs.confidence > 0.3;
  } else {
    leadMark.visible = false;
  }

  updateCamera(wall);

  const st = brain.state();
  const target = flies.find((f) => f.id === zs.targetId);
  // The read-outs and the HUD canvas are redrawn at 15 Hz, not at frame rate.
  // Two dozen textContent writes force a style recalculation every time, and
  // the compass and the gait raster are a full 2D canvas repaint -- none of
  // which anyone can read at 60 Hz anyway.
  //
  // The 3D render is deliberately OUTSIDE this. Throttling the panels is free;
  // throttling the scene would be the stutter this is meant to remove.
  if (now - lastSlowUi >= 66) {
    lastSlowUi = now;
    radar.draw({
      x: body.x,
      z: body.z,
      yaw: body.yaw,
      contacts: lastContacts,
      heard: lastHeard,
      estimate: zoro.tracker.locked
        ? { x: zoro.tracker.pos.x, z: zoro.tracker.pos.z, confidence: zs.confidence }
        : null,
      room: won ? 'CENTRE' : 'ring ' + Math.max(0, ringAt(body.x, body.z)),
    });
    hud.draw(st, body.yaw, {
      zoro: zs,
      fly: target ? target.flyBrain.state() : flies[0].flyBrain.state(),
      flies: { alive: flies.filter((f) => f.alive).length, total: FLIES, cuts: score.cuts },
    });
    updateReadout(st, zs);
  }

  renderer.render(scene, camera);
}

let lastSlowUi = 0;

const camGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();

function updateCamera(dt) {
  const k = 1 - Math.pow(0.001, dt);
  // Per-frame fraction for a fixed time constant, so the view answers the hand
  // at the same rate whatever the frame rate is. See CAM_RESPONSE.
  controls.dampingFactor = Math.min(1, 1 - Math.exp(-Math.max(dt, 1e-4) / CAM_RESPONSE));

  if (viewMode === 'free') {
    // NOTHING HERE TOUCHES THE CAMERA. The only call is the one that applies
    // the viewer's own damped input. If a line is ever added above this that
    // writes camera.position or controls.target, free mode stops being free.
    controls.update();
    return;
  }

  if (shot === 'follow') {
    // Sits ABOVE the 2.6 m walls and looks down. Inside a 2 m corridor there is
    // no room for a camera at head height -- it ends up against the wall or
    // against the character -- so the shot is taken from over the top, where
    // the corridor, the turns ahead and the pictures on the far wall are all
    // visible at once.
    camGoal.set(
      body.x - Math.sin(body.yaw) * 4.6,
      MAZE.height + 2.4,
      body.z - Math.cos(body.yaw) * 4.6,
    );
    pullCameraIn(world, body.x, body.z, camGoal);
    lookGoal.set(body.x, 1.0, body.z);
  } else if (shot === 'shoulder') {
    camGoal.set(
      body.x - Math.sin(body.yaw) * 2.6 + Math.cos(body.yaw) * 0.9,
      1.95,
      body.z - Math.cos(body.yaw) * 2.6 - Math.sin(body.yaw) * 0.9,
    );
    pullCameraIn(world, body.x, body.z, camGoal);
    lookGoal.set(body.x, 1.25, body.z);
  } else if (shot === 'pov') {
    // First person. Set outright rather than eased: a POV camera that lags the
    // head reads as motion sickness. Pushed forward of the skull so the head is
    // not sitting in front of the near plane.
    //
    // The eye rides on body.y, so if he is ever knocked down the view goes with
    // him rather than hovering where his head used to be.
    const fx = Math.sin(body.yaw);
    const fz = Math.cos(body.yaw);
    const eye = body.y + EYE_H;
    camera.position.set(body.x + fx * 0.22, eye, body.z + fz * 0.22);
    // Level. The aim point used to sit 0.08 m below the eye, which tilted the
    // whole view a third of a degree down for no reason.
    controls.target.set(body.x + fx * 12, eye, body.z + fz * 12);
    controls.update();
    return;
  } else if (shot === 'top') {
    camGoal.set(0, MAZE.outerR * 2.1, 0.01);
    lookGoal.set(0, 0, 0);
  } else if (shot === 'duel') {
    const t = flies.find((f) => f.id === zoro.targetId && f.alive) || flies.find((f) => f.alive);
    if (!t) {
      controls.update();
      return;
    }
    const mx = (body.x + t.state.x) / 2;
    const mz = (body.z + t.state.z) / 2;
    const d = Math.max(Math.hypot(t.state.x - body.x, t.state.z - body.z), 2);
    camGoal.set(mx + d * 0.85, 2.3 + d * 0.22, mz + d * 0.85);
    pullCameraIn(world, mx, mz, camGoal);
    lookGoal.set(mx, 1.25, mz);
  }

  camera.position.lerp(camGoal, k);
  controls.target.lerp(lookGoal, k);
  controls.update();
}

function updateReadout(st, zs) {
  el('r-speed').textContent = Math.abs(st.speed).toFixed(2) + ' m/s';
  el('r-step').textContent = st.stepHz.toFixed(2) + ' Hz';
  el('r-sync').textContent = st.tripodSync.toFixed(2);
  el('r-landmark').textContent = landmarkEnabled ? 'on' : 'off';
  el('r-fps').textContent = fps.toFixed(0);
  el('r-weapon').textContent = zs.weapon;
  el('r-kills').textContent = zs.hits + ' shot / ' + score.cuts + ' cut';
  el('r-flies').textContent = flies.filter((f) => f.alive).length + ' / ' + FLIES;

  const total = Math.max(1, activePoints().length - 1);
  const pct = (marchIndex / total) * 100;
  el('r-room').textContent = won
    ? 'CENTRE reached'
    : 'ring ' + Math.max(0, ringAt(body.x, body.z));
  el('r-progress').textContent = marchIndex + ' / ' + total + ' (' + pct.toFixed(0) + '%)';
  const ts = tour.state();
  el('r-viewed').textContent = ts.viewed + ' / ' + ts.required
    + (ts.looking !== null ? '  (looking ' + ts.left.toFixed(1) + 's)' : '');
  el('r-viewed').style.color = ts.satisfied ? '#4f9e57' : '#9a9aa2';
  const act = el('r-doing');
  if (retaliate) { act.textContent = 'RETALIATING'; act.style.color = '#e05a45'; }
  else if (ts.looking !== null) { act.textContent = 'viewing art'; act.style.color = '#e0b341'; }
  else if (finale) {
    act.textContent = finale.sit > 0.05 ? 'sitting down' : 'to the chair';
    act.style.color = '#6fd07d';
  } else if (won) { act.textContent = 'seated'; act.style.color = '#6fd07d'; }
  else if (!ts.satisfied && marchIndex >= activePoints().length - 1) {
    act.textContent = 'back for missed art'; act.style.color = '#e0b341';
  } else { act.textContent = 'marching'; act.style.color = '#9a9aa2'; }

  el('r-mode').textContent = routeMode === 'shortest'
    ? 'shortest (BFS)'
    : 'coverage (every corridor)';

  const compassErr = (wrapPi(st.headingEstimate - body.yaw) * 180) / Math.PI;
  const e = el('r-cerr');
  e.textContent = (compassErr >= 0 ? '+' : '') + compassErr.toFixed(0) + '°';
  e.style.color = Math.abs(compassErr) > 20 ? '#e05a45' : '#9a9aa2';

  const sc = score.state();
  el('r-score').textContent = String(sc.points);
  el('r-score').style.color = sc.points < 0 ? '#e05a45' : '#9a9aa2';
  el('sc-streak').textContent = sc.streak > 0 ? 'x' + sc.streak : '-';
  el('sc-landed').textContent = String(sc.landings);

  const lf = life.state();
  el('sc-life').textContent = lf.hp + ' / ' + lf.max;
  const bar = el('life-fill');
  bar.style.width = (lf.fraction * 100).toFixed(1) + '%';
  // Green down to half, amber, then red. It is the only warning he gets.
  bar.style.background = lf.fraction > 0.5 ? '#4f9e57'
    : lf.fraction > 0.25 ? '#c9952f' : '#c4392a';
  el('sc-missed').textContent = String(sc.misses);
  el('sc-cool').textContent = sc.cooldownScale.toFixed(2) + '×';
  const ev = el('sc-event');
  if (sc.lastEvent) {
    ev.textContent = sc.lastEvent.label + ' '
      + (sc.lastEvent.points > 0 ? '+' : '') + sc.lastEvent.points;
    ev.style.color = sc.lastEvent.points > 0 ? '#4f9e57' : '#e05a45';
  } else {
    ev.textContent = sc.stunned ? 'STUNNED' : '';
    ev.style.color = '#e0b341';
  }
}

function showDead(on) {
  const d = el('dead');
  if (!d) return;
  d.style.display = on ? 'flex' : 'none';
  if (!on) return;
  const sc = score.state();
  el('dead-stats').innerHTML = 'Brought down after <b>'
    + life.cfg.max + '</b> landings, <b>'
    + marchIndex + '</b> of <b>' + (activePoints().length - 1) + '</b> moves walked, <b>'
    + zoro.hits + '</b> shot and <b>' + score.cuts + '</b> cut, <b>'
    + sc.points + '</b> points.';
}

function showWin(on) {
  const w = el('win');
  if (!w) return;
  w.style.display = on ? 'flex' : 'none';
  if (on) {
    el('win-stats').innerHTML = 'Every corridor walked. <b>'
      + (world.routePoints.length - 1) + '</b> moves, <b>'
      + world.passages.size + '</b> corridors covered, <b>'
      + score.state().points + '</b> points, <b>'
      + zoro.hits + '</b> shot and <b>' + score.cuts + '</b> cut on the way, and <b>'
      + tour.viewedCount + '</b> of <b>' + world.pictures.length
      + '</b> pictures looked at.';
  }
}

(function buildPicker() {
  const host = el('pick-rows');
  host.innerHTML = VARIANTS.map((v, i) => '<button class="pick" data-id="' + v.id + '"'
    + (i === 0 ? ' data-on="1"' : '') + '>'
    + '<span class="pk">' + (i + 1) + '</span>'
    + '<span class="pn">' + v.name + '</span>'
    + '<span class="pd">' + v.note + '</span></button>').join('');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b && player && b.dataset.id !== player.variantId) setPlayer(b.dataset.id);
  });
})();

(function fillPanels() {
  const rep = scaleReport('human');
  const rows = comparisonRows();
  const maxMm = rows[rows.length - 1].mm;

  el('cmp-rows').innerHTML = rows.map((r) => {
    const w = Math.max(2, (Math.log10(r.mm) / Math.log10(maxMm)) * 100);
    const hi = r.label === 'Fly in this scene' || r.label === 'Character';
    return '<div class="cmp"><div class="cmp-l"' + (hi ? ' style="color:#b8b8c0"' : '') + '>'
      + r.label + '</div><div class="cmp-bar"><i style="width:' + w.toFixed(1) + '%'
      + (hi ? ';background:#6fb877' : '') + '"></i></div><div class="cmp-v">'
      + (r.mm < 10 ? r.mm.toFixed(1) : r.mm.toFixed(0)) + ' mm</div><div class="cmp-x">'
      + (r.times < 1.5 ? '1×' : '×' + r.times.toFixed(0)) + '</div></div>';
  }).join('');

  el('cmp-note').innerHTML = 'Scene fly is <b>'
    + (LENGTHS_M.sceneFly * 1000).toFixed(0) + '&nbsp;mm</b>, <b>'
    + (LENGTHS_M.sceneFly / LENGTHS_M.fly).toFixed(0) + '×</b> a real one. '
    + 'Tripled and slowed so it can be hit: <b>authored, not derived</b>. Froude sets the rest '
    + '&mdash; the walk runs <b>' + rep.usedHz + '&nbsp;Hz</b> against a predicted '
    + rep.predictedHz.slow.toFixed(2) + '&ndash;' + rep.predictedHz.fast.toFixed(2)
    + '&nbsp;Hz, and double support falls out at <b>'
    + (doubleSupportFraction() * 100).toFixed(0) + '%</b> of the cycle.';

  el('cap-note').innerHTML = 'Spec: <b>'
    + CAPACITY.multiplier.toExponential(0) + '×</b> the connectome, <b>'
    + CAPACITY.neurons.toExponential(2) + '</b> neurons, about <b>'
    + CAPACITY.vsHuman.toFixed(1) + '×</b> a human brain. <b>Nothing simulates that.</b> '
    + CAPACITY.modulesSimulated + ' modules run. Walking is <b>not</b> upgraded &mdash; the legs '
    + 'are the fly circuit driving measured human gait, following a route from a DFS carve, a BFS '
    + 'and an ordered coverage walk.';
})();

function setPaused(on) {
  paused = on;
  const b = el('stop');
  b.textContent = paused ? 'RESUME' : 'STOP';
  b.dataset.on = paused ? '1' : '';
}

/**
 * The one place the two modes are told apart. In FREE the viewer's input is the
 * only thing that moves the camera; in FOLLOW the rig is.
 */
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  controls.enabled = mode === 'free';
  if (mode === 'free') {
    // Hand over from wherever the rig had got to, with the character as the
    // pivot, so the first drag turns round what was being watched instead of
    // round whatever point the last shot happened to leave behind.
    controls.target.set(body.x, 1.0, body.z);
    controls.update();
  }
  syncViewUi();
}

function setShot(next) {
  shot = next;
  applyFov();
  if (viewMode !== 'follow') setViewMode('follow');
  syncViewUi();
}

/** Point the free camera at the character once. NOT a follow -- it is one move. */
function lookAtHim() {
  if (viewMode !== 'free') return;
  const off = camera.position.clone().sub(controls.target);
  // Keep whatever angle and distance the viewer had chosen; only the pivot moves.
  controls.target.set(body.x, 1.0, body.z);
  camera.position.copy(controls.target).add(off);
  controls.update();
}

/** Pull back until the whole maze is in shot. Also a one-off. */
function frameTheMaze() {
  if (viewMode !== 'free') return;
  controls.target.set(0, 0, 0);
  camera.position.set(0.01, MAZE.outerR * 2.05, MAZE.outerR * 0.75);
  controls.update();
}

function syncViewUi() {
  for (const b of document.querySelectorAll('.vm')) {
    if (b.dataset.mode === viewMode) b.dataset.on = '1';
    else delete b.dataset.on;
  }
  const sh = el('shotrow');
  if (sh) sh.style.display = viewMode === 'follow' ? 'flex' : 'none';
  const fr = el('freerow');
  if (fr) fr.style.display = viewMode === 'free' ? 'flex' : 'none';
  const name = el('r-cam');
  if (name) name.textContent = viewMode === 'free' ? 'free' : 'follow / ' + shot;
  for (const b of document.querySelectorAll('.shot')) {
    if (b.dataset.shot === shot) b.dataset.on = '1';
    else delete b.dataset.on;
  }
}

(function buildViewUi() {
  const host = el('viewbtns');
  if (!host) return;
  host.innerHTML = '<button class="vm" data-mode="free">FREE VIEW</button>'
    + '<button class="vm" data-mode="follow">FOLLOW HIM</button>';
  host.addEventListener('click', (e) => {
    const b = e.target.closest('.vm');
    if (b) setViewMode(b.dataset.mode);
  });

  const row = el('shotrow');
  if (row) {
    row.innerHTML = SHOTS.map((x) => '<button class="shot" data-shot="' + x + '">'
      + x + '</button>').join('');
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.shot');
      if (b) setShot(b.dataset.shot);
    });
  }

  const fr = el('freerow');
  if (fr) {
    // Delegated off the host, like the rows above, so nothing in this file
    // reads an id that only exists once this function has run -- tools/
    // imports.mjs checks every id main.js reads against the page, and an
    // exemption list is a worse answer than not needing one.
    fr.innerHTML = '<button data-act="him">FIND HIM</button>'
      + '<button data-act="maze">WHOLE MAZE</button>'
      + '<button data-act="night" class="nightbtn">NIGHT</button>';
    fr.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'him') lookAtHim();
      else if (b.dataset.act === 'maze') frameTheMaze();
      else if (b.dataset.act === 'night') toggleNight();
    });
  }

  controls.enabled = viewMode === 'free';
  syncViewUi();
}());

el('stop').addEventListener('click', () => setPaused(!paused));

el('look').addEventListener('click', () => {
  // Hide the card so the room is visible; the arrows still turn the model.
  el('win').style.display = 'none';
});

el('dead-restart').addEventListener('click', () => {
  startRun((runSeed * 1103515245 + 12345) >>> 0, player ? player.variantId : undefined);
});

el('restart').addEventListener('click', () => {
  startRun((runSeed * 1103515245 + 12345) >>> 0, player ? player.variantId : undefined);
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // The roster is whatever VARIANTS holds, not a hard-coded four -- adding a
  // character should not need this line edited again.
  if (k >= '1' && k <= String(Math.min(9, VARIANTS.length))) {
    const v = VARIANTS[Number(k) - 1];
    if (v && player && v.id !== player.variantId) setPlayer(v.id);
    return;
  }
  if (k === ' ') {
    setPaused(!paused);
    e.preventDefault();
  }
  if (k === 'f') autoFire = !autoFire;
  if (k === 'l') {
    landmarkEnabled = !landmarkEnabled;
    world.landmarkLight.intensity = landmarkEnabled ? 34 : 4;
  }
  if (k === 'v') setViewMode(viewMode === 'free' ? 'follow' : 'free');
  if (k === 'c') {
    // Only meaningful in FOLLOW. In FREE there is no shot to pick, so pressing
    // it switches into FOLLOW rather than silently doing nothing.
    if (viewMode === 'free') setViewMode('follow');
    else setShot(SHOTS[(SHOTS.indexOf(shot) + 1) % SHOTS.length]);
  }
  if (k === 'g') lookAtHim();
  if (k === 'b') frameTheMaze();
  if (k === 'm') setRouteMode(routeMode === 'coverage' ? 'shortest' : 'coverage');
  if (k === 'r') startRun(runSeed, player ? player.variantId : undefined);
  if (k === 'h') document.body.classList.toggle('bare');
  if (k === 'n') toggleNight();
  // Turn the model by hand. Useful at the end, and harmless during the walk --
  // it rotates the body the viewer sees without touching the heading the brain
  // believes, so the compass readout stays honest.
  if (e.key === 'ArrowLeft') manualYaw += 0.12;
  if (e.key === 'ArrowRight') manualYaw -= 0.12;
});

// Smoothed frame time, and the governor that spends it. Checked a few times a
// second rather than every frame: changing the pixel ratio reallocates the
// drawing buffers, so doing it often would cost more than it saves.
let frameMs = 16.7;
let governorAt = 0;

function stepGovernor(now) {
  if (now - governorAt < 700) return;
  governorAt = now;
  // 22 ms is about 45 fps. Below that it reads as lag, so buy the frame back
  // with resolution. Above 13 ms (77 fps) there is room to spend.
  let want = pixelRatio;
  if (frameMs > 22) want = Math.max(PR_FLOOR, pixelRatio * 0.85);
  else if (frameMs < 13) want = Math.min(PR_CEILING, pixelRatio * 1.08);
  // The dead band between 13 and 22 ms is what stops it oscillating: a change
  // that lands inside it is not a change worth the reallocation.
  if (Math.abs(want - pixelRatio) < 0.03) return;
  pixelRatio = want;
  renderer.setPixelRatio(pixelRatio);
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // After the aspect, because the POV vertical fov is derived from it.
  applyFov();
  hud.resize();
  if (radar) radar.resize();
}
window.addEventListener('resize', resize);

startRun(runSeed);
resize();
requestAnimationFrame(frame);
