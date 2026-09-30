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
import { Player } from '../entities/Player.js';
import { Zombie } from '../entities/Zombie.js';
import { HUD } from '../ui/HUD.js';

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

    this.objectiveId = 'intro';
    this.objectiveText = 'Survive. Grab your knife and clear the streets.';
    this.zoneName = 'Odisha - Room';
    this.activeZone = null;
    this.kills = 0;

    this._clock = new THREE.Clock();
    this._running = false;
    this._rafId = null;

    this.audio = new AudioManager();

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();

    this.input = new Input(this.camera, this.container);

    // Player rides the PointerLockControls rig created inside Input.
    this.player = new Player({
      camera: this.camera,
      controls: this.input.controls,
      audio: this.audio,
      onDeath: () => this._onPlayerDeath(),
      onDamage: (n) => this._onPlayerDamage(n),
    });

    this.hud = new HUD();

    this._loadPlaceholderZone();
    this.player.setPosition(0, 6);
    this._bindUI();
    this._installTestHooks();

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

    const colliders = [];

    // A few placeholder buildings and props so the scene clearly renders.
    const styles = ['concrete', 'brick', 'slum'];
    for (let i = 0; i < 6; i++) {
      const w = 6 + Math.random() * 6;
      const h = 8 + Math.random() * 14;
      const d = 6 + Math.random() * 6;
      const b = AssetFactory.makeBuilding(w, h, d, styles[i % 3]);
      const angle = (i / 6) * Math.PI * 2;
      const bx = Math.cos(angle) * 22;
      const bz = Math.sin(angle) * 22;
      b.position.set(bx, h / 2, bz);
      group.add(b);
      colliders.push({ x: bx, z: bz, radius: Math.max(w, d) * 0.5 });
    }

    for (let i = 0; i < 8; i++) {
      const crate = AssetFactory.makeProp('crate');
      const cx = (Math.random() - 0.5) * 24;
      const cz = (Math.random() - 0.5) * 24;
      crate.position.set(cx, 0, cz);
      group.add(crate);
      colliders.push({ x: cx, z: cz, radius: 0.7 });
    }

    const zone = { group, name: 'Odisha - Room', colliders, zombies: [], pickups: [] };

    // Seed a couple of starter pickups: the gun (progression) and a medkit.
    this._addPickup(zone, 'gun', 8, -4);
    this._addPickup(zone, 'medkit', -8, -4);
    this._addPickup(zone, 'ammo', 4, -10);

    this.loadZone(zone);
  }

  /** Create a pickup mesh in the zone and register it for proximity checks. */
  _addPickup(zone, type, x, z) {
    const mesh = AssetFactory.makePickup(type);
    mesh.position.set(x, 0, z);
    zone.group.add(mesh);
    zone.pickups.push({ type, mesh, radius: 1.6 });
  }

  /** Spawn a zombie into the active zone. Returns the Zombie. */
  spawnZombie(x, z) {
    if (!this.activeZone) return null;
    if (x == null || z == null) {
      const angle = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 10;
      x = Math.cos(angle) * r;
      z = Math.sin(angle) * r;
    }
    const z1 = new Zombie({ position: { x, z }, audio: this.audio });
    this.activeZone.group.add(z1.group);
    this.activeZone.zombies.push(z1);
    return z1;
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
    // Reset player state and inventory (back to knife only).
    this.player.dispose();
    this.player = new Player({
      camera: this.camera,
      controls: this.input.controls,
      audio: this.audio,
      onDeath: () => this._onPlayerDeath(),
      onDamage: (n) => this._onPlayerDamage(n),
    });

    // Clear and rebuild the zone (zombies + pickups fresh).
    if (this.activeZone && this.activeZone.group) {
      this.scene.remove(this.activeZone.group);
    }
    this.kills = 0;
    this.objectiveId = 'intro';
    this.objectiveText = 'Survive. Grab your knife and clear the streets.';
    this._loadPlaceholderZone();
    this.player.setPosition(0, 6);
    this._beginPlay();
  }

  _onPlayerDamage() {
    if (this.hud) this.hud.flashDamage();
  }

  _onPlayerDeath() {
    this.audio.playSfx('death');
    this.setState(GameState.LOSE);
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
    if (this.state !== GameState.PLAYING) return;

    const actions = this.input.consumeActions();
    const zone = this.activeZone;

    // ---- Player input: weapon switch, reload, interact, attack ----
    if (actions.switchWeapon) {
      if (this.player.switchWeaponByKey(actions.switchWeapon)) {
        this.hud.showMessage(this.player.currentWeapon.config.label + ' equipped', 1200);
      }
    }
    if (actions.reload) {
      if (this.player.reload()) this.hud.showMessage('Reloading...', 900);
    }
    if (actions.interact) this._tryPickup();

    if (actions.attack) {
      const targets = zone && zone.zombies ? zone.zombies : [];
      const res = this.player.attack(targets);
      if (res.fired && res.hits.length) this._afterHits(res.hits);
    }

    // ---- Player movement ----
    this.player.update(dt, this.input.keys, zone);

    // ---- Zombie AI ----
    if (zone && zone.zombies) {
      const list = zone.zombies;
      for (const z of list) z.update(dt, this.player, list);
      // Remove finished-dead zombies and count kills.
      for (let i = list.length - 1; i >= 0; i--) {
        const z = list[i];
        if (!z.alive && z.state === 'DEAD' && z._deathT <= 0) {
          zone.group.remove(z.group);
          list.splice(i, 1);
        }
      }
    }

    // ---- Proximity pickup (auto-grab when very close) ----
    this._checkProximityPickups();

    // ---- HUD ----
    const w = this.player.currentWeapon;
    this.hud.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      weaponLabel: w ? w.config.label : '-',
      ammoLabel: w ? w.ammoLabel() : '',
      isMelee: w ? w.melee : true,
      objectiveText: this.objectiveText,
      zoneName: this.zoneName,
    }, dt);
  }

  /** Apply post-hit bookkeeping: count kills, show toast. */
  _afterHits(hits) {
    for (const h of hits) {
      if (!h.alive) {
        this.kills += 1;
        this.hud.showMessage('Zombie down (' + this.kills + ')', 900);
      }
    }
  }

  _tryPickup() {
    const zone = this.activeZone;
    if (!zone || !zone.pickups) return;
    const pp = this.player.group.position;
    for (let i = zone.pickups.length - 1; i >= 0; i--) {
      const p = zone.pickups[i];
      const dx = pp.x - p.mesh.position.x;
      const dz = pp.z - p.mesh.position.z;
      if (dx * dx + dz * dz <= (p.radius + 0.6) * (p.radius + 0.6)) {
        this._grantPickup(p);
        zone.group.remove(p.mesh);
        zone.pickups.splice(i, 1);
        return; // one per press
      }
    }
  }

  _checkProximityPickups() {
    const zone = this.activeZone;
    if (!zone || !zone.pickups) return;
    const pp = this.player.group.position;
    for (let i = zone.pickups.length - 1; i >= 0; i--) {
      const p = zone.pickups[i];
      // Spin the pickup for visibility.
      p.mesh.rotation.y += 0.03;
      const dx = pp.x - p.mesh.position.x;
      const dz = pp.z - p.mesh.position.z;
      if (dx * dx + dz * dz <= 0.9 * 0.9) {
        this._grantPickup(p);
        zone.group.remove(p.mesh);
        zone.pickups.splice(i, 1);
      }
    }
  }

  _grantPickup(p) {
    this.audio.playSfx('pickup');
    switch (p.type) {
      case 'gun':
        this.player.giveWeapon('gun');
        this.objectiveText = 'You found a gun. Press 1/2 to switch weapons.';
        this.hud.showMessage('Picked up a Pistol! (press 2)', 2000);
        break;
      case 'ammo':
        this.player.addAmmo(24);
        this.hud.showMessage('Picked up ammo (+24)', 1500);
        break;
      case 'medkit':
        this.player.heal(40);
        this.hud.showMessage('Used a medkit (+40 HP)', 1500);
        break;
      default:
        this.hud.showMessage('Picked up ' + p.type, 1500);
        break;
    }
  }

  /** Headless test hooks so combat is exercisable without real mouse input. */
  _installTestHooks() {
    this.test = {
      spawnZombie: (x, z) => this.spawnZombie(x, z),
      attack: () => {
        const zone = this.activeZone;
        const targets = zone && zone.zombies ? zone.zombies : [];
        const res = this.player.attack(targets);
        if (res.fired && res.hits.length) this._afterHits(res.hits);
        return res;
      },
      killAllZombies: () => {
        const zone = this.activeZone;
        if (!zone || !zone.zombies) return 0;
        let n = 0;
        for (const z of zone.zombies) {
          if (z.alive) { z.takeDamage(9999); n += 1; }
        }
        this.kills += n;
        return n;
      },
      giveGun: () => {
        this.player.giveWeapon('gun');
        return this.player.hasGun;
      },
    };
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
    const w = this.player ? this.player.currentWeapon : null;
    const liveZombies = this.activeZone && Array.isArray(this.activeZone.zombies)
      ? this.activeZone.zombies.filter((z) => z.alive).length
      : 0;
    return {
      state: this.state,
      health: this.player ? this.player.health : 0,
      ammo: w && !w.melee ? w.ammo : 0,
      weapon: w ? w.type : 'knife',
      objectiveId: this.objectiveId,
      zombieCount: liveZombies,
      kills: this.kills,
      zone: this.zoneName,
    };
  }

  dispose() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    if (this.player) this.player.dispose();
    if (this.input) this.input.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

export default Game;
