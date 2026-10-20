// Save / load (localStorage), import / export, new game, autosave on month rollover.
import { bus } from '../core/bus.js';
import { createInitialState, replaceState, ui } from '../core/state.js';
import { state as singleton } from '../core/state.js';
import { SAVE_KEY_PREFIX, SAVE_VERSION } from '../core/constants.js';
import { rebuildOccupancy, footprint } from '../core/grid.js';
import { seedStarterClinic } from './build.js';
import { refreshPool } from './staff.js';
import { recomputeZones } from './synergy.js';
import { recomputeMods } from './modifiers.js';
import { rollWeather } from './events.js';
import { formatDate } from './calendar.js';
import { BUILDABLES } from '../data/buildables.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { STAFF_ROLES } from '../data/staffdefs.js';
import { LOTS } from '../data/lots.js';
import { RESEARCH } from '../data/research.js';
import { FOCUS } from '../data/patients.js';
import { WEATHER, BOARDS, COMMUNITY } from '../data/events.js';
import { ACHIEVEMENTS, MAX_BADGES } from '../data/achievements.js';
import { POINT_KEYS } from '../core/constants.js';

export const SAVE_SLOTS = ['1', '2', '3'];      // manual slots; 'auto' is the autosave slot
const NESTED_KEYS = ['time', 'points', 'weather', 'lot', 'door', 'policy', 'research', 'nhi', 'ledger', 'stats', 'events', 'inspections', 'flags'];

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

function snapshot(state) {
  const { map, ...rest } = state;
  return { ...rest, map: { floor: map.floor } };   // occ is a runtime cache
}

function buildPayload(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    label: `${state.clinicName || '診所'}　${formatDate(state)}　NT$ ${Math.round(state.money).toLocaleString('en-US')}`,
    state: JSON.parse(JSON.stringify(snapshot(state))),
  };
}

export function saveGame(state, slot = 'auto') {
  try {
    const ls = storage();
    if (!ls) return false;
    ls.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(buildPayload(state)));
    return true;
  } catch (e) {
    console.warn('[save] failed', e);
    return false;
  }
}

// ---- version migrations ----
// MIGRATIONS[v] upgrades a raw state saved at version v to version v+1 (runs before hydrate()).
// When you change the shape of `state` in a way defaults can't paper over, bump SAVE_VERSION in core/constants.js
// and add MIGRATIONS[<old version>] here. Missing fields are otherwise filled by hydrate()/sanitize() below.
export const MIGRATIONS = {
  0: (st) => st,     // pre-versioned dumps: nothing structural to change, hydrate() fills the gaps
  // v1 -> v2: achievements. Adds state.achv; the state-derivable ones are paid out by achievements.evaluateAll() on 'state:loaded'.
  1: (st) => {
    if (!st.achv || typeof st.achv !== 'object') st.achv = { unlocked: {}, counters: {}, title: null, badges: [] };
    const c = st.achv.counters && typeof st.achv.counters === 'object' ? st.achv.counters : (st.achv.counters = {});
    // periods already running cannot be tracked retroactively (trackMonth/trackYear stay undefined -> achievements.ensure() sets null)
    if (c.selfPayEver === undefined) c.selfPayEver = !!(st.ledger && st.ledger.income && st.ledger.income.self > 0);
    return st;
  },
};
function migrate(st, fromVersion) {
  let v = Number.isFinite(fromVersion) ? fromVersion : 0;
  while (v < SAVE_VERSION) {
    if (MIGRATIONS[v]) st = MIGRATIONS[v](st) || st;
    v++;
  }
  st.version = SAVE_VERSION;
  return st;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
const clampN = (v, a, b, d) => Math.max(a, Math.min(b, num(v, d)));
// every field patients.js reads without a guard (mirrors spawnPatient); only applied where a field is missing
const PATIENT_DEFAULTS = {
  name: '病患', bubble: null, bubbleCd: 0, cured: false, targetObj: null, staffId: null, seat: null, enteredAt: 480, waitedMin: 0,
  upsold: false, course: 4, visit: 0, cureScale: 1, age: 0, stun: 0, hold: false, chat: null, chatCd: 60, cmf: 0, rel: 0, cmfT: 0,
  waitStart: 0, spot: null, stand: null, dest: null, dir: 1, moving: false, treated: 0, qT: 0, needSpot: false, remaining: 0, total: 0,
};
const STAGES = new Set(['arriving', 'to_reception', 'registering', 'waiting', 'to_station', 'treating', 'leaving']);

// createInitialState() calls Math.random() for state.seed; building the merge bases must not advance the game's
// random stream, otherwise "save -> load" would change what happens next.
function quietly(fn) {
  const r = Math.random;
  Math.random = () => 0;
  try { return fn(); } finally { Math.random = r; }
}

// Merge a parsed payload into a fresh state so saves from older builds still load.
function hydrate(raw) {
  const [fresh, base] = quietly(() => [createInitialState(), createInitialState()]);
  const merged = Object.assign(fresh, raw);
  for (const k of NESTED_KEYS) {
    const rv = raw[k];
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merged[k] = { ...base[k], ...(rv && typeof rv === 'object' && !Array.isArray(rv) ? rv : {}) };
  }
  merged.mods = { ...base.mods, ...(raw.mods && typeof raw.mods === 'object' ? raw.mods : {}) };
  if (!merged.mods.typeSpawn || typeof merged.mods.typeSpawn !== 'object') merged.mods.typeSpawn = {};
  merged.map = { floor: (raw.map && Array.isArray(raw.map.floor) && raw.map.floor.length === base.map.floor.length && raw.map.floor.every((r, i) => Array.isArray(r) && r.length === base.map.floor[i].length)) ? raw.map.floor : base.map.floor, occ: null };
  for (const k of ['objects', 'staff', 'hirePool', 'patients', 'queue', 'history', 'zones']) if (!Array.isArray(merged[k])) merged[k] = [];
  merged.policy.boards = Array.isArray(merged.policy.boards) ? merged.policy.boards : [];
  merged.policy.priceMult = merged.policy.priceMult && typeof merged.policy.priceMult === 'object' ? merged.policy.priceMult : {};
  for (const k of ['active', 'log']) if (!Array.isArray(merged.events[k])) merged.events[k] = [];
  if (!merged.events.cooldowns || typeof merged.events.cooldowns !== 'object') merged.events.cooldowns = {};
  if (merged.events.pendingDilemma === undefined) merged.events.pendingDilemma = null;
  if (!Array.isArray(merged.research.done)) merged.research.done = [];
  return merged;
}

// Repair values a hand-edited / truncated / older save may have wrong, so the sim never meets NaN or a dangling id.
function sanitize(m) {
  m.money = num(m.money, 0);
  m.reputation = clampN(m.reputation, 0, 1000, 10);
  for (const k of POINT_KEYS) m.points[k] = Math.max(0, num(m.points[k], 0));
  m.nextId = Math.max(1, Math.floor(num(m.nextId, 1)));
  m.seed = num(m.seed, 0);
  m.clinicName = typeof m.clinicName === 'string' && m.clinicName ? m.clinicName : '幸福復健科診所';

  const t = m.time;
  t.year = Math.max(1, Math.floor(num(t.year, 1)));
  t.month = clampN(Math.floor(num(t.month, 1)), 1, 12, 1);
  t.week = clampN(Math.floor(num(t.week, 1)), 1, 4, 1);
  t.clock = clampN(t.clock, 480, 1200, 480);
  t.speed = [0, 1, 2, 3].includes(t.speed) ? t.speed : 1;
  t.paused = !!t.paused;

  // lot: level must exist and the rectangle must be that level's (nested lots only grow)
  m.lotLevel = Math.max(0, Math.min(LOTS.length - 1, Math.floor(num(m.lotLevel, 0))));
  const L = LOTS[m.lotLevel];
  const okRect = m.lot && ['x0', 'y0', 'w', 'h'].every(k => Number.isFinite(m.lot[k]));
  if (!okRect || m.lot.w !== L.lot.w || m.lot.h !== L.lot.h) m.lot = { ...L.lot };
  if (!m.door || !Number.isFinite(m.door.x) || !Number.isFinite(m.door.y)) m.door = { ...L.door };

  // economy bookkeeping
  for (const k of Object.keys(m.ledger.income)) m.ledger.income[k] = Math.max(0, num(m.ledger.income[k], 0));
  for (const k of Object.keys(m.ledger.expense)) m.ledger.expense[k] = Math.max(0, num(m.ledger.expense[k], 0));
  for (const k of ['weekPoints', 'monthPoints']) m.nhi[k] = Math.max(0, num(m.nhi[k], 0));
  m.nhi.pointValue = clampN(m.nhi.pointValue, 0.1, 1, 1);
  for (const k of Object.keys(m.stats)) m.stats[k] = num(m.stats[k], 0);
  m.history = m.history.filter(h => h && typeof h === 'object');

  // mods are recomputed after load; just make sure every default key is a number
  for (const [k, v] of Object.entries(createInitialStateMods())) if (typeof v === 'number' && !Number.isFinite(m.mods[k])) m.mods[k] = v;

  // references into static data
  m.research.done = [...new Set(m.research.done.filter(id => RESEARCH[id]))];
  if (m.research.current && (!RESEARCH[m.research.current] || m.research.done.includes(m.research.current))) { m.research.current = null; m.research.progress = 0; }
  m.research.progress = Math.max(0, num(m.research.progress, 0));
  if (!FOCUS[m.policy.focus]) m.policy.focus = 'ortho';
  const boardIds = new Set((BOARDS || []).map(b => b.id));
  m.policy.boards = [...new Set(m.policy.boards.filter(id => boardIds.has(id)))];
  for (const [id, v] of Object.entries(m.policy.priceMult)) m.policy.priceMult[id] = clampN(v, 0.5, 2, 1);
  const w = m.weather || {};
  const wd = (WEATHER || []).find(x => x.id === w.id) || (WEATHER || []).find(x => x.kind === w.kind);
  m.weather = wd ? { ...w, kind: wd.kind, id: wd.id, temp: num(w.temp, 24) } : { kind: 'sunny', id: 'sunny', temp: 24 };
  m.events.active = m.events.active.filter(a => a && typeof a === 'object' && Number.isFinite(a.weeksLeft));
  const pd = m.events.pendingDilemma;
  if (pd && !(typeof pd === 'object' && Array.isArray(pd.choices) && pd.choices.length)) m.events.pendingDilemma = null;
  m.hirePool = m.hirePool.filter(c => c && c.cid && STAFF_ROLES[c.role]);

  // objects: known defs, inside the lot, no overlaps, runtime fields present
  const taken = new Set();
  const inL = (x, y) => x >= m.lot.x0 && y >= m.lot.y0 && x < m.lot.x0 + m.lot.w && y < m.lot.y0 + m.lot.h;
  const objs = [];
  for (const o of m.objects) {
    if (!o || !BUILDABLES[o.defId] || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.id)) continue;
    o.rot = o.rot ? 1 : 0; o.wear = Math.max(0, num(o.wear, 0));
    if (typeof o.busy !== 'boolean') o.busy = false;
    if (o.usedBy === undefined) o.usedBy = null;
    if (o.staffId === undefined) o.staffId = null;
    const cells = footprint(o);
    if (!cells.every(c => inL(c.x, c.y))) continue;
    if (BUILDABLES[o.defId].blocks !== false) {
      if (cells.some(c => taken.has(c.x + ',' + c.y))) continue;
      for (const c of cells) taken.add(c.x + ',' + c.y);
    }
    objs.push(o);
  }
  m.objects = objs;

  // staff: known roles + the runtime fields staff.js / patients.js touch
  const sids = new Set();
  m.staff = m.staff.filter(s => s && STAFF_ROLES[s.role] && Number.isFinite(s.id) && !sids.has(s.id) && sids.add(s.id));
  for (const s of m.staff) {
    const def = STAFF_ROLES[s.role];
    s.skill = clampN(s.skill, 1, 10, 5); s.charm = clampN(s.charm, 1, 10, 5);
    s.staminaMax = Math.max(1, num(s.staminaMax, def.staminaMax || 100));
    s.stamina = clampN(s.stamina, 0, s.staminaMax, s.staminaMax);
    s.salary = Math.max(0, num(s.salary, def.baseSalary || 0));
    s.x = num(s.x, m.door.x + 0.5); s.y = num(s.y, m.door.y - 0.5);
    s.level = Math.max(1, Math.floor(num(s.level, 1)));
    // runtime fields: only fill what is missing (a valid in-flight task / path survives the round trip)
    if (!Array.isArray(s.path)) s.path = [];
    if (s.task === undefined || (s.task !== null && typeof s.task !== 'object')) s.task = null;
    if (typeof s.state !== 'string') s.state = 'idle';
    s.wait = Math.max(0, num(s.wait, 0));
    if (s.trait === undefined) s.trait = null;
  }

  // patients are transient: keep those that are structurally sound, repair the rest, drop the hopeless
  const pids = new Set();
  m.patients = m.patients.filter(p => p && PATIENT_TYPES[p.type] && Number.isFinite(p.id) && !pids.has(p.id) && pids.add(p.id) &&
    Array.isArray(p.plan) && p.plan.length && STAGES.has(p.stage) && Number.isFinite(p.x) && Number.isFinite(p.y));
  for (const p of m.patients) {
    p.planIdx = clampN(Math.floor(num(p.planIdx, 0)), 0, p.plan.length, 0);
    if (!Array.isArray(p.path)) p.path = [];
    if (!p.flags || typeof p.flags !== 'object') p.flags = { slipped: false, skipDoc: false };
    if (!p.paid || typeof p.paid !== 'object') p.paid = { nhi: 0, self: 0 };
    p.satisfaction = clampN(p.satisfaction, 0, 100, 60);
    const basePat = PATIENT_TYPES[p.type].patience || 50;
    p.patience = num(p.patience, basePat); p.patienceMax = Math.max(1, num(p.patienceMax, basePat));
    p.hp = Math.max(0, num(p.hp, 0));
    p.treated = Math.max(0, num(p.treated, 0));
    p.age = Math.max(0, num(p.age, 0));
    if (!p.noPath || typeof p.noPath !== 'object') p.noPath = {};
    if (!Array.isArray(p.selfPaySteps)) p.selfPaySteps = [];
    for (const [k, v] of Object.entries(PATIENT_DEFAULTS)) if (p[k] === undefined) p[k] = Array.isArray(v) ? [] : (v && typeof v === 'object' ? { ...v } : v);
    // (an inconsistent claim - station or staff that no longer exists - is repaired by patients.js reconcile())
  }
  m.queue = m.queue.filter(id => pids.has(id));
  sanitizeAchv(m);
  return m;
}

// achievements: counters numeric, unknown ids dropped, badges <= MAX_BADGES and unlocked, title must be an unlocked achievement with a title
const ACHV_NUM_COUNTERS = ['totalSelfPayMonth', 'auditPassStreak', 'chatCount', 'slipThisYear', 'angryThisMonth', 'servedThisMonth', 'servedThisYear',
  'servedThisWeek', 'curedThisWeek', 'elderThisWeek', 'slipThisWeek'];
const DILEMMA_KEYS = ['painkiller', 'skip_doctor', 'overtreat', 'complain'];
function sanitizeAchv(m) {
  const defs = new Map(ACHIEVEMENTS.map(d => [d.id, d]));
  const a = m.achv && typeof m.achv === 'object' && !Array.isArray(m.achv) ? m.achv : {};
  const unlocked = {};
  const src = a.unlocked && typeof a.unlocked === 'object' && !Array.isArray(a.unlocked) ? a.unlocked : {};
  for (const [id, at] of Object.entries(src)) {
    if (!defs.has(id)) continue;
    const o = at && typeof at === 'object' ? at : {};
    unlocked[id] = { year: Math.max(1, Math.floor(num(o.year, 1))), month: clampN(Math.floor(num(o.month, 1)), 1, 12, 1), week: clampN(Math.floor(num(o.week, 1)), 1, 4, 1) };
  }
  const c0 = a.counters && typeof a.counters === 'object' && !Array.isArray(a.counters) ? a.counters : {};
  const c = {};
  for (const k of ACHV_NUM_COUNTERS) c[k] = Math.max(0, Math.floor(num(c0[k], 0)));
  c.dilemmasDone = {};
  for (const k of DILEMMA_KEYS) c.dilemmasDone[k] = Math.max(0, Math.floor(num(c0.dilemmasDone && c0.dilemmasDone[k], 0)));
  c.communityDone = {};
  for (const def of COMMUNITY || []) { const n = Math.max(0, Math.floor(num(c0.communityDone && c0.communityDone[def.id], 0))); if (n > 0) c.communityDone[def.id] = n; }
  c.weekSeen = (Array.isArray(c0.weekSeen) ? c0.weekSeen : []).filter(v => Number.isFinite(v)).slice(-500);
  c.selfPayEver = !!c0.selfPayEver;
  if (Number.isFinite(c0.startMoney)) c.startMoney = c0.startMoney;
  if (Number.isFinite(c0.lowestMoneySeen)) c.lowestMoneySeen = Math.min(c0.lowestMoneySeen, m.money);
  for (const k of ['trackMonth', 'trackYear']) {
    if (c0[k] === null) c[k] = null;
    else if (Number.isFinite(c0[k])) c[k] = c0[k];
  }   // left undefined when missing: achievements.ensure() derives it
  const badges = [];
  for (const id of Array.isArray(a.badges) ? a.badges : []) {
    const d = defs.get(id);
    if (d && d.badge && unlocked[id] && !badges.includes(id) && badges.length < MAX_BADGES) badges.push(id);
  }
  const td = typeof a.title === 'string' ? defs.get(a.title) : null;
  m.achv = { unlocked, counters: c, title: td && td.title && unlocked[td.id] ? td.id : null, badges };
}
function createInitialStateMods() { return base0().mods; }
function base0() { return quietly(() => createInitialState()); }

function applyPayload(state, payload) {
  if (!payload || typeof payload !== 'object' || !payload.state) return false;
  if (typeof payload.version === 'number' && payload.version > SAVE_VERSION) return false;
  const st = payload.state;
  // reject obviously foreign / truncated JSON instead of silently resetting the clinic
  if (typeof st !== 'object' || typeof st.money !== 'number' || !st.time || !st.lot || !Array.isArray(st.objects)) return false;
  const merged = sanitize(hydrate(migrate(st, typeof payload.version === 'number' ? payload.version : st.version)));
  replaceState(state, merged);
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  bus.emit('state:loaded', {});
  // a decision that was pending at save time is shown again
  const p = state.events.pendingDilemma;
  if (p) {
    state.time.paused = true;
    if (p.kind === 'dilemma') bus.emit('dilemma:show', { dilemma: p }); else bus.emit('event:show', { event: p });
  }
  return true;
}

export function loadGame(state, slot = 'auto') {
  try {
    const ls = storage();
    if (!ls) return false;
    const txt = ls.getItem(SAVE_KEY_PREFIX + slot);
    if (!txt) return false;
    return applyPayload(state, JSON.parse(txt));
  } catch (e) {
    console.warn('[save] load failed', e);
    return false;
  }
}

export function listSaves() {
  const out = [];
  try {
    const ls = storage();
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key || !key.startsWith(SAVE_KEY_PREFIX)) continue;
      try {
        const p = JSON.parse(ls.getItem(key));
        out.push({ slot: key.slice(SAVE_KEY_PREFIX.length), label: p.label || '', savedAt: p.savedAt || 0 });
      } catch (e) { /* corrupt slot: skip */ }
    }
  } catch (e) { /* storage unavailable */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSave(slot) {
  try { const ls = storage(); if (ls) ls.removeItem(SAVE_KEY_PREFIX + slot); } catch (e) { /* ignore */ }
}

export function exportSave(state) {
  return JSON.stringify(buildPayload(state));
}

export function importSave(state, str) {
  try {
    const payload = JSON.parse(str);
    // accept both a wrapped payload and a bare state dump
    return applyPayload(state, payload && payload.state ? payload : { version: SAVE_VERSION, state: payload });
  } catch (e) {
    console.warn('[save] import failed', e);
    return false;
  }
}

export function newGame(state) {
  const fresh = createInitialState();
  replaceState(state, fresh);
  seedStarterClinic(state);
  refreshPool(state);
  rollWeather(state);
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  bus.emit('state:loaded', {});
  return state;
}

// ---- autosave ----
let unsub = [];
export function initSave() {
  unsub.forEach(f => f());
  unsub = [
    // month:start fires after month:end settlement and the calendar rollover, so the save is fully consistent
    bus.on('month:start', () => { if (!(singleton.flags && singleton.flags.gameOver)) saveGame(singleton, 'auto'); }),
    bus.on('game:over', () => deleteSave('auto')),
  ];
}
initSave();   // main.js never calls this explicitly; importing save.js is enough
