// Patient simulation: arrivals, registration, waiting, treatment steps, upsell, chat, slip, leaving.
// One state machine per patient (stage: arriving -> to_reception -> registering -> waiting -> to_station ->
// treating -> waiting ... -> leaving). Resources (reception / stations / staff) are reserved by the
// patient when a step is assigned and released when it finishes, is abandoned or the object disappears.
//
// Extra (JSON-safe) fields this module keeps on a patient, beyond ARCHITECTURE §3.2:
//   stand/dest {x,y} tiles, remaining/total (minutes of the current treatment), dir 0..3, moving, hold, chat,
//   patienceMax, course/visit/cureScale (multi-visit cure), selfPaySteps, waitStart, age, stun, reason, flags.*
// Extra module state lives in state.agents (see getMeta).
import { bus } from '../core/bus.js';
import { newId, state as gameState } from '../core/state.js';
import { OPEN_MIN, CLOSE_MIN, WALK_TILES_PER_MIN, POINT_KEYS } from '../core/constants.js';
import { entryTile, adjacentTiles, footprint, inLot } from '../core/grid.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { STAFF_NAMES } from '../data/staffdefs.js';
import { LINES } from '../data/texts.js';
import { LOTS } from '../data/lots.js';
import { findPath, findPathToAdjacent, findPathNear, moveAlongPath, pathStillValid, agentTileOk } from './pathfinding.js';
import { comfortScoreAt, anxietyReliefAt, floorGripAt, floorWalkMultAt } from './modifiers.js';
import { isTreatmentUnlocked } from './research.js';
import { selfPayPrice, resolveCured } from './economy.js';
import { isStaffAvailable, assignTask, releaseStaff, staffAtStand, TUNE as STAFF_TUNE } from './staff.js';

// ================= tuning knobs =================
export const TUNE = {
  MAX_PATIENTS: 60,
  BASE_ARRIVALS: 12,         // §2: arrivalsPerWeek = (BASE + rep * REP_FACTOR) * mods.spawnMult * ...
  REP_FACTOR: 0.12,
  RETURN_DISCOUNT: 0.3,      // new arrivals shrink by this share of the (capped) returning load
  RETURN_PROB: 0.88,         // chance a satisfied, not-yet-cured patient books another visit
  STOP_SPAWN_BEFORE_CLOSE: 100,
  REG_MIN: 4,                // registration duration (game-min)
  REG_SELF_MULT: 2.5,        // self-registration (no nurse) is this much slower
  REG_FALLBACK_WAIT: 22,     // minutes queuing for a busy nurse before self-registering
  SAT_START: 62,
  DRAIN_BASE: 0.42,          // patience / min while waiting
  SEAT_DRAIN: 0.65,          // drain multiplier while seated
  STAND_DRAIN: 1.25,         // ... while standing (elders: x1.3 more)
  SAT_PER_PATIENCE: 0.25,    // satisfaction lost per patience point lost
  COMFORT_SAT: 0.06,         // satisfaction / min at max comfort
  SAT_PER_TREATMENT: 3,
  SKIP_STEP_PENALTY: 4,
  SLIP_BASE: 0.0022,         // slip chance per tile on grip 0 (scaled by (1-grip), slipProne, mods.slipRisk)
  SLIP_SAT: 25, SLIP_STUN: 8,
  CHAT_RATE: 0.012,          // per min * type.chatty
  CHAT_MIN: 6, CHAT_SAT: 5, CHAT_CD: 150,
  DILEMMA_CD: 5400,          // game-min between dilemma requests (7.5 game weeks)
  DILEMMA_CD_START: 900,
  PAINKILLER_P: 0.05, OVERTREAT_P: 0.035, COMPLAIN_P: 0.5,
  MAX_AGE: 600,
  PRE_SLACK: 6,              // a patient may walk towards a station whose user finishes within (walk time + this)
  FOLLOWUP_SKIP_EXAM: 0.7,   // chance a returning patient does not need a new doctor exam
  STAFF_LEAD: 3,             // staff leave for a station when the patient is this many minutes from arriving
  STEP_OVERHEAD: 28,         // walking + waiting allowance per step when trimming late arrivals' plans
  REORDER_WAIT: 8,           // after waiting this long for step 1, a patient may start a later self-service step first
  STAFF_WAIT: 30,            // arrived at a staffed station and nobody came for this long -> give the station back
  STUCK_MIN: 40,             // standing still this long while waiting for a partner -> snap both onto their stand tiles              // watchdog: a patient never stays longer than this
  UPSELL_SECOND: 0.35,
  REP_CURED_K: 0.2,         // reputation per cured patient = reputationGain * K * sat/100
  REP_SAT_K: 0.45,           // reputation per satisfied visit = (sat-60)/60 * K
  REP_NEUTRAL: 55,           // satisfaction at which a visit changes reputation by 0
  REP_ANGRY: 0.35,
  WAIT_BUBBLE: 0.006,
};

export const debug = { teleports: 0, repaths: 0, forcedSnaps: 0, skipped: 0, selfReg: 0, chats: 0, upsells: 0, upsellOffers: 0 };

const rnd = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const key = (x, y) => x + ',' + y;
const tk = (t) => t.x + ',' + t.y;
const atTile = (a, t) => Math.floor(a.x) === t.x && Math.floor(a.y) === t.y;

function weekIdx(state) {
  const t = state.time;
  return ((t.year - 1) * 12 + (t.month - 1)) * 4 + (t.week - 1);
}

function getMeta(state) {
  if (!state.agents) state.agents = {};
  const m = state.agents;
  if (!Array.isArray(m.returning)) m.returning = [];
  if (typeof m.spawned !== 'number') m.spawned = 0;
  if (typeof m.dilemmaCd !== 'number') m.dilemmaCd = TUNE.DILEMMA_CD_START;
  if (typeof m.retLoad !== 'number') m.retLoad = 0;
  return m;
}

function lotDefOf(state) { return LOTS[state.lotLevel || 0] || LOTS[0]; }

// ================= speech =================
export function say(p, key, force) {
  const set = LINES[p.type];
  const arr = set && set[key];
  if (!arr || !arr.length) return;
  if (!force && (p.bubble || p.bubbleCd > 0)) return;
  p.bubble = { text: pick(arr), ttl: 36 };
  p.bubbleCd = 40 + rnd() * 50;
}

// ================= per-tick context =================
let lastOcc = null;
let reservedCache = { occ: null, n: -1, set: null };

function buildCtx(state, dt) {
  const c = {
    state, dt,
    objById: new Map(), patById: new Map(), staffById: new Map(),
    byDef: {}, standTaken: new Set(), spotTaken: new Set(), seatTaken: new Set(),
    feasMemo: new Map(), seats: null, staff: state.staff, preBy: new Map(),
  };
  for (const o of state.objects) {
    c.objById.set(o.id, o);
    (c.byDef[o.defId] || (c.byDef[o.defId] = [])).push(o);
  }
  for (const s of state.staff) c.staffById.set(s.id, s);
  for (const p of state.patients) {
    c.patById.set(p.id, p);
    if (p.pre && p.targetObj) c.preBy.set(p.targetObj, p.id);
    if (p.stand && (p.stage === 'to_station' || p.stage === 'treating' || p.stage === 'registering' || (p.stage === 'to_reception' && p.targetObj))) c.standTaken.add(tk(p.stand));
    if (p.spot && !p.seat) c.spotTaken.add(tk(p.spot));
    if (p.seat) c.seatTaken.add(p.seat.x + ',' + p.seat.y + '#' + (p.seat.slot || 0));
  }
  for (const s of state.staff) if (s.task && s.stand && s.task.treatmentId !== '__chat') c.standTaken.add(tk(s.stand));
  return c;
}

// is a treatment doable right now (unlocked, a station exists, a qualified staff exists)?
function feasible(c, tid) {
  let v = c.feasMemo.get(tid);
  if (v !== undefined) return v;
  const T = TREATMENTS[tid];
  v = !!T;
  if (v && T.requires && !isTreatmentUnlocked(c.state, tid)) v = false;
  if (v) v = T.objects.some(d => c.byDef[d] && c.byDef[d].length > 0);
  if (v && T.staffRole) v = c.state.staff.some(s => T.staffRole.includes(s.role));
  c.feasMemo.set(tid, v);
  return v;
}

// ================= seats / spots =================
function seatList(c) {
  if (c.seats) return c.seats;
  const out = [];
  for (const o of c.state.objects) {
    const def = BUILDABLES[o.defId];
    if (!def || !(def.seats > 0)) continue;
    const cells = footprint(o);
    const per = Math.max(1, Math.ceil(def.seats / cells.length));
    const nCells = Math.min(cells.length, Math.ceil(def.seats / per));
    for (let i = 0; i < nCells; i++) for (let s = 0; s < per; s++) out.push({ objId: o.id, x: cells[i].x, y: cells[i].y, slot: s });
  }
  c.seats = out;
  return out;
}

function reservedTiles(c) {
  const st = c.state;
  const occ = st.map.occ;
  if (reservedCache.occ === occ && reservedCache.n === st.objects.length && reservedCache.set) return reservedCache.set;
  const set = new Set();
  const stationDefs = new Set(['reception', 'rest_room']);
  for (const T of Object.values(TREATMENTS)) for (const d of T.objects) stationDefs.add(d);
  for (const o of st.objects) {
    if (!stationDefs.has(o.defId)) continue;
    for (const t of adjacentTiles(st, o)) set.add(tk(t));
  }
  const e = entryTile(st);
  set.add(key(e.x, e.y));
  reservedCache = { occ, n: st.objects.length, set };
  return set;
}

// Choose a standing tile for a waiting / queuing patient, near `near` ({x,y} object centre) and not reserved.
function pickSpot(c, p, near) {
  const st = c.state, L = st.lot;
  const res = reservedTiles(c);
  const cands = [];
  for (let strict = 1; strict >= 0 && cands.length < 3; strict--) {
    cands.length = 0;
    for (let y = L.y0; y < L.y0 + L.h; y++) {
      for (let x = L.x0; x < L.x0 + L.w; x++) {
        const k = key(x, y);
        if (c.spotTaken.has(k) || c.standTaken.has(k)) continue;
        if (strict && res.has(k)) continue;
        if (!agentTileOk(st, x, y)) continue;
        cands.push({ x, y, s: Math.abs(x - near.x) + Math.abs(y - near.y) + rnd() * 2.5 });
      }
    }
  }
  cands.sort((a, b) => a.s - b.s);
  return cands.slice(0, 4);
}

function centerOf(c, o) {
  const f = footprint(o);
  let sx = 0, sy = 0;
  for (const t of f) { sx += t.x; sy += t.y; }
  return { x: Math.round(sx / f.length), y: Math.round(sy / f.length) };
}

function receptionCenter(c) {
  const r = c.byDef.reception && c.byDef.reception[0];
  if (r) return centerOf(c, r);
  const e = entryTile(c.state);
  return { x: e.x, y: e.y - 2 };
}

// ================= routing helpers =================
function teleportTo(a, tx, ty) { a.x = tx + 0.5; a.y = ty + 0.5; a.path = []; debug.teleports++; }

function routeToTile(c, a, tx, ty) {
  a.dest = { x: tx, y: ty };
  const path = findPath(c.state, a.x, a.y, tx, ty);
  if (path) { a.path = path; return true; }
  teleportTo(a, tx, ty);
  return false;
}

function routeToSeat(c, p, seat) {
  p.dest = { x: seat.x, y: seat.y };
  const r = findPathNear(c.state, p.x, p.y, seat.x, seat.y);
  if (r) { p.path = r.path.concat([{ x: seat.x, y: seat.y }]); return true; }
  teleportTo(p, seat.x, seat.y);
  return false;
}

function patientSpeed(c, p) {
  const P = PATIENT_TYPES[p.type];
  let m = (P.speed || 1) * (c.state.mods.walkSpeed || 1);
  if (P.needsRamp) {
    const w = floorWalkMultAt(c.state, p.x, p.y);
    m *= w > 1 ? w : 0.8;
  }
  return WALK_TILES_PER_MIN * STAFF_TUNE.WALK_BOOST * m;
}

function slipCheck(c, p, tx, ty) {
  if (p.flags.slipped) return false;
  const P = PATIENT_TYPES[p.type];
  const grip = floorGripAt(c.state, tx, ty);
  const risk = TUNE.SLIP_BASE * (1 - grip) * (P.slipProne || 1) * (c.state.mods.slipRisk || 1);
  if (rnd() >= risk) return false;
  p.flags.slipped = true;
  p.stun = TUNE.SLIP_STUN;
  p.satisfaction -= TUNE.SLIP_SAT;
  p.patience = Math.max(0, p.patience - 10);
  say(p, 'slip', true);
  bus.emit('patient:slip', { patient: p });
  return true;
}

// walk along the path, re-routing if the path got lost. Returns true when the patient stands on its destination.
function walk(c, p, dt) {
  if (p.path.length === 0 && p.dest && !atTile(p, p.dest)) {
    debug.repaths++;
    if (p.seat && p.dest.x === p.seat.x && p.dest.y === p.seat.y) routeToSeat(c, p, p.seat);
    else routeToTile(c, p, p.dest.x, p.dest.y);
  }
  if (p.path.length) moveAlongPath(p, dt, patientSpeed(c, p), (tx, ty) => slipCheck(c, p, tx, ty));
  else p.moving = false;
  return p.path.length === 0 && (!p.dest || atTile(p, p.dest));
}

// ================= patient creation =================
function planFrac(c, plan) {
  let ok = 0;
  for (const s of plan.steps) if (feasible(c, s)) ok++;
  return plan.steps.length ? ok / plan.steps.length : 1;
}

function availability(c, P) {
  let best = 0;
  for (const pl of P.plans) best = Math.max(best, planFrac(c, pl));
  return Math.max(0.1, best * best);
}

function randName() {
  return pick(STAFF_NAMES.surnames) + pick(STAFF_NAMES.given);
}

function samplePlan(c, P) {
  let tot = 0;
  const ws = P.plans.map(pl => { const w = (pl.w || 1) * (0.15 + Math.pow(planFrac(c, pl), 2)); tot += w; return w; });
  let x = rnd() * tot;
  for (let i = 0; i < P.plans.length; i++) { x -= ws[i]; if (x <= 0) return P.plans[i]; }
  return P.plans[0];
}

export function spawnPatient(state, typeId, ret) {
  const P = PATIENT_TYPES[typeId];
  if (!P) return null;
  const c = buildCtx(state, 0);
  const plan = samplePlan(c, P);
  const door = state.door;
  const sum = plan.steps.reduce((a, s) => a + ((TREATMENTS[s] && TREATMENTS[s].cure) || 0), 0) || 0.2;
  const [v0, v1] = P.visitsToCure || [2, 4];
  const course = ret ? ret.course : v0 + Math.floor(rnd() * (v1 - v0 + 1));
  const patience = P.patience * (0.85 + rnd() * 0.3);
  // late arrivals only book as many steps as fit before closing time
  let budget = CLOSE_MIN - state.time.clock - 25;
  const steps = [];
  const followUp = ret && ret.visit > 0;
  for (const sid of plan.steps) {
    if (followUp && sid === 'exam' && plan.steps.length > 1 && rnd() < TUNE.FOLLOWUP_SKIP_EXAM) continue;   // follow-up visits mostly skip the doctor
    const T = TREATMENTS[sid];
    const est = T ? T.duration / (T.kind === 'nhi' ? Math.max(0.2, state.mods.nhiTurnover || 1) : 1) + TUNE.STEP_OVERHEAD : 0;
    if (steps.length >= 1 && est > budget) break;
    steps.push(sid); budget -= est;
  }
  const p = {
    id: newId(state), type: typeId, name: ret ? ret.name : randName(),
    x: door.x + 0.5, y: door.y + 0.5, path: [], stage: 'arriving',
    plan: steps, planIdx: 0, upsold: false,
    patience, patienceMax: patience,
    satisfaction: TUNE.SAT_START + (typeId === 'elder' ? (state.mods.elderSat || 0) : 0) + (rnd() * 8 - 4),
    hp: ret ? ret.hp : 0, cured: false, bubble: null, bubbleCd: 0, targetObj: null, staffId: null,
    seat: null, enteredAt: state.time.clock, waitedMin: 0, paid: { nhi: 0, self: 0 },
    flags: { slipped: false, skipDoc: false },
    selfPaySteps: (plan.selfPaySteps || []).slice(),
    course, visit: ret ? ret.visit : 0,
    cureScale: clamp(P.cureNeeded / (course * sum), 0.05, 1.6),
    age: 0, stun: 0, hold: false, chat: null, chatCd: 20 + rnd() * 60, cmf: 0, rel: 0, cmfT: 0,
    waitStart: 0, spot: null, stand: null, dest: null, dir: 1, moving: false,
    treated: 0, noPath: {}, qT: 0, needSpot: false,
  };
  const e = entryTile(state);
  p.path = findPath(state, p.x, p.y, e.x, e.y) || [];
  p.dest = { x: e.x, y: e.y };
  state.patients.push(p);
  say(p, 'arrive', true);
  bus.emit('patient:spawn', { patient: p });
  return p;
}

// ================= arrivals =================
function windowsOf(P) { return P.spawn && P.spawn.length ? P.spawn : [{ from: OPEN_MIN, to: CLOSE_MIN, w: 1 }]; }

const densCache = new Map();
function densityOf(P, t) {
  let norm = densCache.get(P.id);
  if (norm === undefined) {
    norm = 0;
    for (const w of windowsOf(P)) {
      const a = Math.max(w.from, OPEN_MIN), b = Math.min(w.to, CLOSE_MIN - TUNE.STOP_SPAWN_BEFORE_CLOSE);
      if (b > a) norm += w.w * (b - a);
    }
    densCache.set(P.id, norm);
  }
  if (!(norm > 0)) return 0;
  let d = 0;
  for (const w of windowsOf(P)) if (t >= w.from && t < w.to && t < CLOSE_MIN - TUNE.STOP_SPAWN_BEFORE_CLOSE) d += w.w;
  return d / norm;
}

function sampleClock(P) {
  const END = CLOSE_MIN - TUNE.STOP_SPAWN_BEFORE_CLOSE;
  const ws = windowsOf(P).filter(w => Math.min(w.to, END) > Math.max(w.from, OPEN_MIN));
  if (!ws.length) return OPEN_MIN + rnd() * 600;
  let tot = 0;
  for (const w of ws) tot += w.w * (Math.min(w.to, END) - Math.max(w.from, OPEN_MIN));
  let x = rnd() * tot;
  for (const w of ws) {
    const a = Math.max(w.from, OPEN_MIN), b = Math.min(w.to, END);
    const m = w.w * (b - a);
    if (x <= m) return a + (x / w.w);
    x -= m;
  }
  return OPEN_MIN + 60;
}

function poisson(mu) {
  if (mu <= 0) return 0;
  const L = Math.exp(-mu);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L && k < 8);
  return k - 1;
}

export function expectedArrivalsPerWeek(state) {
  const mods = state.mods;
  return (TUNE.BASE_ARRIVALS + state.reputation * TUNE.REP_FACTOR) * (mods.spawnMult || 1);
}

function newDay(state, meta, wk) {
  meta.wk = wk;
  meta.spawned = 0;
  let load = 0;
  for (const r of meta.returning) {
    if (r.due <= wk) { r.at = sampleClock(PATIENT_TYPES[r.type] || PATIENT_TYPES.elder); load++; }
    else r.at = null;
  }
  meta.returning = meta.returning.filter(r => wk - r.due < 10);
  meta.retLoad = load;
}

function runArrivals(c, meta, dt) {
  const state = c.state;
  const clock = state.time.clock;
  if (clock < OPEN_MIN || clock >= CLOSE_MIN - TUNE.STOP_SPAWN_BEFORE_CLOSE) return;
  const cap = lotDefOf(state).maxPatientsPerWeek || 20;
  if (state.patients.length >= TUNE.MAX_PATIENTS) return;
  const wk = weekIdx(state);

  // returning patients first
  if (meta.returning.length) {
    for (let i = meta.returning.length - 1; i >= 0; i--) {
      const r = meta.returning[i];
      if (r.at == null || r.at > clock || r.due > wk) continue;
      if (meta.spawned >= cap || state.patients.length >= TUNE.MAX_PATIENTS) break;
      meta.returning.splice(i, 1);
      spawnPatient(state, r.type, r);
      meta.spawned++;
    }
  }
  if (meta.spawned >= cap) return;

  const lambda = expectedArrivalsPerWeek(state);
  const retShare = Math.min(1, meta.retLoad / Math.max(1, lambda));
  const discount = 1 - TUNE.RETURN_DISCOUNT * retShare;
  let rawSum = 0;
  for (const P of Object.values(PATIENT_TYPES)) rawSum += P.weight;
  const typeSpawn = state.mods.typeSpawn || {};
  for (const P of Object.values(PATIENT_TYPES)) {
    const ts = typeSpawn[P.id] == null ? 1 : typeSpawn[P.id];
    const share = (P.weight / rawSum) * ts * availability(c, P);
    const mu = lambda * discount * share * densityOf(P, clock) * dt;
    const n = poisson(mu);
    for (let i = 0; i < n; i++) {
      if (meta.spawned >= cap || state.patients.length >= TUNE.MAX_PATIENTS) return;
      spawnPatient(state, P.id);
      meta.spawned++;
    }
  }
}

// ================= resource release =================
// release a station; a patient who pre-reserved it (still walking over) takes it immediately
function freeObj(c, id) {
  const o = c.objById.get(id);
  if (!o) return;
  const nxt = c.state.patients.find(q => q.pre && q.targetObj === id);
  if (nxt) { nxt.pre = false; o.busy = true; o.usedBy = nxt.id; o.staffId = null; c.preBy.delete(id); }
  else { o.busy = false; o.usedBy = null; o.staffId = null; }
}

function dropAssignment(c, p) {
  const st = c.state;
  const staff = p.staffId && c.staffById.get(p.staffId);
  if (staff && staff.task && staff.task.patientId === p.id) releaseStaff(st, staff);
  if (p.targetObj) { if (p.pre) c.preBy.delete(p.targetObj); else freeObj(c, p.targetObj); }
  p.pre = false;
  p.targetObj = null; p.staffId = null; p.stand = null; p.path = []; p.dest = null;
  p.selfReg = false; p.needStaff = null;
  if (p.stage === 'to_station' || p.stage === 'treating') {
    p.stage = 'waiting'; p.needSpot = true; p.waitStart = p.age;
  } else if (p.stage === 'registering' || p.stage === 'to_reception') {
    p.stage = 'to_reception'; p.needSpot = true;
    if (!st.queue.includes(p.id)) st.queue.push(p.id);
  }
}

function releaseChat(c, p) {
  if (!p.chat) return;
  const s = c.staffById.get(p.chat.staffId);
  if (s && s.task && s.task.treatmentId === '__chat' && s.task.patientId === p.id) releaseStaff(c.state, s);
  p.chat = null;
}

// ================= reconcile (objects demolished, staff fired, stale flags) =================
function reconcile(c) {
  const st = c.state;
  for (const p of st.patients) {
    if (p.targetObj && !c.objById.has(p.targetObj)) {
      if (p.stage === 'registering' && p.selfReg) p.targetObj = null;
      else dropAssignment(c, p);
    }
    if ((p.stage === 'to_station' || p.stage === 'treating') && !p.targetObj) dropAssignment(c, p);
    if (p.staffId && !c.staffById.has(p.staffId)) {
      p.staffId = null;
      if (p.stage === 'to_station' || p.stage === 'treating' || (p.stage === 'registering' && !p.selfReg) || (p.stage === 'to_reception' && p.targetObj)) dropAssignment(c, p);
    }
    if (p.seat && !c.objById.has(p.seat.objId)) { p.seat = null; p.needSpot = true; p.path = []; p.dest = null; }
    if (p.chat && !c.staffById.has(p.chat.staffId)) { p.chat = null; p.needSpot = true; }
  }
  // object flags follow patient claims
  const claim = new Map();
  for (const p of st.patients) {
    if (p.targetObj && !p.pre && (p.stage === 'to_station' || p.stage === 'treating' || p.stage === 'registering' || p.stage === 'to_reception')) claim.set(p.targetObj, p.id);
  }
  // pre-reserved stations whose occupant vanished: promote the waiting patient
  for (const p of st.patients) {
    if (p.pre && p.targetObj && !claim.has(p.targetObj)) { p.pre = false; claim.set(p.targetObj, p.id); }
  }
  const restUsers = new Set();
  for (const s of st.staff) if (s.restObj) restUsers.add(s.restObj);
  for (const o of st.objects) {
    if (claim.has(o.id)) { o.busy = true; o.usedBy = claim.get(o.id); }
    else if (restUsers.has(o.id)) { o.busy = true; o.usedBy = null; }
    else if (o.busy || o.usedBy || o.staffId) { o.busy = false; o.usedBy = null; o.staffId = null; }
  }
  // staff jobs must match a live patient claim
  for (const s of st.staff) {
    if (!s.task || s.task.treatmentId === '__chat') continue;
    const p = c.patById.get(s.task.patientId);
    if (!p || p.staffId !== s.id) releaseStaff(st, s);
  }
}

// occupancy changed: re-validate every path and stand tile
function onMapChanged(c) {
  const st = c.state;
  for (const p of st.patients) {
    if (p.stand && (p.stage === 'to_station' || p.stage === 'treating' || p.stage === 'registering' || (p.stage === 'to_reception' && p.targetObj)) && !agentTileOk(st, p.stand.x, p.stand.y)) {
      dropAssignment(c, p);
      continue;
    }
    if (!p.path.length) continue;
    const lastOpen = !!p.seat && p.dest && p.dest.x === p.seat.x && p.dest.y === p.seat.y;
    if (!pathStillValid(st, p.path, lastOpen)) {
      debug.repaths++;
      if (lastOpen) routeToSeat(c, p, p.seat);
      else if (p.dest) routeToTile(c, p, p.dest.x, p.dest.y);
      else p.path = [];
    }
  }
  for (const s of st.staff) {
    if (s.task && s.stand && s.task.treatmentId !== '__chat' && !agentTileOk(st, s.stand.x, s.stand.y)) {
      const p = c.patById.get(s.task.patientId);
      if (p) dropAssignment(c, p); else releaseStaff(st, s);
      continue;
    }
    if (!s.path.length) continue;
    if (!pathStillValid(st, s.path, false)) {
      const end = s.path[s.path.length - 1];
      const np = findPath(st, s.x, s.y, end.x, end.y);
      if (np) s.path = np; else { s.path = []; }
    }
  }
}

// ================= stand picking for a station / reception =================
function pickStands(c, p, obj, staff) {
  const st = c.state;
  const pr = findPathToAdjacent(st, p.x, p.y, obj, c.standTaken);
  if (!pr) return null;
  let sr = null;
  if (staff) {
    const claimed = new Set(c.standTaken);
    claimed.add(tk(pr.stand));
    sr = findPathToAdjacent(st, staff.x, staff.y, obj, claimed) || findPathToAdjacent(st, staff.x, staff.y, obj);
    if (!sr) return null;
  }
  return { pStand: pr.stand, pPath: pr.path, sStand: sr && sr.stand, sPath: sr && sr.path };
}

function pickStaff(c, roles, o, forExam) {
  let best = null, bs = Infinity;
  for (const s of c.staff) {
    if (!roles.includes(s.role) || !isStaffAvailable(s)) continue;
    const d = Math.abs(Math.floor(s.x) - o.x) + Math.abs(Math.floor(s.y) - o.y);
    let sc = d + (1 - s.stamina / s.staminaMax) * 8 + (s.role === 'doctor' && !forExam ? 6 : 0) + (s.task ? 2 : 0);
    if (s.stamina < s.staminaMax * 0.08) sc += 10;
    if (sc < bs) { bs = sc; best = s; }
  }
  return best;
}

function cancelStaffChat(c, s) {
  if (!s.task || s.task.treatmentId !== '__chat') return;
  const cp = c.patById.get(s.task.patientId);
  if (cp && cp.chat) { cp.chat = null; cp.needSpot = true; cp.path = []; cp.dest = null; }
}

// ================= registration =================
function enterReception(c, p) {
  const st = c.state;
  if (!(c.byDef.reception && c.byDef.reception.length)) {
    // no reception counter at all: register on the spot (slow) so nobody gets stuck
    p.stage = 'registering'; p.selfReg = true; p.targetObj = null;
    p.remaining = p.total = TUNE.REG_MIN * TUNE.REG_SELF_MULT; debug.selfReg++;
    say(p, 'angry');
    return;
  }
  p.stage = 'to_reception';
  p.targetObj = null; p.qT = 0; p.needSpot = true; p.path = []; p.dest = null;
  if (!st.queue.includes(p.id)) st.queue.push(p.id);
}

function assignRegistration(c) {
  const st = c.state;
  if (!st.queue.length) return;
  // sanitize
  st.queue = st.queue.filter(id => { const p = c.patById.get(id); return p && p.stage === 'to_reception'; });
  const recs = (c.byDef.reception || []).filter(o => !o.busy && !o.usedBy);
  if (!recs.length) return;
  const anyNurse = st.staff.some(s => s.role === 'nurse');
  for (const id of st.queue) {
    const p = c.patById.get(id);
    if (!p || p.targetObj || recs.length === 0) continue;
    if (p.stun > 0) continue;
    // nearest free reception
    let ri = 0, bd = Infinity;
    recs.forEach((o, i) => { const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y); if (d < bd) { bd = d; ri = i; } });
    const rec = recs[ri];
    let nurse = pickStaff(c, ['nurse'], rec, true);
    let selfReg = false;
    if (!nurse) {
      if (!anyNurse || p.qT > TUNE.REG_FALLBACK_WAIT) selfReg = true; else continue;
    }
    const res = pickStands(c, p, rec, nurse);
    if (!res) continue;
    recs.splice(ri, 1);
    rec.busy = true; rec.usedBy = p.id; rec.staffId = nurse ? nurse.id : null;
    p.targetObj = rec.id; p.staffId = nurse ? nurse.id : null; p.selfReg = selfReg;
    p.stand = res.pStand; p.path = res.pPath; p.dest = res.pStand; p.spot = null; p.stT = 0;
    c.standTaken.add(tk(res.pStand));
    if (nurse) {
      cancelStaffChat(c, nurse);
      assignTask(st, nurse, { patientId: p.id, objId: rec.id, treatmentId: '__register', remaining: TUNE.REG_MIN, stand: res.sStand }, res.sStand, res.sPath);
      c.standTaken.add(tk(res.sStand));
    } else debug.selfReg++;
  }
}

function finishRegistration(c, p) {
  const st = c.state;
  const staff = p.staffId && c.staffById.get(p.staffId);
  if (staff) { releaseStaff(st, staff); staff.state = 'idle'; }
  if (p.targetObj) freeObj(c, p.targetObj);
  p.targetObj = null; p.staffId = null; p.stand = null; p.selfReg = false; p.dest = null; p.path = [];
  p.stage = 'waiting'; p.needSpot = true; p.waitStart = p.age; p.remaining = 0;
  st.queue = st.queue.filter(id => id !== p.id);
  p.satisfaction += 1;
  const P = PATIENT_TYPES[p.type];
  // skip-the-doctor request
  if (!p.flags.askedSkip && p.plan.slice(p.planIdx).includes('exam') && rnd() < (P.needsDoctorSkip || 0) * 0.5) {
    p.flags.askedSkip = true;
    requestDilemma(c, p, 'skip_doctor');
  }
}

// ================= dilemmas =================
function requestDilemma(c, p, trigger) {
  const st = c.state, meta = getMeta(st);
  if (meta.dilemmaCd > 0) return false;
  if (!st.events) st.events = { active: [], log: [], pendingDilemma: null, cooldowns: {} };
  if (st.events.pendingDilemma) return false;
  meta.dilemmaCd = TUNE.DILEMMA_CD;
  bus.emit('dilemma:request', { patientId: p.id, trigger });
  if (st.events.pendingDilemma) { p.hold = true; p.holdT = 0; p.flags.dilemma = trigger; }
  return true;
}

// The player let a patient skip the doctor (second choice / one that costs NHI points): drop the exam step.
bus.on('dilemma:resolved', (e) => {
  if (!e || e.trigger !== 'skip_doctor') return;
  const p = gameState.patients.find(x => x.id === e.patientId);
  if (!p) return;
  const fx = e.effects || {};
  if (e.choice === 1 || fx.nhiPenalty > 0) { p.flags.skipDoc = true; p.satisfaction += 2; }
});

// ================= treatment =================
function treatDuration(c, p, T, staff) {
  let d = T.duration;
  if (T.kind === 'nhi') d /= Math.max(0.2, c.state.mods.nhiTurnover || 1);
  if (staff) {
    d *= 1.1 - 0.02 * staff.skill;
    if (staff.stamina < staff.staminaMax * STAFF_TUNE.TIRED_FRAC) d *= 1.2;
  }
  return Math.max(5, d);
}

function startTreating(c, p, staff) {
  const T = TREATMENTS[p.plan[p.planIdx]];
  p.stage = 'treating';
  p.total = p.remaining = treatDuration(c, p, T, staff);
  p.path = []; p.moving = false;
  if (staff) { staff.state = 'working'; staff.task.remaining = p.remaining; staff.task.total = p.total; staff.path = []; }
  say(p, 'treat');
}

function maybeUpsell(c, p, staff) {
  if (p.upsold) return;
  p.upsold = true;
  const st = c.state, P = PATIENT_TYPES[p.type];
  const opts = (p.selfPaySteps || []).filter(id => TREATMENTS[id] && TREATMENTS[id].kind === 'self' && !p.plan.includes(id) &&
    isTreatmentUnlocked(st, id) && feasible(c, id));
  if (!opts.length) return;
  const charm = staff ? staff.charm : 5;
  let chance = (P.selfPay || 0) + 0.04 * (charm - 5) + (st.mods.selfPayConv || 0);
  chance *= 0.5 + 0.8 * clamp(p.satisfaction, 0, 100) / 100;
  const picks = [];
  let pool = opts.slice();
  for (let n = 0; n < 2 && pool.length; n++) {
    const id = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const pm = (st.policy.priceMult && st.policy.priceMult[id]) || 1;
    const pf = clamp(1 - (pm - 1) * 0.8, 0.12, 1.4);
    debug.upsellOffers++;
    if (rnd() < clamp(chance * pf * (n === 0 ? 1 : TUNE.UPSELL_SECOND), 0, 0.95)) picks.push(id);
    else break;
  }
  if (picks.length) {
    p.plan.splice(p.planIdx, 0, ...picks);
    debug.upsells += picks.length;
    say(p, 'pay', true);
  }
}

function completeTreatment(c, p) {
  const st = c.state;
  const T = TREATMENTS[p.plan[p.planIdx]];
  const P = PATIENT_TYPES[p.type];
  const staff = p.staffId && c.staffById.get(p.staffId);
  const self = T.kind === 'self';
  const price = self ? selfPayPrice(st, T.id) : 0;
  const nhiPts = self ? 0 : T.nhiPoints;
  const skill = staff ? staff.skill : 5;
  const skillF = 0.7 + 0.06 * skill;
  const gain = st.mods.researchGain || 1;
  for (const k of POINT_KEYS) {
    st.points[k] += ((T.points && T.points[k]) || 0) * ((P.pointBias && P.pointBias[k]) || 1) * (staff ? skillF : 1) * gain;
  }
  p.hp += T.cure * p.cureScale * (staff ? 0.8 + 0.04 * skill : 1);
  p.paid.nhi += nhiPts; p.paid.self += price;
  p.treated++;
  p.satisfaction += TUNE.SAT_PER_TREATMENT + (staff ? (skill - 5) * 0.4 : 0);
  if (self) {
    const pm = (st.policy.priceMult && st.policy.priceMult[T.id]) || 1;
    if (pm > 1.15) p.satisfaction -= (pm - 1) * 6;
    say(p, 'pay', true);
  } else say(p, 'treat');
  p.patience = Math.min(p.patienceMax, p.patience + 8);
  const sid = staff ? staff.id : null;
  const obj = c.objById.get(p.targetObj);
  if (obj) obj.wear = (obj.wear || 0) + 1;
  if (staff) { releaseStaff(st, staff); staff.state = 'idle'; }
  if (p.targetObj) freeObj(c, p.targetObj);
  p.targetObj = null; p.staffId = null; p.stand = null; p.dest = null; p.path = []; p.remaining = 0; p.needStaff = null;
  p.planIdx++;
  bus.emit('treatment:done', { patient: p, treatmentId: T.id, nhiPoints: nhiPts, selfPay: price, staffId: sid });

  if (T.id === 'exam' || p.planIdx === 1) maybeUpsell(c, p, staff);
  if (T.id === 'exam' && !p.flags.askedPain && rnd() < TUNE.PAINKILLER_P * (p.type === 'elder' ? 1.5 : 1)) {
    p.flags.askedPain = true;
    requestDilemma(c, p, 'painkiller');
  } else if (!p.flags.askedOver && rnd() < TUNE.OVERTREAT_P * (self ? 1.5 : 0.7)) {
    p.flags.askedOver = true;
    requestDilemma(c, p, 'overtreat');
  }
  if (p.planIdx >= p.plan.length) startLeaving(c, p, 'done');
  else { p.stage = 'waiting'; p.needSpot = true; p.waitStart = p.age; }
}

// make sure the current step is doable; skip it (with a complaint) otherwise. Returns false when the plan is over.
function prepareStep(c, p) {
  while (p.planIdx < p.plan.length) {
    const tid = p.plan[p.planIdx];
    if (tid === 'exam' && p.flags.skipDoc) { p.planIdx++; continue; }
    if (feasible(c, tid)) return true;
    p.planIdx++;
    p.satisfaction -= TUNE.SKIP_STEP_PENALTY;
    debug.skipped++;
    say(p, 'angry', true);
  }
  return false;
}

// ================= waiting =================
function tickWait(c, p, dt) {
  const st = c.state, mods = st.mods;
  p.waitedMin += dt;
  p.qT += dt;
  p.cmfT -= dt;
  if (p.cmfT <= 0) {
    p.cmfT = 3;
    p.cmf = comfortScoreAt(st, p.x, p.y);
    p.rel = anxietyReliefAt(st, p.x, p.y);
  }
  const cm = clamp(p.cmf / 12, 0, 1), rl = clamp(p.rel / 12, 0, 1);
  const seated = !!p.seat && p.path.length === 0 && atTile(p, p.seat);
  const rate = TUNE.DRAIN_BASE / Math.max(0.2, mods.patience || 1) * (1 - 0.4 * cm - 0.3 * rl) * (seated ? TUNE.SEAT_DRAIN : TUNE.STAND_DRAIN * (PATIENT_TYPES[p.type].needsRamp ? 1.3 : 1));
  const dp = rate * dt;
  p.patience -= dp;
  p.satisfaction += cm * TUNE.COMFORT_SAT * dt - dp * TUNE.SAT_PER_PATIENCE;
  if (!p.bubble && rnd() < TUNE.WAIT_BUBBLE * dt) say(p, 'wait');
  if (!p.flags.complained && p.patience < p.patienceMax * 0.35) {
    p.flags.complained = true;
    if (rnd() < TUNE.COMPLAIN_P) requestDilemma(c, p, 'complain');
  }
  if (p.patience <= 0) startLeaving(c, p, 'angry');
}

function assignSpots(c) {
  const st = c.state;
  const need = st.patients.filter(p => p.needSpot && !p.chat && p.stun <= 0 && (p.stage === 'waiting' || (p.stage === 'to_reception' && !p.targetObj)));
  if (!need.length) return;
  need.sort((a, b) => (a.waitStart || 0) - (b.waitStart || 0));
  const seats = seatList(c);
  const rc = receptionCenter(c);
  for (const p of need) {
    // 1. a free seat (waiting patients only)
    if (p.stage === 'waiting' && seats.length && !p.seat) {
      let best = null, bd = Infinity;
      for (const s of seats) {
        if (c.seatTaken.has(s.x + ',' + s.y + '#' + s.slot)) continue;
        const d = Math.abs(s.x - p.x) + Math.abs(s.y - p.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) {
        c.seatTaken.add(best.x + ',' + best.y + '#' + best.slot);
        if (p.spot) c.spotTaken.delete(tk(p.spot));
        p.spot = null; p.seat = { objId: best.objId, x: best.x, y: best.y, slot: best.slot };
        routeToSeat(c, p, p.seat);
        p.needSpot = false;
        continue;
      }
    }
    if (p.seat) { p.needSpot = false; continue; }
    // 2. already has a standing spot: keep it (keep polling for a free seat while waiting)
    if (p.spot) { p.needSpot = p.stage === 'waiting' && seats.length > 0; continue; }
    // 3. pick a standing spot
    const cands = pickSpot(c, p, rc);
    let done = false;
    for (const cd of cands) {
      const path = findPath(st, p.x, p.y, cd.x, cd.y);
      if (path) {
        p.spot = { x: cd.x, y: cd.y }; p.path = path; p.dest = p.spot;
        c.spotTaken.add(tk(p.spot)); done = true; break;
      }
    }
    if (!done && cands.length) {
      const cd = cands[0];
      p.spot = { x: cd.x, y: cd.y }; teleportTo(p, cd.x, cd.y); p.dest = p.spot; c.spotTaken.add(tk(p.spot));
      done = true;
    }
    p.needSpot = done && p.stage === 'waiting' && seats.length > 0;
  }
}

function assignStations(c) {
  const st = c.state;
  const waiters = [];
  for (const p of st.patients) {
    if (p.stage === 'waiting' && !p.hold && p.stun <= 0 && p.planIdx < p.plan.length) waiters.push(p);
  }
  if (!waiters.length) return;
  waiters.sort((a, b) => a.waitStart - b.waitStart);
  for (const p of waiters) {
    if (!prepareStep(c, p)) { startLeaving(c, p, 'done'); continue; }
    if (!tryAssignStation(c, p) && p.age - p.waitStart >= TUNE.REORDER_WAIT) {
      // the next step is blocked: hop to a later self-service step (heat, tens...) that is free right now
      for (let j = p.planIdx + 1; j < Math.min(p.plan.length, p.planIdx + 3); j++) {
        const T = TREATMENTS[p.plan[j]];
        if (!T || T.staffRole || p.plan[j] === 'exam' || !feasible(c, T.id)) continue;
        const save = p.plan[p.planIdx];
        p.plan[p.planIdx] = p.plan[j]; p.plan[j] = save;
        if (tryAssignStation(c, p)) break;
        p.plan[j] = p.plan[p.planIdx]; p.plan[p.planIdx] = save;
      }
    }
  }
}

function etaMin(path, speed) { return path.length / Math.max(0.001, speed); }

// stand + path for a staff member at an object whose patient stand is already fixed
function pickStaffStand(c, staff, obj, patientStand) {
  const claimed = new Set(c.standTaken);
  if (patientStand) claimed.add(tk(patientStand));
  return findPathToAdjacent(c.state, staff.x, staff.y, obj, claimed) || findPathToAdjacent(c.state, staff.x, staff.y, obj);
}

function sendStaff(c, p, obj, T, staff, sr) {
  p.staffId = staff.id; p.needStaff = null;
  obj.staffId = staff.id;
  cancelStaffChat(c, staff);
  assignTask(c.state, staff, { patientId: p.id, objId: obj.id, treatmentId: T.id, remaining: T.duration, stand: sr.stand }, sr.stand, sr.path);
  c.standTaken.add(tk(sr.stand));
}

// patients reserve a station on assignment; the qualified staff member is dispatched so that both arrive together
function dispatchStaff(c, p) {
  const T = TREATMENTS[p.plan[p.planIdx]];
  const o = c.objById.get(p.targetObj);
  if (!T || !o) return;
  const staff = pickStaff(c, T.staffRole, o, T.id === 'exam' || T.id === 'us' || T.id === 'prp');
  if (!staff) return;
  const sr = pickStaffStand(c, staff, o, p.stand);
  if (!sr) return;
  const tP = etaMin(p.path, patientSpeed(c, p));
  const tS = etaMin(sr.path, WALK_TILES_PER_MIN * STAFF_TUNE.WALK_BOOST * STAFF_TUNE.STAFF_SPEED);
  if (tP <= tS + TUNE.STAFF_LEAD) sendStaff(c, p, o, T, staff, sr);
}

// how many qualified staff are free now or finish their job within `eta` minutes, minus patients already waiting for one
function staffSlots(c, roles, eta) {
  let n = 0;
  for (const s of c.staff) {
    if (!roles.includes(s.role) || s.restObj || s.state === 'resting') continue;
    if (isStaffAvailable(s) || (s.task && s.state === 'working' && s.task.remaining <= eta + TUNE.PRE_SLACK)) n++;
  }
  for (const q of c.state.patients) {
    if (q.stage === 'to_station' && q.needStaff && !q.staffId && q.needStaff.some(r => roles.includes(r))) n--;
  }
  return n;
}

function tryAssignStation(c, p) {
  const T = TREATMENTS[p.plan[p.planIdx]];
  const free = [], pre = [];
  for (const d of T.objects) {
    for (const o of c.byDef[d] || []) {
      if (p.noPath[o.id] && p.noPath[o.id] > p.age) continue;
      if (!o.busy && !o.usedBy) free.push(o);
      else if (!c.preBy.has(o.id)) {
        const occ = c.patById.get(o.usedBy);
        if (occ && occ.stage === 'treating' && !occ.pre) pre.push({ o, occ });
      }
    }
  }
  if (!free.length && !pre.length) return false;
  const dist = (o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
  free.sort((a, b) => dist(a) - dist(b));
  pre.sort((a, b) => a.occ.remaining - b.occ.remaining);
  const tryObj = (o, isPre, occ) => {
    const pr = findPathToAdjacent(c.state, p.x, p.y, o, c.standTaken);
    if (!pr) { p.noPath[o.id] = p.age + 12; return false; }
    const eta = etaMin(pr.path, patientSpeed(c, p));
    if (isPre && occ.remaining > eta + TUNE.PRE_SLACK) return false;
    if (T.staffRole && staffSlots(c, T.staffRole, eta + (isPre ? occ.remaining : 0)) <= 0) return false;
    if (!isPre) { o.busy = true; o.usedBy = p.id; o.staffId = null; }
    releaseChat(c, p);
    p.pre = isPre;
    if (isPre) c.preBy.set(o.id, p.id);
    p.targetObj = o.id; p.staffId = null; p.stage = 'to_station';
    p.seat = null; p.spot = null; p.needSpot = false;
    p.stand = pr.stand; p.path = pr.path; p.dest = pr.stand; p.stT = 0;
    p.needStaff = T.staffRole ? T.staffRole : null;
    c.standTaken.add(tk(pr.stand));
    if (p.needStaff && !isPre) dispatchStaff(c, p);
    return true;
  };
  for (const o of free) if (tryObj(o, false)) return true;
  for (const e of pre) if (tryObj(e.o, true, e.occ)) return true;
  return false;
}

// ================= chatting =================
const CHAT_ROLES = ['pt', 'ot', 'st'];

function assignChats(c, dt) {
  const st = c.state;
  for (const p of st.patients) {
    if (p.stage !== 'waiting' || p.chat || p.hold || p.stun > 0 || p.chatCd > 0 || p.path.length) continue;
    const P = PATIENT_TYPES[p.type];
    if (!(rnd() < (P.chatty || 0) * TUNE.CHAT_RATE * dt)) continue;
    let best = null, bd = Infinity;
    for (const s of c.staff) {
      if (!CHAT_ROLES.includes(s.role) || s.task || s.restObj || s.state !== 'idle' || s.path.length) continue;
      const d = Math.abs(s.x - p.x) + Math.abs(s.y - p.y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) continue;
    const r = findPathNear(st, p.x, p.y, best.x, best.y, c.standTaken);
    if (!r) { p.chatCd = 40; continue; }
    best.task = { patientId: p.id, objId: null, treatmentId: '__chat', remaining: TUNE.CHAT_MIN };
    best.state = 'chatting'; best.stand = null;
    if (p.seat) { c.seatTaken.delete(p.seat.x + ',' + p.seat.y + '#' + (p.seat.slot || 0)); p.seat = null; }
    if (p.spot) { c.spotTaken.delete(tk(p.spot)); p.spot = null; }
    p.chat = { staffId: best.id, phase: 'go', t: 0 };
    p.path = r.path; p.dest = r.stand;
    debug.chats++;
  }
}

function tickChat(c, p, dt) {
  const ch = p.chat;
  const s = c.staffById.get(ch.staffId);
  if (!s || !s.task || s.task.treatmentId !== '__chat' || s.task.patientId !== p.id) {
    p.chat = null; p.needSpot = true; p.chatCd = 60; return;
  }
  if (ch.phase === 'go') {
    if (walk(c, p, dt)) {
      ch.phase = 'talk'; ch.t = TUNE.CHAT_MIN * (0.8 + rnd() * 0.6);
      say(p, 'chat', true);
    }
    return;
  }
  p.moving = false;
  ch.t -= dt;
  s.task.remaining = ch.t;
  if (!s.bubble && rnd() < 0.05) s.bubble = { text: pick((LINES.staff && LINES.staff.chat) || ['…']), ttl: 30 };
  if (ch.t <= 0) {
    p.satisfaction += TUNE.CHAT_SAT + s.charm * 0.6;
    p.patience = Math.min(p.patienceMax, p.patience + 10);
    p.chat = null; p.chatCd = TUNE.CHAT_CD; p.needSpot = true;
    releaseStaff(c.state, s); s.state = 'idle';
  }
}

// ================= leaving =================
function startLeaving(c, p, reason) {
  if (p.stage === 'leaving') return;
  const st = c.state;
  releaseChat(c, p);
  if (p.targetObj || p.staffId) dropAssignment(c, p);
  st.queue = st.queue.filter(id => id !== p.id);   // (after the drop, which may re-queue)
  p.seat = null; p.spot = null; p.hold = false; p.needSpot = false; p.stand = null; p.chat = null;
  p.stage = 'leaving'; p.reason = reason;
  if (reason === 'done') {
    p.visit++;
    const P = PATIENT_TYPES[p.type];
    p.finished = p.hp >= P.cureNeeded || p.visit >= p.course;
    if (p.finished) p.cured = resolveCured(p, P);
    if (p.cured) p.satisfaction += 8;
  }
  if (reason === 'closed' && p.treated === 0) p.satisfaction -= 6;
  if (reason === 'closed' && p.treated > 0) p.finished = false;
  if (reason === 'angry') say(p, 'angry', true);
  else if (p.satisfaction >= 70) say(p, 'happy', true);
  const d = st.door;
  p.dest = { x: d.x, y: d.y };
  const path = findPath(st, p.x, p.y, d.x, d.y);
  if (path) p.path = path; else { p.path = []; teleportTo(p, d.x, d.y); }
}

function finalizeLeave(c, p) {
  const st = c.state, meta = getMeta(st), P = PATIENT_TYPES[p.type];
  const sat = clamp(p.satisfaction, 0, 100);
  p.satisfaction = sat;
  const s = st.stats;
  s.patientsToday++; s.patientsMonth++; s.patientsTotal++;
  s.satSum += sat; s.satN++;
  const angry = p.reason === 'angry' || sat < 35;
  if (angry) s.angry++;
  if (p.cured) s.cured++;
  // reputation
  let dr = 0;
  if (angry) dr = -(TUNE.REP_ANGRY + (50 - sat) / 100);
  else if (p.treated > 0) {
    dr = (sat - TUNE.REP_NEUTRAL) / 45 * TUNE.REP_SAT_K;
    if (p.cured && sat >= 55) dr += (P.reputationGain || 2) * TUNE.REP_CURED_K * sat / 100;
  }
  st.reputation = clamp(st.reputation + dr, 0, 1000);
  // multi-visit: come back later?
  if (!p.cured && !p.finished && p.treated > 0 && sat >= 50 && rnd() < TUNE.RETURN_PROB * (sat >= 70 ? 1 : 0.6)) {
    const wk = weekIdx(st);
    meta.returning.push({ type: p.type, name: p.name, hp: p.hp, visit: p.visit, course: p.course, due: wk + 1 + Math.floor(rnd() * 2), at: null });
  }
  p.gone = true;
  p.stage = 'gone';
  bus.emit('patient:left', { patient: p, satisfaction: sat, cured: p.cured, reason: p.reason || 'done' });
}

export function closeUp(state) {
  const c = buildCtx(state, 0);
  for (const p of state.patients) if (p.stage !== 'leaving') startLeaving(c, p, 'closed');
  state.queue = [];
  for (const s of state.staff) if (s.task) { releaseStaff(state, s); }
  for (const o of state.objects) {
    // rest rooms stay reserved by resting staff
    if (!state.staff.some(s => s.restObj === o.id)) { o.busy = false; o.usedBy = null; o.staffId = null; }
  }
}

// ================= main loop =================
function updatePatient(c, p, dt) {
  p.age += dt;
  if (p.bubble) { p.bubble.ttl -= dt; if (p.bubble.ttl <= 0) p.bubble = null; }
  if (p.bubbleCd > 0) p.bubbleCd -= dt;
  if (p.chatCd > 0) p.chatCd -= dt;
  if (p.stun > 0) { p.stun -= dt; p.moving = false; return; }
  if (p.age > TUNE.MAX_AGE && p.stage !== 'leaving') startLeaving(c, p, 'timeout');
  const st = c.state;

  switch (p.stage) {
    case 'arriving': {
      if (walk(c, p, dt)) enterReception(c, p);
      break;
    }
    case 'to_reception': {
      if (p.targetObj) {
        const staff = p.staffId && c.staffById.get(p.staffId);
        const arrived = walk(c, p, dt);
        p.stT = (p.moving || (staff && staff.moving)) ? 0 : (p.stT || 0) + dt;
        if (arrived && (!staff || staffAtStand(staff))) {
          p.stage = 'registering';
          const t = TUNE.REG_MIN * (p.selfReg ? TUNE.REG_SELF_MULT : (1.1 - 0.02 * (staff ? staff.skill : 5)));
          p.remaining = p.total = t;
          if (staff) { staff.state = 'working'; staff.task.remaining = t; staff.task.total = t; }
          st.queue = st.queue.filter(id => id !== p.id);
        } else if (p.stT > TUNE.STUCK_MIN) { forceSnap(c, p, staff); }
      } else {
        walk(c, p, dt);
        tickWait(c, p, dt);
      }
      break;
    }
    case 'registering': {
      p.moving = false;
      p.remaining -= dt;
      const staff = p.staffId && c.staffById.get(p.staffId);
      if (staff && staff.task) staff.task.remaining = p.remaining;
      if (p.remaining <= 0) finishRegistration(c, p);
      break;
    }
    case 'waiting': {
      if (p.hold) {
        p.holdT = (p.holdT || 0) + dt;
        const pd = st.events && st.events.pendingDilemma;
        if (!pd || p.holdT > 90) p.hold = false;
        p.moving = false;
        break;
      }
      if (p.chat) { tickChat(c, p, dt); break; }
      walk(c, p, dt);
      tickWait(c, p, dt);
      if (p.stage === 'waiting' && p.planIdx >= p.plan.length) startLeaving(c, p, 'done');
      break;
    }
    case 'to_station': {
      if (p.needStaff && !p.pre) dispatchStaff(c, p);
      const staff = p.staffId && c.staffById.get(p.staffId);
      const arrived = walk(c, p, dt);
      p.stT = (p.moving || p.pre || (staff && staff.moving)) ? 0 : (p.stT || 0) + dt;
      if (arrived && !p.pre && !p.needStaff && (!staff || staffAtStand(staff))) startTreating(c, p, staff);
      else if (arrived && p.needStaff && !p.pre && p.stT > TUNE.STAFF_WAIT) {
        // nobody turned up for this station: give it back and queue again
        const oid = p.targetObj, ws = p.waitStart;
        dropAssignment(c, p);
        p.waitStart = ws; p.noPath[oid] = p.age + 20;
      } else if (p.stT > TUNE.STUCK_MIN) forceSnap(c, p, staff);
      break;
    }
    case 'treating': {
      p.moving = false;
      p.remaining -= dt;
      const staff = p.staffId && c.staffById.get(p.staffId);
      if (staff && staff.task) staff.task.remaining = p.remaining;
      if (p.remaining <= 0) completeTreatment(c, p);
      break;
    }
    case 'leaving': {
      const arrived = walk(c, p, dt);
      if (arrived || (p.path.length === 0 && atTile(p, st.door))) finalizeLeave(c, p);
      break;
    }
    default: break;
  }
}

// last-resort anti-deadlock: put both parties on their stand tiles
function forceSnap(c, p, staff) {
  debug.forcedSnaps++;
  if (p.stand) teleportTo(p, p.stand.x, p.stand.y);
  if (staff && staff.stand) { staff.x = staff.stand.x + 0.5; staff.y = staff.stand.y + 0.5; staff.path = []; }
}

export function updatePatients(state, dtMin) {
  const meta = getMeta(state);
  const wk = weekIdx(state);
  if (meta.wk === undefined) meta.wk = wk;
  else if (meta.wk !== wk) {
    closeUp(state);               // idempotent safety net (main.js also calls it on week:end)
    newDay(state, meta, wk);
  }
  if (!meta.dayInit) { meta.dayInit = true; newDay(state, meta, wk); }
  if (!state.map.occ) lastOcc = null;

  const c = buildCtx(state, dtMin);
  if (state.map.occ && lastOcc !== state.map.occ) {
    if (lastOcc !== null) onMapChanged(c);
    lastOcc = state.map.occ;
  }
  reconcile(c);

  // dilemma cooldown only runs while nothing is pending
  if (!(state.events && state.events.pendingDilemma) && meta.dilemmaCd > 0) meta.dilemmaCd -= dtMin;

  runArrivals(c, meta, dtMin);

  const list = state.patients.slice();
  for (const p of list) {
    if (p.stage === 'gone') continue;
    updatePatient(c, p, dtMin);
  }

  // shared passes
  assignRegistration(c);
  assignStations(c);
  assignSpots(c);
  assignChats(c, dtMin);

  // remove those who left
  if (state.patients.some(p => p.gone)) {
    state.patients = state.patients.filter(p => !p.gone);
  }
}
