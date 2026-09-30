// Animation-state adapter shared by Zombie and NPC.
// Imported clips keep the original mixer path. The CC0 human ships without
// clips, so human NPCs use a compact additive armature driver over bone rests.

import * as THREE from 'three';

const _manualEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _manualQuaternion = new THREE.Quaternion();

export class CharacterAnimator {
  constructor(group, clipNames = {}, options = {}) {
    this.group = group;
    this.root = group && group.userData.animationRoot;
    this.clips = (group && group.userData.animationClips) || [];
    this.mixer = null;
    this.actions = new Map();
    this.current = null;
    this.currentName = '';
    this.baseTimeScale = options.timeScale || 1;

    this.manualRig = group && group.userData.manualRig;
    this.manualRests = new Map();
    this.manualOffsets = new Map();
    this.manualTargets = new Map();
    this.manualState = 'idle';
    this.manualTime = 0;
    this.manualTimeScale = this.baseTimeScale;
    this.manualPaused = false;
    this.manualPhaseSet = false;
    this.manualPosition = new THREE.Vector3();
    this.manualTargetPosition = new THREE.Vector3();

    const manualBones = this.manualRig && this.manualRig.bones;
    if (manualBones) {
      for (const [name, bone] of Object.entries(manualBones)) {
        if (!bone || !bone.isBone) continue;
        this.manualRests.set(name, {
          bone,
          quaternion: bone.quaternion.clone(),
          position: bone.position.clone(),
        });
        this.manualOffsets.set(name, new THREE.Vector3());
        this.manualTargets.set(name, new THREE.Vector3());
      }
    }

    const hasManualRig = this.manualRests.size > 0;
    const hasClipRig = !!(this.root && this.clips.length);
    this.enabled = hasManualRig || hasClipRig;
    if (!this.enabled || hasManualRig) return;

    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [stateName, wantedNames] of Object.entries(clipNames)) {
      const names = Array.isArray(wantedNames) ? wantedNames : [wantedNames];
      const clip = names
        .map((name) => THREE.AnimationClip.findByName(this.clips, name))
        .find(Boolean);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      this.actions.set(stateName, action);
    }

    group.userData.animationMixer = this.mixer;
  }

  play(name, options = {}) {
    if (!this.enabled) return false;

    if (this.manualRests.size) {
      this.manualState = ['idle', 'walk', 'attack'].includes(name) ? name : 'idle';
      this.currentName = this.manualState;
      this.manualTimeScale = (options.timeScale || 1) * this.baseTimeScale;
      if (!this.manualPhaseSet && Number.isFinite(options.phase)) {
        this.manualTime = (((options.phase % 1) + 1) % 1) * Math.PI * 2;
        this.manualPhaseSet = true;
      }
      return true;
    }

    const next = this.actions.get(name);
    if (!next) return false;

    const timeScale = (options.timeScale || 1) * this.baseTimeScale;
    next.setEffectiveTimeScale(timeScale);
    if (this.current === next) return true;

    const previous = this.current;
    next.reset();
    if (Number.isFinite(options.phase) && next.getClip().duration > 0) {
      next.time = ((options.phase % 1) + 1) % 1 * next.getClip().duration;
    }
    next.setEffectiveWeight(1);
    next.play();

    if (previous) {
      previous.crossFadeTo(next, options.fade == null ? 0.22 : options.fade, false);
    }
    this.current = next;
    this.currentName = name;
    return true;
  }

  update(dt) {
    if (this.manualRests.size) {
      this._updateManualRig(dt);
    } else if (this.mixer) {
      this.mixer.update(dt);
    }
  }

  _target(name, x = 0, y = 0, z = 0) {
    const target = this.manualTargets.get(name);
    if (target) target.set(x, y, z);
  }

  _updateManualRig(dt) {
    if (this.manualPaused || !Number.isFinite(dt) || dt <= 0) return;
    this.manualTime += dt * this.manualTimeScale;

    for (const target of this.manualTargets.values()) target.set(0, 0, 0);
    this.manualTargetPosition.set(0, 0, 0);

    const t = this.manualTime;
    const breathe = Math.sin(t * 1.7);
    const weight = Math.sin(t * 0.73 + 0.8);
    const hostile = this.manualRig.kind === 'hostile';

    // Shared low-amplitude breathing and weight shift keep every state alive.
    this._target('lowerSpine', -0.012 * breathe, 0, 0.008 * weight);
    this._target('midSpine', 0.018 * breathe, 0, -0.006 * weight);
    this._target('chest', 0.012 * breathe, 0.012 * weight, 0);
    this._target('neck', -0.008 * breathe, 0, 0);
    this._target('head', -0.006 * breathe, -0.012 * weight, 0.006 * weight);
    this.manualTargetPosition.set(0.006 * weight, 0.004 + 0.004 * breathe, 0);

    if (this.manualState === 'walk') {
      const stride = Math.sin(t * 6.15);
      const counter = Math.sin(t * 12.3);
      const leftLift = Math.max(0, stride);
      const rightLift = Math.max(0, -stride);

      this._target('thighL', 0.48 * stride, 0, 0.025 * counter);
      this._target('thighR', -0.48 * stride, 0, -0.025 * counter);
      this._target('shinL', 0.52 * leftLift, 0, 0);
      this._target('shinR', 0.52 * rightLift, 0, 0);
      this._target('footL', -0.2 * leftLift, 0, 0);
      this._target('footR', -0.2 * rightLift, 0, 0);
      this._target('upperArmL', -0.42 * stride, 0, -0.035);
      this._target('upperArmR', 0.42 * stride, 0, 0.035);
      this._target('forearmL', 0.12 + 0.14 * rightLift, 0, 0);
      this._target('forearmR', 0.12 + 0.14 * leftLift, 0, 0);
      this._target('chest', 0.01 * breathe, -0.065 * stride, 0.018 * weight);
      this.manualTargetPosition.set(0.018 * stride, 0.012 + Math.abs(counter) * 0.012, 0);
    } else if (this.manualState === 'attack') {
      const punch = 0.5 - 0.5 * Math.cos(t * 5.6);
      const recoil = Math.sin(t * 5.6) * 0.06;

      // Left arm guards while the right arm drives a repeating punch.
      this._target('upperArmL', 0.52, 0.08, -0.12);
      this._target('forearmL', 0.82, 0.02, 0.06);
      this._target('upperArmR', 0.42 + 0.88 * punch, -0.08, 0.1);
      this._target('forearmR', 0.92 * (1 - punch) + 0.05, -0.02, -0.04);
      this._target('handR', -0.1 * punch, 0, 0);
      this._target('chest', -0.03 + recoil, -0.2 + 0.34 * punch, -0.04);
      this._target('head', 0.03, -0.08 + 0.1 * punch, 0.02);
      this._target('thighL', 0.08, 0, 0.04);
      this._target('thighR', -0.08, 0, -0.04);
      this.manualTargetPosition.set(0, 0.006, 0.035 * punch);
    } else if (hostile) {
      // A restrained guard pose distinguishes hostiles from relaxed survivors.
      this._target('upperArmL', 0.34 + 0.025 * breathe, 0.04, -0.08);
      this._target('forearmL', 0.72, 0, 0.05);
      this._target('upperArmR', 0.28 - 0.025 * breathe, -0.04, 0.08);
      this._target('forearmR', 0.62, 0, -0.05);
      this._target('chest', 0.012 * breathe, -0.08, -0.02);
    } else {
      // Relaxed elbows and asymmetry avoid a rigid mannequin read at rest.
      this._target('upperArmL', 0.025 * breathe, 0, -0.035);
      this._target('upperArmR', -0.025 * breathe, 0, 0.035);
      this._target('forearmL', 0.075 + 0.015 * weight, 0, 0);
      this._target('forearmR', 0.055 - 0.015 * weight, 0, 0);
    }

    // Exponential convergence doubles as state blending and smooths sampled
    // sine targets without allowing state changes to snap the armature.
    const response = this.manualState === 'attack' ? 11 : 8;
    const alpha = 1 - Math.exp(-dt * response);
    for (const [name, rest] of this.manualRests) {
      const offset = this.manualOffsets.get(name);
      const target = this.manualTargets.get(name);
      offset.lerp(target, alpha);
      _manualEuler.set(offset.x, offset.y, offset.z);
      _manualQuaternion.setFromEuler(_manualEuler);
      rest.bone.quaternion.copy(rest.quaternion).multiply(_manualQuaternion);
    }

    const rootRest = this.manualRests.get('root');
    if (rootRest) {
      this.manualPosition.lerp(this.manualTargetPosition, alpha);
      rootRest.bone.position.copy(rootRest.position).add(this.manualPosition);
    }
  }

  pause() {
    if (this.manualRests.size) this.manualPaused = true;
    if (this.mixer) this.mixer.timeScale = 0;
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      for (const action of this.actions.values()) {
        this.mixer.uncacheAction(action.getClip(), this.root);
      }
      this.mixer.uncacheRoot(this.root);
      if (this.group && this.group.userData.animationMixer === this.mixer) {
        delete this.group.userData.animationMixer;
      }
    }

    this.actions.clear();
    this.manualRests.clear();
    this.manualOffsets.clear();
    this.manualTargets.clear();
    this.current = null;
    this.mixer = null;
    this.manualRig = null;
    this.enabled = false;
  }
}

export default CharacterAnimator;
