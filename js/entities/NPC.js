// NPC: friendly, hostile, and scientist non-player characters.
//
// Friendly / scientist NPCs idle and gently wander around an anchor point and
// can be interacted with (E) to show dialogue lines and advance the quest via
// an onInteract callback. Hostile NPCs behave like zombies: they chase the
// player and deal contact damage on a cooldown.
//
// Per the design, ALL NPCs are killable by the player's weapons (they expose
// .alive, .group.position, .radius, and takeDamage(n) just like a Zombie so
// the Weapon hit resolution treats them identically). Killing a quest-critical
// friendly NPC is allowed but must never soft-lock the game: the QuestManager
// exposes a self-serve fallback, and the NPC surfaces a warning message when
// it dies via the onDeath callback.

import * as THREE from 'three';
import { AssetFactory } from '../assets/AssetFactory.js';
import { CharacterAnimator } from './CharacterAnimator.js';

export const NPCKind = {
  FRIENDLY: 'friendly',
  HOSTILE: 'hostile',
  SCIENTIST: 'scientist',
};

export class NPC {
  /**
   * @param {object} opts
   * @param {string} opts.kind 'friendly' | 'hostile' | 'scientist'
   * @param {{x:number,z:number}} opts.position anchor / spawn position
   * @param {string} [opts.id] stable id used by quest wiring
   * @param {string[]} [opts.dialogue] lines shown when interacted with
   * @param {boolean} [opts.questCritical] surfaces a warning if killed
   * @param {AudioManager} [opts.audio]
   * @param {(npc:NPC)=>void} [opts.onInteract]
   * @param {(npc:NPC)=>void} [opts.onDeath]
   */
  constructor(opts = {}) {
    this.kind = opts.kind || NPCKind.FRIENDLY;
    this.id = opts.id || ('npc-' + Math.random().toString(36).slice(2, 7));
    this.audio = opts.audio || null;
    this.dialogue = opts.dialogue || ['...'];
    this.questCritical = !!opts.questCritical;
    this.onInteract = opts.onInteract || (() => {});
    this.onDeath = opts.onDeath || (() => {});

    this.group = AssetFactory.makeNPC(this.kind);
    const p = opts.position || { x: 0, z: 0 };
    this._anchor = new THREE.Vector3(p.x || 0, 0, p.z || 0);
    this.group.position.set(p.x || 0, 0, p.z || 0);

    this.hostile = this.kind === NPCKind.HOSTILE;

    this.maxHealth = this.hostile ? 70 : 50;
    this.health = this.maxHealth;
    this.alive = true;
    this.radius = 0.5;

    this._dialogueIndex = 0;

    // Wander / hostile movement state.
    this.speed = this.hostile ? 2.6 : 1.1;
    this.senseRadius = this.hostile ? 16 : 20;
    this.attackRange = 1.6;
    this.attackDamage = 8;
    this.attackCooldown = 1.2;
    this._attackCd = 0;
    this._wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this._wanderT = 1 + Math.random() * 3;

    this._animator = new CharacterAnimator(this.group, {
      idle: this.hostile ? ['fight_idle', 'idle'] : 'idle',
      walk: 'run',
      attack: ['fight_punch', 'fight_kick'],
    }, { timeScale: 0.92 + Math.random() * 0.16 });
    this._animator.play('idle', { phase: Math.random(), fade: 0 });

    // Death collapse timer.
    this._deathT = 0;
  }

  /** Next dialogue line (cycles, keeping the last as the "resting" line). */
  nextDialogueLine() {
    const line = this.dialogue[Math.min(this._dialogueIndex, this.dialogue.length - 1)];
    if (this._dialogueIndex < this.dialogue.length - 1) this._dialogueIndex += 1;
    return line;
  }

  /** Player pressed E within range. Friendly/scientist only. Returns a line. */
  interact() {
    if (!this.alive || this.hostile) return null;
    const line = this.nextDialogueLine();
    this.onInteract(this);
    return line;
  }

  takeDamage(n) {
    if (!this.alive) return;
    this.health -= n;
    if (this.audio) this.audio.playSfx('hit');
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this._deathT = 1.2;
    this._animator.pause();
    if (this.audio) this.audio.playSfx('death');
    this.onDeath(this);
  }

  /** True once the death collapse animation is finished (safe to remove). */
  isRemovable() {
    return !this.alive && this._deathT <= 0;
  }

  /**
   * @param {number} dt
   * @param {object} player has .group.position + takeDamage(n)
   * @param {Array} [zombies] unused; kept for signature parity
   */
  update(dt, player /*, zombies */) {
    if (!this.alive) {
      if (this._deathT > 0) {
        this._deathT -= dt;
        const t = Math.max(0, this._deathT / 1.2);
        this.group.rotation.x = (1 - t) * (Math.PI / 2);
        this.group.position.y = -(1 - t) * 0.4;
      }
      return;
    }

    if (this._attackCd > 0) this._attackCd = Math.max(0, this._attackCd - dt);

    const myPos = this.group.position;
    const toPlayer = _v1.set(0, 0, 0);
    let dist = Infinity;
    if (player && player.group) {
      toPlayer.copy(player.group.position).sub(myPos);
      toPlayer.y = 0;
      dist = toPlayer.length();
    }

    let animationState;
    if (this.hostile) {
      animationState = this._updateHostile(dt, player, toPlayer, dist, myPos);
    } else {
      animationState = this._updateFriendly(dt, myPos);
    }

    if (this._animator.enabled) {
      const timeScale = animationState === 'walk'
        ? (this.hostile ? 1.05 : 0.58)
        : (animationState === 'attack' ? 1.08 : 1);
      this._animator.play(animationState, { timeScale });
      this._animator.update(dt);
    }
  }

  _updateHostile(dt, player, toPlayer, dist, myPos) {
    if (dist <= this.attackRange) {
      if (this._attackCd <= 0 && player && typeof player.takeDamage === 'function') {
        this._attackCd = this.attackCooldown;
        player.takeDamage(this.attackDamage);
      }
      return 'attack';
    }
    if (dist <= this.senseRadius && dist > 0.0001) {
      const move = _v2.copy(toPlayer).normalize();
      myPos.x += move.x * this.speed * dt;
      myPos.z += move.z * this.speed * dt;
      this.group.rotation.y = Math.atan2(move.x, move.z);
      return 'walk';
    }
    return 'idle';
  }

  _updateFriendly(dt, myPos) {
    this._wanderT -= dt;
    if (this._wanderT <= 0) {
      this._wanderT = 2 + Math.random() * 4;
      this._wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }
    // Gentle wander that stays near the anchor.
    const toAnchor = _v3.copy(this._anchor).sub(myPos);
    toAnchor.y = 0;
    const anchorDist = toAnchor.length();
    const move = _v2.copy(this._wanderDir);
    if (anchorDist > 4) {
      move.copy(toAnchor).normalize();
    }
    myPos.x += move.x * this.speed * dt;
    myPos.z += move.z * this.speed * dt;
    if (move.lengthSq() > 0.0001) this.group.rotation.y = Math.atan2(move.x, move.z);
    return move.lengthSq() > 0.0001 ? 'walk' : 'idle';
  }

  dispose() {
    if (this._animator) this._animator.dispose();
    AssetFactory.disposeObject3D(this.group);
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export default NPC;
