// Bolt-action rifle with a scope, built from primitives.
//
// Laid out along +X: butt at -0.38, muzzle at +0.57. Origin sits at the grip,
// which is the point the right hand is posed to, so the whole prop can be
// parented to the torso and aimed by rotating the group.
//
// Length is 0.95 m rather than a true 1.1 m. The figure is chibi-proportioned
// and a correctly scaled rifle reads as a cannon against that body -- the same
// reason the swords on the original figure are oversized.

import * as THREE from '../vendor/three.module.js';

const WOOD = 0x5a3a24;
const WOOD_DARK = 0x3d2617;
const METAL = 0x2e3238;
const METAL_DARK = 0x1a1d21;
const GLASS = 0x2a4a5a;

function mat(color, rough, metal) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function part(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.compact] Shorten it into a one-handed carbine. The
 *   reference pose carries a firearm in one hand and a blade in the other, and
 *   a full-length rifle held one-handed reads as a mistake rather than a style.
 */
export function buildRifle(opts = {}) {
  const g = new THREE.Group();
  g.name = 'rifle';

  const wood = mat(WOOD, 0.62, 0.05);
  const woodDark = mat(WOOD_DARK, 0.6, 0.05);
  const metal = mat(METAL, 0.38, 0.85);
  const metalDark = mat(METAL_DARK, 0.3, 0.9);
  const glass = new THREE.MeshStandardMaterial({
    color: GLASS, roughness: 0.08, metalness: 0.2,
    emissive: 0x16323d, emissiveIntensity: 0.5,
  });

  // --- Stock: butt, comb, and the wrist that runs into the receiver ---------
  const butt = part(new THREE.BoxGeometry(0.15, 0.115, 0.058), wood, -0.305, -0.012, 0);
  butt.scale.set(1, 1, 0.92);
  g.add(butt);
  g.add(part(new THREE.BoxGeometry(0.008, 0.115, 0.058), metalDark, -0.383, -0.012, 0)); // butt plate
  g.add(part(new THREE.BoxGeometry(0.16, 0.085, 0.05), wood, -0.152, 0.004, 0));          // comb
  g.add(part(new THREE.BoxGeometry(0.10, 0.062, 0.046), wood, -0.052, -0.004, 0));        // wrist

  // Pistol grip, angled down and back under the wrist.
  g.add(part(new THREE.BoxGeometry(0.052, 0.10, 0.044), woodDark, -0.075, -0.068, 0, 0, 0, 0.30));

  // --- Receiver and bolt ----------------------------------------------------
  g.add(part(new THREE.BoxGeometry(0.175, 0.052, 0.042), metal, 0.048, 0.022, 0));
  // Bolt body lying along the receiver, handle turned down on the right side.
  g.add(part(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 12), metal, 0.045, 0.040, 0.021, 0, 0, Math.PI / 2));
  g.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10), metal, 0.012, 0.030, 0.043, Math.PI / 2, 0, 0));
  g.add(part(new THREE.SphereGeometry(0.014, 12, 10), metalDark, 0.012, 0.022, 0.062));

  // --- Trigger and guard ----------------------------------------------------
  g.add(part(new THREE.TorusGeometry(0.026, 0.005, 8, 16, Math.PI), metalDark, -0.016, -0.028, 0, Math.PI / 2, 0, Math.PI));
  g.add(part(new THREE.BoxGeometry(0.006, 0.022, 0.006), metalDark, -0.018, -0.022, 0, 0, 0, 0.2));
  // Magazine floor plate.
  g.add(part(new THREE.BoxGeometry(0.062, 0.012, 0.036), metalDark, 0.028, -0.010, 0));

  // --- Barrel and fore-end --------------------------------------------------
  g.add(part(new THREE.CylinderGeometry(0.0165, 0.0145, 0.44, 16), metal, 0.355, 0.020, 0, 0, 0, Math.PI / 2));
  g.add(part(new THREE.CylinderGeometry(0.0155, 0.0155, 0.012, 16), metalDark, 0.572, 0.020, 0, 0, 0, Math.PI / 2)); // muzzle crown
  const foreEnd = part(new THREE.BoxGeometry(0.235, 0.055, 0.050), wood, 0.245, -0.008, 0);
  g.add(foreEnd);
  g.add(part(new THREE.BoxGeometry(0.030, 0.030, 0.052), woodDark, 0.360, -0.012, 0)); // fore-end tip

  // Sling swivels.
  g.add(part(new THREE.TorusGeometry(0.009, 0.0025, 6, 12), metalDark, 0.345, -0.036, 0, 0, Math.PI / 2, 0));
  g.add(part(new THREE.TorusGeometry(0.009, 0.0025, 6, 12), metalDark, -0.265, -0.062, 0, 0, Math.PI / 2, 0));

  // --- Scope ----------------------------------------------------------------
  const scopeY = 0.092;
  const tube = part(new THREE.CylinderGeometry(0.0175, 0.0175, 0.20, 16), metalDark, 0.052, scopeY, 0, 0, 0, Math.PI / 2);
  g.add(tube);
  // Objective bell at the front, eyepiece at the rear.
  g.add(part(new THREE.CylinderGeometry(0.029, 0.0175, 0.062, 16), metalDark, 0.182, scopeY, 0, 0, 0, -Math.PI / 2));
  g.add(part(new THREE.CylinderGeometry(0.0255, 0.0255, 0.008, 16), glass, 0.212, scopeY, 0, 0, 0, Math.PI / 2));
  g.add(part(new THREE.CylinderGeometry(0.0225, 0.0175, 0.050, 16), metalDark, -0.068, scopeY, 0, 0, 0, Math.PI / 2));
  g.add(part(new THREE.CylinderGeometry(0.019, 0.019, 0.007, 16), glass, -0.092, scopeY, 0, 0, 0, Math.PI / 2));
  // Turret housing.
  g.add(part(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 14), metalDark, 0.072, scopeY + 0.020, 0));
  g.add(part(new THREE.CylinderGeometry(0.013, 0.013, 0.022, 12), metal, 0.072, scopeY + 0.038, 0));
  g.add(part(new THREE.CylinderGeometry(0.013, 0.013, 0.020, 12), metal, 0.072, scopeY, 0.028, Math.PI / 2, 0, 0));
  // Rings mounting it to the receiver.
  for (const x of [-0.018, 0.122]) {
    g.add(part(new THREE.TorusGeometry(0.0205, 0.005, 8, 16), metal, x, scopeY, 0, 0, Math.PI / 2, 0));
    g.add(part(new THREE.BoxGeometry(0.018, 0.040, 0.030), metal, x, scopeY - 0.036, 0));
  }

  // Grip points the arms are posed to, exposed so the character does not have
  // to guess where the hands go.
  g.userData.grip = new THREE.Vector3(-0.075, -0.052, 0);   // trigger hand
  g.userData.foreGrip = new THREE.Vector3(0.245, -0.030, 0); // support hand
  g.userData.muzzle = new THREE.Vector3(0.578, 0.020, 0);

  if (opts.compact) {
    // Shorten along the barrel axis only, so the receiver and scope keep their
    // proportions and it still reads as the same weapon.
    g.scale.set(0.62, 0.86, 0.86);
    g.userData.grip.set(-0.075 * 0.62, -0.052 * 0.86, 0);
    g.userData.foreGrip.set(0.245 * 0.62, -0.030 * 0.86, 0);
    g.userData.muzzle.set(0.578 * 0.62, 0.020 * 0.86, 0);
  }

  return g;
}
