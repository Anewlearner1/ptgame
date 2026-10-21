// Weather, random events (RANDOM_EVENTS + EVENTS_EXT_A + EVENTS_EXT_B), community actions, health boards, focus / price
// setters and the dilemma pipeline. Spec for the extended engine: docs/EVENTS_EXT.md.
// A pending decision lives in state.events.pendingDilemma; the game is paused (state.time.paused = true)
// until resolveDilemma() is called.
//
// State added by this module (all created lazily, sanitised in save.js):
//   state.events.flags {name:true}          M10 flags          state.events.pendingFollowUps [{id,due}]  (due = absolute week)
//   state.events.buffs [{id,label,weeksLeft,mods}]  M5/M6 timed mod patches (recomputeMods applies them, expiry -> mods:dirty)
//   state.events.lastBigMonth                absolute month of the last `big` event (max one per month)
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { OPEN_MIN, WEEKS_PER_MONTH } from '../core/constants.js';
import * as EV from '../data/events.js';
import { EVENTS_EXT_A } from '../data/events_ext.js';
import { EVENTS_EXT_B } from '../data/events_ext2.js';
import { FOCUS } from '../data/patients.js';
import { TREATMENTS } from '../data/treatments.js';
import { STAFF_ROLES } from '../data/staffdefs.js';
import { spend, nhiCap, setBoardUpkeepResolver, riskOf, addRisk, reviewOf, addReview, RISK_TUNE } from './economy.js';
import { recomputeMods } from './modifiers.js';
import { absoluteWeek } from './calendar.js';
import { modChips, buffPatch, buffText, buffGood, sgn, signedNum } from './efftext.js';
import * as EQ from './equipment.js';
import * as ST from './staff.js';

// ---- tuning constants ----
export const WEATHER_STICKY = 0.35;          // chance the weather simply continues next week (if still valid for the month)
export const EVENT_CHANCE_PER_WEEK = 0.30;   // random event roll at each week:start
export const EVENT_GRACE_WEEKS = 6;          // no random events during the first weeks
export const EVENT_MIN_GAP_WEEKS = 1;        // min weeks between two random events
// live-tunable copy of the three pacing constants above (balance harnesses poke this)
// EARLY_WEEKS / EARLY_MULT: the first 4 months (still learning the layout) get half the event rate and no `big` events.
export const EVENT_TUNE = { CHANCE: EVENT_CHANCE_PER_WEEK, GRACE: EVENT_GRACE_WEEKS, MIN_GAP: EVENT_MIN_GAP_WEEKS, EARLY_WEEKS: 16, EARLY_MULT: 0.5, BIG_MIN_WEEK: 16 };
export const EVENT_REPEAT_COOLDOWN_WEEKS = 20;   // default cooldown of the legacy RANDOM_EVENTS
export const EVENT_EXT_COOLDOWN_WEEKS = 24;      // default cooldown of extended events (def.cooldownWeeks overrides)
export const EVENT_SEASON_MULT = 1.5;        // weight multiplier of cat 'season' events
export const EVENT_RISK_MULT = 2;            // weight multiplier of cat 'nhi' events while risk > RISK_TUNE.HIGH
export const EVENT_WEIGHT_DEFAULT = 6;       // def.weight default (season 10, big 3)
export const EVENT_WEIGHT_SEASON = 10;
export const EVENT_WEIGHT_BIG = 3;
export const BIG_PER_MONTH = 1;
export const RESIGN_EVENT_ID = 'pt_resign';
export const DILEMMA_ACCEPT_CHANCE = 0.85;   // chance a patient's dilemma:request becomes a modal
export const DILEMMA_TRIGGER_COOLDOWN_WEEKS = 4;
export const DILEMMA_GLOBAL_GAP_WEEKS = 3;
export const DILEMMA_REPEAT_COOLDOWN_WEEKS = 6;   // same dilemma id
export const SLIP_REP_PENALTY = 0.4;
export const SLIP_EVENT_CHANCE = 0.12;       // chance a slip escalates into the 'fall_lobby' event
export const PRICE_MULT_MIN = 0.5;
export const PRICE_MULT_MAX = 2.0;
export const EVENT_LOG_MAX = 60;

let unsub = [];

const rnd = () => Math.random();            // late-bound so test harnesses can seed Math.random
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function ev(state) {
  if (!state.events) state.events = { active: [], log: [], pendingDilemma: null, cooldowns: {} };
  const e = state.events;
  if (!e.active) e.active = [];
  if (!e.log) e.log = [];
  if (!e.cooldowns) e.cooldowns = {};
  if (!e.flags || typeof e.flags !== 'object') e.flags = {};
  if (!Array.isArray(e.pendingFollowUps)) e.pendingFollowUps = [];
  if (!Array.isArray(e.buffs)) e.buffs = [];
  if (e.pendingDilemma === undefined) e.pendingDilemma = null;
  return e;
}

export function initEvents() {
  unsub.forEach(f => f());
  setBoardUpkeepResolver((id) => { const b = (EV.BOARDS || []).find(x => x.id === id); return b ? b.upkeep || 0 : 0; });
  unsub = [
    bus.on('week:start', () => onWeekStart(singleton)),
    bus.on('dilemma:request', (p) => requestDilemma(singleton, p)),
    bus.on('patient:slip', (p) => onSlip(singleton, p)),
  ];
}

// ---------- the event pool ----------
function normalizeDef(def, legacy) {
  const big = !!def.big;
  const cat = def.cat || (legacy ? 'ops' : 'ops');
  const weight = typeof def.weight === 'number' ? def.weight : (cat === 'season' ? EVENT_WEIGHT_SEASON : big ? EVENT_WEIGHT_BIG : EVENT_WEIGHT_DEFAULT);
  const cooldownWeeks = typeof def.cooldownWeeks === 'number' ? def.cooldownWeeks : (legacy ? EVENT_REPEAT_COOLDOWN_WEEKS : EVENT_EXT_COOLDOWN_WEEKS);
  return { ...def, cat, big, weight, cooldownWeeks, cond: def.cond || {}, choices: def.choices || [] };
}
const POOL = [];
const POOL_BY_ID = new Map();
for (const [list, legacy] of [[EV.RANDOM_EVENTS || [], true], [EVENTS_EXT_A || [], false], [EVENTS_EXT_B || [], false]]) {
  for (const def of list) {
    if (!def || !def.id || POOL_BY_ID.has(def.id)) continue;
    const n = normalizeDef(def, legacy);
    POOL.push(n); POOL_BY_ID.set(n.id, n);
  }
}
export function eventPool() { return POOL; }
export function eventById(id) { return POOL_BY_ID.get(id) || null; }

// ---------- helpers ----------
function pickWeighted(list, wf = (x) => x.weight || 1) {
  let total = 0;
  for (const x of list) total += Math.max(0, wf(x));
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const x of list) {
    r -= Math.max(0, wf(x));
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

function logLine(state, text) {
  const e = ev(state);
  e.log.push({ y: state.time.year, m: state.time.month, w: state.time.week, text });
  if (e.log.length > EVENT_LOG_MAX) e.log.splice(0, e.log.length - EVENT_LOG_MAX);
}
function note(state, text, kind = 'info') {
  logLine(state, text);
  bus.emit('toast', { text, kind });
}

function refreshMods(state) {
  recomputeMods(state);
  bus.emit('mods:dirty', {});
}

const absMonth = (state) => Math.floor(absoluteWeek(state) / WEEKS_PER_MONTH);
const flagOn = (state, name) => !!ev(state).flags[name];

// ---------- weather ----------
export function weatherDefById(id) { return (EV.WEATHER || []).find(w => w.id === id) || null; }

export function rollWeather(state) {
  const list = (EV.WEATHER || []).filter(w => !w.months || w.months.includes(state.time.month));
  if (!list.length) return null;
  const prev = state.weather && state.weather.id ? list.find(w => w.id === state.weather.id) : null;
  let w;
  if (prev && rnd() < WEATHER_STICKY) w = prev;
  else w = pickWeighted(list);
  const [a, b] = w.tempRange || [20, 28];
  const temp = Math.round(a + rnd() * (b - a));
  state.weather = { kind: w.kind, id: w.id, name: w.name, icon: w.icon, temp };
  return w;
}

// ---------- M1: conditions ----------
const asList = (v) => (Array.isArray(v) ? v : [v]);

// All keys of EVENTS_EXT.md §2 (AND). Unknown keys are ignored.
export function condMet(state, cond) {
  const c = cond || {};
  const t = state.time;
  if (c.months && !asList(c.months).includes(t.month)) return false;
  if (c.weather && !asList(c.weather).includes(state.weather && state.weather.kind)) return false;
  if (c.weatherId && !asList(c.weatherId).includes(state.weather && state.weather.id)) return false;
  if (c.minYear != null && t.year < c.minYear) return false;
  if (c.maxYear != null && t.year > c.maxYear) return false;
  if (c.minRep != null && state.reputation < c.minRep) return false;
  if (c.maxRep != null && state.reputation > c.maxRep) return false;
  if (c.minLot != null && (state.lotLevel || 0) < c.minLot) return false;
  const objs = state.objects || [];
  if (c.hasObject && !asList(c.hasObject).some(d => objs.some(o => o.defId === d))) return false;
  if (c.needObjects && !asList(c.needObjects).every(d => objs.some(o => o.defId === d))) return false;
  if (c.hasStaff) {
    for (const role of Object.keys(c.hasStaff)) if (ST.staffCount(state, role) < c.hasStaff[role]) return false;
  }
  if (c.pvBelow != null && !((state.nhi && typeof state.nhi.pointValue === 'number' ? state.nhi.pointValue : 1) < c.pvBelow)) return false;
  if (c.policy && !asList(c.policy).includes(state.policy && state.policy.focus)) return false;
  if (c.flag && !asList(c.flag).every(f => flagOn(state, f))) return false;
  if (c.notFlag && asList(c.notFlag).some(f => flagOn(state, f))) return false;
  if (c.riskAtLeast != null && riskOf(state) < c.riskAtLeast) return false;
  if (c.riskAtMost != null && riskOf(state) > c.riskAtMost) return false;
  if (c.wearAtLeast) {
    const w = c.wearAtLeast, ids = w.defId ? asList(w.defId) : null, n = w.n != null ? w.n : 0;
    if (!objs.some(o => (!ids || ids.includes(o.defId)) && EQ.wearOf(o) >= n && (EQ.isWearable(o.defId) || o.wear > 0))) return false;
  }
  if (c.moraleBelow != null && !(state.staff || []).some(s => ST.moraleOf(s) < c.moraleBelow)) return false;
  if (c.reviewBelow != null && !(reviewOf(state) < c.reviewBelow)) return false;
  if (c.monthPointsOverCapPct != null) {
    // events roll at week:start, when the new month's counter is still ~0: in week 1 the month that just closed counts too
    const cap = nhiCap(state);
    const pts = Math.max(state.nhi.monthPoints || 0, state.time.week === 1 ? ((state.nhi.lastSettlement && state.nhi.lastSettlement.points) || 0) : 0);
    if (!(cap > 0 && (pts / cap) * 100 >= c.monthPointsOverCapPct)) return false;
  }
  if (c.minPatientsTotal != null && ((state.stats && state.stats.patientsTotal) || 0) < c.minPatientsTotal) return false;
  return true;
}

// ---------- pool selection ----------
export function eventWeight(state, def) {
  let w = def.weight;
  if (def.cat === 'season') w *= EVENT_SEASON_MULT;
  if (def.cat === 'nhi' && riskOf(state) > RISK_TUNE.HIGH) w *= EVENT_RISK_MULT;
  return w;
}

function bigUsedThisMonth(state) { return ev(state).lastBigMonth === absMonth(state); }

export function eligibleEvents(state) {
  const e = ev(state), now = absoluteWeek(state), bigUsed = bigUsedThisMonth(state);
  return POOL.filter(r => {
    if ((e.cooldowns['evt:' + r.id] || 0) > now) return false;
    if (r.big && (bigUsed || now < EVENT_TUNE.BIG_MIN_WEEK)) return false;
    return condMet(state, r.cond);
  });
}

function maybeRandomEvent(state) {
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma || now < EVENT_TUNE.GRACE) return null;
  if (now - (e.lastEventWeek ?? -999) < EVENT_TUNE.MIN_GAP) return null;
  if (rnd() >= EVENT_TUNE.CHANCE * (now < EVENT_TUNE.EARLY_WEEKS ? EVENT_TUNE.EARLY_MULT : 1)) return null;
  const r = pickWeighted(eligibleEvents(state), (d) => eventWeight(state, d));
  return r ? triggerEvent(state, r.id) : null;
}

// ---------- M10: follow-ups ----------
function fireDueFollowUp(state) {
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma) return null;
  e.pendingFollowUps.sort((a, b) => a.due - b.due);
  for (let i = 0; i < e.pendingFollowUps.length; i++) {
    const f = e.pendingFollowUps[i];
    if (f.due > now) break;
    const def = eventById(f.id);
    if (!def) { e.pendingFollowUps.splice(i--, 1); continue; }
    if (def.big && bigUsedThisMonth(state)) continue;      // wait for next month
    e.pendingFollowUps.splice(i, 1);
    return triggerEvent(state, f.id);
  }
  return null;
}

// ---------- showing a decision ----------
function cloneFx(fx) { return fx ? JSON.parse(JSON.stringify(fx)) : {}; }

// Stored in state.events.pendingDilemma (JSON-safe). A `chance` option is rolled when the decision opens
// (`u`), so reloading the save does not re-roll it.
function normChoice(c) {
  const o = { label: c.label || '', result: c.result || '', effects: c.chance ? {} : cloneFx(c.effects) };
  if (c.chance) {
    const p = clamp(Number(c.chance.p), 0, 1);
    o.chance = {
      p: Number.isFinite(p) ? p : 0.5, u: rnd(),
      win: { effects: cloneFx(c.chance.win && c.chance.win.effects), result: (c.chance.win && c.chance.win.result) || '' },
      lose: { effects: cloneFx(c.chance.lose && c.chance.lose.effects), result: (c.chance.lose && c.chance.lose.result) || '' },
    };
  }
  if (c.requires && Number(c.requires.money) > 0) o.requires = { money: Number(c.requires.money) };
  return o;
}

export function choiceAffordable(state, c) { return !(c && c.requires && Number(c.requires.money) > state.money); }

function showPending(state, p) {
  const e = ev(state);
  // never strand a poor player: if no option is affordable, the last one (usually "decline") loses its requirement
  if (p.choices.length && !p.choices.some(c => choiceAffordable(state, c))) delete p.choices[p.choices.length - 1].requires;
  p.wasPaused = !!state.time.paused;
  e.pendingDilemma = p;
  state.time.paused = true;
  if (p.kind === 'dilemma') bus.emit('dilemma:show', { dilemma: p });
  else bus.emit('event:show', { event: p });
}

function openDef(state, def, extra) {
  return showPending(state, { kind: 'event', id: def.id, title: def.title, text: def.text, choices: def.choices.map(normChoice), ...(extra || {}) });
}

// Public so tests / debug tools can force an event (any id of the pool). Honors the cooldown bookkeeping, not the cond.
export function triggerEvent(state, id) {
  const e = ev(state);
  const r = eventById(id);
  if (!r || e.pendingDilemma) return null;
  const now = absoluteWeek(state);
  e.lastEventWeek = now;
  e.cooldowns['evt:' + id] = now + (r.cooldownWeeks || 0);
  if (r.big) e.lastBigMonth = absMonth(state);
  openDef(state, r);
  return e.pendingDilemma;
}

// A decision built on the fly (not in the pool): used for the generic breakdown / resignation prompts.
function openAdHoc(state, id, title, text, choices) {
  const e = ev(state);
  if (e.pendingDilemma) return null;
  e.lastEventWeek = absoluteWeek(state);
  showPending(state, { kind: 'event', id, title, text, choices: choices.map(normChoice) });
  return e.pendingDilemma;
}

// ---------- M2: breakdown hook ----------
function breakdownEventFor(state, obj) {
  const e = ev(state), now = absoluteWeek(state);
  return POOL.find(d => d.cat === 'ops' && !d.big && d.cond && d.cond.wearAtLeast && d.cond.wearAtLeast.defId &&
    asList(d.cond.wearAtLeast.defId).includes(obj.defId) && (e.cooldowns['evt:' + d.id] || 0) <= now) || null;
}

export function triggerBreakdownEvent(state, obj) {
  const e = ev(state);
  if (e.pendingDilemma || !obj) return null;
  const def = breakdownEventFor(state, obj);
  if (def) return triggerEvent(state, def.id);
  const cost = EQ.repairCost(obj), name = EQ.defName(obj.defId);
  return openAdHoc(state, 'equip_breakdown', `${name}故障了`, `${name}突然停止運轉，螢幕上只剩一行錯誤碼。病人在旁邊探頭問：「這台今天不能用喔？」`, [
    { label: `立刻叫修（NT$ ${cost.toLocaleString('en-US')}）`, requires: { money: cost }, effects: { money: -cost, repairObj: obj.id }, result: '師傅一小時內到場，換了零件，機器又開始嗡嗡運轉。' },
    { label: '先停用，之後再修', effects: {}, result: '你在機器上貼了張「維修中」，之後可到〈一覽〉→〈設備維護〉叫修。' },
  ]);
}

// ---------- M4: resignation hook ----------
function maybeResignEvent(state) {
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma) return null;
  const cand = ST.resignCandidate(state);
  if (!cand || rnd() >= ST.MORALE.RESIGN_P) return null;
  if ((e.cooldowns['gen:resign'] || 0) > now) return null;
  e.cooldowns['gen:resign'] = now + EVENT_EXT_COOLDOWN_WEEKS;
  const def = cand.role === 'pt' ? eventById(RESIGN_EVENT_ID) : null;
  if (def && (e.cooldowns['evt:' + def.id] || 0) <= now && !(def.big && bigUsedThisMonth(state))) return triggerEvent(state, def.id);
  const role = (STAFF_ROLES[cand.role] || {}).name || cand.role;
  const raise = Math.round((cand.salary || 60000) / 1000) * 1000;
  return openAdHoc(state, 'staff_resign', `${cand.name}遞出辭呈`, `${role}${cand.name}最近士氣低落，把辭呈放在你的桌上：「我想休息一陣子。」`, [
    { label: `談加薪慰留（NT$ ${raise.toLocaleString('en-US')}）`, requires: { money: raise }, effects: { money: -raise, morale: { role: cand.role, delta: 12 } }, result: '談了一個下午，加薪與排班調整都有了，辭呈被收進抽屜。' },
    { label: '放行，公開徵才', effects: { resign: { role: cand.role, p: 1 }, reputation: -2 }, result: '辭呈照批，招聘名單裡多了一位新的應徵者。' },
  ]);
}

// ---------- weekly tick ----------
function onWeekStart(state) {
  const e = ev(state);
  // 1. tick active effects + timed buffs
  let changed = false;
  for (const a of e.active) a.weeksLeft -= 1;
  const before = e.active.length;
  e.active = e.active.filter(a => a.weeksLeft > 0);
  if (e.active.length !== before) changed = true;
  for (const b of e.buffs) b.weeksLeft -= 1;
  const expired = e.buffs.filter(b => b.weeksLeft <= 0);
  if (expired.length) {
    e.buffs = e.buffs.filter(b => b.weeksLeft > 0);
    changed = true;
    for (const b of expired) if (b.note !== false) logLine(state, `效應結束：${b.label}`);
  }

  // 2. weather
  const prevId = state.weather && state.weather.id;
  const w = rollWeather(state);
  if (w) {
    changed = true;
    if (w.id !== prevId && w.news && w.kind !== 'sunny' && w.kind !== 'cloudy') note(state, `${w.icon || ''} ${w.news}`, w.kind === 'typhoon' ? 'bad' : 'info');
  }

  // 3. equipment wear / breakdowns (M2) and staff morale (M4)
  const broke = EQ.weeklyWear(state);
  broke.forEach((o, i) => { if (i === 0) logLine(state, `${EQ.defName(o.defId)}故障了`); else note(state, `🔧 ${EQ.defName(o.defId)}故障了，到〈一覽〉→〈設備維護〉叫修`, 'bad'); });
  ST.weeklyMorale(state);
  if (changed) refreshMods(state);

  // 4. one decision at most: breakdown > due follow-up > resignation > random event
  if (e.pendingDilemma) return;
  if (broke.length) { if (triggerBreakdownEvent(state, broke[0])) return; }
  if (fireDueFollowUp(state)) return;
  if (maybeResignEvent(state)) return;
  maybeRandomEvent(state);
}

// ---------- dilemmas ----------
function requestDilemma(state, payload) {
  if (!payload) return null;
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma) return null;
  const trig = payload.trigger;
  if ((e.cooldowns['dtr:' + trig] || 0) > now) return null;
  if (e.lastDilemmaWeek !== undefined && now - e.lastDilemmaWeek < DILEMMA_GLOBAL_GAP_WEEKS) return null;
  if (rnd() >= DILEMMA_ACCEPT_CHANCE) return null;

  const patient = (state.patients || []).find(p => p.id === payload.patientId) || null;
  let pool = (EV.DILEMMAS || []).filter(d => d.trigger === trig && (e.cooldowns['dil:' + d.id] || 0) <= now);
  if (!pool.length) return null;
  const typed = patient ? pool.filter(d => d.id.endsWith('_' + patient.type)) : [];
  const d = pickWeighted(typed.length ? typed : pool, () => 1);

  e.lastDilemmaWeek = now;
  e.cooldowns['dtr:' + trig] = now + DILEMMA_TRIGGER_COOLDOWN_WEEKS;
  e.cooldowns['dil:' + d.id] = now + DILEMMA_REPEAT_COOLDOWN_WEEKS;
  showPending(state, {
    kind: 'dilemma', id: d.id, trigger: trig, patientId: payload.patientId, patientName: patient ? patient.name : '',
    title: d.title, text: d.text,
    choices: d.choices.map(normChoice),
  });
  return e.pendingDilemma;
}

function onSlip(state, payload) {
  state.reputation = Math.max(0, state.reputation - SLIP_REP_PENALTY);
  if (rnd() < SLIP_EVENT_CHANCE && !ev(state).pendingDilemma) {
    const e = ev(state);
    if ((e.cooldowns['evt:fall_lobby'] || 0) <= absoluteWeek(state)) triggerEvent(state, 'fall_lobby');
  }
}

// ---------- effects ----------
const roleName = (role) => (STAFF_ROLES[role] || {}).name || role;
const moneyText = (n) => `${n > 0 ? '+' : '−'}NT$ ${Math.abs(n).toLocaleString('en-US')}`;

export function addBuff(state, b, src) {
  const e = ev(state);
  const label = b.label || '特殊效應';
  const weeks = Math.max(1, Math.round(Number(b.weeks) || 1));
  const mods = buffPatch(b);
  const same = e.buffs.find(x => x.label === label);
  if (same) { same.weeksLeft = Math.max(same.weeksLeft, weeks); same.mods = mods; if (src) same.src = src; return same; }
  const entry = { id: 'buff' + (e.buffSeq = (e.buffSeq || 0) + 1), label, weeksLeft: weeks, mods };
  if (src) entry.src = src;
  e.buffs.push(entry);
  return entry;
}

// Apply a choice's effects. Returns [{text, good}] (what happened, in order). Every key of docs/EVENTS_EXT.md §1.
export function applyEffectsDetailed(state, fx, ctx = {}) {
  const out = [];
  if (!fx) return out;
  const e = ev(state);
  const push = (text, good) => out.push({ text, good: !!good });
  let modsDirty = false;

  if (typeof fx.money === 'number' && fx.money !== 0) {
    state.money += fx.money;
    const l = state.ledger;
    if (fx.money > 0) l.income.other += fx.money; else l.expense.other += -fx.money;
    push(`資金 ${moneyText(fx.money)}`, fx.money > 0);
  }
  if (typeof fx.reputation === 'number' && fx.reputation !== 0) {
    state.reputation = clamp(state.reputation + fx.reputation, 0, 1000);
    push(`聲譽 ${signedNum(fx.reputation)}`, fx.reputation > 0);
  }
  if (fx.points) {
    for (const k of Object.keys(fx.points)) {
      if (!fx.points[k]) continue;
      state.points[k] = Math.max(0, (state.points[k] || 0) + fx.points[k]);
      push(`${k === 'medical' ? '醫術' : k === 'device' ? '儀器' : '服務'} ${signedNum(fx.points[k])}`, fx.points[k] > 0);
    }
  }
  if (typeof fx.sat === 'number' && fx.sat !== 0) {
    const targets = ctx.patient ? [ctx.patient] : (state.patients || []);
    const d = ctx.patient ? fx.sat : fx.sat / 2;
    for (const p of targets) p.satisfaction = clamp((p.satisfaction || 0) + d, 0, 100);
    // a clinic-wide mood swing also colours the patients who arrive during the next week (events fire at the start of a week,
    // when almost nobody is inside yet)
    if (!ctx.patient) { addBuff(state, { weeks: 1, label: fx.sat > 0 ? '口碑小回升' : '口碑小受挫', mods: { satShift: fx.sat } }, ctx.source); modsDirty = true; }
    push(`滿意度 ${signedNum(fx.sat)}`, fx.sat > 0);
  }
  if (typeof fx.nhiPenalty === 'number' && fx.nhiPenalty > 0) {
    state.nhi.monthPoints = Math.max(0, state.nhi.monthPoints - fx.nhiPenalty);
    push(`健保點數 −${fx.nhiPenalty.toLocaleString('en-US')}`, false);
  }
  if (fx.buff && typeof fx.buff === 'object') {
    addBuff(state, fx.buff, ctx.source);
    modsDirty = true;
    push(buffText(fx.buff), buffGood(fx.buff));
  }
  for (const name of fx.setFlag ? asList(fx.setFlag) : []) if (typeof name === 'string' && name) e.flags[name] = true;
  for (const name of fx.clearFlag ? asList(fx.clearFlag) : []) delete e.flags[name];
  if (fx.followUp && fx.followUp.id) {
    const f = fx.followUp, p = f.p == null ? 1 : f.p;
    if (eventById(f.id) && (p >= 1 || rnd() < p)) {
      e.pendingFollowUps.push({ id: f.id, due: absoluteWeek(state) + Math.max(0, Math.round(Number(f.afterWeeks) || 0)) });
    }
  }
  if (typeof fx.risk === 'number' && fx.risk !== 0) {
    addRisk(state, fx.risk);
    push(`審查風險 ${signedNum(fx.risk)}`, fx.risk < 0);
  }
  if (fx.wear && typeof fx.wear.delta === 'number' && fx.wear.delta !== 0) {
    const hit = EQ.addWear(state, fx.wear.target || 'all', fx.wear.delta);
    if (hit.length) {
      const label = fx.wear.target && fx.wear.target !== 'all' && fx.wear.target !== 'random' ? `${EQ.defName(fx.wear.target)}耗損` : '設備耗損';
      push(`${label} ${signedNum(fx.wear.delta)}`, fx.wear.delta < 0);
    }
  }
  if (fx.breakdown) {
    const o = EQ.breakdownTarget(state, fx.breakdown);
    if (o) push(`${EQ.defName(o.defId)}故障`, false);
  }
  if (fx.repair) {
    const hit = EQ.freeRepair(state, fx.repair);
    if (hit.length) push(fx.repair === 'broken' ? '故障設備已修復' : '設備已全面保養', true);
  }
  if (fx.repairObj != null) {
    const o = (state.objects || []).find(x => x.id === fx.repairObj);
    if (o && (o.broken || EQ.wearOf(o) > 0)) { o.broken = false; o.wear = 0; push(`${EQ.defName(o.defId)}已修復`, true); }
  }
  if (fx.stamina && typeof fx.stamina.delta === 'number' && fx.stamina.delta !== 0) {
    const d = fx.stamina.delta, role = fx.stamina.role;
    const n = ST.addStamina(state, role, d, state.time.clock <= OPEN_MIN + 2);
    if (n) push(`${role ? roleName(role) : ''}體力 ${signedNum(d)}`, d > 0);
  }
  if (fx.morale && typeof fx.morale.delta === 'number' && fx.morale.delta !== 0) {
    const d = fx.morale.delta, role = fx.morale.role;
    const n = ST.addMorale(state, role, d);
    if (n) push(`${role ? roleName(role) : ''}士氣 ${signedNum(d)}`, d > 0);
  }
  if (fx.resign && fx.resign.role) {
    const r = ST.resignRole(state, fx.resign.role, fx.resign.p == null ? 1 : fx.resign.p, ctx.resignRoll);
    if (r.left) { push(`${r.left.name}（${roleName(r.left.role)}）離職了`, false); modsDirty = true; }
    else if (r.hit) push(`${roleName(fx.resign.role)}士氣 −${ST.MORALE.RESIGN_FALLBACK_HIT}`, false);
  }
  if (typeof fx.reviewScore === 'number' && fx.reviewScore !== 0) {
    addReview(state, fx.reviewScore);
    push(`網路評價 ${sgn(fx.reviewScore)}${Math.abs(fx.reviewScore).toFixed(1)}`, fx.reviewScore > 0);
  }
  if (typeof fx.maintenance === 'number' && fx.maintenance > 0) {
    if (EQ.wearables(state).length) { EQ.applyMaintenance(state, fx.maintenance); push(`保養合約 ${fx.maintenance} 週：耗損減半`, true); }
  }
  if (modsDirty) refreshMods(state);
  return out;
}

// Legacy shape: array of summary strings.
export function applyEffects(state, fx, ctx = {}) {
  return applyEffectsDetailed(state, fx, ctx).map(c => c.text);
}

// resolveDilemma(state, index, opts?) -> {ok,id,kind,choice,result,summary[],chips[],roll,effects} | null
// opts.roll = 'win'|'lose' forces the outcome of a `chance` option (tests).
export function resolveDilemma(state, choiceIndex, opts = {}) {
  const e = ev(state);
  const p = e.pendingDilemma;
  if (!p) return null;
  const c = p.choices[choiceIndex];
  if (!c) return null;
  if (!choiceAffordable(state, c)) return null;
  const patient = p.patientId ? (state.patients || []).find(x => x.id === p.patientId) : null;
  let fx = c.effects, result = c.result, roll = null;
  if (c.chance) {
    const u = typeof c.chance.u === 'number' ? c.chance.u : rnd();
    const win = opts.roll === 'win' ? true : opts.roll === 'lose' ? false : u < c.chance.p;
    const side = win ? c.chance.win : c.chance.lose;
    fx = side.effects; result = side.result || c.result; roll = win ? 'win' : 'lose';
  }
  const chips = applyEffectsDetailed(state, fx, { patient, source: p.id });
  if (patient) {
    patient.flags = patient.flags || {};
    patient.flags.dilemma = { id: p.id, choice: choiceIndex };
  }
  e.pendingDilemma = null;
  state.time.paused = !!p.wasPaused;
  logLine(state, `${p.title}：${c.label}${roll ? (roll === 'win' ? '（成功）' : '（失敗）') : ''}`);
  const out = { ok: true, id: p.id, kind: p.kind, choice: choiceIndex, result, summary: chips.map(x => x.text), chips, roll, effects: fx };
  bus.emit('dilemma:resolved', { ...out, patientId: p.patientId || null, trigger: p.trigger || null, effects: fx });
  refreshMods(state);
  return out;
}

// ---------- 目前效應 (for the 診所 panel) ----------
// [{kind:'buff'|'community', label, weeksLeft, chips:[{text,good}]}]
export function activeEffects(state) {
  const e = ev(state), out = [];
  for (const a of e.active) out.push({ kind: a.kind || 'community', label: a.name || a.id, weeksLeft: a.weeksLeft, chips: modChips(a.mods) });
  for (const b of e.buffs) out.push({ kind: 'buff', label: b.label, weeksLeft: b.weeksLeft, chips: modChips(b.mods) });
  return out;
}

// ---------- community actions ----------
export function communityList(state) {
  const e = ev(state), now = absoluteWeek(state);
  return (EV.COMMUNITY || []).map(def => {
    const act = e.active.find(a => a.kind === 'community' && a.id === def.id);
    const cdLeft = Math.max(0, (e.cooldowns['com:' + def.id] || 0) - now);
    let status = 'ready';
    if (act) status = 'active'; else if (cdLeft > 0) status = 'cooldown';
    return { def, status, weeksLeft: act ? act.weeksLeft : 0, cooldownLeft: cdLeft, affordable: state.money >= def.cost };
  });
}

export function startCommunity(state, id) {
  const e = ev(state), now = absoluteWeek(state);
  const def = (EV.COMMUNITY || []).find(c => c.id === id);
  if (!def) return { ok: false, reason: '找不到這個活動' };
  if (e.active.some(a => a.kind === 'community' && a.id === id)) return { ok: false, reason: '活動進行中' };
  const cd = (e.cooldowns['com:' + id] || 0) - now;
  if (cd > 0) return { ok: false, reason: `冷卻中（還要 ${cd} 週）` };
  if (!spend(state, def.cost, 'other')) return { ok: false, reason: '資金不足' };
  const fx = def.effects || {};
  const mods = {};
  for (const t of Object.keys(fx.spawn || {})) mods['typeSpawn.' + t] = fx.spawn[t];
  if (fx.mods) Object.assign(mods, fx.mods);
  e.active.push({ id, kind: 'community', name: def.name, weeksLeft: def.durationWeeks, mods });
  e.cooldowns['com:' + id] = now + Math.max(def.cooldownWeeks || 0, def.durationWeeks || 0);
  if (fx.reputation) state.reputation = Math.max(0, Math.min(1000, state.reputation + fx.reputation));
  for (const k of Object.keys(fx.points || {})) state.points[k] = Math.max(0, (state.points[k] || 0) + fx.points[k]);
  note(state, `社區活動開跑：${def.name}`, 'good');
  refreshMods(state);
  bus.emit('community:started', { id });
  return { ok: true, reason: '' };
}

// ---------- boards / policy ----------
export function boardList(state) {
  return (EV.BOARDS || []).map(def => ({ def, on: (state.policy.boards || []).includes(def.id) }));
}

export function setBoard(state, id, on) {
  const def = (EV.BOARDS || []).find(b => b.id === id);
  if (!def) return false;
  const boards = state.policy.boards || (state.policy.boards = []);
  const has = boards.includes(id);
  if (on && !has) {
    if (!spend(state, def.cost, 'other')) return false;
    boards.push(id);
  } else if (!on && has) {
    boards.splice(boards.indexOf(id), 1);
  } else {
    return true;
  }
  refreshMods(state);
  return true;
}

export function setFocus(state, focus) {
  if (!FOCUS || !FOCUS[focus]) return false;
  state.policy.focus = focus;
  refreshMods(state);
  return true;
}

export function setPriceMult(state, treatmentId, mult) {
  const t = TREATMENTS[treatmentId];
  if (!t || t.kind !== 'self' || typeof mult !== 'number' || Number.isNaN(mult)) return false;
  const m = Math.round(Math.max(PRICE_MULT_MIN, Math.min(PRICE_MULT_MAX, mult)) * 20) / 20;
  state.policy.priceMult[treatmentId] = m;
  return true;
}
