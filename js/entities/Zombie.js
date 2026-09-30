// Zombie: procedural mesh + a small AI state machine.
//
// States: IDLE -> WANDER -> CHASE -> ATTACK -> DEAD. The zombie senses the
// player within a radius, walks toward them (with light separation from other
// zombies so they do not perfectly stack), and deals contact damage on a
// cooldown. It has health, growls occasionally, and on death plays a death sfx,
// collapses, and reports the kill so the Game can count and remove it.

import * as THREE from 'three';
import { AssetFactory } from '../assets/AssetFactory.js';

export const ZombieState = {
  IDLE: 'IDLE',
  WANDER: 'WANDER',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  DEAD: 'DEAD',
};

export class Zombie {
  /**
   * @param {object} opts
   * @param {THREE.Vector3|{x,y,z}} opts.position spawn point
   * @param {AudioManager} [opts.audio]
   */
  constructor(opts = {}) {
    this.group = AssetFactory.makeZombie();
    const p = opts.position || { x: 0, y: 0, z: 0 };
    this.group.position.set(p.x || 0, 0, p.z || 0);

    this.audio = opts.audio || null;

    this.maxHealth = 60;
    this.health = 60;
    this.alive = true;
    this.radius = 0.5;

    this.speed = 2.4 + Math.random() * 0.8;
    this.senseRadius = 22;
    this.attackRange = 1.6;
    this.attackDamage = 12;
    this.attackCooldown = 1.0;
    this._attackCd = 0;

    this.state = ZombieState.IDLE;
    this._stateT = Math.random() * 2;
    this._growlT = 2 + Math.random() * 4;
    this._deathT = 0;

    this._wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
  }

  takeDamage(n) {
    if (!this.alive) return;
    this.health -= n;
    if (this.audio) this.audio.playSfx('hit');
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.state = ZombieState.DEAD;
    this._deathT = 1.2;
    if (this.audio) this.audio.playSfx('death');
  }

  /**
   * @param {number} dt
   * @param {object} player has .group.position and takeDamage(n)
   * @param {Array<Zombie>} [others] for separation
   * @returns {boolean} true while the zombie should remain in the scene
   */
  update(dt, player, others) {
    if (this.state === ZombieState.DEAD) {
      // Collapse animation then request removal.
      this._deathT -= dt;
      const t = Math.max(0, this._deathT / 1.2);
      this.group.rotation.x = (1 - t) * (Math.PI / 2);
      this.group.position.y = -(1 - t) * 0.4;
      return this._deathT > 0;
    }

    if (this._attackCd > 0) this._attackCd = Math.max(0, this._attackCd - dt);
    this._growlT -= dt;
    if (this._growlT <= 0) {
      this._growlT = 4 + Math.random() * 6;
      if (this.audio && Math.random() < 0.5) this.audio.playSfx('growl');
    }

    const myPos = this.group.position;
    let dist = Infinity;
    const toPlayer = _v1.set(0, 0, 0);
    if (player && player.group) {
      toPlayer.copy(player.group.position).sub(myPos);
      toPlayer.y = 0;
      dist = toPlayer.length();
    }

    // Decide state.
    if (dist <= this.attackRange) {
      this.state = ZombieState.ATTACK;
    } else if (dist <= this.senseRadius) {
      this.state = ZombieState.CHASE;
    } else {
      this._stateT -= dt;
      if (this._stateT <= 0) {
        this._stateT = 2 + Math.random() * 3;
        this.state = this.state === ZombieState.WANDER ? ZombieState.IDLE : ZombieState.WANDER;
        this._wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      }
    }

    // Movement direction per state.
    const move = _v2.set(0, 0, 0);
    if (this.state === ZombieState.CHASE && dist > 0.0001) {
      move.copy(toPlayer).normalize();
    } else if (this.state === ZombieState.WANDER) {
      move.copy(this._wanderDir);
    }

    // Separation so zombies do not perfectly overlap.
    if (others && move.lengthSq() > 0) {
      const sep = _v3.set(0, 0, 0);
      for (const o of others) {
        if (o === this || !o.alive) continue;
        const away = _v4.copy(myPos).sub(o.group.position);
        away.y = 0;
        const d = away.length();
        if (d > 0.0001 && d < 1.2) {
          sep.add(away.multiplyScalar((1.2 - d) / 1.2 / d));
        }
      }
      move.add(sep.multiplyScalar(0.6));
      if (move.lengthSq() > 0) move.normalize();
    }

    const spd = this.state === ZombieState.CHASE ? this.speed : this.speed * 0.4;
    if (move.lengthSq() > 0) {
      myPos.x += move.x * spd * dt;
      myPos.z += move.z * spd * dt;
      // Face the movement direction.
      this.group.rotation.y = Math.atan2(move.x, move.z);
      // Simple walk bob on the legs for a little life.
      const parts = this.group.userData.parts;
      if (parts) {
        const bob = Math.sin(performance.now() * 0.008) * 0.4;
        parts.legL.rotation.x = bob;
        parts.legR.rotation.x = -bob;
      }
    }

    // Attack on contact.
    if (this.state === ZombieState.ATTACK && this._attackCd <= 0 && player) {
      this._attackCd = this.attackCooldown;
      if (typeof player.takeDamage === 'function') player.takeDamage(this.attackDamage);
    }

    return true;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

export default Zombie;
