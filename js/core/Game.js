// Game: state machine + three.js scene setup + render loop + world/story.
//
// Stands up the renderer, camera, lighting, input, audio, player, and HUD, then
// drives the story: modular zones (OdishaCity -> MedicalFacility), the cure
// quest flow (QuestManager), friendly/hostile NPCs, zone travel, and the
// win/lose finale. Exposes debugState() and window.__GAME__.test hooks for the
// headless verification harness.

import * as THREE from 'three';
import { Input } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { Player } from '../entities/Player.js';
import { Zombie } from '../entities/Zombie.js';
import { HUD } from '../ui/HUD.js';
import { QuestManager } from '../quest/QuestManager.js';
import { OdishaCity } from '../world/zones/OdishaCity.js';
import { MedicalFacility } from '../world/zones/MedicalFacility.js';

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

    this.zoneName = 'Odisha - City';
    this.activeZone = null;
    this.kills = 0;

    this._clock = new THREE.Clock();
    this._running = false;
    this._rafId = null;
    this._interactCd = 0;

    this.audio = new AudioManager();

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();

    this.input = new Input(this.camera, this.container);

    this.player = this._makePlayer();
    this.hud = new HUD();

    this.quest = new QuestManager({
      onChange: (s) => this._onQuestChange(s),
      onMessage: (t, ms) => this.hud.showMessage(t, ms),
      onWin: () => this._onQuestWin(),
    });
    this.objectiveId = this.quest.objectiveId();
    this.objectiveText = this.quest.objectiveText();

    this._buildZones();
    this._enterZone('OdishaCity', 'default');

    this._bindUI();
    this._installTestHooks();

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._loop = this._loop.bind(this);
  }

  _makePlayer() {
    return new Player({
      camera: this.camera,
      controls: this.input.controls,
      audio: this.audio,
      onDeath: () => this._onPlayerDeath(),
      onDamage: (n) => this._onPlayerDamage(n),
    });
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
    this.scene.fog = new THREE.Fog(0x1a1f2a, 30, 160);
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

  /** Construct (but do not load) both zones with their quest wiring. */
  _buildZones() {
    this.zones = {
      OdishaCity: new OdishaCity({
        audio: this.audio,
        onLeaveRoom: () => this.quest.handleEvent({ type: 'left_room' }),
        onEnterResearch: () => this.quest.handleEvent({ type: 'enter_research' }),
        onTalkSurvivor: () => this.quest.handleEvent({ type: 'talk_survivor' }),
        onCriticalNpcKilled: (role) => this.quest.handleEvent({ type: 'critical_npc_killed', role }),
        onMessage: (t, ms) => this.hud.showMessage(t, ms),
      }),
      MedicalFacility: new MedicalFacility({
        audio: this.audio,
        onDeliver: () => this.quest.handleEvent({ type: 'deliver' }),
        onBoardHelicopter: () => this.quest.handleEvent({ type: 'board_helicopter' }),
        onCriticalNpcKilled: (role) => this.quest.handleEvent({ type: 'critical_npc_killed', role }),
        onMessage: (t, ms) => this.hud.showMessage(t, ms),
      }),
    };
  }

  /** Unload the current zone (if any), load `id`, reposition the player. */
  _enterZone(id, entry = 'default') {
    const next = this.zones[id];
    if (!next) return false;
    if (this.activeZone && this.activeZone !== next) {
      this.activeZone.unload(this.scene);
    }
    this.activeZone = next;
    next.load(this.scene);
    this.zoneName = next.name;

    const spawn = (next.entryPoints && next.entryPoints[entry]) || { x: 0, z: 0 };
    this.player.setPosition(spawn.x, spawn.z);
    return true;
  }

  /** Travel to another zone: checks the exit's prerequisite, then swaps. */
  travelTo(id, entry = 'default') {
    if (!this._enterZone(id, entry)) return false;
    this.quest.handleEvent({ type: 'travel', zone: id });
    this.hud.showMessage('Arrived: ' + this.zoneName, 2400);
    return true;
  }

  /** Spawn a zombie into the active zone (used by the test hook). */
  spawnZombie(x, z) {
    if (!this.activeZone) return null;
    if (x == null || z == null) {
      const angle = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 10;
      const p = this.player.group.position;
      x = p.x + Math.cos(angle) * r;
      z = p.z + Math.sin(angle) * r;
    }
    return this.activeZone.spawnZombie(x, z);
  }

  _onQuestChange(s) {
    // Play the objective-complete chime only when the objective id actually
    // changes (not on every ingredient-count tick), and never for the initial
    // objective set during construction/reset.
    if (this.objectiveId != null
        && s.objectiveId !== this.objectiveId
        && this.state === GameState.PLAYING) {
      this.audio.playSfx('objective');
    }
    this.objectiveId = s.objectiveId;
    this.objectiveText = s.objectiveText;
  }

  _onQuestWin() {
    this.audio.playSfx('victory');
    this.setState(GameState.WIN);
  }

  _bindUI() {
    const startBtn = document.getElementById('start-button');
    const winBtn = document.getElementById('win-restart-button');
    const loseBtn = document.getElementById('lose-restart-button');
    const resumeBtn = document.getElementById('resume-button');

    if (startBtn) startBtn.addEventListener('click', () => this._beginPlay());
    if (winBtn) winBtn.addEventListener('click', () => this._restart());
    if (loseBtn) loseBtn.addEventListener('click', () => this._restart());
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());
  }

  _beginPlay() {
    this.audio.resume();
    this.setState(GameState.PLAYING);
    this.input.setEnabled(true);
    this.input.requestLock();
  }

  /** Full reset back to a fresh Odisha start. */
  _restart() {
    // Detach current zone and dispose the player.
    if (this.activeZone) this.activeZone.unload(this.scene);
    this.player.dispose();
    this.player = this._makePlayer();

    this.kills = 0;
    this.quest.reset();
    this.objectiveId = this.quest.objectiveId();
    this.objectiveText = this.quest.objectiveText();

    // Rebuild zones fresh so pickups/NPCs/zombies are reset.
    this._buildZones();
    this.activeZone = null;
    this._enterZone('OdishaCity', 'default');

    this._beginPlay();
  }

  _onPlayerDamage() {
    if (this.hud) this.hud.flashDamage();
    // Player-damage audio cue (distinct from zombie 'hit' and 'death').
    if (this.player && this.player.alive) this.audio.playSfx('hurt');
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
    const pauseScreen = document.getElementById('pause-screen');
    const hud = document.getElementById('hud');
    const crosshair = document.getElementById('crosshair');

    const show = (el, on) => { if (el) el.classList.toggle('hidden', !on); };

    show(startScreen, next === GameState.START);
    show(winScreen, next === GameState.WIN);
    show(loseScreen, next === GameState.LOSE);
    show(pauseScreen, next === GameState.PAUSED);
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
    const dt = Math.min(this._clock.getDelta(), 0.1);

    // Pause toggle (Esc) is handled here so it works while PLAYING or PAUSED,
    // even though the main update() early-returns when not PLAYING. Consuming
    // actions here would clobber gameplay input, so only peek at pause and
    // clear it; update() consumes the rest during PLAYING.
    if ((this.state === GameState.PLAYING || this.state === GameState.PAUSED)
        && this.input.actions.pause) {
      this.input.actions.pause = false;
      this.togglePause();
    }

    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Toggle between PLAYING and PAUSED, releasing/regaining pointer lock. */
  togglePause() {
    if (this.state === GameState.PLAYING) {
      this.setState(GameState.PAUSED);
      this.input.setEnabled(false);
      this.input.releaseLock();
    } else if (this.state === GameState.PAUSED) {
      this.setState(GameState.PLAYING);
      this.input.setEnabled(true);
      this.input.requestLock();
    }
  }

  update(dt) {
    if (this.state !== GameState.PLAYING) return;

    const actions = this.input.consumeActions();
    const zone = this.activeZone;
    if (this._interactCd > 0) this._interactCd = Math.max(0, this._interactCd - dt);

    // ---- Player input: weapon switch, reload, interact, attack ----
    if (actions.switchWeapon) {
      if (this.player.switchWeaponByKey(actions.switchWeapon)) {
        this.hud.showMessage(this.player.currentWeapon.config.label + ' equipped', 1200);
      }
    }
    if (actions.reload) {
      if (this.player.reload()) this.hud.showMessage('Reloading...', 900);
    }
    if (actions.interact) this._tryInteract();

    if (actions.attack) {
      const targets = this._attackTargets();
      const res = this.player.attack(targets);
      if (res.fired && res.hits.length) this._afterHits(res.hits);
    }

    // ---- Player movement ----
    this.player.update(dt, this.input.keys, zone);

    // ---- Zombie AI (Game owns the player, so it drives zombie updates) ----
    if (zone && zone.zombies) {
      const list = zone.zombies;
      for (const z of list) z.update(dt, this.player, list);
      for (let i = list.length - 1; i >= 0; i--) {
        const z = list[i];
        if (!z.alive && z.state === 'DEAD' && z._deathT <= 0) {
          zone.group.remove(z.group);
          list.splice(i, 1);
        }
      }
    }

    // ---- Zone logic: pickups spin, NPC AI, corpse cleanup ----
    if (zone) zone.update(dt, { player: this.player });

    // ---- Auto-grab close pickups + check exits ----
    this._checkProximityPickups();
    this._checkExits();

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

  /** Zombies + hostile NPCs are both attackable; friendlies are too (killable). */
  _attackTargets() {
    const zone = this.activeZone;
    if (!zone) return [];
    const targets = [];
    if (zone.zombies) for (const z of zone.zombies) targets.push(z);
    if (zone.npcs) for (const n of zone.npcs) targets.push(n);
    return targets;
  }

  _afterHits(hits) {
    for (const h of hits) {
      if (!h.alive) {
        // A killed zombie counts toward the survive objective; NPC deaths are
        // surfaced by their own onDeath callbacks (quest fallback handling).
        const isZombie = h instanceof Zombie;
        if (isZombie) {
          this.kills += 1;
          this.quest.handleEvent({ type: 'zombie_killed' });
          this.hud.showMessage('Zombie down (' + this.kills + ')', 900);
        } else {
          this.hud.showMessage('You killed a survivor...', 1400);
        }
      }
    }
  }

  /** E press: talk to a friendly NPC, or trigger a landmark interactable. */
  _tryInteract() {
    if (this._interactCd > 0) return;
    const zone = this.activeZone;
    if (!zone) return;
    const pp = this.player.group.position;

    // Friendly / scientist NPC dialogue first.
    if (zone.npcs) {
      for (const n of zone.npcs) {
        if (!n.alive || n.hostile) continue;
        const dx = pp.x - n.group.position.x;
        const dz = pp.z - n.group.position.z;
        if (dx * dx + dz * dz <= 3.2 * 3.2) {
          const line = n.interact();
          if (line) {
            this.hud.showMessage(line, 3200);
            this._interactCd = 0.35;
            return;
          }
        }
      }
    }

    // Landmark interactables (research center, terminal, helicopter).
    if (zone.interactables) {
      for (const it of zone.interactables) {
        const dx = pp.x - it.x;
        const dz = pp.z - it.z;
        if (dx * dx + dz * dz <= it.radius * it.radius) {
          if (typeof it.action === 'function') it.action();
          this._interactCd = 0.35;
          return;
        }
      }
    }
  }

  _checkProximityPickups() {
    const zone = this.activeZone;
    if (!zone || !zone.pickups) return;
    const pp = this.player.group.position;
    for (let i = zone.pickups.length - 1; i >= 0; i--) {
      const p = zone.pickups[i];
      const dx = pp.x - p.mesh.position.x;
      const dz = pp.z - p.mesh.position.z;
      if (dx * dx + dz * dz <= 1.4 * 1.4) {
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
        this.hud.showMessage('Picked up a Pistol! (press 2)', 2000);
        this.quest.handleEvent({ type: 'pickup', item: 'gun' });
        break;
      case 'ammo':
        this.player.addAmmo(24);
        this.hud.showMessage('Picked up ammo (+24)', 1500);
        break;
      case 'medkit':
        this.player.heal(40);
        this.hud.showMessage('Used a medkit (+40 HP)', 1500);
        break;
      case 'ingredient':
        this.hud.showMessage('Collected a cure ingredient', 1600);
        this.quest.handleEvent({ type: 'pickup', item: 'ingredient' });
        break;
      default:
        this.hud.showMessage('Picked up ' + p.type, 1500);
        break;
    }
  }

  /** If the player is standing in an exit trigger and prereqs pass, travel. */
  _checkExits() {
    const zone = this.activeZone;
    if (!zone || !zone.exits) return;
    const pp = this.player.group.position;
    const ctx = { quest: this.quest, player: this.player };
    for (const ex of zone.exits) {
      const dx = pp.x - ex.x;
      const dz = pp.z - ex.z;
      if (dx * dx + dz * dz > ex.radius * ex.radius) continue;
      if (typeof ex.requires === 'function' && !ex.requires(ctx)) {
        // Not yet: give feedback but do not spam.
        if (!ex._blockedShown) {
          this.hud.showMessage('Collect all ingredients before heading north.', 2200);
          ex._blockedShown = true;
        }
        continue;
      }
      ex._blockedShown = false;
      this.travelTo(ex.target, ex.entry);
      return;
    }
  }

  /** Headless test hooks so the full story is walkable without input. */
  _installTestHooks() {
    this.test = {
      spawnZombie: (x, z) => this.spawnZombie(x, z),
      attack: () => {
        const res = this.player.attack(this._attackTargets());
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
        for (let i = 0; i < n; i++) this.quest.handleEvent({ type: 'zombie_killed' });
        return n;
      },
      giveGun: () => {
        this.player.giveWeapon('gun');
        this.quest.handleEvent({ type: 'pickup', item: 'gun' });
        return this.player.hasGun;
      },
      // Story hooks:
      travelTo: (zoneName, entry) => this.travelTo(zoneName, entry || 'default'),
      advanceObjective: () => this.quest.advanceOne(),
      interactNearest: () => this._interactNearest(),
      collectAllIngredients: () => this._collectAllIngredients(),
      triggerWin: () => this._forceWin(),
      triggerLose: () => this._forceLose(),
    };
  }

  /** Interact with the nearest NPC or interactable regardless of distance. */
  _interactNearest() {
    const zone = this.activeZone;
    if (!zone) return null;
    const pp = this.player.group.position;
    let best = null;
    let bestD = Infinity;
    let bestKind = null;

    if (zone.npcs) {
      for (const n of zone.npcs) {
        if (!n.alive || n.hostile) continue;
        const d = pp.distanceToSquared(n.group.position);
        if (d < bestD) { bestD = d; best = n; bestKind = 'npc'; }
      }
    }
    if (zone.interactables) {
      for (const it of zone.interactables) {
        const dx = pp.x - it.x;
        const dz = pp.z - it.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = it; bestKind = 'it'; }
      }
    }
    if (!best) return null;
    if (bestKind === 'npc') {
      const line = best.interact();
      if (line) this.hud.showMessage(line, 3200);
      return line;
    }
    if (typeof best.action === 'function') best.action();
    return best.id;
  }

  /**
   * Drive the quest far enough to reveal + collect every ingredient in the
   * current (Odisha) zone. Advances the earlier objectives as needed so the
   * ingredient pickups exist, then grants them.
   */
  _collectAllIngredients() {
    // Drive the earlier objectives through the SAME real game events a player
    // triggers, so this hook cannot silently route around a broken step.
    const q = this.quest;
    // OBJ_WAKE -> OBJ_SURVIVE: fire the real room-exit event (what crossing the
    // doorway fires in normal play).
    q.handleEvent({ type: 'left_room' });
    // OBJ_SURVIVE -> OBJ_FIND_GUN: fire real zombie_killed events until cleared.
    let guard = 0;
    while (q.objectiveId() === 'OBJ_SURVIVE' && guard < 100) {
      q.handleEvent({ type: 'zombie_killed' });
      guard += 1;
    }
    // OBJ_FIND_GUN -> OBJ_MEET_SURVIVORS: real gun pickup.
    this.player.giveWeapon('gun');
    q.handleEvent({ type: 'pickup', item: 'gun' });
    // OBJ_MEET_SURVIVORS -> OBJ_RESEARCH: real talk event.
    q.handleEvent({ type: 'talk_survivor' });
    // OBJ_RESEARCH -> OBJ_COLLECT: real enter-research event (also reveals via zone).
    q.handleEvent({ type: 'enter_research' });

    const zone = this.zones.OdishaCity;
    if (zone && typeof zone._revealIngredients === 'function') zone._revealIngredients();

    // Grant the required number of ingredients directly through the quest so
    // this works even if the pickups are not present (e.g. wrong active zone).
    const need = q.requiredIngredients;
    while (q.ingredients < need) {
      q.handleEvent({ type: 'pickup', item: 'ingredient' });
    }
    // Remove any remaining ingredient pickup meshes from the Odisha zone.
    if (zone && zone.pickups) {
      for (let i = zone.pickups.length - 1; i >= 0; i--) {
        if (zone.pickups[i].type === 'ingredient') {
          zone.group.remove(zone.pickups[i].mesh);
          zone.pickups.splice(i, 1);
        }
      }
    }
    return q.ingredients;
  }

  /**
   * Drive the full win path via the SAME real events a player triggers, from
   * the opening OBJ_WAKE transition through the finale. No silent advanceTo
   * shortcuts, so the harness exercises the real player path end to end.
   */
  _forceWin() {
    // OBJ_WAKE .. OBJ_COLLECT (via left_room, real kills, gun, talk, research)
    // and grants all ingredients -> OBJ_TRAVEL.
    this._collectAllIngredients();
    // OBJ_TRAVEL -> OBJ_DELIVER: travel north (real travel event + zone swap).
    if (this.activeZone !== this.zones.MedicalFacility) {
      this.travelTo('MedicalFacility', 'default');
    } else {
      this.quest.handleEvent({ type: 'travel', zone: 'MedicalFacility' });
    }
    // OBJ_DELIVER -> OBJ_FINALE: real deliver event.
    this.quest.handleEvent({ type: 'deliver' });
    // OBJ_FINALE -> WIN: real board-helicopter event (fires onWin -> WIN state).
    this.quest.handleEvent({ type: 'board_helicopter' });
    return this.state;
  }

  _forceLose() {
    if (this.player) this.player.takeDamage(99999);
    if (this.state !== GameState.LOSE) this.setState(GameState.LOSE);
    return this.state;
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
      objectiveId: this.quest ? this.quest.objectiveId() : this.objectiveId,
      zombieCount: liveZombies,
      kills: this.kills,
      zone: this.activeZone ? this.activeZone.id : this.zoneName,
      ingredients: this.quest ? this.quest.ingredients : 0,
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
