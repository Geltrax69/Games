// Input: keyboard + mouse state and PointerLockControls integration.
//
// Tracks movement keys (WASD), run (Shift), jump (Space), weapon switch (1/2),
// interact (E), reload (R), and mouse buttons. Mouse-look is handled by
// PointerLockControls, which is locked when the player clicks the canvas while
// the game is PLAYING.

import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class Input {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement the render container / canvas
   */
  constructor(camera, domElement) {
    this.domElement = domElement;

    // Movement + action state.
    this.keys = {
      forward: false,
      back: false,
      left: false,
      right: false,
      run: false,
      jump: false,
    };

    // One-shot actions consumed by the game loop (edge-triggered).
    this.actions = {
      switchWeapon: null, // 1 | 2 | null
      interact: false,
      reload: false,
      attack: false,
      attackHeld: false,
    };

    this.controls = new PointerLockControls(camera, document.body);
    this.locked = false;
    this.controls.addEventListener('lock', () => { this.locked = true; });
    this.controls.addEventListener('unlock', () => { this.locked = false; });

    this._enabled = false;
    this._bind();
  }

  /** Enable/disable pointer-lock-on-click. Called by the Game per state. */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  requestLock() {
    if (this._enabled && !this.locked) {
      // requestPointerLock returns a promise in modern browsers; it rejects
      // when there is no trusted user gesture (e.g. headless / synthetic
      // clicks). Swallow that rejection so it does not surface as a game error.
      const p = this.controls.lock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  _bind() {
    this._onKeyDown = (e) => this._handleKey(e, true);
    this._onKeyUp = (e) => this._handleKey(e, false);
    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.actions.attack = true;
        this.actions.attackHeld = true;
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.actions.attackHeld = false;
    };
    this._onCanvasClick = () => this.requestLock();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    if (this.domElement) {
      this.domElement.addEventListener('click', this._onCanvasClick);
    }
  }

  _handleKey(e, down) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = down; break;
      case 'KeyS': case 'ArrowDown': this.keys.back = down; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = down; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.run = down; break;
      case 'Space': this.keys.jump = down; break;
      case 'Digit1': if (down) this.actions.switchWeapon = 1; break;
      case 'Digit2': if (down) this.actions.switchWeapon = 2; break;
      case 'KeyE': if (down) this.actions.interact = true; break;
      case 'KeyR': if (down) this.actions.reload = true; break;
      default: return;
    }
  }

  /** Read + clear the one-shot actions. Call once per game frame. */
  consumeActions() {
    const a = { ...this.actions };
    this.actions.switchWeapon = null;
    this.actions.interact = false;
    this.actions.reload = false;
    this.actions.attack = false;
    return a;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    if (this.domElement) {
      this.domElement.removeEventListener('click', this._onCanvasClick);
    }
  }
}

export default Input;
