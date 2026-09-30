// Zone: base class for a self-contained playable location.
//
// A zone owns everything that lives in one place: a THREE.Group holding the
// terrain / buildings / props, a list of circular colliders the player and
// zombies are blocked against, zombie spawn points, NPC placements, pickups,
// and named exit trigger volumes that request travel to another zone. All of
// its geometry is assembled from AssetFactory primitives so the game runs
// fully offline.
//
// Concrete zones (OdishaCity, MedicalFacility) subclass this and implement
// build() to populate the group. The Game calls load(scene) once to attach
// the group and spawn initial zombies/NPCs, unload(scene) to detach it, and
// update(dt, ctx) every frame to run zone-local logic (zombie/NPC AI, pickup
// spin, exit trigger checks).

import * as THREE from 'three';
import { AssetFactory } from '../assets/AssetFactory.js';
import { Zombie } from '../entities/Zombie.js';
import { NPC } from '../entities/NPC.js';

export class Zone {
  /**
   * @param {object} opts
   * @param {string} opts.id  stable zone id used by travel + debugState
   * @param {string} opts.name human-readable name shown in the HUD
   * @param {AudioManager} [opts.audio]
   */
  constructor(opts = {}) {
    this.id = opts.id || 'zone';
    this.name = opts.name || 'Unknown';
    this.audio = opts.audio || null;

    this.group = new THREE.Group();
    this.group.name = 'zone-' + this.id;

    // Circular colliders: { x, z, radius }.
    this.colliders = [];
    // Live entities.
    this.zombies = [];
    this.npcs = [];
    // Pickups: { type, mesh, radius, ingredient?:bool, id? }.
    this.pickups = [];
    // Named exit trigger volumes: { name, target, x, z, radius, requires?, mesh }.
    this.exits = [];
    // Interactable landmarks (research center, helicopter, ...):
    //   { id, x, z, radius, action, mesh }.
    this.interactables = [];
    // Zombie spawn descriptors used at load time.
    this.spawns = [];
    // Where the player is placed when entering this zone (per named entry).
    this.entryPoints = { default: { x: 0, z: 0 } };

    this._built = false;
  }

  /** Subclasses populate group/colliders/pickups/npcs/exits here. */
  build() { /* override */ }

  /** Attach the zone to the scene and spin up its entities. */
  load(scene) {
    if (!this._built) { this.build(); this._built = true; }
    if (scene) scene.add(this.group);
    this._spawnInitialZombies();
    return this;
  }

  /** Detach the zone from the scene. */
  unload(scene) {
    if (scene) scene.remove(this.group);
  }

  _spawnInitialZombies() {
    for (const s of this.spawns) {
      this.spawnZombie(s.x, s.z);
    }
  }

  /** Spawn a zombie into the zone. Returns the Zombie. */
  spawnZombie(x, z) {
    const zed = new Zombie({ position: { x, z }, audio: this.audio });
    this.group.add(zed.group);
    this.zombies.push(zed);
    return zed;
  }

  /** Add an NPC to the zone. Returns the NPC. */
  addNPC(npc) {
    this.npcs.push(npc);
    this.group.add(npc.group);
    return npc;
  }

  /** Register a pickup mesh at (x, z). */
  addPickup(type, x, z, extra = {}) {
    const mesh = AssetFactory.makePickup(extra.visual || type);
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    const p = { type, mesh, radius: extra.radius || 1.6, ...extra };
    this.pickups.push(p);
    return p;
  }

  /**
   * Register a named exit trigger. When the player enters its radius and the
   * (optional) requires() predicate is true, the Game travels to target.
   */
  addExit({ name, target, entry, x, z, radius = 3, requires = null, marker = true }) {
    const exit = { name, target, entry: entry || 'default', x, z, radius, requires };
    if (marker) {
      const mesh = AssetFactory.makeExitMarker();
      mesh.position.set(x, 0, z);
      this.group.add(mesh);
      exit.mesh = mesh;
    }
    this.exits.push(exit);
    return exit;
  }

  /** Register an interactable landmark trigger (E to interact). */
  addInteractable({ id, x, z, radius = 3.5, action, label }) {
    const it = { id, x, z, radius, action, label };
    this.interactables.push(it);
    return it;
  }

  /** Add a circular collider. */
  addCollider(x, z, radius) {
    this.colliders.push({ x, z, radius });
  }

  getColliders() { return this.colliders; }
  getSpawns() { return this.spawns; }
  getExits() { return this.exits; }

  /**
   * Per-frame zone logic: spin pickups, update NPC AI, remove dead entities.
   * Zombie AI is driven by the Game (it owns the player). Here we only handle
   * pickup animation and NPC updates + corpse cleanup.
   * @param {number} dt
   * @param {object} ctx { player }
   */
  update(dt, ctx) {
    for (const p of this.pickups) {
      if (p.mesh) p.mesh.rotation.y += 0.03;
    }
    for (const it of this.interactables) {
      if (it.mesh) it.mesh.rotation.y += 0.01;
    }
    const player = ctx && ctx.player;
    for (const n of this.npcs) n.update(dt, player, this.zombies);
    // Remove NPCs that finished their death collapse.
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      if (!n.alive && n.isRemovable && n.isRemovable()) {
        this.group.remove(n.group);
        this.npcs.splice(i, 1);
      }
    }
  }
}

export default Zone;
