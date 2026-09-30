// Weapon: knife (melee cone) + gun (hitscan raycaster) with ammo/reload.
//
// A weapon is a small config-driven object. The player owns one Weapon
// instance per type. attack() resolves hits against a list of live targets
// (zombies / NPCs) and returns the ones that were hit so the caller can apply
// damage and death. All feedback (viewmodel swing, muzzle flash, sfx) is driven
// from here but rendered by the player's attached viewmodel.

import * as THREE from 'three';

// Per-weapon tuning. Keeping this as data makes it easy to add weapons later.
export const WEAPON_CONFIG = {
  knife: {
    type: 'knife',
    label: 'Knife',
    melee: true,
    range: 2.4,
    damage: 34,
    cooldown: 0.42,
    // half-angle of the hit cone (radians) in front of the player
    coneHalfAngle: Math.PI / 4,
    sfx: 'knife',
  },
  gun: {
    type: 'gun',
    label: 'Pistol',
    melee: false,
    range: 80,
    damage: 55,
    cooldown: 0.28,
    clipSize: 12,
    reserveMax: 120,
    reloadTime: 1.1,
    sfx: 'gunshot',
  },
};

export class Weapon {
  /**
   * @param {string} type 'knife' | 'gun'
   * @param {object} [opts] { audio }
   */
  constructor(type, opts = {}) {
    const cfg = WEAPON_CONFIG[type] || WEAPON_CONFIG.knife;
    this.type = cfg.type;
    this.config = cfg;
    this.audio = opts.audio || null;

    this.melee = cfg.melee;
    this.range = cfg.range;
    this.damage = cfg.damage;
    this.cooldown = cfg.cooldown;

    this._cd = 0; // time until next allowed attack

    if (!this.melee) {
      this.clipSize = cfg.clipSize;
      this.ammo = cfg.clipSize;        // rounds in clip
      this.reserve = cfg.clipSize * 2; // spare rounds
      this.reserveMax = cfg.reserveMax;
      this.reloading = false;
      this._reloadT = 0;
    } else {
      this.clipSize = 0;
      this.ammo = 0;
      this.reserve = 0;
    }
  }

  /** Advance cooldowns / reload timer. */
  update(dt) {
    if (this._cd > 0) this._cd = Math.max(0, this._cd - dt);
    if (!this.melee && this.reloading) {
      this._reloadT -= dt;
      if (this._reloadT <= 0) this._finishReload();
    }
  }

  get canAttack() {
    if (this._cd > 0) return false;
    if (!this.melee) {
      if (this.reloading) return false;
      if (this.ammo <= 0) return false;
    }
    return true;
  }

  addAmmo(rounds) {
    if (this.melee) return 0;
    const before = this.reserve;
    this.reserve = Math.min(this.reserveMax, this.reserve + rounds);
    return this.reserve - before;
  }

  reload() {
    if (this.melee || this.reloading) return false;
    if (this.ammo >= this.clipSize) return false;
    if (this.reserve <= 0) return false;
    this.reloading = true;
    this._reloadT = this.config.reloadTime;
    return true;
  }

  _finishReload() {
    this.reloading = false;
    const need = this.clipSize - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
  }

  /**
   * Resolve an attack.
   * @param {object} ctx
   * @param {THREE.Vector3} ctx.origin  world position of the shooter (camera)
   * @param {THREE.Vector3} ctx.direction normalized forward look direction
   * @param {Array} ctx.targets  entities with .alive, .group.position, .radius, takeDamage(n)
   * @param {AudioManager} [ctx.audio]
   * @returns {{fired:boolean, hits:Array}} hits are the entities damaged
   */
  attack(ctx) {
    const audio = ctx.audio || this.audio;
    if (!this.canAttack) return { fired: false, hits: [] };

    this._cd = this.cooldown;

    if (audio) audio.playSfx(this.config.sfx);

    if (this.melee) {
      return { fired: true, hits: this._meleeHits(ctx) };
    }

    this.ammo -= 1;
    return { fired: true, hits: this._hitscanHits(ctx) };
  }

  /** Cone test: any target within range and inside the forward cone is hit. */
  _meleeHits(ctx) {
    const { origin, direction, targets } = ctx;
    const hits = [];
    const toTarget = new THREE.Vector3();
    for (const t of targets) {
      if (!t || !t.alive) continue;
      const pos = t.group ? t.group.position : t.position;
      if (!pos) continue;
      toTarget.copy(pos).sub(origin);
      toTarget.y = 0; // ignore vertical for melee reach
      const dist = toTarget.length();
      const reach = this.range + (t.radius || 0.5);
      if (dist > reach) continue;
      toTarget.normalize();
      const flatDir = _tmpDir.copy(direction);
      flatDir.y = 0;
      flatDir.normalize();
      const cos = flatDir.dot(toTarget);
      if (cos >= Math.cos(this.config.coneHalfAngle)) {
        if (typeof t.takeDamage === 'function') t.takeDamage(this.damage);
        hits.push(t);
      }
    }
    return hits;
  }

  /** Hitscan: raycast forward and damage the nearest target sphere hit. */
  _hitscanHits(ctx) {
    const { origin, direction, targets } = ctx;
    const ray = _ray;
    ray.set(origin, _tmpDir.copy(direction).normalize());

    let best = null;
    let bestDist = Infinity;
    const sphere = _sphere;
    for (const t of targets) {
      if (!t || !t.alive) continue;
      const pos = t.group ? t.group.position : t.position;
      if (!pos) continue;
      // Center the sphere on the torso height for a fair shot.
      sphere.center.set(pos.x, pos.y + 1.1, pos.z);
      sphere.radius = (t.radius || 0.5) + 0.35;
      const hitPoint = ray.ray.intersectSphere(sphere, _tmpHit);
      if (!hitPoint) continue;
      const dist = origin.distanceTo(hitPoint);
      if (dist <= this.range && dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }

    if (best) {
      if (typeof best.takeDamage === 'function') best.takeDamage(this.damage);
      return [best];
    }
    return [];
  }

  /** HUD-facing ammo string. Knife has no ammo. */
  ammoLabel() {
    if (this.melee) return '';
    return `${this.ammo} / ${this.reserve}`;
  }
}

// Scratch objects reused across calls to avoid per-frame allocation.
const _tmpDir = new THREE.Vector3();
const _tmpHit = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _sphere = new THREE.Sphere();

export default Weapon;
