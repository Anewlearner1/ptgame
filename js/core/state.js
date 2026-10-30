// The single source of truth. Everything serialisable lives in `state`;
// view-only things (camera, selected tool, open panel) live in `ui` and are NOT saved.
import { MAP_W, MAP_H, START_MONEY, SAVE_VERSION } from './constants.js';

export function createInitialState() {
  const floor = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(null));
  return {
    version: SAVE_VERSION,
    seed: Math.floor(Math.random() * 1e9),
    nextId: 1,                       // use newId(state) for every entity

    time: { year: 1, month: 1, week: 1, clock: 8 * 60, speed: 1, paused: false },
    // clock = minutes since midnight, runs OPEN_MIN..CLOSE_MIN each week

    money: START_MONEY,
    points: { culinary: 0, device: 0, service: 0 },
    reputation: 10,                  // 0..1000, drives guest volume + inspection
    shopName: '幸福小吃店',

    weather: { kind: 'sunny', temp: 24 },   // kind: sunny|cloudy|rain|cold|hot|typhoon

    lotLevel: 0,                     // index into LOTS (data/lots.js)
    lot: { x0: 10, y0: 10, w: 12, h: 10 },  // buildable rectangle, overwritten by lots.js on expand
    door: { x: 15, y: 20 },          // tile just OUTSIDE the lot edge where guests spawn/leave (bottom edge)

    map: {
      floor,                         // floor[y][x] = 'floor_mat'|'floor_wood'|'ramp'|null
      occ: null,                     // runtime cache, rebuilt by grid.rebuildOccupancy(); NOT saved
    },
    objects: [],                     // see ARCHITECTURE §3.2
    staff: [],                       // see ARCHITECTURE §3.3
    hirePool: [],                    // staff candidates available to hire (sim/staff.js refreshPool)
    patients: [],                    // see ARCHITECTURE §3.4
    queue: [],                       // patient ids waiting for registration (FIFO)

    policy: {
      focus: 'business',             // 'business' | 'community' | 'kids'
      priceMult: {},                 // dishId -> 0.5..2.0 for special (加點) items (default 1)
      boards: [],                    // enabled menu-board ids
    },

    research: { done: [], current: null, progress: 0 },  // current = node id being researched
    zones: [],                       // active synergy zones (computed): {id, objectIds[], cells[]}
    mods: defaultMods(),             // computed modifiers (synergy + research + events)

    safety: {
      risk: 0,                       // 食安風險 0..100 (drives inspections + events), see economy.js RISK_TUNE
    },

    ledger: {                        // this month, reset at month end
      income: { menu: 0, special: 0, other: 0 },
      expense: { salary: 0, rent: 0, build: 0, maintain: 0, food: 0, other: 0 },
    },
    history: [],                     // per-month snapshots [{year,month,income,expense,money,patients,satisfaction,reputation}]

    stats: { patientsToday: 0, patientsMonth: 0, patientsTotal: 0, cured: 0, angry: 0, satSum: 0, satN: 0 },   // patients* = guests, cured = 熟客

    events: { active: [], log: [], pendingDilemma: null, cooldowns: {} },
    inspections: { lastYearResult: null },

    flags: { tutorialDone: false },

    achv: { unlocked: {}, counters: {}, title: null, badges: [] },   // achievements, see docs/ACHIEVEMENTS.md §5.2
    career: { startedYear: 1, onboarding: { done: {}, hidden: false }, goals: { year: 0, list: [] }, reviews: [], ending: null, endless: false },   // goals & ending, see docs/GOALS_AND_ENDING.md §7
  };
}

export function defaultMods() {
  return {
    nhiTurnover: 1,        // multiplier on menu-dish speed (翻桌率; lower duration)
    selfPayConv: 0,        // additive probability for a guest to accept a special-dish upsell (加點轉換率)
    selfPayPrice: 1,       // multiplier on special-dish price
    foodCost: 1,           // multiplier on ingredient cost (lower is better)
    researchGain: 1,       // multiplier on all point gains
    elderSat: 0,           // additive satisfaction for elder patients
    walkSpeed: 1,          // global patient walk multiplier
    spawnMult: 1,          // multiplier on guest arrival rate
    typeSpawn: {},         // guestTypeId -> multiplier
    patience: 1,           // multiplier on guest patience
    slipRisk: 1,           // multiplier on slip-and-fall probability
    staffStamina: 1,       // multiplier on staff stamina drain (lower is better)
    rentMult: 1,
    wageMult: 1,
    cureGain: 1,           // multiplier on the `cure` (好感) contributed by each completed dish (熟客經營)
    treatTime: 1,          // multiplier on ALL dish durations (lower is faster; stacks with nhiTurnover)
    wearRate: 1,           // multiplier on equipment wear accumulation (lower is better; 設備精進)
    repGrowth: 0,          // additive reputation per week (品牌聲望)
    satGain: 0,            // additive satisfaction for every guest at the end of the visit (客戶關係)
    typeSat: {},           // guestTypeId -> additive satisfaction (like elderSat, generalised)
    typeCure: {},          // guestTypeId -> additive multiplier on cure (0.1 → ×1.1)
  };
}

export function newId(state) { return state.nextId++; }

// View-only state (never serialised)
export const ui = {
  panel: null,                       // null | 'build'|'operate'|'clinic'|'overview'|'map'|'system'   ('clinic' = 餐廳 panel; id kept)
  tool: { mode: 'none', defId: null, rot: 0, cat: null },  // mode: none|place|paint|demolish
  hover: { x: -1, y: -1, valid: false },
  selected: null,                    // {type:'patient'(=guest)|'staff'|'object', id}
  cam: { x: 0, y: 0, zoom: 1 },      // x,y = screen-space pan offset in px
  showGrid: true,
  dirtyOcc: true,                    // set true after any map change -> main loop rebuilds occupancy + synergies
};

// Deserialise helper: save.js writes JSON.stringify(state) minus map.occ
export function replaceState(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

export const state = createInitialState();
