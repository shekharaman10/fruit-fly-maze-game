// The player rig: one of the four humans, carrying both weapons at once.
//
// Following the reference pose: BLADE IN THE RIGHT HAND, FIREARM IN THE LEFT,
// both drawn, neither stowed. The previous build mounted one two-handed weapon
// at a time and swapped visibility, which meant the free hand was empty, the
// arms were solved to grips that were not there, and the hold looked wrong in
// both modes.
//
// Consequences of the change, all deliberate:
//   - Each weapon is held ONE-handed, so each arm solves to exactly one grip.
//   - The firearm is the compact carbine, because a full-length rifle held in
//     one hand reads as a mistake rather than as a style.
//   - Nothing is hidden, so the silhouette carries both weapons at all times
//     and switching between them is a change of which one is being USED.
//
// Factored out of main.js so the headless tests build what the scene builds.

import * as THREE from '../vendor/three.module.js';
import { buildHuman, VARIANTS } from './human.js';
import { buildRifle } from './rifle.js';
import { buildSword, buildSwingTrail, updateSwingTrail } from './sword.js';

// Rest pose for the firearm: carried low and forward, muzzle down.
export const GUN_REST = { yaw: -1.35, roll: -0.40, pitch: 0 };

export function buildPlayer(variantId = VARIANTS[0].id) {
  const human = buildHuman(variantId);
  const anchor = human.parts.weaponAnchor;

  // --- right hand: the katana ----------------------------------------------
  const swordMount = new THREE.Group();
  swordMount.position.set(-0.16, 0.26, 0.06); // -X is the figure's right
  anchor.add(swordMount);

  const sword = buildSword();
  sword.position.copy(sword.userData.grip).multiplyScalar(-1);
  swordMount.add(sword);

  // The trail is a record of where the blade HAS BEEN, so it cannot be a child
  // of the blade -- in the sword's own space nothing moves relative to it and
  // there is nothing to draw. It hangs off the figure instead, which is the
  // space the arc stays put in while he keeps walking.
  const trail = buildSwingTrail();
  human.group.add(trail);

  // --- left hand: the carbine ----------------------------------------------
  const gunMount = new THREE.Group();
  gunMount.position.set(0.18, -0.02, 0.06);
  gunMount.rotation.set(GUN_REST.pitch, GUN_REST.yaw, GUN_REST.roll);
  anchor.add(gunMount);

  const rifle = buildRifle({ compact: true });
  rifle.position.copy(rifle.userData.grip).multiplyScalar(-1);
  gunMount.add(rifle);

  const muzzle = new THREE.Object3D();
  muzzle.position.copy(rifle.userData.muzzle);
  rifle.add(muzzle);

  return {
    human, sword, swordMount, trail, rifle, gunMount, muzzle, variantId,
    // Last pose from the Swing, so callers can feed the torso twist and the
    // weight drop into poseHuman without re-deriving them.
    swingPose: { twist: 0, lean: 0, u: 0, speed: 0, blur: 0 },
    _wasSwinging: false,
    // Eased weapon commitment, 0..1 each. Written by applyWeaponPose, read by
    // gripTargets; it lives on the player so neither call needs a new argument.
    hold: { rifle: 0, sword: 0 },
    group: human.group,
    parts: human.parts,
  };
}

/**
 * Point both weapons. The sword follows its own swing clock; the firearm
 * follows the aim solution and falls back to the carry when not engaging.
 *
 * @param {object} player
 * @param {object} zoro  ZoroBrain -- aimYaw, aimPitch, aiming, weapon
 * @param {object} swing Swing
 */
// How much room the katana needs, and how little it will put up with.
//
// MEASURED by tools/clearance.mjs: the blade reaches 1.06 m from the body
// centre at full extension, and the tightest standing spot in the maze has
// 0.95 m to the nearest wall face. So a swing in a corridor goes through the
// wall -- 23% of them did, by up to 0.04 m.
//
// The answer is the one a person would use: bring the point up. Elevating the
// blade shortens its horizontal reach by cos(elevation) without shortening the
// blade, so it is the one adjustment that costs nothing but the angle.
const BLADE_REACH = 1.06;    // m, horizontal, at full extension
const TUCK_ROLL = 1.30;      // mount roll that stands the blade up
const TUCK_FLOOR = 0.85;     // m of room at which it is fully stood up

export function applyWeaponPose(player, zoro, swing, dt = 1 / 60, room = Infinity) {
  // How committed each weapon is, 0..1. These drive the hands as well as the
  // weapons, so they are eased rather than switched: a hand that teleports
  // between two grips is worse than a hand on the wrong one.
  const wantRifle = zoro.weapon === 'rifle' ? zoro.aiming : 0;
  const wantSword = swing.active ? 1 : 0;
  const k = Math.min(1, dt * 12);
  player.hold.rifle += (wantRifle - player.hold.rifle) * k;
  player.hold.sword += (wantSword - player.hold.sword) * k;

  // --- katana ---------------------------------------------------------------
  const p = swing.pose();

  // Stand the blade up when there is not room to hold it out. `room` is the
  // distance to the nearest wall face; at BLADE_REACH there is nothing to do,
  // at TUCK_FLOOR the point is straight up.
  let tuck = 0;
  if (room < BLADE_REACH) {
    tuck = Math.min(1, (BLADE_REACH - room) / (BLADE_REACH - TUCK_FLOOR));
  }
  player.tuck = tuck;
  const roll = p.roll + (TUCK_ROLL - p.roll) * tuck;

  player.swordMount.rotation.set(p.pitch, p.yaw, roll);
  // Sampled after the mount is written, so the ribbon records where the blade
  // is this frame rather than where it was last frame.
  player.swordMount.updateWorldMatrix(true, true);
  const fresh = swing.active && !player._wasSwinging;
  updateSwingTrail(player.trail, player.sword, player.group, p, swing.active, dt, fresh);
  player._wasSwinging = swing.active;
  player.swingPose = p;

  // --- carbine --------------------------------------------------------------
  // The barrel runs along +X. Rotating by (aimYaw - PI/2) about Y sends it to
  // the azimuth the aim solution asked for; elevation is rotation.z.
  // Only aim it when the rifle is the weapon being used -- in melee it stays
  // carried, which is what keeps the reference pose readable.
  const useGun = wantRifle;
  const wantYaw = zoro.aimYaw - Math.PI / 2;

  player.gunMount.rotation.set(
    GUN_REST.pitch,
    GUN_REST.yaw + (wantYaw - GUN_REST.yaw) * useGun,
    GUN_REST.roll + (zoro.aimPitch - GUN_REST.roll) * useGun,
  );
}

const _hr = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _alt = new THREE.Vector3();

/**
 * Grip positions in torso space, for the arm IK.
 *
 * The hands are no longer glued one to each weapon. Both weapons carry a second
 * grip point -- the carbine a forend, the katana the lower half of the tsuka --
 * and the free hand moves onto whichever weapon is actually being used:
 *
 *   shooting   left on the pistol grip, RIGHT crosses to the forend
 *   cutting    right on the tsuka, LEFT crosses to the lower grip
 *   carrying   one hand per weapon, and the hold eases off so the arms swing
 *
 * Nothing is stowed or hidden in any of them; it is the same silhouette with
 * the hands where they would actually be. `player.hold` is written by
 * applyWeaponPose, which every caller runs immediately before this.
 *
 * Both grips and both shoulders live under the torso, so the result is exact
 * rather than a frame behind.
 *
 * @returns {{right: THREE.Vector3, left: THREE.Vector3,
 *            holdRight: number, holdLeft: number}}
 */
export function gripTargets(player) {
  const torso = player.parts.torso;
  const sword = player.sword;
  const rifle = player.rifle;
  sword.updateWorldMatrix(true, false);
  rifle.updateWorldMatrix(true, false);

  const hr = player.hold ? player.hold.rifle : 0;
  const hs = player.hold ? player.hold.sword : 0;
  // A swing owns both hands outright; aiming only gets the right hand to the
  // extent the sword is not mid-cut.
  const toForend = hr * (1 - hs);

  // Right hand: the tsuka, crossing to the carbine's forend while shooting.
  _hr.copy(sword.userData.grip);
  sword.localToWorld(_hr);
  torso.worldToLocal(_hr);
  if (toForend > 0.001) {
    _alt.copy(rifle.userData.foreGrip);
    rifle.localToWorld(_alt);
    torso.worldToLocal(_alt);
    _hr.lerp(_alt, toForend);
  }

  // Left hand: the pistol grip, crossing to the lower tsuka while cutting.
  _hl.copy(rifle.userData.grip);
  rifle.localToWorld(_hl);
  torso.worldToLocal(_hl);
  if (hs > 0.001) {
    _alt.copy(sword.userData.gripLow);
    sword.localToWorld(_alt);
    torso.worldToLocal(_alt);
    _hl.lerp(_alt, hs);
  }

  // Idle, an arm is not clamped to its grip: it keeps some of the gait's
  // counter-swing, which is what "carrying" looks like as against "presenting".
  const CARRY = 0.74;
  const committed = Math.max(hr, hs);
  const hold = CARRY + (1 - CARRY) * committed;

  return { right: _hr, left: _hl, holdRight: hold, holdLeft: hold };
}

export { VARIANTS };
