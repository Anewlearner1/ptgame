// Staff: hire pool, hire / fire / train, stamina, rest room usage, idle wandering and task plumbing.
// Treatment progress itself is driven by patients.js (it owns the patient state machine); this module owns
// everything about the staff member as a person (movement, stamina, resting, wandering).
import { newId } from '../core/state.js';
import { WALK_TILES_PER_MIN } from '../core/constants.js';
import { adjacentTiles, entryTile } from '../core/grid.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';
import { STAFF_ROLES, STAFF_NAMES, TRAITS } from '../data/staffdefs.js';
import { LINES } from '../data/texts.js';
import { spend } from './economy.js';
import { maxStaffOf } from './research.js';
import { findPath, findPathToAdjacent, moveAlongPath, agentTileOk } from './pathfinding.js';

// ---- tuning knobs ----
export const TUNE = {
  POOL_MIN: 3, POOL_MAX: 5,
  STAFF_SPEED: 1.0,            // walk multiplier
  REST_BELOW: 0.15,            // stamina fraction that sends an idle staff member to the rest room
  REST_UNTIL: 0.80,
  IDLE_REGEN: 0.0018,          // stamina fraction / min while idle without a rest room
  WALK_REGEN: 0.0007,
  OVERNIGHT_REGEN: 0.65,       // fraction of staminaMax restored when a new day (week) starts
  TIRED_FRAC: 0.30,            // below this fraction treatments run slower (patients.js)
  TRAIN_COST_BASE: 15000, TRAIN_COST_PER_LEVEL: 8000, TRAIN_POINTS_BASE: 10,
  WANDER_MIN: 6, WANDER_SPAN: 16,
  BUBBLE_CHANCE: 0.004,        // per game-min per idle staff
};

// role -> object defs the role likes to hang around
const HOME = {
  doctor: ['exam_room'],
  nurse: ['reception'],
  pt: ['bed', 'heatbox', 'tens', 'traction'],
  ot: ['si_room', 'fine_table'],
  st: ['speech_room'],
};
const ROLE_WEIGHT = { pt: 3, nurse: 2, doctor: 1.3, ot: 1.2, st: 0.9 };

const rnd = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const tileOf = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y) });

function weekIdx(state) {
  const t = state.time;
  return ((t.year - 1) * 12 + (t.month - 1)) * 4 + (t.week - 1);
}
function monthIdx(state) {
  const t = state.time;
  return (t.year - 1) * 12 + (t.month - 1);
}
function agentsMeta(state) {
  if (!state.agents) state.agents = {};
  return state.agents;
}

// ---------- public data helpers ----------

export function salaryOf(staff) { return Math.round(staff.salary || 0); }

export function staffCount(state, role) {
  if (!role) return state.staff.length;
  let n = 0;
  for (const s of state.staff) if (s.role === role) n++;
  return n;
}

function randomName() {
  return pick(STAFF_NAMES.surnames) + pick(STAFF_NAMES.given);
}

function makeCandidate(state, role) {
  const def = STAFF_ROLES[role];
  const trait = rnd() < 0.55 ? pick(TRAITS) : null;
  const [a, b] = def.skillRange;
  let skill = a + Math.floor(rnd() * (b - a + 1));
  let charm = 2 + Math.floor(rnd() * 7);
  let staminaMax = def.staminaMax;
  if (trait) {
    skill += (trait.mods.skill || 0);
    charm += (trait.mods.charm || 0);
    staminaMax += (trait.mods.staminaMax || 0);
  }
  skill = clamp(skill, 1, 10); charm = clamp(charm, 1, 10);
  const salary = Math.round(def.baseSalary * (0.8 + skill * 0.05) / 500) * 500;
  const hireCost = Math.round(def.hireCost * (0.7 + skill * 0.06) / 500) * 500;
  return { cid: 'c' + newId(state), role, name: randomName(), skill, charm, salary, hireCost, trait: trait ? trait.id : null, staminaMax };
}

export function refreshPool(state) {
  const n = TUNE.POOL_MIN + Math.floor(rnd() * (TUNE.POOL_MAX - TUNE.POOL_MIN + 1));
  const roles = Object.keys(STAFF_ROLES);
  const pool = [];
  // guarantee at least 2 different roles
  const first = pick(['pt', 'nurse', 'doctor']);
  for (let i = 0; i < n; i++) {
    let role;
    if (i === 0) role = first;
    else {
      let tot = 0;
      for (const r of roles) tot += ROLE_WEIGHT[r] || 1;
      let x = rnd() * tot;
      role = roles[0];
      for (const r of roles) { x -= ROLE_WEIGHT[r] || 1; if (x <= 0) { role = r; break; } }
    }
    pool.push(makeCandidate(state, role));
  }
  state.hirePool = pool;
  agentsMeta(state).poolMonth = monthIdx(state);
  return pool;
}

// Build a staff entity (also usable by other modules). tx,ty = tile coordinates.
export function createStaff(state, role, cand, tx, ty) {
  const def = STAFF_ROLES[role];
  const c = cand || makeCandidate(state, role);
  const max = c.staminaMax || def.staminaMax;
  return {
    id: newId(state), role, name: c.name, skill: c.skill, charm: c.charm,
    stamina: max, staminaMax: max, salary: c.salary, trait: c.trait || null, level: 1,
    x: tx + 0.5, y: ty + 0.5, path: [], state: 'idle', task: null, wait: 2 + rnd() * 6,
    dir: 1, moving: false, bubble: null, restObj: null,
  };
}

export function hire(state, cid) {
  const i = state.hirePool.findIndex(c => c.cid === cid);
  if (i < 0) return null;
  const c = state.hirePool[i];
  if (state.staff.length >= maxStaffOf(state)) return null;
  if (!spend(state, c.hireCost, 'other')) return null;
  state.hirePool.splice(i, 1);
  const s = createStaff(state, c.role, c, state.door.x, state.door.y);
  s.stamina = s.staminaMax;
  state.staff.push(s);
  s.wait = 0;     // wander to the workplace right away
  return s;
}

export function fire(state, staffId) {
  const i = state.staff.findIndex(s => s.id === staffId);
  if (i < 0) return false;
  const s = state.staff[i];
  releaseStaff(state, s);
  freeRest(state, s);
  state.staff.splice(i, 1);
  return true;
}

export function train(state, staffId) {
  const s = state.staff.find(x => x.id === staffId);
  if (!s || s.skill >= 10) return false;
  const cost = TUNE.TRAIN_COST_BASE + TUNE.TRAIN_COST_PER_LEVEL * (s.level || 1);
  const pts = TUNE.TRAIN_POINTS_BASE * (s.level || 1);
  if (state.money < cost || (state.points.service || 0) < pts) return false;
  if (!spend(state, cost, 'other')) return false;
  state.points.service -= pts;
  s.skill = Math.min(10, s.skill + 1);
  s.level = (s.level || 1) + 1;
  s.salary = Math.round(s.salary * 1.07 / 100) * 100;
  s.charm = Math.min(10, s.charm + (rnd() < 0.3 ? 1 : 0));
  return true;
}

// ---------- task plumbing used by patients.js ----------

export function isChatTask(s) { return !!(s.task && s.task.treatmentId === '__chat'); }

// Free to be given a new job (chatting staff can be interrupted; resting / walking-to-rest cannot).
export function isStaffAvailable(s) {
  if (s.state === 'resting' || s.restObj) return false;
  if (s.task && !isChatTask(s)) return false;
  return true;
}

export function releaseStaff(state, s) {
  s.task = null;
  s.stand = null;
  if (s.state === 'working' || s.state === 'chatting') s.state = 'idle';
  s.wait = 1 + rnd() * 4;
}

// Give a staff member a job and send them to `stand` ({x,y} tile). Returns false if unreachable.
export function assignTask(state, s, task, stand, path) {
  s.task = task;
  s.stand = stand;
  s.restObj = null;
  const p = path || findPath(state, s.x, s.y, stand.x, stand.y);
  s.path = p || [];
  if (!p) { s.x = stand.x + 0.5; s.y = stand.y + 0.5; s.path = []; }   // never leave a job unreachable
  s.state = s.path.length ? 'walking' : 'idle';
  return true;
}

export function staffAtStand(s) {
  if (!s.stand) return false;
  return s.path.length === 0 && Math.floor(s.x) === s.stand.x && Math.floor(s.y) === s.stand.y;
}

function freeRest(state, s) {
  if (!s.restObj) return;
  const o = state.objects.find(x => x.id === s.restObj);
  if (o && o.staffId === s.id && !o.usedBy) { o.busy = false; o.staffId = null; }
  s.restObj = null;
}

export function staffSpeed(state, s) {
  return WALK_TILES_PER_MIN * TUNE.STAFF_SPEED * (state.mods && state.mods.walkSpeed || 1);
}

// ---------- per-frame update ----------

function say(s, key) {
  const pool = LINES.staff && LINES.staff[key];
  if (!pool || !pool.length) return;
  s.bubble = { text: pick(pool), ttl: 40 };
}

function seekRest(state, s) {
  let best = null;
  for (const o of state.objects) {
    const def = BUILDABLES[o.defId];
    if (!def || !(def.restRecovery > 0) || o.busy || o.usedBy || o.staffId) continue;
    const r = findPathToAdjacent(state, s.x, s.y, o);
    if (r && (!best || r.path.length < best.r.path.length)) best = { o, r };
  }
  if (!best) return false;
  best.o.busy = true; best.o.staffId = s.id;
  s.restObj = best.o.id;
  s.stand = best.r.stand;
  s.path = best.r.path;
  s.task = null;
  s.state = s.path.length ? 'walking' : 'resting';
  say(s, 'tired');
  return true;
}

function wander(state, s) {
  const homeDefs = HOME[s.role] || [];
  const homes = state.objects.filter(o => homeDefs.includes(o.defId));
  let tx, ty;
  if (homes.length) {
    const adj = adjacentTiles(state, pick(homes)).filter(t => agentTileOk(state, t.x, t.y));
    if (adj.length) { const t = pick(adj); tx = t.x; ty = t.y; }
  }
  if (tx === undefined) { const e = entryTile(state); tx = e.x + Math.floor(rnd() * 5) - 2; ty = e.y - 2 - Math.floor(rnd() * 3); }
  if (rnd() < 0.35) { tx += Math.floor(rnd() * 3) - 1; ty += Math.floor(rnd() * 3) - 1; }
  if (!agentTileOk(state, tx, ty)) return;
  const p = findPath(state, s.x, s.y, tx, ty);
  if (p && p.length) { s.path = p; s.state = 'walking'; }
}

export function updateStaff(state, dtMin) {
  const meta = agentsMeta(state);
  const mi = monthIdx(state);
  if (meta.poolMonth === undefined || (meta.poolMonth !== mi && (!state.hirePool || state.hirePool.length === 0))) refreshPool(state);
  const wk = weekIdx(state);
  const newDay = meta.staffDay !== undefined && meta.staffDay !== wk;
  meta.staffDay = wk;
  const patientIds = new Set();
  for (const p of state.patients) patientIds.add(p.id);
  const speed = staffSpeed(state);
  const stMul = (state.mods && state.mods.staffStamina) || 1;

  for (const s of state.staff) {
    if (!s.path) s.path = [];
    if (!s.state) s.state = 'idle';
    if (s.task === undefined) s.task = null;
    if (s.wait === undefined) s.wait = 0;
    if (typeof s.stamina !== 'number') s.stamina = s.staminaMax || 100;
    if (!s.staminaMax) s.staminaMax = (STAFF_ROLES[s.role] && STAFF_ROLES[s.role].staminaMax) || 100;
    if (s.restObj === undefined) s.restObj = null;
    if (s.bubble) { s.bubble.ttl -= dtMin; if (s.bubble.ttl <= 0) s.bubble = null; }
    if (newDay) s.stamina = Math.min(s.staminaMax, s.stamina + s.staminaMax * TUNE.OVERNIGHT_REGEN);

    // drop jobs whose patient disappeared
    if (s.task && !patientIds.has(s.task.patientId)) releaseStaff(state, s);
    // rest room demolished?
    if (s.restObj) {
      const ro = state.objects.find(o => o.id === s.restObj);
      if (!ro) { s.restObj = null; if (s.state === 'resting') s.state = 'idle'; s.path = []; }
    }

    const max = s.staminaMax;

    if (s.state === 'working') {
      if (!s.task) { s.state = 'idle'; continue; }
      const T = TREATMENTS[s.task.treatmentId];
      const rate = T ? (T.staminaCost * stMul / Math.max(1, T.duration)) : (3 * stMul / 4);
      s.stamina = Math.max(0, s.stamina - rate * dtMin);
      continue;
    }

    if (s.state === 'resting') {
      const ro = s.restObj && state.objects.find(o => o.id === s.restObj);
      const rec = ro ? (BUILDABLES[ro.defId].restRecovery || 1) : 0;
      s.stamina = Math.min(max, s.stamina + (rec || max * TUNE.IDLE_REGEN) * dtMin);
      if (s.stamina >= max * TUNE.REST_UNTIL || !ro) { freeRest(state, s); s.state = 'idle'; s.wait = 1; }
      continue;
    }

    // walking / idle / chatting
    if (s.path.length) {
      moveAlongPath(s, dtMin, speed);
      s.stamina = Math.min(max, s.stamina + max * TUNE.WALK_REGEN * dtMin);
      if (s.path.length === 0) {
        if (s.restObj) s.state = 'resting';
        else s.state = 'idle';
      } else if (s.state !== 'chatting') s.state = 'walking';
      continue;
    }
    s.moving = false;
    if (s.state === 'walking') s.state = s.restObj ? 'resting' : 'idle';
    if (s.restObj && s.state !== 'resting') s.state = 'resting';

    // standing around
    if (s.state === 'chatting') { s.stamina = Math.min(max, s.stamina + max * TUNE.IDLE_REGEN * dtMin); continue; }
    s.stamina = Math.min(max, s.stamina + max * TUNE.IDLE_REGEN * dtMin);
    if (s.task) continue;                      // waiting for the patient at the station

    if (s.stamina <= max * TUNE.REST_BELOW) {
      s.restCd = (s.restCd || 0) - dtMin;
      if (s.restCd <= 0) { s.restCd = 6; if (seekRest(state, s)) continue; }
    }
    s.wait -= dtMin;
    if (s.wait <= 0) {
      s.wait = TUNE.WANDER_MIN + rnd() * TUNE.WANDER_SPAN;
      wander(state, s);
    }
    if (!s.bubble && rnd() < TUNE.BUBBLE_CHANCE * dtMin) say(s, s.stamina < max * 0.35 ? 'tired' : (rnd() < 0.5 ? 'work' : 'chat'));
  }
}
