# Zombie Apocalypse - Odisha Outbreak

A browser-based, first-person 3D zombie-survival game built with **three.js**. You
wake up in your room in Odisha, India, during a zombie outbreak, fight your way
through the infested streets with a knife and a scavenged pistol, help the last
survivors build a cure, and finally board a helicopter to spread that cure across
the world.

It runs **entirely offline** as a static site: no build step, no bundler, no npm,
no external assets. Every mesh, texture, and sound is generated procedurally in
code, and three.js itself is vendored locally.

---

## 1. How to run

This is a static site that uses **ES module import maps**, so it **must be served
over HTTP** - opening `index.html` directly via `file://` will not work (the
browser blocks module/import-map resolution and local module loads).

From the repository root:

```bash
cd Games
python3 -m http.server 8000
```

Then open **http://localhost:8000** in a modern desktop browser (Chrome, Edge, or
Firefox). Click **START**, then click the game window once to lock the mouse for
look controls.

Any static file server works (`python3 -m http.server`, `npx serve`, nginx, etc.);
Python's built-in server is used above because it needs no installation.

---

## 2. Controls

| Input | Action |
| --- | --- |
| **W A S D** | Move |
| **Shift** | Run |
| **Mouse** | Look around |
| **Click / Left-click** | Fire the gun or swing the knife |
| **1 / 2** | Switch weapon (1 = knife, 2 = pistol) |
| **R** | Reload the gun |
| **E** | Interact (talk to survivors, enter the research center, deliver ingredients, board the helicopter) |
| **Space** | Jump |
| **Esc** | Pause / resume (releases and re-locks the mouse) |

Pickups (gun, ammo, medkit, cure ingredients) are grabbed automatically when you
walk over them.

---

## 3. Story and objective flow

You play a survivor who wakes up in a locked room in **Odisha** as the outbreak
turns the people outside into zombies. Armed at first with only a small knife, you
must survive, find better weapons, and help the remaining survivors complete and
distribute a cure.

The objective flow (shown live in the HUD) runs end to end:

1. **OBJ_WAKE** - You wake in your room. Walk out through the doorway into the
   city; stepping through the doorway completes this objective (killing your
   first zombie also clears it if you fight in the doorway).
2. **OBJ_SURVIVE** - The streets are overrun. Kill a few zombies to clear a path.
3. **OBJ_FIND_GUN** - A knife is not enough. Find the pistol dropped in the city.
4. **OBJ_MEET_SURVIVORS** - Find other survivors and talk to one (press E).
5. **OBJ_RESEARCH** - A survivor points you to a research center. Enter it (press E)
   to receive the cure task; the needed ingredients are marked around the city.
6. **OBJ_COLLECT** - Collect the cure ingredients scattered across Odisha.
7. **OBJ_TRAVEL** - With the ingredients gathered, travel north to the Medical
   Facility (walk into the north-road exit trigger).
8. **OBJ_DELIVER** - Deliver the ingredients to the lead scientist (press E). If the
   scientist has been killed, a self-serve lab terminal accepts the delivery so the
   game can never soft-lock.
9. **OBJ_FINALE** - The cure is ready. Board the helicopter (press E).
10. **WIN** - The cure is spread across the world. Humanity endures.

There are also **hostile NPCs** ("cultists"/"raiders") who want the apocalypse to
continue - they attack on sight. **Every NPC is killable**, including friendly
survivors and the scientist; killing a quest-critical NPC is allowed but surfaced
with a warning, and the story can still be completed through the fallback terminal.

Player death (health reaches 0) ends the run with a **YOU DIED** screen and a
restart button.

---

## 4. What was built vs deferred

**Built (the playable vertical slice):**

- First-person controller (WASD + mouse look via `PointerLockControls`, run, jump,
  gravity, circular collision) with health and a damage vignette.
- Weapon system with a **knife -> pistol** progression: melee cone hit test and gun
  hitscan (raycast), ammo, reload, muzzle/swing feedback.
- Zombie AI (idle / wander / chase / attack / die) with contact damage, separation,
  and death cleanup.
- Friendly, scientist, and hostile NPCs; dialogue and quest hooks; all killable.
- Two modular zones: **Odisha City** (room -> city, research center, ingredients)
  and the **Medical Facility** (delivery + helicopter finale), with zone travel.
- A `QuestManager` driving the full ordered objective flow above.
- Live HUD (health, weapon, ammo, objective, zone, toasts), start / pause / win /
  lose overlays with a story intro and controls legend.
- Procedural audio (Web Audio API) for gunshot, knife swing, zombie growl, hits,
  player damage, pickups, objective-complete, death, and victory.
- A headless verification harness (`window.__GAME__.debugState()`,
  `window.__consoleErrors`, and `window.__GAME__.test` hooks).

**Deferred / out of scope for this slice:**

- A true open world spanning the whole planet or many countries (see the scope
  note below) - the slice ships one city plus one travel destination.
- Real downloaded 3D models, textures, and audio (everything is procedural; see the
  no-internet note).
- Networking / multiplayer / accounts / persistence / save games.
- Deep RPG systems (leveling, inventory management beyond weapons/ammo/medkits,
  crafting, skill trees), advanced pathfinding, and mobile/touch controls.

---

## 5. No-internet / procedural assets

This project was built and runs in an environment with **no external network
access**, so it depends on nothing that would need to be downloaded at load time:

- **All game assets are generated procedurally in code.** Geometry is built from
  three.js primitives (boxes, cylinders, spheres, planes) in
  `js/assets/AssetFactory.js`; textures are drawn at runtime onto a `<canvas>` and
  used as `CanvasTexture`; all sound effects are synthesized live with the **Web
  Audio API** (oscillators + filtered noise) in `js/core/AudioManager.js`. There are
  no image, model, or audio files to fetch.
- **three.js is vendored locally.** three.js **r160** is committed under
  [`vendor/three/`](vendor/three/) (`build/three.module.js`,
  `build/three.module.min.js`, and `examples/jsm/controls/PointerLockControls.js`)
  and loaded through the import map in `index.html`. Nothing is pulled from a CDN.

---

## 6. Scope note: single-player, not a true MMORPG

The original concept described an MMORPG spanning the entire planet. This
deliverable is a **single-player** game, not a massively-multiplayer online RPG.
Servers, accounts, matchmaking, and simultaneous players are out of scope for a
static, offline, client-only site: there is no backend to host shared world state
or authenticate players.

Similarly, rather than modeling the whole world, the slice ships **one starting
city (Odisha)** plus **one travel destination (the Medical Facility)**. That is
enough to demonstrate the full story loop - wake up, survive, arm up, gather the
cure, travel, deliver, and fly out to spread it - while staying performant in a
browser. The zone system (below) is built so more locations can be added later.

---

## 7. How to extend

The code is organized so the world and the assets can grow without rewriting game
logic.

**Add a new location (Zone):**

1. Create a subclass of `Zone` under `js/world/zones/`, e.g.
   `js/world/zones/DelhiStreets.js`, and implement `build()` to populate the zone
   (call `this.group.add(...)`, `this.addCollider(...)`, `this.addNPC(...)`,
   `this.addPickup(...)`, `this.addInteractable(...)`, and `this.addExit(...)`, and
   set `this.spawns` for zombie spawn points and `this.entryPoints` for where the
   player arrives). See `js/world/zones/OdishaCity.js` and
   `js/world/zones/MedicalFacility.js` for working examples.
2. Register it in `Game._buildZones()` in `js/core/Game.js` (add it to the `zones`
   map), and point an existing zone's `addExit({ target: 'YourZoneId', ... })` at it
   so the player can travel there. If it should advance the quest, wire its callbacks
   into `this.quest.handleEvent(...)` the same way the existing zones do.

**Swap procedural assets for real models/textures:**

All meshes and textures come from the `AssetFactory` API
(`makeGround`, `makeBuilding`, `makeZombie`, `makeNPC`, `makePickup`,
`makePlayerViewmodel`, `makeProp`, `makeCanvasTexture`, etc.) in
`js/assets/AssetFactory.js`. Because the rest of the game only ever calls these
factory methods, you can replace their bodies to load real downloaded models
(e.g. glTF via `GLTFLoader`) and image textures (`TextureLoader`) **without
touching game logic** - keep the same method names and returned object shapes
(a `THREE.Object3D`/`Group`, with the same `userData` such as `parts` and `rotor`
that the entities animate) and everything else keeps working.

---

## 8. Credits and license

- **three.js** (r160) - MIT License. Copyright (c) 2010-present three.js authors.
  The full license text is included with the vendored copy at
  [`vendor/three/LICENSE`](vendor/three/LICENSE). See <https://threejs.org>.

All other code and procedurally generated assets in this repository were created
for this project.
