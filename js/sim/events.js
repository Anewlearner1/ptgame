// Weather, random events, community actions, health boards, focus / price setters and the dilemma pipeline.
// A pending decision lives in state.events.pendingDilemma; the game is paused (state.time.paused = true)
// until resolveDilemma() is called.
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import * as EV from '../data/events.js';
import { FOCUS } from '../data/patients.js';
import { TREATMENTS } from '../data/treatments.js';
import { spend, setBoardUpkeepResolver } from './economy.js';
import { recomputeMods } from './modifiers.js';
import { absoluteWeek } from './calendar.js';

// ---- tuning constants ----
export const WEATHER_STICKY = 0.35;          // chance the weather simply continues next week (if still valid for the month)
export const EVENT_CHANCE_PER_WEEK = 0.14;   // random event roll at each week:start
export const EVENT_GRACE_WEEKS = 6;          // no random events during the first weeks
export const EVENT_MIN_GAP_WEEKS = 3;        // min weeks between two random events
export const EVENT_REPEAT_COOLDOWN_WEEKS = 20;   // same event again no sooner than this
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

function ev(state) {
  if (!state.events) state.events = { active: [], log: [], pendingDilemma: null, cooldowns: {} };
  const e = state.events;
  if (!e.active) e.active = [];
  if (!e.log) e.log = [];
  if (!e.cooldowns) e.cooldowns = {};
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

// ---------- helpers ----------
function pickWeighted(list, wf = (x) => x.weight || 1) {
  let total = 0;
  for (const x of list) total += Math.max(0, wf(x));
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const x of list) {
    r -= Math.max(0, wf(x));
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

function note(state, text, kind = 'info') {
  const e = ev(state);
  e.log.push({ y: state.time.year, m: state.time.month, w: state.time.week, text });
  if (e.log.length > EVENT_LOG_MAX) e.log.splice(0, e.log.length - EVENT_LOG_MAX);
  bus.emit('toast', { text, kind });
}

function refreshMods(state) {
  recomputeMods(state);
  bus.emit('mods:dirty', {});
}

// ---------- weather ----------
export function weatherDefById(id) { return (EV.WEATHER || []).find(w => w.id === id) || null; }

export function rollWeather(state) {
  const list = (EV.WEATHER || []).filter(w => !w.months || w.months.includes(state.time.month));
  if (!list.length) return null;
  const prev = state.weather && state.weather.id ? list.find(w => w.id === state.weather.id) : null;
  let w;
  if (prev && Math.random() < WEATHER_STICKY) w = prev;
  else w = pickWeighted(list);
  const [a, b] = w.tempRange || [20, 28];
  const temp = Math.round(a + Math.random() * (b - a));
  state.weather = { kind: w.kind, id: w.id, name: w.name, icon: w.icon, temp };
  return w;
}

// ---------- weekly tick ----------
function onWeekStart(state) {
  const e = ev(state);
  // 1. tick active effects
  let changed = false;
  for (const a of e.active) a.weeksLeft -= 1;
  const before = e.active.length;
  e.active = e.active.filter(a => a.weeksLeft > 0);
  if (e.active.length !== before) changed = true;

  // 2. weather
  const prevId = state.weather && state.weather.id;
  const w = rollWeather(state);
  if (w) {
    changed = true;
    if (w.id !== prevId && w.news && w.kind !== 'sunny' && w.kind !== 'cloudy') note(state, `${w.icon || ''} ${w.news}`, w.kind === 'typhoon' ? 'bad' : 'info');
  }
  if (changed) refreshMods(state);

  // 3. random event
  maybeRandomEvent(state);
}

function eligibleEvents(state) {
  const e = ev(state), now = absoluteWeek(state);
  return (EV.RANDOM_EVENTS || []).filter(r => {
    const c = r.cond || {};
    if (c.minYear && state.time.year < c.minYear) return false;
    if (c.minRep && state.reputation < c.minRep) return false;
    if ((e.cooldowns['evt:' + r.id] || 0) > now) return false;
    if (r.id === 'flood' && !(state.weather && state.weather.kind === 'typhoon')) return false;
    return true;
  });
}

function maybeRandomEvent(state) {
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma || now < EVENT_GRACE_WEEKS) return null;
  if (now - (e.lastEventWeek ?? -999) < EVENT_MIN_GAP_WEEKS) return null;
  if (Math.random() >= EVENT_CHANCE_PER_WEEK) return null;
  const r = pickWeighted(eligibleEvents(state));
  return r ? triggerEvent(state, r.id) : null;
}

// Public so tests / debug tools can force an event.
export function triggerEvent(state, id) {
  const e = ev(state);
  const r = (EV.RANDOM_EVENTS || []).find(x => x.id === id);
  if (!r || e.pendingDilemma) return null;
  e.lastEventWeek = absoluteWeek(state);
  e.cooldowns['evt:' + id] = absoluteWeek(state) + EVENT_REPEAT_COOLDOWN_WEEKS;
  showPending(state, { kind: 'event', id: r.id, title: r.title, text: r.text, choices: r.choices.map(c => ({ label: c.label, effects: c.effects || {}, result: c.result || '' })) });
  return e.pendingDilemma;
}

function showPending(state, p) {
  const e = ev(state);
  p.wasPaused = !!state.time.paused;
  e.pendingDilemma = p;
  state.time.paused = true;
  if (p.kind === 'dilemma') bus.emit('dilemma:show', { dilemma: p });
  else bus.emit('event:show', { event: p });
}

// ---------- dilemmas ----------
function requestDilemma(state, payload) {
  if (!payload) return null;
  const e = ev(state), now = absoluteWeek(state);
  if (e.pendingDilemma) return null;
  const trig = payload.trigger;
  if ((e.cooldowns['dtr:' + trig] || 0) > now) return null;
  if (e.lastDilemmaWeek !== undefined && now - e.lastDilemmaWeek < DILEMMA_GLOBAL_GAP_WEEKS) return null;
  if (Math.random() >= DILEMMA_ACCEPT_CHANCE) return null;

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
    choices: d.choices.map(c => ({ label: c.label, effects: c.effects || {}, result: c.result || '' })),
  });
  return e.pendingDilemma;
}

function onSlip(state, payload) {
  state.reputation = Math.max(0, state.reputation - SLIP_REP_PENALTY);
  if (Math.random() < SLIP_EVENT_CHANCE && !ev(state).pendingDilemma) {
    const e = ev(state);
    if ((e.cooldowns['evt:fall_lobby'] || 0) <= absoluteWeek(state)) triggerEvent(state, 'fall_lobby');
  }
}

// Apply a choice's effects; returns a short summary for the UI.
export function applyEffects(state, fx, ctx = {}) {
  const sum = [];
  if (!fx) return sum;
  if (typeof fx.money === 'number' && fx.money !== 0) {
    state.money += fx.money;
    const l = state.ledger;
    if (fx.money > 0) l.income.other += fx.money; else l.expense.other += -fx.money;
    sum.push(`${fx.money > 0 ? '+' : '-'}NT$ ${Math.abs(fx.money).toLocaleString('en-US')}`);
  }
  if (typeof fx.reputation === 'number' && fx.reputation !== 0) {
    state.reputation = Math.max(0, Math.min(1000, state.reputation + fx.reputation));
    sum.push(`聲譽 ${fx.reputation > 0 ? '+' : ''}${fx.reputation}`);
  }
  if (fx.points) {
    for (const k of Object.keys(fx.points)) {
      state.points[k] = Math.max(0, (state.points[k] || 0) + fx.points[k]);
      sum.push(`${k === 'medical' ? '醫術' : k === 'device' ? '儀器' : '服務'} ${fx.points[k] > 0 ? '+' : ''}${fx.points[k]}`);
    }
  }
  if (typeof fx.sat === 'number' && fx.sat !== 0) {
    const targets = ctx.patient ? [ctx.patient] : (state.patients || []);
    const d = ctx.patient ? fx.sat : fx.sat / 2;
    for (const p of targets) p.satisfaction = Math.max(0, Math.min(100, (p.satisfaction || 0) + d));
    sum.push(`滿意度 ${fx.sat > 0 ? '+' : ''}${fx.sat}`);
  }
  if (typeof fx.nhiPenalty === 'number' && fx.nhiPenalty > 0) {
    state.nhi.monthPoints = Math.max(0, state.nhi.monthPoints - fx.nhiPenalty);
    sum.push(`健保點數 -${fx.nhiPenalty}`);
  }
  return sum;
}

export function resolveDilemma(state, choiceIndex) {
  const e = ev(state);
  const p = e.pendingDilemma;
  if (!p) return null;
  const c = p.choices[choiceIndex];
  if (!c) return null;
  const patient = p.patientId ? (state.patients || []).find(x => x.id === p.patientId) : null;
  const summary = applyEffects(state, c.effects, { patient });
  if (patient) {
    patient.flags = patient.flags || {};
    patient.flags.dilemma = { id: p.id, choice: choiceIndex };
  }
  e.pendingDilemma = null;
  state.time.paused = !!p.wasPaused;
  e.log.push({ y: state.time.year, m: state.time.month, w: state.time.week, text: `${p.title}：${c.label}` });
  if (e.log.length > EVENT_LOG_MAX) e.log.splice(0, e.log.length - EVENT_LOG_MAX);
  const out = { ok: true, id: p.id, kind: p.kind, choice: choiceIndex, result: c.result, summary };
  bus.emit('dilemma:resolved', { ...out, patientId: p.patientId || null, trigger: p.trigger || null, effects: c.effects });
  refreshMods(state);
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
