// OdishaCity: the starting zone.
//
// The player wakes in an enclosed room (with only a knife). A doorway on the
// south (-Z) wall opens onto a block of Odisha: streets, low buildings, a
// temple-like landmark, street props, and wandering zombies. Placed in the
// city:
//   - a gun + ammo pickup to find,
//   - three friendly survivor NPCs (one hints at the research center),
//   - two hostile NPCs (cultists who want the apocalypse to continue),
//   - a RESEARCH CENTER building the player enters/interacts with to receive
//     the cure task and reveal the ingredient pickups,
//   - three ingredient pickups to collect,
//   - a north exit trigger that travels to the MedicalFacility once all the
//     ingredients are collected.
//
// Everything is built from AssetFactory primitives.

import { Zone } from '../Zone.js';
import { AssetFactory } from '../../assets/AssetFactory.js';
import { NPC, NPCKind } from '../../entities/NPC.js';

const ROOM_SIZE = 12;

export class OdishaCity extends Zone {
  constructor(opts = {}) {
    super({ id: 'OdishaCity', name: 'Odisha - City', audio: opts.audio });
    // Callbacks the Game wires so zone interactions drive the quest.
    this.onEnterResearch = opts.onEnterResearch || (() => {});
    this.onTalkSurvivor = opts.onTalkSurvivor || (() => {});
    this.onCriticalNpcKilled = opts.onCriticalNpcKilled || (() => {});
    this.onMessage = opts.onMessage || (() => {});

    // The player wakes inside the room.
    this.entryPoints = {
      default: { x: 0, z: 3 },
      // Returning here (not used in the base flow) would drop you at the door.
      street: { x: 0, z: -12 },
    };

    this._ingredientsRevealed = false;
    this._researchEntered = false;
  }

  build() {
    // --- Ground (large so the city + room sit on it) ---
    this.group.add(AssetFactory.makeGround(220));

    this._buildRoom();
    this._buildCity();
    this._buildResearchCenter();
    this._placeNPCs();
    this._placeInitialPickups();
    this._placeZombieSpawns();
    this._placeExit();
  }

  _buildRoom() {
    const room = AssetFactory.makeRoom(ROOM_SIZE);
    // Room sits centered on origin; doorway faces -Z into the city.
    this.group.add(room.group);
    for (const c of room.colliders) this.addCollider(c.x, c.z, c.radius);
  }

  _buildCity() {
    const styles = ['concrete', 'brick', 'slum'];
    // A rough grid of low buildings south of the room (negative Z).
    const blockPositions = [
      [-22, -20], [-8, -26], [10, -22], [24, -18],
      [-26, -40], [-6, -46], [14, -44], [28, -38],
      [-18, -60], [12, -62],
    ];
    blockPositions.forEach(([x, z], i) => {
      const w = 6 + (i % 3) * 2;
      const h = 8 + (i % 4) * 3;
      const d = 6 + (i % 2) * 3;
      const b = AssetFactory.makeBuilding(w, h, d, styles[i % 3]);
      b.position.set(x, h / 2, z);
      this.group.add(b);
      this.addCollider(x, z, Math.max(w, d) * 0.5);
    });

    // Temple landmark.
    const temple = AssetFactory.makeTemple();
    temple.position.set(0, 0, -34);
    this.group.add(temple);
    this.addCollider(0, -34, 4.2);

    // Street props: cars, streetlights, crates, trees, barrels.
    const props = [
      ['car', -12, -14], ['car', 16, -30], ['car', -2, -52],
      ['streetlight', -14, -18], ['streetlight', 14, -18],
      ['streetlight', -14, -48], ['streetlight', 14, -48],
      ['tree', -20, -10], ['tree', 20, -10], ['tree', -24, -54], ['tree', 22, -56],
      ['crate', 6, -16], ['crate', -6, -16], ['barrel', 8, -40], ['barrel', -8, -40],
    ];
    props.forEach(([kind, x, z]) => {
      const p = AssetFactory.makeProp(kind);
      p.position.set(x, 0, z);
      this.group.add(p);
      const r = kind === 'car' ? 1.6 : kind === 'tree' ? 1.0 : 0.7;
      this.addCollider(x, z, r);
    });
  }

  _buildResearchCenter() {
    const rc = AssetFactory.makeFacility(14, 8, 12, 0x4aa3d0);
    this._researchPos = { x: -30, z: -30 };
    rc.position.set(this._researchPos.x, 0, this._researchPos.z);
    this.group.add(rc);
    this.addCollider(this._researchPos.x, this._researchPos.z, 8);

    // Interact trigger just in front of the entrance (door faces +Z).
    const marker = AssetFactory.makeInteractableMarker(0x4aa3d0);
    const ix = this._researchPos.x;
    const iz = this._researchPos.z + 8;
    marker.position.set(ix, 0, iz);
    this.group.add(marker);
    this.addInteractable({
      id: 'research_center',
      x: ix, z: iz, radius: 3.5,
      label: 'Enter the Research Center',
      action: () => this._enterResearch(),
    });
  }

  _placeNPCs() {
    // Friendly survivors. The first hints at the research center.
    const survivor1 = new NPC({
      kind: NPCKind.FRIENDLY,
      id: 'survivor_hint',
      position: { x: -6, z: -12 },
      audio: this.audio,
      questCritical: true,
      dialogue: [
        'You made it out alive! Most did not.',
        'There is a research center to the west - they are working on a cure.',
        'Find the ingredients they need. Go, hurry!',
      ],
      onInteract: () => this.onTalkSurvivor('survivor_hint'),
      onDeath: () => this.onCriticalNpcKilled('survivor'),
    });
    const survivor2 = new NPC({
      kind: NPCKind.FRIENDLY,
      id: 'survivor_2',
      position: { x: 8, z: -20 },
      audio: this.audio,
      dialogue: ['Keep your knife close.', 'I heard a gun was dropped near the crates.'],
      onInteract: () => this.onTalkSurvivor('survivor_2'),
    });
    const survivor3 = new NPC({
      kind: NPCKind.FRIENDLY,
      id: 'survivor_3',
      position: { x: -14, z: -44 },
      audio: this.audio,
      dialogue: ['They are everywhere...', 'Do not trust the ones in red. They want this.'],
      onInteract: () => this.onTalkSurvivor('survivor_3'),
    });
    this.addNPC(survivor1);
    this.addNPC(survivor2);
    this.addNPC(survivor3);

    // Hostile NPCs (want the apocalypse to spread). Killable like zombies.
    this.addNPC(new NPC({
      kind: NPCKind.HOSTILE, id: 'cultist_1',
      position: { x: 4, z: -30 }, audio: this.audio,
    }));
    this.addNPC(new NPC({
      kind: NPCKind.HOSTILE, id: 'cultist_2',
      position: { x: -10, z: -50 }, audio: this.audio,
    }));
  }

  _placeInitialPickups() {
    // Gun + ammo to find in the streets.
    this.addPickup('gun', 6, -16, { visual: 'weapon' });
    this.addPickup('ammo', -6, -22, { visual: 'ammo' });
    this.addPickup('medkit', 12, -12, { visual: 'medkit' });
    // Ingredient pickups exist but are only "revealed" (added) once the player
    // enters the research center and learns what is needed.
  }

  /** Reveal the ingredient pickups after the research center is entered. */
  _revealIngredients() {
    if (this._ingredientsRevealed) return;
    this._ingredientsRevealed = true;
    const spots = [
      [-30, -18], [18, -50], [-2, -64],
    ];
    spots.forEach(([x, z], i) => {
      this.addPickup('ingredient', x, z, { visual: 'cure', ingredient: true, id: 'ing_' + i });
    });
    this.onMessage('The scientists need 3 ingredients. Markers appeared in the city.', 3600);
  }

  _enterResearch() {
    if (this._researchEntered) {
      this._revealIngredients();
      return;
    }
    this._researchEntered = true;
    this.onEnterResearch();
    this._revealIngredients();
  }

  _placeZombieSpawns() {
    // Wandering zombies out in the city (never inside the starting room).
    this.spawns = [
      { x: -4, z: -16 }, { x: 6, z: -24 }, { x: -12, z: -30 },
      { x: 10, z: -38 }, { x: -8, z: -48 }, { x: 16, z: -54 },
      { x: 0, z: -60 }, { x: -20, z: -22 },
    ];
  }

  _placeExit() {
    // North exit at the far south end of the block (the "road north").
    const ex = 0;
    const ez = -74;
    this.addExit({
      name: 'North Road',
      target: 'MedicalFacility',
      entry: 'default',
      x: ex, z: ez, radius: 3.5,
      requires: (ctx) => ctx && ctx.quest && ctx.quest.hasAllIngredients(),
    });
  }
}

export default OdishaCity;
