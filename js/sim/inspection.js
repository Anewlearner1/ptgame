// Annual inspection (衛生局稽查) and lot expansion.
import { bus } from '../core/bus.js';
import { state as singleton, ui } from '../core/state.js';
import { BUILDABLES } from '../data/buildables.js';
import { LOTS, INSPECTION_RULES } from '../data/lots.js';
import { RESEARCH } from '../data/research.js';
import { rebuildOccupancy } from '../core/grid.js';
import { spend, lotDef, riskOf } from './economy.js';
import { recomputeMods } from './modifiers.js';
import { recomputeZones } from './synergy.js';

// ---- tuning constants ----
export const PASS_SCORE = 70;            // 0..100
export const CRITICAL_RULES = ['staff_license'];   // a rule flagged `critical` (see evaluateRules) fails the inspection outright
export const EXCELLENT_SCORE = 88;       // pays a bonus
export const REP_PASS_BASE = 4;          // reputation on pass = base + (score - PASS) * REP_PER_POINT
export const REP_PER_POINT = 0.35;
export const REP_FAIL_BASE = 8;          // reputation loss on fail = base + (PASS - score) * REP_FAIL_PER_POINT
export const REP_FAIL_PER_POINT = 0.25;
export const BONUS_EXCELLENT = 200000;    // NT$ 優良獎勵金
export const FINE_BASE = 100000;          // NT$ fine = base + per-failed-rule
export const FINE_PER_FAILED_RULE = 50000;
export const ANTISLIP_TARGET = 0.4;      // coverage of walkable lot tiles by 防滑地墊/坡道
export const SAT_TARGET = 50;            // yearly avg satisfaction
export const RISK_PENALTY_FROM = 20;     // 食安風險 (0..100) above this reduces the food_safety rule score
export const RISK_PENALTY_MAX = 1;       // ... by up to this fraction of the rule at risk 100
export const SAT_WINDOW_MONTHS = 3;      // window for "current" average satisfaction used by expansion

let unsub = [];

export function initInspection() {
  unsub.forEach(f => f());
  unsub = [bus.on('year:end', () => runInspection(singleton))];
}

// ---- helpers ----
export function countSeats(state) {
  let n = 0;
  for (const o of state.objects || []) n += (BUILDABLES[o.defId] && BUILDABLES[o.defId].seats) || 0;
  return n;
}

export function hasRamp(state) {
  for (const row of state.map.floor) if (row && row.includes('ramp')) return true;
  return false;
}

function staffCountOf(state, role) { return (state.staff || []).filter(s => s.role === role).length; }

export function antislipCoverage(state) {
  const occ = new Set();
  for (const o of state.objects || []) {
    const d = BUILDABLES[o.defId];
    if (!d || d.blocks === false) continue;
    const w = o.rot ? d.h : d.w, h = o.rot ? d.w : d.h;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) occ.add((o.x + dx) + ',' + (o.y + dy));
  }
  let total = 0, good = 0;
  const l = state.lot;
  for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) {
    if (occ.has(x + ',' + y)) continue;
    total++;
    const f = state.map.floor[y] && state.map.floor[y][x];
    if (f === 'floor_tile' || f === 'ramp') good++;
  }
  return total ? good / total : 0;
}

// Guest-weighted average satisfaction over the last `months` history entries (+ the running month).
export function avgSatisfaction(state, months = SAT_WINDOW_MONTHS, onlyYear = null) {
  let sum = 0, n = 0;
  let hist = state.history || [];
  if (onlyYear != null) hist = hist.filter(h => h.year === onlyYear);
  else hist = hist.slice(-months);
  for (const h of hist) { sum += (h.satisfaction || 0) * (h.patients || 0); n += h.patients || 0; }
  if (onlyYear == null && state.stats && state.stats.satN > 0) { sum += state.stats.satSum; n += state.stats.satN; }
  return n > 0 ? sum / n : null;
}

// ---- inspection ----
export function evaluateRules(state, year) {
  const lot = lotDef(state);
  const need = lot.requires || {};
  const results = [];
  const ruleW = (id, dflt) => { const r = (INSPECTION_RULES || []).find(x => x.id === id); return r ? r.weight : dflt; };
  const nameOf = (id, dflt) => { const r = (INSPECTION_RULES || []).find(x => x.id === id); return r ? r.name : dflt; };
  const add = (id, dflt, frac, note, critical = false) => results.push({ id, name: nameOf(id, id), weight: ruleW(id, dflt), frac: Math.max(0, Math.min(1, frac)), ok: frac >= 0.999, note, critical });

  const ramp = hasRamp(state);
  add('ramp', 10, ramp ? 1 : 0, ramp ? '有設置無障礙坡道。' : '未設置無障礙坡道，輪椅與嬰兒車無法順利通行。');

  const seats = countSeats(state), needSeats = need.minSeats || 0;
  add('seats', 8, needSeats ? seats / needSeats : 1, `候位座位 ${seats} / 要求 ${needSeats}。`);

  const cov = antislipCoverage(state);
  add('antislip', 9, cov / ANTISLIP_TARGET, `防滑地面覆蓋率 ${(cov * 100).toFixed(0)}%（標準 ${ANTISLIP_TARGET * 100}%）。`);

  const hasChef = staffCountOf(state, 'chef') > 0, hasCook = staffCountOf(state, 'cook') > 0;
  let lic = (hasChef ? 0.5 : 0) + (hasCook ? 0.5 : 0);
  const objDefs = new Set((state.objects || []).map(o => o.defId));
  const miss = [];
  if (!hasChef) miss.push('主廚');
  if (!hasCook) miss.push('廚師');
  if ((objDefs.has('drink_bar') || objDefs.has('ice_shop') || objDefs.has('dessert_bar') || objDefs.has('bar_counter')) && !staffCountOf(state, 'barista')) { lic -= 0.25; miss.push('吧台師'); }
  if ((objDefs.has('table2') || objDefs.has('table4') || objDefs.has('hotpot_table')) && !staffCountOf(state, 'server')) { lic -= 0.25; miss.push('外場服務生'); }
  // no chef or no cook on the books = cannot legally operate -> automatic fail (barista / server gaps only cost points)
  add('staff_license', 10, lic, miss.length ? '缺少持證人員：' + miss.join('、') + '。' : '持證廚師配置齊全。', !hasChef || !hasCook);

  const sat = avgSatisfaction(state, 12, year);
  add('satisfaction', 8, sat == null ? 1 : sat / SAT_TARGET, sat == null ? '本年度尚無客人資料。' : `全年平均滿意度 ${sat.toFixed(0)}（標準 ${SAT_TARGET}）。`);

  // 食安風險 (state.safety.risk) above RISK_PENALTY_FROM costs points at the annual 衛生局稽查 (RISK_PENALTY_FROM..100 -> up to RISK_PENALTY_MAX)
  const risk = riskOf(state);
  const riskPen = risk > RISK_PENALTY_FROM ? (risk - RISK_PENALTY_FROM) / (100 - RISK_PENALTY_FROM) * RISK_PENALTY_MAX : 0;
  const fsNote = riskPen > 0 ? `食安風險偏高（${Math.round(risk)}），稽查員把冷藏與爐具多看了幾眼。` : `食安風險控制得宜（${Math.round(risk)}）。`;
  add('food_safety', 12, 1 - riskPen, fsNote);
  return results;
}

export function runInspection(state) {
  const year = state.time.year;
  const rules = evaluateRules(state, year);
  const totalW = rules.reduce((s, r) => s + r.weight, 0) || 1;
  const score = Math.round(rules.reduce((s, r) => s + r.weight * r.frac, 0) / totalW * 100);
  const critical = rules.some(r => CRITICAL_RULES.includes(r.id) && r.critical);
  const pass = score >= PASS_SCORE && !critical;
  const failed = rules.filter(r => !r.ok);
  const notes = rules.map(r => (r.ok ? '✔ ' : '✘ ') + r.name + '：' + r.note);

  let repDelta, rewardOrFine = 0;
  if (pass) {
    repDelta = Math.round(REP_PASS_BASE + (score - PASS_SCORE) * REP_PER_POINT);
    if (score >= EXCELLENT_SCORE) { rewardOrFine = BONUS_EXCELLENT; state.money += BONUS_EXCELLENT; state.ledger.income.other += BONUS_EXCELLENT; }
  } else {
    repDelta = -Math.round(REP_FAIL_BASE + (PASS_SCORE - score) * REP_FAIL_PER_POINT);
    const fine = FINE_BASE + FINE_PER_FAILED_RULE * failed.filter(r => r.frac < 0.5).length;
    rewardOrFine = -fine;
    state.money -= fine;                       // fines may push the shop into debt
    state.ledger.expense.other += fine;
  }
  state.reputation = Math.max(0, Math.min(1000, state.reputation + repDelta));

  const result = { year, pass, score, notes, rewardOrFine, reputationDelta: repDelta, rules: rules.map(r => ({ id: r.id, name: r.name, ok: r.ok, frac: r.frac, note: r.note })) };
  state.inspections.lastYearResult = result;
  const ilog = state.inspections.log || (state.inspections.log = []);
  ilog.push({ year, pass, score, rewardOrFine });
  if (ilog.length > 40) ilog.splice(0, ilog.length - 40);
  bus.emit('inspection:result', result);
  return result;
}

// ---- expansion ----
export function nextLot(state) { return LOTS[(state.lotLevel || 0) + 1] || null; }

export function canExpand(state) {
  const next = nextLot(state);
  if (!next) return { ok: false, missing: ['已是最大規模'], checks: [] };
  const r = next.requires || {};
  const checks = [];
  const chk = (ok, label) => checks.push({ ok, label });
  if (r.minReputation) chk(state.reputation >= r.minReputation, `聲譽 ≥ ${r.minReputation}（目前 ${Math.floor(state.reputation)}）`);
  if (r.minYear) chk(state.time.year >= r.minYear, `第 ${r.minYear} 年起（目前第 ${state.time.year} 年）`);
  if (r.minStaff) chk(state.staff.length >= r.minStaff, `員工 ≥ ${r.minStaff}（目前 ${state.staff.length}）`);
  if (r.minAvgSat) {
    const s = avgSatisfaction(state);
    chk(s != null && s >= r.minAvgSat, `平均滿意度 ≥ ${r.minAvgSat}（目前 ${s == null ? '—' : s.toFixed(0)}）`);
  }
  if (r.needRamp) chk(hasRamp(state), '有無障礙坡道');
  if (r.minSeats) chk(countSeats(state) >= r.minSeats, `候位座位 ≥ ${r.minSeats}（目前 ${countSeats(state)}）`);
  if (r.research) chk((state.research.done || []).includes(r.research), `完成研發「${(RESEARCH[r.research] || {}).name || r.research}」`);
  chk(state.money >= (next.expandCost || 0), `資金 ≥ NT$ ${(next.expandCost || 0).toLocaleString('en-US')}`);
  const missing = checks.filter(c => !c.ok).map(c => c.label);
  return { ok: missing.length === 0, missing, checks, cost: next.expandCost || 0, target: next.name };
}

export function expand(state) {
  const c = canExpand(state);
  if (!c.ok) return false;
  const next = nextLot(state);
  if (!spend(state, next.expandCost || 0, 'build')) return false;
  state.lotLevel += 1;
  state.lot = { ...next.lot };
  state.door = { ...next.door };
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  bus.emit('map:changed', {});
  bus.emit('lot:expanded', { level: state.lotLevel });
  bus.emit('toast', { text: `餐廳擴建完成：${next.name}！`, kind: 'good' });
  return true;
}
