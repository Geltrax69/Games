// Game: state machine + three.js scene setup + render loop.
//
// This is the foundation feature. It stands up the renderer, camera, lighting,
// a placeholder zone (ground + boxes) so the scene renders, wires input and
// audio, and exposes debugState() for the headless verification harness. Later
// features attach the real player, zones, entities, HUD, and quest flow.

import * as THREE from 'three';
import { Input } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { AssetFactory } from '../assets/AssetFactory.js';

export const GameState = {
  START: 'START',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  WIN: 'WIN',
  LOSE: 'LOSE',
};

export class Game {
  constructor({ container }) {
    this.container = container || document.body;
    this.state = GameState.START;

    // Placeholder gameplay values; real systems fill these in later features.
    this.health = 100;
    this.ammo = 0;
    this.weapon = 'knife';
    this.objectiveId = 'intro';
    this.zoneName = 'Odisha - Room';
    this.activeZone = null;

    this._clock = new THREE.Clock();
    this._running = false;
    this._rafId = null;

    this.audio = new AudioManager();

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();

    this.input = new Input(this.camera, this.container);

    this._loadPlaceholderZone();
    this._bindUI();

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._loop = this._loop.bind(this);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1f2a);
    this.scene.fog = new THREE.Fog(0x1a1f2a, 30, 140);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 1.7, 6);
  }

  _initLights() {
    const ambient = new THREE.AmbientLight(0x556070, 0.7);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xfff0d8, 1.1);
    dir.position.set(20, 40, 15);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 120;
    dir.shadow.camera.left = -60;
    dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 60;
    dir.shadow.camera.bottom = -60;
    this.scene.add(dir);
    this.sun = dir;
  }

  /**
   * Swap the active zone. A zone is expected to expose a `group` (THREE.Object3D)
   * and optional `name`. Placeholder zones are plain objects for now.
   */
  loadZone(zone) {
    if (this.activeZone && this.activeZone.group) {
      this.scene.remove(this.activeZone.group);
    }
    this.activeZone = zone;
    if (zone && zone.group) this.scene.add(zone.group);
    if (zone && zone.name) this.zoneName = zone.name;
  }

  _loadPlaceholderZone() {
    const group = new THREE.Group();
    group.name = 'placeholder-zone';

    group.add(AssetFactory.makeGround(200));

    // A few placeholder buildings and props so the scene clearly renders.
    const styles = ['concrete', 'brick', 'slum'];
    for (let i = 0; i < 6; i++) {
      const b = AssetFactory.makeBuilding(6 + Math.random() * 6, 8 + Math.random() * 14, 6 + Math.random() * 6, styles[i % 3]);
      const angle = (i / 6) * Math.PI * 2;
      b.position.set(Math.cos(angle) * 22, b.geometry.parameters.height / 2, Math.sin(angle) * 22);
      group.add(b);
    }

    for (let i = 0; i < 8; i++) {
      const crate = AssetFactory.makeProp('crate');
      crate.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24);
      group.add(crate);
    }

    this.loadZone({ group, name: 'Odisha - Room' });
  }

  _bindUI() {
    const startBtn = document.getElementById('start-button');
    const winBtn = document.getElementById('win-restart-button');
    const loseBtn = document.getElementById('lose-restart-button');

    if (startBtn) startBtn.addEventListener('click', () => this._beginPlay());
    if (winBtn) winBtn.addEventListener('click', () => this._restart());
    if (loseBtn) loseBtn.addEventListener('click', () => this._restart());
  }

  _beginPlay() {
    // AudioContext must be created from a user gesture.
    this.audio.resume();
    this.setState(GameState.PLAYING);
    this.input.setEnabled(true);
    this.input.requestLock();
  }

  _restart() {
    this.health = 100;
    this.ammo = 0;
    this.weapon = 'knife';
    this.objectiveId = 'intro';
    this._beginPlay();
  }

  setState(next) {
    this.state = next;

    const startScreen = document.getElementById('start-screen');
    const winScreen = document.getElementById('win-screen');
    const loseScreen = document.getElementById('lose-screen');
    const hud = document.getElementById('hud');
    const crosshair = document.getElementById('crosshair');

    const show = (el, on) => { if (el) el.classList.toggle('hidden', !on); };

    show(startScreen, next === GameState.START);
    show(winScreen, next === GameState.WIN);
    show(loseScreen, next === GameState.LOSE);
    show(hud, next === GameState.PLAYING || next === GameState.PAUSED);
    show(crosshair, next === GameState.PLAYING);

    if (next !== GameState.PLAYING) {
      this.input.setEnabled(false);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.setState(GameState.START);
    this._clock.start();
    this._rafId = requestAnimationFrame(this._loop);
  }

  _loop() {
    this._rafId = requestAnimationFrame(this._loop);
    // Clamp delta so a tab switch / long frame does not cause a huge jump.
    const dt = Math.min(this._clock.getDelta(), 0.1);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    if (this.state === GameState.PLAYING) {
      // Consume one-shot inputs so they do not leak across frames. Real
      // gameplay wiring lands in later features.
      this.input.consumeActions();
      // Gentle idle rotation of the camera is intentionally omitted; the
      // player controller will own the camera in later features.
    }
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** State snapshot for the headless verification harness. */
  debugState() {
    return {
      state: this.state,
      health: this.health,
      ammo: this.ammo,
      weapon: this.weapon,
      objectiveId: this.objectiveId,
      zombieCount: this.activeZone && Array.isArray(this.activeZone.zombies)
        ? this.activeZone.zombies.length
        : 0,
      zone: this.zoneName,
    };
  }

  dispose() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    if (this.input) this.input.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

export default Game;
