// Staff: hire pool, hire / fire / train, stamina, rest room usage, idle wandering and task plumbing.
// Treatment progress itself is driven by patients.js (it owns the patient state machine); this module owns
// everything about the staff member as a person (movement, stamina, resting, wandering).
import { bus } from '../core/bus.js';
import { newId } from '../core/state.js';
import { WALK_TILES_PER_MIN, DAY_GAME_MIN } from '../core/constants.js';
import { adjacentTiles, entryTile } from '../core/grid.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';
import { STAFF_ROLES, STAFF_NAMES, TRAITS } from '../data/staffdefs.js';
import { LINES } from '../data/texts.js';
import { spend } from './economy.js';
import { maxStaffOf } from './research.js';
import { findPath, findPathToAdjacent, moveAlongPath, agentTileOk, receptionPost, rescueIfBlocked } from './pathfinding.js';

// ---- tuning knobs ----
export const TUNE = {
  POOL_MIN: 3, POOL_MAX: 5,
  STAFF_SPEED: 1.0,            // walk multiplier
  WALK_BOOST: 1.7,             // global walking-speed scale (patients + staff) on top of constants.WALK_TILES_PER_MIN
  REST_BELOW: 0.30,            // stamina fraction that sends a staff member to the rest room (after the current patient)
  REST_UNTIL: 0.85,
  REG_STAMINA: 0.22,           // stamina / min a nurse burns while registering a patient
  IDLE_REGEN: 0.0018,          // stamina fraction / min while idle without a rest room
  WALK_REGEN: 0.0007,
  OVERNIGHT_REGEN: 0.65,       // fraction of staminaMax restored when a new day (week) starts
  TIRED_FRAC: 0.30,            // below this fraction work (treatment / registration) gets slower (see tiredFactor)
  TIRED_SLOW: 0.8,             // extra duration at stamina 0 (x1.8 total)
  TRAIN_COST_BASE: 40000, TRAIN_COST_PER_LEVEL: 20000, TRAIN_POINTS_BASE: 10,
  WANDER_MIN: 6, WANDER_SPAN: 16,
  BUBBLE_CHANCE: 0.004,        // per game-min per idle staff
  TIRED_BUBBLE: 0.03,          // per game-min: tired staff mutter (visible 'tired' bubble) while working
  REST_RETRY: 6,               // game-min before a staff member whose rest request failed asks again
};

// M4 morale (docs/EVENTS_EXT.md §5)
export const MORALE = {
  START: 70, MIN: 0, MAX: 100,
  WEEK_RECOVER: 1,             // base weekly recovery
  TIRED_PENALTY: 3,            // weeks in which stamina stayed under TIRED_FRAC for at least TIRED_MIN game-minutes
  TIRED_MIN: 120,
  REST_BONUS: 1,               // a rest room (def.restRecovery) in the clinic
  OVERTIME_UTIL: 0.6,          // 超時: working for this share of the opening hours in a week ...
  OVERTIME_PENALTY: 2,         // ... costs this much morale
  RESIGN_BELOW: 25,            // morale under this: weekly RESIGN_P chance of the resignation event
  RESIGN_P: 0.08,
  RESIGN_ROLES: ['doctor', 'pt', 'ot', 'st'],
  RESIGN_FALLBACK_HIT: 15,     // morale loss instead of leaving when the role would be left empty
  POOL_MAX: 6,
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

const rnd = () => Math.random();   // late-bound so test harnesses can seed Math.random
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
    morale: MORALE.START, tiredAcc: 0, workAcc: 0,
    x: tx + 0.5, y: ty + 0.5, path: [], state: 'idle', task: null, wait: 2 + rnd() * 6,
    dir: 1, moving: false, bubble: null, restObj: null, wantRest: false, tired: false,
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

// Take a staff member out of the clinic: frees their task, rest room and station claims (patients.js reconcile() then
// releases any patient still pointing at them). Shared by fire() and resignStaff(). Returns the removed staff or null.
export function removeStaff(state, staffId) {
  const i = state.staff.findIndex(s => s.id === staffId);
  if (i < 0) return null;
  const s = state.staff[i];
  releaseStaff(state, s);
  freeRest(state, s);
  s.path = []; s.restObj = null; s.wantRest = false;
  for (const o of state.objects) if (o.staffId === s.id && !o.usedBy) { o.busy = false; o.staffId = null; }
  state.staff.splice(i, 1);
  return s;
}

export function fire(state, staffId) {
  return !!removeStaff(state, staffId);
}

// ---------- M4 morale ----------
export function moraleOf(s) {
  const m = s && s.morale;
  return typeof m === 'number' && Number.isFinite(m) ? clamp(m, MORALE.MIN, MORALE.MAX) : MORALE.START;
}
export function addMorale(state, role, delta) {
  let n = 0;
  for (const s of state.staff) {
    if (role && s.role !== role) continue;
    s.morale = clamp(moraleOf(s) + delta, MORALE.MIN, MORALE.MAX);
    n++;
  }
  return n;
}
// `carry`: the effect happens at the very start of a new day (week:start), just before the overnight regeneration in
// updateStaff would wash it out - so it is applied after that regeneration instead.
export function addStamina(state, role, delta, carry) {
  let n = 0;
  for (const s of state.staff) {
    if (role && s.role !== role) continue;
    if (carry) s.staminaCarry = (s.staminaCarry || 0) + delta;
    else s.stamina = clamp((typeof s.stamina === 'number' ? s.stamina : s.staminaMax || 100) + delta, 0, s.staminaMax || 100);
    n++;
  }
  return n;
}
export function hasRestRoom(state) {
  return state.objects.some(o => { const d = BUILDABLES[o.defId]; return d && d.restRecovery > 0; });
}
// Weekly update (events.js, week:start): +1 recovery, -3 after a week of exhaustion, +1 with a rest room.
export function weeklyMorale(state) {
  const rest = hasRestRoom(state);
  for (const s of state.staff) {
    let m = moraleOf(s) + MORALE.WEEK_RECOVER + (rest ? MORALE.REST_BONUS : 0);
    if ((s.tiredAcc || 0) >= MORALE.TIRED_MIN) m -= MORALE.TIRED_PENALTY;
    if ((s.workAcc || 0) >= MORALE.OVERTIME_UTIL * DAY_GAME_MIN) m -= MORALE.OVERTIME_PENALTY;
    s.tiredAcc = 0; s.workAcc = 0;
    s.morale = clamp(m, MORALE.MIN, MORALE.MAX);
  }
}
// Most unhappy resign candidate: a PT/OT/ST/doctor under RESIGN_BELOW whose role would not be left empty.
export function resignCandidate(state) {
  let best = null;
  for (const s of state.staff) {
    if (!MORALE.RESIGN_ROLES.includes(s.role) || moraleOf(s) >= MORALE.RESIGN_BELOW) continue;
    if (staffCount(state, s.role) < 2) continue;
    if (!best || moraleOf(s) < moraleOf(best)) best = s;
  }
  return best;
}

// A staff member quits. Removes them (see removeStaff) and adds a replacement candidate of the same role to the hire pool.
export function resignStaff(state, staffId) {
  const s = removeStaff(state, staffId);
  if (!s) return null;
  if (!Array.isArray(state.hirePool)) state.hirePool = [];
  const cand = makeCandidate(state, s.role);
  if (state.hirePool.length >= MORALE.POOL_MAX) state.hirePool[state.hirePool.length - 1] = cand; else state.hirePool.push(cand);
  bus.emit('staff:resigned', { id: s.id, role: s.role, name: s.name });
  return s;
}
// Effect `resign: {role, p}`: with chance p the least happy member of the role leaves, provided at least one stays;
// otherwise (or when the role would be empty) the role loses RESIGN_FALLBACK_HIT morale instead. Returns {left, hit}.
export function resignRole(state, role, p = 1, rollOverride) {
  const mates = state.staff.filter(s => s.role === role);
  if (!mates.length) return { left: null, hit: false };
  const roll = rollOverride !== undefined ? rollOverride : rnd();
  if (roll >= p) return { left: null, hit: false };
  if (mates.length < 2) { addMorale(state, role, -MORALE.RESIGN_FALLBACK_HIT); return { left: null, hit: true }; }
  const who = mates.slice().sort((a, b) => moraleOf(a) - moraleOf(b) || a.id - b.id)[0];
  return { left: resignStaff(state, who.id), hit: false };
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
// Work-duration multiplier: 1 while rested, rising to 1 + TIRED_SLOW at zero stamina below TIRED_FRAC.
export function tiredFactor(s) {
  if (!s || !s.staminaMax) return 1;
  const f = s.stamina / s.staminaMax;
  if (f >= TUNE.TIRED_FRAC) return 1;
  return 1 + TUNE.TIRED_SLOW * (TUNE.TIRED_FRAC - Math.max(0, f)) / TUNE.TIRED_FRAC;
}

export function isStaffAvailable(s) {
  if (s.state === 'resting' || s.restObj || s.wantRest) return false;
  if (s.task && !isChatTask(s)) return false;
  return true;
}

export function releaseStaff(state, s) {
  if (s.task && s.state === 'walking') s.path = [];       // stop walking to a cancelled job
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
  return WALK_TILES_PER_MIN * TUNE.WALK_BOOST * TUNE.STAFF_SPEED * (state.mods && state.mods.walkSpeed || 1);
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
  s.wantRest = false;
  s.restObj = best.o.id;
  s.stand = best.r.stand;
  s.path = best.r.path;
  s.task = null;
  s.state = s.path.length ? 'walking' : 'resting';
  say(s, 'tired');
  return true;
}

// Nurses each keep to "their" reception counter (round robin by id) and stand on its post instead of roaming
// between counters: walking across the clinic takes far longer than a registration itself.
function nurseHome(state, s, homes) {
  const mates = state.staff.filter(x => x.role === 'nurse').sort((a, b) => a.id - b.id);
  const sorted = homes.slice().sort((a, b) => a.id - b.id);
  const idx = Math.max(0, mates.indexOf(s));
  return { obj: sorted[idx % sorted.length], owner: idx < sorted.length };
}

function wander(state, s) {
  const homeDefs = HOME[s.role] || [];
  const homes = state.objects.filter(o => homeDefs.includes(o.defId));
  let tx, ty, exact = false;
  if (homes.length) {
    let home = null;
    if (s.role === 'nurse') {
      const h = nurseHome(state, s, homes);
      home = h.obj;
      const post = h.owner && receptionPost(state, home);
      if (post) { tx = post.x; ty = post.y; exact = true; }
    } else home = pick(homes);
    if (tx === undefined) {
      const adj = adjacentTiles(state, home).filter(t => agentTileOk(state, t.x, t.y));
      if (adj.length) { const t = pick(adj); tx = t.x; ty = t.y; }
    }
  }
  if (tx === undefined) { const e = entryTile(state); tx = e.x + Math.floor(rnd() * 5) - 2; ty = e.y - 2 - Math.floor(rnd() * 3); }
  if (!exact && rnd() < 0.35) { tx += Math.floor(rnd() * 3) - 1; ty += Math.floor(rnd() * 3) - 1; }
  if (!agentTileOk(state, tx, ty)) return;
  if (Math.floor(s.x) === tx && Math.floor(s.y) === ty) return;
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
  // rest rooms nobody is using or heading for, minus staff already queued for one (each tired person only
  // reserves a room when one is really free, so nobody gets locked out of work waiting for a busy room)
  let freeRooms = 0, flagged = 0;
  for (const o of state.objects) {
    const def = BUILDABLES[o.defId];
    if (def && def.restRecovery > 0 && !o.busy && !o.usedBy && !o.staffId) freeRooms++;
  }
  for (const s of state.staff) if (s.wantRest && !s.restObj) flagged++;

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
    if (s.staminaCarry) { s.stamina = clamp(s.stamina + s.staminaCarry, 0, s.staminaMax); delete s.staminaCarry; }

    // drop jobs whose patient disappeared
    if (s.task && !patientIds.has(s.task.patientId)) releaseStaff(state, s);
    // rest room demolished?
    if (s.restObj) {
      const ro = state.objects.find(o => o.id === s.restObj);
      if (!ro) { s.restObj = null; if (s.state === 'resting') s.state = 'idle'; s.path = []; }
    }

    if (!s.path.length) rescueIfBlocked(state, s);     // built over: pop out of the object
    const max = s.staminaMax;
    if (s.restCd > 0) s.restCd -= dtMin;
    s.tired = s.stamina < max * TUNE.TIRED_FRAC;
    if (s.tired) s.tiredAcc = (s.tiredAcc || 0) + dtMin;
    if (s.state === 'working') s.workAcc = (s.workAcc || 0) + dtMin;
    // low stamina: ask for a rest room slot; the request only bites BETWEEN tasks (isStaffAvailable is false meanwhile),
    // so the current patient is always finished first
    if (!s.wantRest && !s.restObj && s.state !== 'resting' && s.stamina <= max * TUNE.REST_BELOW && !(s.restCd > 0) && freeRooms > flagged) {
      s.wantRest = true; flagged++;
    } else if (s.wantRest && s.stamina > max * (TUNE.REST_BELOW + 0.12)) { s.wantRest = false; flagged = Math.max(0, flagged - 1); }

    if (s.state === 'working') {
      if (!s.task) { s.state = 'idle'; continue; }
      const T = TREATMENTS[s.task.treatmentId];
      const rate = T ? (T.staminaCost * stMul / Math.max(1, T.duration)) : (TUNE.REG_STAMINA * stMul);
      s.stamina = Math.max(0, s.stamina - rate * dtMin);
      if (s.tired && !s.bubble && rnd() < TUNE.TIRED_BUBBLE * dtMin) say(s, 'tired');
      continue;
    }

    if (s.state === 'resting') {
      const ro = s.restObj && state.objects.find(o => o.id === s.restObj);
      const rec = ro ? (BUILDABLES[ro.defId].restRecovery || 1) : 0;
      s.stamina = Math.min(max, s.stamina + (rec || max * TUNE.IDLE_REGEN) * dtMin);
      if (s.stamina >= max * TUNE.REST_UNTIL || !ro) { freeRest(state, s); s.state = 'idle'; s.wait = 1; }
      continue;
    }

    // tired and between tasks (a chat is not a task): go and rest
    if (s.wantRest && !s.restObj && (!s.task || isChatTask(s))) {
      if (seekRest(state, s)) { flagged = Math.max(0, flagged - 1); freeRooms--; continue; }
      s.wantRest = false; flagged = Math.max(0, flagged - 1); s.restCd = TUNE.REST_RETRY;
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

    s.wait -= dtMin;
    if (s.wait <= 0) {
      s.wait = TUNE.WANDER_MIN + rnd() * TUNE.WANDER_SPAN;
      wander(state, s);
    }
    if (!s.bubble && rnd() < TUNE.BUBBLE_CHANCE * dtMin) say(s, s.stamina < max * 0.35 ? 'tired' : (rnd() < 0.5 ? 'work' : 'chat'));
  }
}
