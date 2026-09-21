// Many flies, drawn in a few dozen calls instead of a few thousand.
//
// One fly is 42 meshes. At the old count of eight that was 336 draw calls and
// nobody noticed; at eighty it is 3,360, doubled again by the shadow pass, and
// the frame rate goes with it.
//
// Every fly is the same geometry in a different pose, which is exactly what
// instancing is for. A single prototype fly is built and never added to the
// scene. Each frame it is posed once per fly, its world matrices are harvested,
// and those matrices are written into one InstancedMesh per part. Eighty flies
// then cost 42 draw calls rather than 3,360.
//
// The cost moves to the CPU -- 80 poses and 3,360 matrix composes per frame --
// which is far cheaper than the draw calls it replaces.

import * as THREE from '../vendor/three.module.js';
import { buildFly, makeHalves } from './fly.js';

export class FlySwarm {
  /**
   * @param {THREE.Scene} scene
   * @param {number} capacity how many flies at most
   */
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.scene = scene;

    // The prototype is posed and measured, never rendered.
    this.proto = buildFly();
    this.proto.group.position.set(0, 0, 0);

    this.parts = [];
    this.meshes = [];

    this.proto.group.traverse((o) => {
      if (!o.isMesh) return;
      const inst = new THREE.InstancedMesh(o.geometry, o.material, capacity);
      // NOT o.castShadow. Eighty flies casting shadows means the whole swarm is
      // drawn a second time into the shadow map every frame, for a handful of
      // 2 cm smudges on the floor under a body that is usually 1.4 m up in the
      // air and over a wall from the light. It is the most expensive thing in
      // the scene that nobody can see.
      inst.castShadow = false;
      inst.receiveShadow = false;
      inst.frustumCulled = false; // the flies move; a stale bounds pops them out
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(inst);
      this.parts.push(o);
      this.meshes.push(inst);
    });

    this._m = new THREE.Matrix4();
    // Dead or missing flies are collapsed to nothing rather than removed, so
    // the instance count never has to change.
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  get drawCalls() { return this.meshes.length; }

  /**
   * @param {Array} flies each { alive, state:{x,y,z,yaw,yawRate}, flyBrain }
   */
  update(flies) {
    for (let i = 0; i < this.capacity; i++) {
      const f = flies[i];

      if (!f || !f.alive) {
        for (const m of this.meshes) m.setMatrixAt(i, this._hidden);
        continue;
      }

      // Pose the prototype as this fly, then read where its parts ended up.
      this.proto.group.position.set(f.state.x, f.state.y, f.state.z);
      this.proto.group.rotation.y = f.state.yaw;
      this.proto.pose({
        wingPhase: f.flyBrain.wingPhase,
        thrust: f.flyBrain.thrust,
        bank: Math.max(-0.7, Math.min(0.7, f.state.yawRate * 0.30)),
        pitch: Math.max(-0.4, Math.min(0.4, -f.flyBrain.climb * 0.16)),
        escaping: f.flyBrain.escaping,
      });
      this.proto.group.updateMatrixWorld(true);

      for (let p = 0; p < this.parts.length; p++) {
        this.meshes[p].setMatrixAt(i, this.parts[p].matrixWorld);
      }
    }

    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  /**
   * Two cut halves for one fly. There is no per-fly view any more, so the
   * prototype is posed as that fly and cloned from -- the same thing the old
   * per-fly model did, without keeping eighty of them around.
   */
  halvesFor(f) {
    this.proto.group.position.set(f.state.x, f.state.y, f.state.z);
    this.proto.group.rotation.y = f.state.yaw;
    this.proto.pose({
      wingPhase: f.flyBrain.wingPhase,
      thrust: f.flyBrain.thrust,
      bank: 0,
      pitch: 0,
      escaping: false,
    });
    this.proto.group.updateMatrixWorld(true);
    return makeHalves(this.proto);
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.meshes.length = 0;
    this.parts.length = 0;
  }
}
