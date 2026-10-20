// Research state machine over data/research.js. state.research = {done:[ids], current:id|null, progress:weeksDone}.
// Unlocks are computed on demand from `done` (never stored).
import { bus } from '../core/bus.js';
import { RESEARCH, RESEARCH_TRACKS } from '../data/research.js';
import { TREATMENTS } from '../data/treatments.js';
import { BUILDABLES } from '../data/buildables.js';
import { LOTS } from '../data/lots.js';
import { state as singleton } from '../core/state.js';
import { recomputeMods } from './modifiers.js';

let unsub = [];

function rs(state) {
  if (!state.research) state.research = { done: [], current: null, progress: 0 };
  return state.research;
}

export function initResearch() {
  unsub.forEach(f => f());
  unsub = [bus.on('week:end', () => tickWeek(singleton))];
}

export function isDone(state, id) { return rs(state).done.includes(id); }

function pointKeyOf(node) {
  const tr = (RESEARCH_TRACKS || []).find(t => t.id === node.track);
  return (tr && tr.pointKey) || node.track;
}

export function canStart(state, id) {
  const node = RESEARCH[id];
  const r = rs(state);
  if (!node) return { ok: false, reason: '找不到這項研發' };
  if (r.done.includes(id)) return { ok: false, reason: '已經研發完成' };
  if (r.current) return { ok: false, reason: r.current === id ? '正在研發中' : '已有研發進行中（同時只能一項）' };
  const missing = (node.requires || []).filter(q => !r.done.includes(q));
  if (missing.length) return { ok: false, reason: '需先完成：' + missing.map(q => (RESEARCH[q] ? RESEARCH[q].name : q)).join('、') };
  const key = pointKeyOf(node);
  if ((state.points[key] || 0) < node.cost) return { ok: false, reason: `${key === 'medical' ? '醫術' : key === 'device' ? '儀器' : '服務'}點數不足（需要 ${node.cost}）` };
  return { ok: true, reason: '' };
}

export function start(state, id) {
  if (!canStart(state, id).ok) return false;
  const node = RESEARCH[id];
  state.points[pointKeyOf(node)] -= node.cost;
  const r = rs(state);
  r.current = id;
  r.progress = 0;
  bus.emit('toast', { text: `開始研發：${node.name}（${node.weeks} 週）`, kind: 'info' });
  return true;
}

export function progressInfo(state) {
  const r = rs(state);
  const node = r.current ? RESEARCH[r.current] : null;
  if (!node) return { id: null, node: null, progress: 0, weeks: 0, remaining: 0, pct: 0 };
  return {
    id: node.id, node, progress: r.progress, weeks: node.weeks,
    remaining: Math.max(0, node.weeks - r.progress),
    pct: Math.min(1, r.progress / Math.max(1, node.weeks)),
  };
}

export function list(state) {
  const r = rs(state);
  return Object.values(RESEARCH).map(node => {
    let status;
    if (r.done.includes(node.id)) status = 'done';
    else if (r.current === node.id) status = 'current';
    else if ((node.requires || []).every(q => r.done.includes(q))) status = 'available';
    else status = 'locked';
    return { node, status };
  });
}

function finish(state, id) {
  const r = rs(state);
  const node = RESEARCH[id];
  r.current = null;
  r.progress = 0;
  if (!r.done.includes(id)) r.done.push(id);
  for (const e of (node && node.effects) || []) {
    if (e.type === 'rep') state.reputation = Math.max(0, Math.min(1000, state.reputation + e.value));
  }
  recomputeMods(state);
  bus.emit('mods:dirty', {});
  bus.emit('research:done', { id });
  bus.emit('toast', { text: `研發完成：${node ? node.name : id}`, kind: 'good' });
}

// Called on week:end (public for tests).
export function tickWeek(state) {
  const r = rs(state);
  if (!r.current) return;
  const node = RESEARCH[r.current];
  if (!node) { r.current = null; r.progress = 0; return; }
  r.progress += 1;
  if (r.progress >= node.weeks) finish(state, node.id);
}

// ---- unlock queries ----
function doneNodes(state) { return rs(state).done.map(id => RESEARCH[id]).filter(Boolean); }

export function isBuildableUnlocked(state, defId) {
  const def = BUILDABLES[defId];
  if (!def) return false;
  if (!def.requires) return true;
  if (isDone(state, def.requires)) return true;
  return doneNodes(state).some(n => (n.effects || []).some(e => e.type === 'unlockBuild' && (e.ids || []).includes(defId)));
}

export function isTreatmentUnlocked(state, treatmentId) {
  const t = TREATMENTS[treatmentId];
  if (!t) return false;
  if (!t.requires) return true;
  if (isDone(state, t.requires)) return true;
  return doneNodes(state).some(n => (n.effects || []).some(e => e.type === 'unlockTreatment' && (e.ids || []).includes(treatmentId)));
}

export function unlockedBuildables(state) {
  return Object.keys(BUILDABLES).filter(id => isBuildableUnlocked(state, id));
}

export function unlockedTreatments(state) {
  return Object.keys(TREATMENTS).filter(id => isTreatmentUnlocked(state, id));
}

// Extra staff slots from research (rs_staffing, rs_expand ...).
export function extraMaxStaff(state) {
  let n = 0;
  for (const node of doneNodes(state)) for (const e of node.effects || []) if (e.type === 'maxStaff') n += e.n || 0;
  return n;
}

// Staff cap = lot cap + research slots. patients/staff modules should use this.
export function maxStaffOf(state) {
  const lot = LOTS[state.lotLevel || 0];
  return ((lot && lot.maxStaff) || 6) + extraMaxStaff(state);
}
