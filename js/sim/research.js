// Research state machine over data/research.js. state.research = {done:[ids], current:id|null, progress:weeksDone, levels:{lineId:int}}.
// Unlocks are computed on demand from `done` (never stored). `levels` = 持續精進 (data/upgrades.js): instant, repeatable,
// capped purchases that keep the point types useful after the tree is exhausted (see the "upgrades" section below).
import { bus } from '../core/bus.js';
import { RESEARCH, RESEARCH_TRACKS } from '../data/research.js';
import { TREATMENTS } from '../data/treatments.js';
import { BUILDABLES } from '../data/buildables.js';
import { LOTS } from '../data/lots.js';
import { state as singleton } from '../core/state.js';
import { recomputeMods } from './modifiers.js';
import { UPGRADE_LINES, UPGRADE_BY_ID, UPGRADE_DOMAIN_NAMES, upgradeCost } from '../data/upgrades.js';
import { POINT_LABELS } from '../core/constants.js';

let unsub = [];

function rs(state) {
  if (!state.research) state.research = { done: [], current: null, progress: 0 };
  if (!state.research.levels || typeof state.research.levels !== 'object') state.research.levels = {};   // old saves / fresh state
  return state.research;
}

export function initResearch() {
  unsub.forEach(f => f());
  unsub = [bus.on('week:end', () => { tickWeek(singleton); applyRepGrowth(singleton); })];
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
  if ((state.points[key] || 0) < node.cost) return { ok: false, reason: `${key === 'culinary' ? '廚藝' : key === 'device' ? '設備' : '服務'}點數不足（需要 ${node.cost}）` };
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

// =============================================================================================================
// 持續精進 — repeatable upgrade lines (data/upgrades.js). Purchase is instant and pays the line's domain point type.
// =============================================================================================================
export function upgradeLines() { return UPGRADE_LINES; }

export function levelOf(state, id) {
  const line = UPGRADE_BY_ID[id];
  if (!line) return 0;
  return Math.max(0, Math.min(line.cap, Math.floor(Number(rs(state).levels[id]) || 0)));
}

// Sum of all line levels (career metric `upgradeLevels`, achievements).
export function totalLevels(state) {
  let n = 0;
  for (const l of UPGRADE_LINES) n += levelOf(state, l.id);
  return n;
}

// Number of finished research-tree nodes of a domain.
export function domainNodesDone(state, domain) {
  return doneNodes(state).filter(n => n.track === domain).length;
}

// Cost of the next level, or null when capped.
export function nextCost(state, id) {
  const line = UPGRADE_BY_ID[id];
  if (!line) return null;
  const lv = levelOf(state, id);
  return lv >= line.cap ? null : upgradeCost(line, lv);
}

// Is the line available (enough tree nodes of its domain finished)? -> { ok, have, need, reason }
export function upgradeUnlock(state, id) {
  const line = UPGRADE_BY_ID[id];
  if (!line) return { ok: false, have: 0, need: 0, reason: '找不到這條精進路線' };
  const need = (line.unlock && line.unlock.domainNodes) || 0;
  const have = domainNodesDone(state, line.domain);
  const ok = have >= need;
  return { ok, have, need, reason: ok ? '' : `需先完成 ${need} 項${UPGRADE_DOMAIN_NAMES[line.domain]}研發（目前 ${have}/${need}）` };
}

export function canUpgrade(state, id) {
  const line = UPGRADE_BY_ID[id];
  if (!line) return { ok: false, reason: '找不到這條精進路線' };
  const u = upgradeUnlock(state, id);
  if (!u.ok) return { ok: false, reason: u.reason, locked: true };
  const lv = levelOf(state, id);
  if (lv >= line.cap) return { ok: false, reason: '已達最高等級', capped: true };
  const cost = upgradeCost(line, lv);
  const have = Math.floor(state.points[line.domain] || 0);
  if (have < cost) return { ok: false, reason: `${POINT_LABELS[line.domain]}點數不足（需要 ${cost}，目前 ${have}）`, poor: true, cost };
  return { ok: true, reason: '', cost };
}

// Buy one level. Returns true on success. Recomputes mods immediately.
export function buyUpgrade(state, id) {
  const c = canUpgrade(state, id);
  if (!c.ok) return false;
  const line = UPGRADE_BY_ID[id];
  const r = rs(state);
  state.points[line.domain] -= c.cost;
  r.levels[id] = levelOf(state, id) + 1;
  recomputeMods(state);
  bus.emit('mods:dirty', {});
  bus.emit('research:upgrade', { id, level: r.levels[id], cost: c.cost, total: totalLevels(state) });
  bus.emit('toast', { text: `精進完成：${line.name} Lv.${r.levels[id]}${r.levels[id] >= line.cap ? '（已滿級）' : ''}`, kind: 'good' });
  return true;
}

// Effects of a line at a given level -> [{ key, value }] (value = perLevel x level, rounded).
export function upgradeEffectsAt(id, level) {
  const line = UPGRADE_BY_ID[id];
  if (!line) return [];
  return line.effects.map(e => ({ key: e.key, value: Math.round(e.perLevel * level * 1e6) / 1e6 }));
}

// repGrowth mod -> reputation, once per week (called from the week:end listener; public for tests).
export function applyRepGrowth(state) {
  const g = state.mods && state.mods.repGrowth;
  if (typeof g !== 'number' || !Number.isFinite(g) || g === 0) return 0;
  const before = state.reputation;
  state.reputation = Math.max(0, Math.min(1000, before + g));
  return state.reputation - before;
}
