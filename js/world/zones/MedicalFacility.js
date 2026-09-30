// MedicalFacility: the second zone, reached by travelling north from Odisha.
//
// A distinct, more clinical location: a large medical facility building, a
// helipad, perimeter walls, more zombies to fight through, the lead scientist
// NPC who accepts the collected ingredients, a self-serve lab terminal as a
// soft-lock-proof fallback (used if the scientist is killed), and the finale
// helicopter. Delivering the ingredients unlocks the helicopter; boarding it
// spreads the cure and triggers the WIN state.
//
// Built entirely from AssetFactory primitives.

import { Zone } from '../Zone.js';
import { AssetFactory } from '../../assets/AssetFactory.js';
import { NPC, NPCKind } from '../../entities/NPC.js';

export class MedicalFacility extends Zone {
  constructor(opts = {}) {
    super({ id: 'MedicalFacility', name: 'Medical Facility', audio: opts.audio });
    this.onDeliver = opts.onDeliver || (() => {});
    this.onBoardHelicopter = opts.onBoardHelicopter || (() => {});
    this.onCriticalNpcKilled = opts.onCriticalNpcKilled || (() => {});
    this.onMessage = opts.onMessage || (() => {});

    this.entryPoints = {
      default: { x: 0, z: 30 },
    };

    this._delivered = false;
    this._helicopterReady = false;
  }

  build() {
    this.group.add(AssetFactory.makeGround(200));

    this._buildFacility();
    this._placeNPCs();
    this._placeScientist();
    this._placeTerminal();
    this._placeHelicopter();
    this._placeZombieSpawns();
    this._placeProps();
  }

  _buildFacility() {
    // Main facility building at the back (north, -Z).
    const fac = AssetFactory.makeFacility(22, 10, 16, 0x4ad0a3);
    fac.position.set(0, 0, -18);
    fac.rotation.y = Math.PI; // door faces +Z toward the player
    this.group.add(fac);
    this.addCollider(0, -18, 12);

    // Two side wings.
    const wingL = AssetFactory.makeBuilding(8, 7, 12, 'concrete');
    wingL.position.set(-20, 3.5, -10);
    this.group.add(wingL);
    this.addCollider(-20, -10, 6);
    const wingR = AssetFactory.makeBuilding(8, 7, 12, 'concrete');
    wingR.position.set(20, 3.5, -10);
    this.group.add(wingR);
    this.addCollider(20, -10, 6);
  }

  _placeProps() {
    const props = [
      ['streetlight', -10, 20], ['streetlight', 10, 20],
      ['car', -14, 8], ['car', 14, 6],
      ['crate', -6, 0], ['crate', 6, 0], ['barrel', 0, 12],
      ['tree', -24, 22], ['tree', 24, 22],
    ];
    props.forEach(([kind, x, z]) => {
      const p = AssetFactory.makeProp(kind);
      p.position.set(x, 0, z);
      this.group.add(p);
      const r = kind === 'car' ? 1.6 : kind === 'tree' ? 1.0 : 0.7;
      this.addCollider(x, z, r);
    });
  }

  _placeNPCs() {
    // Hostile guard NPCs blocking the facility.
    this.addNPC(new NPC({
      kind: NPCKind.HOSTILE, id: 'raider_1',
      position: { x: -6, z: 4 }, audio: this.audio,
    }));
    this.addNPC(new NPC({
      kind: NPCKind.HOSTILE, id: 'raider_2',
      position: { x: 8, z: 8 }, audio: this.audio,
    }));
  }

  _placeScientist() {
    const sx = 0;
    const sz = -6;
    this.scientist = new NPC({
      kind: NPCKind.SCIENTIST,
      id: 'lead_scientist',
      position: { x: sx, z: sz },
      audio: this.audio,
      questCritical: true,
      dialogue: [
        'You brought the ingredients? Thank the heavens.',
        'This is exactly what we needed to synthesize the cure.',
        'The cure is ready. Get to the helicopter and spread it worldwide!',
      ],
      onInteract: () => this._deliver(),
      onDeath: () => {
        this.onCriticalNpcKilled('scientist');
        this.onMessage('The scientist is dead! Use the lab terminal instead.', 3600);
      },
    });
    this.addNPC(this.scientist);
    this.addCollider(sx, sz, 0.6);
  }

  /**
   * Self-serve lab terminal: the soft-lock-proof fallback. If the scientist is
   * killed the player can still complete the delivery here (E to interact).
   */
  _placeTerminal() {
    const tx = 4;
    const tz = -6;
    const marker = AssetFactory.makeInteractableMarker(0x4ad0a3);
    marker.position.set(tx, 0, tz);
    this.group.add(marker);
    // A small console box on the pad.
    const console = AssetFactory.makeProp('crate');
    console.position.set(tx, 0, tz);
    console.scale.set(0.9, 0.6, 0.9);
    this.group.add(console);
    this.addInteractable({
      id: 'lab_terminal',
      x: tx, z: tz, radius: 3.0,
      label: 'Use the lab terminal',
      action: () => this._deliver(),
    });
  }

  _deliver() {
    if (this._delivered) {
      this.onMessage('Ingredients already delivered. Board the helicopter.', 2400);
      return;
    }
    this._delivered = true;
    this._helicopterReady = true;
    this.onDeliver();
    this.onMessage('Ingredients delivered! The cure is ready. Board the helicopter.', 3600);
  }

  _placeHelicopter() {
    const hx = 22;
    const hz = 18;
    this.helicopter = AssetFactory.makeHelicopter();
    this.helicopter.position.set(hx, 0, hz);
    this.group.add(this.helicopter);
    // Helipad marker.
    const pad = AssetFactory.makeInteractableMarker(0xffd27f);
    pad.scale.set(2.4, 1, 2.4);
    pad.position.set(hx, 0, hz);
    this.group.add(pad);
    this.addInteractable({
      id: 'helicopter',
      x: hx, z: hz, radius: 4.0,
      label: 'Board the helicopter',
      action: () => this._board(),
    });
  }

  _board() {
    if (!this._helicopterReady) {
      this.onMessage('Deliver the ingredients before you can fly out.', 2600);
      return;
    }
    this.onBoardHelicopter();
  }

  _placeZombieSpawns() {
    this.spawns = [
      { x: -8, z: 16 }, { x: 8, z: 18 }, { x: -14, z: 6 },
      { x: 14, z: 4 }, { x: 0, z: 22 }, { x: -18, z: 14 },
      { x: 16, z: 12 }, { x: 4, z: 26 },
    ];
  }

  /** Spin the rotor once the helicopter is ready, for finale flavor. */
  update(dt, ctx) {
    super.update(dt, ctx);
    if (this.helicopter && this.helicopter.userData.rotor && this._helicopterReady) {
      this.helicopter.userData.rotor.rotation.y += dt * 10;
    }
  }
}

export default MedicalFacility;
