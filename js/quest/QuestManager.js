// QuestManager: the ordered cure-storyline objective flow.
//
// The player advances through a fixed sequence of objectives, each with a
// stable id and human-readable text that drives the HUD objective line and
// debugState().objectiveId. The manager listens to game events (kills, pickups,
// interactions, zone changes) via handleEvent() and advances automatically when
// the current objective's completion condition is met.
//
// Flow:
//   OBJ_WAKE      leave the room
//   OBJ_SURVIVE   kill N zombies in the street
//   OBJ_FIND_GUN  pick up the gun
//   OBJ_MEET_SURVIVORS  talk to a survivor
//   OBJ_RESEARCH  enter the research center (receive the cure task)
//   OBJ_COLLECT   collect the ingredient pickups in Odisha
//   OBJ_TRAVEL    travel north to the Medical Facility
//   OBJ_DELIVER   give the ingredients to the lead scientist
//   OBJ_FINALE    board the helicopter to spread the cure
//   WIN
//
// The manager is intentionally engine-agnostic: it only mutates its own state
// and calls the onChange callback. The Game wires events into handleEvent and
// reads currentObjective() for the HUD.

export const SURVIVE_KILLS = 3;
export const REQUIRED_INGREDIENTS = 3;

// Ordered objective definitions. `text` shows in the HUD.
export const OBJECTIVES = [
  { id: 'OBJ_WAKE', text: 'You woke up. Leave your room and see what happened outside.' },
  { id: 'OBJ_SURVIVE', text: 'The streets are overrun. Kill ' + SURVIVE_KILLS + ' zombies to clear a path.' },
  { id: 'OBJ_FIND_GUN', text: 'A knife is not enough. Find a gun somewhere in the city.' },
  { id: 'OBJ_MEET_SURVIVORS', text: 'Find other survivors. Talk to someone (press E).' },
  { id: 'OBJ_RESEARCH', text: 'A survivor mentioned a research center. Enter it (press E).' },
  { id: 'OBJ_COLLECT', text: 'Collect the cure ingredients scattered across Odisha (0/' + REQUIRED_INGREDIENTS + ').' },
  { id: 'OBJ_TRAVEL', text: 'Ingredients gathered. Travel north to the Medical Facility.' },
  { id: 'OBJ_DELIVER', text: 'Deliver the ingredients to the lead scientist (press E).' },
  { id: 'OBJ_FINALE', text: 'The cure is ready. Board the helicopter to spread it worldwide (press E).' },
  { id: 'WIN', text: 'The cure was spread across the world. Humanity endures.' },
];

export class QuestManager {
  /**
   * @param {object} [opts]
   * @param {(state:object)=>void} [opts.onChange] called whenever the
   *   objective (or ingredient count) changes.
   * @param {(text:string,ms?:number)=>void} [opts.onMessage] transient toast.
   * @param {()=>void} [opts.onWin] called once the flow reaches WIN.
   */
  constructor(opts = {}) {
    this.onChange = opts.onChange || (() => {});
    this.onMessage = opts.onMessage || (() => {});
    this.onWin = opts.onWin || (() => {});
    this.reset();
  }

  reset() {
    this._index = 0;
    this.kills = 0;
    this.ingredients = 0;
    this.hasGun = false;
    this.criticalNpcLost = false;
    // Single source of truth for the ingredient goal, read by Game.
    this.requiredIngredients = REQUIRED_INGREDIENTS;
    this._emit(false);
  }

  get current() {
    return OBJECTIVES[this._index];
  }

  currentObjective() {
    return this.current;
  }

  objectiveId() {
    return this.current.id;
  }

  /** HUD text, with the live ingredient count folded into OBJ_COLLECT. */
  objectiveText() {
    const o = this.current;
    if (o.id === 'OBJ_COLLECT') {
      return 'Collect the cure ingredients scattered across Odisha ('
        + this.ingredients + '/' + REQUIRED_INGREDIENTS + ').';
    }
    return o.text;
  }

  _indexOf(id) {
    return OBJECTIVES.findIndex((o) => o.id === id);
  }

  /** Advance to a specific objective id (no-op if it would move backwards). */
  advanceTo(id, opts = {}) {
    const idx = this._indexOf(id);
    if (idx < 0 || idx <= this._index) return false;
    this._index = idx;
    this._emit(true, opts.silent);
    if (this.current.id === 'WIN') this.onWin();
    return true;
  }

  /** Advance exactly one step in the ordered flow. */
  advanceOne() {
    if (this._index < OBJECTIVES.length - 1) {
      return this.advanceTo(OBJECTIVES[this._index + 1].id);
    }
    return false;
  }

  /**
   * Feed a game event into the flow. Recognized events:
   *   { type:'left_room' }
   *   { type:'zombie_killed' }
   *   { type:'pickup', item:'gun'|'ingredient'|... }
   *   { type:'talk_survivor' }
   *   { type:'enter_research' }
   *   { type:'travel', zone:'MedicalFacility' }
   *   { type:'deliver' }
   *   { type:'board_helicopter' }
   *   { type:'critical_npc_killed', role:'scientist'|'survivor' }
   */
  handleEvent(evt) {
    if (!evt || !evt.type) return;
    const id = this.current.id;

    switch (evt.type) {
      case 'left_room':
        // The player crossed the doorway out of the starting room: the opening
        // objective is complete. This is the intended trigger for OBJ_WAKE.
        if (id === 'OBJ_WAKE') this.advanceTo('OBJ_SURVIVE');
        break;

      case 'zombie_killed':
        this.kills += 1;
        // First zombie kill also clears OBJ_WAKE (fallback if the player fought
        // in the doorway before the room-exit trigger fired), counting the kill
        // toward OBJ_SURVIVE.
        if (id === 'OBJ_WAKE') {
          this.advanceTo('OBJ_SURVIVE');
          if (this.kills >= SURVIVE_KILLS) this.advanceTo('OBJ_FIND_GUN');
        } else if (id === 'OBJ_SURVIVE' && this.kills >= SURVIVE_KILLS) {
          this.advanceTo('OBJ_FIND_GUN');
        }
        break;

      case 'pickup':
        if (evt.item === 'gun') {
          this.hasGun = true;
          if (id === 'OBJ_FIND_GUN') this.advanceTo('OBJ_MEET_SURVIVORS');
        } else if (evt.item === 'ingredient') {
          this.ingredients = Math.min(REQUIRED_INGREDIENTS, this.ingredients + 1);
          this._emit(true);
          if (id === 'OBJ_COLLECT' && this.ingredients >= REQUIRED_INGREDIENTS) {
            this.advanceTo('OBJ_TRAVEL');
          }
        }
        break;

      case 'talk_survivor':
        if (id === 'OBJ_MEET_SURVIVORS') this.advanceTo('OBJ_RESEARCH');
        break;

      case 'enter_research':
        if (id === 'OBJ_RESEARCH') this.advanceTo('OBJ_COLLECT');
        break;

      case 'travel':
        if (id === 'OBJ_TRAVEL' && evt.zone === 'MedicalFacility') {
          this.advanceTo('OBJ_DELIVER');
        }
        break;

      case 'deliver':
        if (id === 'OBJ_DELIVER') this.advanceTo('OBJ_FINALE');
        break;

      case 'board_helicopter':
        if (id === 'OBJ_FINALE') this.advanceTo('WIN');
        break;

      case 'critical_npc_killed':
        // Never soft-lock: mark the loss and surface guidance. The scientist's
        // delivery falls back to a self-serve terminal (handled in the zone).
        this.criticalNpcLost = true;
        this.onMessage(
          'A key survivor was killed. You can still finish via their equipment.',
          3600
        );
        break;

      default:
        break;
    }
  }

  /** True when the player has enough ingredients to travel/deliver. */
  hasAllIngredients() {
    return this.ingredients >= REQUIRED_INGREDIENTS;
  }

  _emit(changed, silent) {
    const state = {
      objectiveId: this.current.id,
      objectiveText: this.objectiveText(),
      ingredients: this.ingredients,
      requiredIngredients: REQUIRED_INGREDIENTS,
      kills: this.kills,
    };
    this.onChange(state);
    if (changed && !silent && this.current.id !== 'WIN') {
      this.onMessage('Objective: ' + this.objectiveText(), 3200);
    }
  }
}

export default QuestManager;
