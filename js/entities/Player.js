// Player: first-person controller riding the PointerLockControls camera rig.
//
// Movement is relative to the look direction (WASD), Shift runs, Space jumps
// with gravity + ground clamp, and movement is blocked against simple circular
// zone colliders. The player owns health, an inventory of Weapon instances,
// weapon switching, and a first-person viewmodel. takeDamage flashes the screen
// (via HUD) and transitions the Game to LOSE when health reaches 0.

import * as THREE from 'three';
import { Weapon } from './Weapon.js';
import { AssetFactory } from '../assets/AssetFactory.js';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const GRAVITY = 22;
const JUMP_VELOCITY = 7.5;
const PLAYER_RADIUS = 0.4;

export class Player {
  /**
   * @param {object} opts
   * @param {import('three').Camera} opts.camera
   * @param {object} opts.controls PointerLockControls (owns the camera object)
   * @param {AudioManager} [opts.audio]
   */
  constructor(opts = {}) {
    this.camera = opts.camera;
    this.controls = opts.controls;
    this.audio = opts.audio || null;
    // Callbacks wired by the Game: onDeath(), onDamage(amount).
    this.onDeath = opts.onDeath || (() => {});
    this.onDamage = opts.onDamage || (() => {});

    this.maxHealth = 100;
    this.health = 100;
    this.alive = true;

    // Story: the player wakes with only a knife.
    this.inventory = [new Weapon('knife', { audio: this.audio })];
    this.hasGun = false;
    this.currentIndex = 0;

    this._velY = 0;
    this._onGround = true;

    // The controls object is the movement rig; a group with position = feet.
    // PointerLockControls' getObject() (r160: controls.object) is the camera.
    this.rig = (this.controls && this.controls.object) || this.camera;

    // First-person viewmodel attached to the camera.
    this.viewmodel = null;
    this._swingT = 0;
    this._attachViewmodel();

    // Reusable spatial state.
    this.group = { position: new THREE.Vector3() }; // for zombie targeting / range
    this._syncGroupFromRig();
  }

  get currentWeapon() {
    return this.inventory[this.currentIndex];
  }

  _attachViewmodel() {
    if (this.viewmodel) {
      if (this.camera) this.camera.remove(this.viewmodel);
      AssetFactory.disposeObject3D(this.viewmodel);
    }
    const type = this.currentWeapon ? this.currentWeapon.type : 'knife';
    this.viewmodel = AssetFactory.makePlayerViewmodel(type);
    if (this.camera) this.camera.add(this.viewmodel);
  }

  _syncGroupFromRig() {
    const p = this.rig.position;
    this.group.position.set(p.x, p.y - EYE_HEIGHT, p.z);
  }

  setPosition(x, z) {
    this.rig.position.set(x, EYE_HEIGHT, z);
    this._velY = 0;
    this._onGround = true;
    this._syncGroupFromRig();
  }

  giveWeapon(type) {
    if (this.inventory.some((w) => w.type === type)) {
      // Already owned: top up ammo instead.
      const w = this.inventory.find((x) => x.type === type);
      if (w && !w.melee) w.addAmmo(w.clipSize);
      return false;
    }
    this.inventory.push(new Weapon(type, { audio: this.audio }));
    if (type === 'gun') {
      this.hasGun = true;
      // Auto-equip the newly unlocked gun.
      this.switchWeapon(this.inventory.length - 1);
    }
    return true;
  }

  addAmmo(rounds) {
    const gun = this.inventory.find((w) => w.type === 'gun');
    if (!gun) return false;
    gun.addAmmo(rounds);
    return true;
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  switchWeapon(index) {
    if (index < 0 || index >= this.inventory.length) return false;
    if (index === this.currentIndex) return false;
    this.currentIndex = index;
    this._attachViewmodel();
    return true;
  }

  /** Switch by the number key (1 = first, 2 = second). */
  switchWeaponByKey(key) {
    return this.switchWeapon(key - 1);
  }

  reload() {
    const w = this.currentWeapon;
    if (w && !w.melee) return w.reload();
    return false;
  }

  /** Forward look direction (normalized) from the camera. */
  getLookDirection(out) {
    const dir = out || new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }

  /** Trigger the current weapon. Returns the attack result {fired, hits}. */
  attack(targets) {
    const w = this.currentWeapon;
    if (!w) return { fired: false, hits: [] };
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const direction = this.getLookDirection();
    const res = w.attack({ origin, direction, targets, audio: this.audio });
    if (res.fired) this._swingT = 0.18;
    return res;
  }

  takeDamage(n) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - n);
    this.onDamage(n);
    if (this.health <= 0) {
      this.alive = false;
      this.onDeath();
    }
  }

  /**
   * @param {number} dt
   * @param {object} inputKeys current held-key state (Input.keys)
   * @param {object} zone active zone (may expose .colliders: [{x,z,radius}])
   */
  update(dt, inputKeys, zone) {
    // ---- Horizontal movement relative to look direction ----
    const speed = inputKeys.run ? RUN_SPEED : WALK_SPEED;

    // Forward on the XZ plane.
    const forward = _fwd;
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    const right = _right.crossVectors(forward, _up).normalize();

    const move = _move.set(0, 0, 0);
    if (inputKeys.forward) move.add(forward);
    if (inputKeys.back) move.sub(forward);
    if (inputKeys.right) move.add(right);
    if (inputKeys.left) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

    const rig = this.rig;
    const nextX = rig.position.x + move.x;
    const nextZ = rig.position.z + move.z;

    // ---- Collision against circular colliders ----
    const resolved = this._resolveCollision(nextX, nextZ, zone);
    rig.position.x = resolved.x;
    rig.position.z = resolved.z;

    // ---- Gravity + jump ----
    if (inputKeys.jump && this._onGround) {
      this._velY = JUMP_VELOCITY;
      this._onGround = false;
    }
    this._velY -= GRAVITY * dt;
    rig.position.y += this._velY * dt;
    if (rig.position.y <= EYE_HEIGHT) {
      rig.position.y = EYE_HEIGHT;
      this._velY = 0;
      this._onGround = true;
    }

    this._syncGroupFromRig();

    // ---- Viewmodel swing / weapon cooldowns ----
    if (this._swingT > 0) this._swingT = Math.max(0, this._swingT - dt);
    if (this.viewmodel) {
      const s = this._swingT / 0.18;
      this.viewmodel.rotation.x = -s * 0.9;
      this.viewmodel.position.z = s * 0.1;
    }
    for (const w of this.inventory) w.update(dt);
  }

  _resolveCollision(x, z, zone) {
    if (!zone || !Array.isArray(zone.colliders)) return { x, z };
    let px = x;
    let pz = z;
    for (const c of zone.colliders) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const minDist = (c.radius || 1) + PLAYER_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (minDist - d) / d;
        px += dx * push;
        pz += dz * push;
      }
    }
    return { x: px, z: pz };
  }

  dispose() {
    if (!this.viewmodel) return;
    if (this.camera) this.camera.remove(this.viewmodel);
    AssetFactory.disposeObject3D(this.viewmodel);
    this.viewmodel = null;
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export default Player;
