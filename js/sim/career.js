// Career: onboarding tasks, yearly goals, yearly review + grade, ten-year ending (docs/GOALS_AND_ENDING.md).
// Data lives in data/goals.js; this module owns progress, rewards, scoring and the ending.
//
// Public API (a contract with the UI): CAREER_YEARS · initCareer() · ensureCareer(state) · onboardingList(state) · currentGoals(state)
//   yearReviews(state) · careerSummary(state) · computeYearScore(state, year) · computeEnding(state, {bankrupt}) · setEndless(state, on)
//   markExpandTabOpened(state) · careerCardText(state)   (+ gradeOf(score), careerScore(state), metricValue(state, key) for tools/tests)
// Bus events emitted: 'career:changed' {} · 'career:goal-done' {goal, rewardText} · 'career:onboarding-done' {task, rewardText}
//   'career:year-review' {review} · 'career:ending' {ending}  (+ 'toast' {kind:'good'}).
//
// Ordering contract: the review (and the year-10 ending) are built when the career first notices the year turned (the 'year:start'
// listener, or any ensureCareer() call after calendar.js advanced the year), i.e. after every 'year:end' listener (inspection.js
// included) ran, so 'inspection:result' is always emitted before 'career:year-review'; the ending (year 10) follows the review.
// While the review is built state.time.year is temporarily the finished year.
//
// ---- Interpretation table ----
// Goal latching: a goal becomes done the first time all its conditions hold at a check (week:end, nhi:settled and the relevant
//   events). Conditions that are "cumulative, lower is better" (slipYear / resignYear / breakdownYear <= n) only count at year:end.
// Core goals: year 1..10 follow CORE_GOALS (variants picked by lot level at generation, targetByLot by the lot at generation);
//   years > 10 pick randomly (seeded by state.seed + year) among core goals that are not trivially satisfied.
// Bonus goals: 2 per year, weighted random (seeded), eligible by `cond`, not already satisfied (trivial), not impossible
//   (equipment goals need a machine, staff goals need staff), never the same goal as last year, preferring different groups.
// kid courses       = kidCured + floor(kidServed / 8)  (kids are practically never 'cured' in the sim: 8-16 visits per course).
// selfPayShare3     = the minimum monthly self-pay share (self / (nhi + self + copay)) of the last 3 settled months ("3 months in a row").
// avgSatYear / netMonthlyAvgYear = 0 until the year has >= 3 settled months (no lucky first month).
// trainYear         = staff.level has no event: the total of (level - 1) is polled; increases count as trainings.
// Score dims (0..100): fin = year net / (bench monthly net x 12) (bench = mean of the lot at year start and end);
//   rep = reputation / repCurve[year]; care = 0.6 sat + 0.25 cure rate (cured / visits) + 0.15 slips (per 1000 visits); team = 0.5 morale + 0.25 retention + 0.25 equipment;
//   local = inspection (0..50) + community (0..30) + achievements (0..20).  Year total = mean of the five; grade by GRADES.
// Career score = weighted mean of yearly totals (years 6..10 x1.5) + lot bonus (0/4/8/12) + achievement rate x 10.
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { earn, riskOf, reviewOf } from './economy.js';
import { avgSatisfaction } from './inspection.js';
import { absoluteWeek } from './calendar.js';
import { isWearable, wearOf } from './equipment.js';
import { moraleOf } from './staff.js';
import { unlockedCount, totalCount, displayTitle } from './achievements.js';
import { LOTS } from '../data/lots.js';
import { TREATMENTS } from '../data/treatments.js';
import { RESEARCH } from '../data/research.js';
import * as G from '../data/goals.js';

export const CAREER_YEARS = G.CAREER_YEARS;
export const MAX_REVIEWS = 40;
export const SCORE_TUNE = {
  lotBonus: [0, 4, 8, 12],       // career score bonus by final lot
  lateYearsFrom: 6, lateWeight: 1.5,
  achvK: 10,                      // x achievement completion rate
  finRef: 1,                      // fin = net / (bench x 12) x finRef
  cureRef: 0.08,                  // cured / patient visits that earns the full cure score
  slipPenalty: 2,                 // care slip score = 100 - (slips per 1000 patient visits) x this
  achvFull: 0.5,                  // achievement rate that earns the full local achievement part
  resignPenalty: 34,
};
const REWARD_SCALE = [1, 2, 4, 8];
const FINAL_KEYS = new Set(['slipYear', 'resignYear', 'breakdownYear']);   // "<= n, cumulative over the year": decided at year:end
const MIN_MONTHS = 3;                                                   // months of data before year-average metrics count
const T = G.CAREER_TEXT || {};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const CORE_IDS = new Set((G.CORE_GOALS || []).map(g => g.id));
const BONUS_BY_ID = new Map((G.BONUS_GOALS || []).map(g => [g.id, g]));
const CORE_BY_ID = new Map((G.CORE_GOALS || []).map(g => [g.id, g]));
const ONB_BY_ID = new Map((G.ONBOARDING || []).map(g => [g.id, g]));

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export function defaultCareer() {
  return { startedYear: 1, onboarding: { done: {}, hidden: false }, goals: { year: 0, list: [] }, reviews: [], ending: null, endless: false,
    inited: false, counters: {}, shares: [], doneOnce: [], prevBonus: [], prevCore: '' };
}
const YEAR_KEYS = ['yrCured', 'yrSlip', 'yrResign', 'yrTrain', 'yrBreak', 'yrCommunity', 'yrDilemma', 'yrEvents', 'moraleSum', 'moraleN', 'wearSum', 'wearN'];
const BASE_KEYS = ['treat', 'elderCured', 'kidCured', 'sportsServed', 'events', 'incomeTotal', 'peakRep', 'goalsDone', 'expandTab', 'trainSum',
  'kidServed', 'fOrtho', 'fLtc', 'fPeds', 'yrYear', 'moneyStart', 'lotStart', 'repStart', 'rdStart'];

function seedCounters(state, c) {
  const k = c.counters;
  for (const key of [...YEAR_KEYS, ...BASE_KEYS]) if (typeof k[key] !== 'number' || !Number.isFinite(k[key])) k[key] = 0;
  return k;
}

function levelSum(state) { let s = 0; for (const x of state.staff || []) s += Math.max(0, (x.level || 1) - 1); return s; }

// Resets the per-year counters and builds this year's goals.
function rollYear(state, c) {
  const k = c.counters, y = state.time.year;
  for (const key of YEAR_KEYS) k[key] = 0;
  k.yrYear = y;
  k.moneyStart = Math.round(state.money);
  k.lotStart = state.lotLevel || 0;
  k.repStart = Math.round(state.reputation);
  k.rdStart = ((state.research && state.research.done) || []).length;
  k.trainSum = levelSum(state);
  const prev = (c.goals && c.goals.list) || [];
  c.prevBonus = prev.filter(g => g.kind === 'bonus').map(g => g.id);
  const prevCore = prev.find(g => g.kind === 'core');
  if (prevCore) c.prevCore = prevCore.id;
  c.goals = { year: y, list: generateGoals(state, c, y) };
}

// Fills defaults, repairs, and (first call of a run) silently marks the satisfied onboarding tasks done and builds this year's goals.
export function ensureCareer(state) {
  if (!state) return null;
  let c = state.career;
  if (c && c.inited === true && c.counters && c.goals && c.goals.year === state.time.year) return c;
  if (!c || typeof c !== 'object') c = state.career = defaultCareer();
  const d = defaultCareer();
  for (const key of Object.keys(d)) if (c[key] === undefined || (c[key] === null && key !== 'ending')) c[key] = d[key];
  if (!c.onboarding || typeof c.onboarding !== 'object') c.onboarding = d.onboarding;
  if (!c.onboarding.done || typeof c.onboarding.done !== 'object') c.onboarding.done = {};
  if (!c.goals || typeof c.goals !== 'object' || !Array.isArray(c.goals.list)) c.goals = { year: 0, list: [] };
  for (const key of ['reviews', 'shares', 'doneOnce', 'prevBonus']) if (!Array.isArray(c[key])) c[key] = [];
  if (!c.counters || typeof c.counters !== 'object') c.counters = {};
  seedCounters(state, c);
  const k = c.counters;
  const wasInited = c.inited === true;
  if (!c.inited) {
    c.inited = true;
    // an existing run: seed what history can tell us, then mark what is already true as done WITHOUT rewards
    const hist = state.history || [];
    k.treat = Math.max(k.treat, (state.stats && state.stats.patientsTotal) || 0);
    if (!k.incomeTotal) k.incomeTotal = Math.round(hist.reduce((s, h) => s + num(h.income), 0));
    k.peakRep = Math.max(k.peakRep, Math.round(state.reputation), ...hist.map(h => num(h.reputation)));
    const ac = (state.achv && state.achv.counters) || {};
    if (!k.events) k.events = Object.values(ac.dilemmasDone || {}).reduce((s, v) => s + num(v), 0);
    const done = state.time.year - 1;
    if (done > 0 && !k.fOrtho && !k.fLtc && !k.fPeds) {
      const f = (state.policy && state.policy.focus) || 'ortho';
      k[f === 'ltc' ? 'fLtc' : f === 'peds' ? 'fPeds' : 'fOrtho'] = Math.min(done, CAREER_YEARS);
    }
    for (const t of G.ONBOARDING || []) if (!c.onboarding.done[t.id] && cmpOk(metricValue(state, t.metric.key), t.metric.target, t.metric.cmp)) c.onboarding.done[t.id] = true;
    if (state.time.year > CAREER_YEARS && !c.ending) c.endless = true;
    c.startedYear = Math.max(1, Math.min(c.startedYear || 1, state.time.year));
    c.goals.year = 0;
  }
  if (c.goals.year !== state.time.year) {
    const prevY = c.goals.year;
    // the natural flow: the calendar moved on by exactly one year (after all year:end listeners ran) -> close the finished year first
    if (wasInited && prevY >= 1 && state.time.year === prevY + 1 && !c.reviews.some(r => r.year === prevY)) {
      const y = state.time.year;
      state.time.year = prevY;
      try { finalizeYear(state, c, prevY); } catch (e) { console.warn('[career] finalize', e); } finally { state.time.year = y; }
    }
    rollYear(state, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------
const hasObj = (state, id) => (state.objects || []).some(o => o.defId === id);
const countObj = (state, id) => (state.objects || []).reduce((n, o) => n + (o.defId === id ? 1 : 0), 0);
const yearHist = (state, y = state.time.year) => (state.history || []).filter(h => h && h.year === y);
const ctr = (state) => (state.career && state.career.counters) || {};   // read-only; never calls ensureCareer (it is used while ensuring)

function lastShares(state, n) {
  const s = (state.career && state.career.shares) || [];
  return s.slice(-n);
}
function monthsSettled(state) { return Math.max((state.history || []).length, 0); }
function wearAvgNow(state) {
  const ws = (state.objects || []).filter(o => isWearable(o.defId));
  return ws.length ? ws.reduce((s, o) => s + wearOf(o), 0) / ws.length : 0;
}
function moraleAvgNow(state) {
  const st = state.staff || [];
  return st.length ? st.reduce((s, x) => s + moraleOf(x), 0) / st.length : 0;
}
function trainYearNow(state) { const k = ctr(state); return k.yrTrain + Math.max(0, levelSum(state) - k.trainSum); }

const METRICS = {
  treatmentsDone: (s) => ctr(s).treat,
  // the starter clinic already has 1 sofa + 1 plant, so "a seating set" means something added: a drinking fountain, a 2nd sofa or a 2nd plant
  seatingSet: (s) => ((hasObj(s, 'sofa') && (hasObj(s, 'water') || countObj(s, 'plant') >= 2)) || countObj(s, 'sofa') >= 2 ? 1 : 0),
  antislipTiles: (s) => { let n = 0; for (const row of s.map.floor) if (row) for (const f of row) if (f === 'floor_mat') n++; return n; },
  zoneActive_golden3: (s) => ((s.zones || []).some(z => z.id === 'golden3') ? 1 : 0),
  monthsSettled: monthsSettled,
  researchStartedOrDone: (s) => ((s.research.done || []).length + (s.research.current ? 1 : 0)),
  ptCount: (s) => (s.staff || []).filter(x => x.role === 'pt').length,
  priceChanged: (s) => (Object.values((s.policy && s.policy.priceMult) || {}).some(v => typeof v === 'number' && Math.abs(v - 1) > 1e-9) ? 1 : 0),
  communityStarted: (s) => Object.values((s.achv && s.achv.counters && s.achv.counters.communityDone) || {}).reduce((a, v) => a + num(v), 0),
  expandTabOpened: (s) => (ctr(s).expandTab ? 1 : 0),

  reputation: (s) => s.reputation,
  money: (s) => s.money,
  moneyGrowthPct: (s) => { const k = ctr(s), base = Math.max(1, Math.abs(k.moneyStart)); return (s.money - k.moneyStart) / base * 100; },
  lotLevel: (s) => s.lotLevel || 0,
  netMonthlyAvgYear: (s) => { const h = yearHist(s); return h.length >= MIN_MONTHS ? h.reduce((a, x) => a + num(x.net), 0) / h.length : 0; },
  netPositiveMonthsYear: (s) => yearHist(s).filter(h => num(h.net) > 0).length,
  selfPayShare3: (s) => { const a = lastShares(s, 3); return a.length >= 3 ? Math.min(...a) : 0; },
  pvGoodMonthsYear: (s) => yearHist(s).filter(h => num(h.pointValue, 1) >= 0.9 - 1e-9).length,

  patientsYear: (s) => yearHist(s).reduce((a, h) => a + num(h.patients), 0) + num(s.stats && s.stats.patientsMonth),
  curedYear: (s) => ctr(s).yrCured,
  avgSat6: (s) => { const v = avgSatisfaction(s, 6); return v == null ? 0 : v; },
  avgSatYear: (s) => { if (yearHist(s).length < MIN_MONTHS) return 0; const v = avgSatisfaction(s, 12, s.time.year); return v == null ? 0 : v; },
  slipYear: (s) => ctr(s).yrSlip,
  reviewScore: (s) => reviewOf(s),

  resignYear: (s) => ctr(s).yrResign,
  moraleAvg: moraleAvgNow,
  trainYear: trainYearNow,

  breakdownYear: (s) => ctr(s).yrBreak,
  wearAvg: wearAvgNow,
  maintenanceActive: (s) => ((s.objects || []).some(o => isWearable(o.defId) && o.maintainedUntil > absoluteWeek(s)) ? 1 : 0),

  communityYear: (s) => ctr(s).yrCommunity,
  inspectionPassedYear: (s) => { const r = s.inspections && s.inspections.lastYearResult; return r && r.year === s.time.year && r.pass ? 1 : 0; },
  dilemmasYear: (s) => ctr(s).yrDilemma,
  riskNow: (s) => riskOf(s),

  researchDone: (s) => (s.research.done || []).length,
  researchYear: (s) => Math.max(0, (s.research.done || []).length - ctr(s).rdStart),
};

export function metricValue(state, key) {
  const f = METRICS[key];
  if (!f) return 0;
  try { const v = f(state); return Number.isFinite(v) ? v : 0; } catch (e) { return 0; }
}
function cmpOk(v, target, cmp) { return cmp === 'lte' ? v <= target + 1e-9 : v >= target - 1e-9; }
function condTarget(cond, lot) {
  if (Array.isArray(cond.targetByLot)) { const v = cond.targetByLot[clamp(lot | 0, 0, cond.targetByLot.length - 1)]; if (typeof v === 'number') return v; }
  return cond.target;
}
function condPct(v, target, cmp) {
  if (cmp === 'lte') { if (v <= target + 1e-9) return 1; return target > 0 ? clamp(target / v, 0, 1) : 0; }
  return target <= 0 ? 1 : clamp(v / target, 0, 1);
}
const isFinalCond = (cond) => cond.cmp === 'lte' && FINAL_KEYS.has(cond.key);
function metricLabel(key) { return (G.GOAL_METRICS[key] && G.GOAL_METRICS[key].label) || key; }

function evalConds(state, conds, lot, finalPhase) {
  return (conds || []).map(cond => {
    const value = metricValue(state, cond.key), target = condTarget(cond, lot);
    let ok = cmpOk(value, target, cond.cmp);
    if (ok && isFinalCond(cond) && !finalPhase) ok = false;
    return { key: cond.key, label: metricLabel(cond.key), value, target, cmp: cond.cmp || 'gte', ok, pct: ok ? 1 : condPct(value, target, cond.cmp) };
  });
}

// ---------------------------------------------------------------------------
// goal definitions / generation
// ---------------------------------------------------------------------------
function defOf(entry) {
  if (entry.kind === 'core') {
    const d = CORE_BY_ID.get(entry.id);
    if (!d) return null;
    const v = entry.vi >= 0 && d.variants ? d.variants[entry.vi] : null;
    return { kind: 'core', id: d.id, name: (v && v.name) || d.name, desc: (v && v.desc) || d.desc, conds: (v && v.conds) || d.conds, altConds: d.altConds || null, reward: d.reward, scale: d.rewardScale !== false };
  }
  const d = BONUS_BY_ID.get(entry.id);
  if (!d) return null;
  return { kind: 'bonus', id: d.id, name: d.name, desc: d.desc, conds: d.conds, altConds: null, reward: d.reward, scale: true, group: d.group };
}

function rngFor(state, year, salt) {
  let s = ((state.seed | 0) ^ Math.imul(year + 1, 2654435761) ^ (salt | 0)) >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function trivialNow(state, d, lot) {
  if (d.conds.some(isFinalCond)) return false;
  return evalConds(state, d.conds, lot, false).every(x => x.ok) || (d.altConds && evalConds(state, d.altConds, lot, false).every(x => x.ok));
}

function bonusEligible(state, c, def, year, lot) {
  const cd = def.cond || {};
  if (cd.minYear != null && year < cd.minYear) return false;
  if (cd.maxYear != null && year > cd.maxYear) return false;
  if (cd.minLot != null && lot < cd.minLot) return false;
  if (cd.maxLot != null && lot > cd.maxLot) return false;
  if (cd.needResearch && !(state.research.done || []).includes(cd.needResearch)) return false;
  if (cd.needObjects && !cd.needObjects.every(id => hasObj(state, id))) return false;
  if (cd.notIfDone && c.doneOnce.includes(def.id)) return false;
  const keys = def.conds.map(x => x.key);
  const wearables = (state.objects || []).some(o => isWearable(o.defId));
  if (keys.some(k => ['breakdownYear', 'wearAvg', 'maintenanceActive'].includes(k)) && !wearables) return false;
  if (keys.some(k => ['moraleAvg', 'trainYear', 'resignYear'].includes(k)) && !(state.staff || []).length) return false;
  if (trivialNow(state, { conds: def.conds, altConds: null }, lot)) return false;
  return true;
}

function generateGoals(state, c, year) {
  const lot = state.lotLevel || 0;
  const list = [];
  // ---- core ----
  let core = null;
  if (year <= CAREER_YEARS) core = CORE_BY_ID.size ? (G.CORE_GOALS || []).find(g => g.year === year) : null;
  else {
    const rnd = rngFor(state, year, 0xC0DE);
    const pool = (G.CORE_GOALS || []).filter(g => g.id !== c.prevCore);
    const ok = pool.filter(g => !trivialNow(state, { conds: pickVariant(g, lot).conds || g.conds, altConds: g.altConds || null }, lot));
    const from = ok.length ? ok : pool;
    core = from.length ? from[Math.floor(rnd() * from.length)] : null;
  }
  if (core) {
    const v = core.variants ? core.variants.findIndex(x => (x.lots || []).includes(lot)) : -1;
    list.push({ id: core.id, kind: 'core', progress: 0, target: 0, done: false, claimed: false, lot, vi: v });
  }
  // ---- bonus ----
  const rnd = rngFor(state, year, 0xB0B5);
  const base = (G.BONUS_GOALS || []).filter(b => bonusEligible(state, c, b, year, lot));
  let pool = base.filter(b => !c.prevBonus.includes(b.id));
  if (pool.length < 2) pool = base;
  const picked = [];
  for (let n = 0; n < 2 && pool.length; n++) {
    let cand = pool.filter(b => !picked.some(p => p.id === b.id));
    const other = cand.filter(b => !picked.some(p => p.group === b.group));
    if (other.length) cand = other;
    if (!cand.length) break;
    const tot = cand.reduce((s, b) => s + Math.max(0.1, num(b.weight, 1)), 0);
    let r = rnd() * tot, ch = cand[cand.length - 1];
    for (const b of cand) { r -= Math.max(0.1, num(b.weight, 1)); if (r <= 0) { ch = b; break; } }
    picked.push(ch);
    list.push({ id: ch.id, kind: 'bonus', progress: 0, target: 0, done: false, claimed: false, lot, vi: -1 });
  }
  for (const e of list) refreshProgress(state, e);
  return list;
}
function pickVariant(g, lot) { return (g.variants && g.variants.find(x => (x.lots || []).includes(lot))) || g; }

function refreshProgress(state, e) {
  const d = defOf(e);
  if (!d) return;
  const first = d.conds[0];
  if (!first) return;
  e.progress = Math.round(metricValue(state, first.key) * 100) / 100;
  e.target = condTarget(first, e.lot);
}

// ---------------------------------------------------------------------------
// rewards
// ---------------------------------------------------------------------------
const POINT_NAMES = (T.pointNames) || { medical: '醫術', device: '儀器', service: '服務' };
function scaledReward(state, reward, scale) {
  const f = scale ? REWARD_SCALE[clamp(state.lotLevel || 0, 0, 3)] : 1;
  const r = reward || {};
  const points = {};
  for (const k of Object.keys(r.points || {})) if (num(r.points[k]) > 0) points[k] = r.points[k];
  return { money: Math.round(num(r.money) * f), reputation: num(r.reputation), points };
}
function rewardTextOf(r) {
  const parts = [];
  if (r.money > 0) parts.push((T.rewardMoney || 'NT$ {amount}').replace('{amount}', Math.round(r.money).toLocaleString('en-US')));
  for (const k of Object.keys(r.points)) parts.push((T.rewardPoints || '{point} +{amount}').replace('{point}', POINT_NAMES[k] || k).replace('{amount}', r.points[k]));
  if (r.reputation > 0) parts.push((T.rewardReputation || '聲譽 +{amount}').replace('{amount}', r.reputation));
  return parts.join('、');
}
function payReward(state, r) {
  if (r.money > 0) earn(state, r.money, 'other');
  for (const k of Object.keys(r.points)) state.points[k] = (state.points[k] || 0) + r.points[k];
  if (r.reputation) state.reputation = clamp(state.reputation + r.reputation, 0, 1000);
}

// ---------------------------------------------------------------------------
// onboarding
// ---------------------------------------------------------------------------
export function onboardingList(state) {
  const c = ensureCareer(state);
  return (G.ONBOARDING || []).map(t => {
    const v = metricValue(state, t.metric.key), done = !!c.onboarding.done[t.id];
    const rw = scaledReward(state, t.reward, false);
    return { id: t.id, name: t.name, desc: t.desc, hint: t.hint, done, progress: done ? t.metric.target : Math.min(t.metric.target, v), target: t.metric.target, reward: t.reward, rewardText: rewardTextOf(rw) };
  });
}

function tickOnboarding(state, c) {
  let changed = false;
  for (const t of G.ONBOARDING || []) {
    if (c.onboarding.done[t.id]) continue;
    if (!cmpOk(metricValue(state, t.metric.key), t.metric.target, t.metric.cmp)) continue;
    c.onboarding.done[t.id] = true;
    const rw = scaledReward(state, t.reward, false);
    payReward(state, rw);
    const rewardText = rewardTextOf(rw);
    bus.emit('toast', { text: (T.toastOnboardingDone || '✅ 新手任務完成：{name}　{reward}').replace('{name}', t.name).replace('{reward}', rewardText), kind: 'good' });
    bus.emit('career:onboarding-done', { task: onboardingList(state).find(x => x.id === t.id), rewardText });
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// goals: progress / completion
// ---------------------------------------------------------------------------
function entryStatus(state, e, finalPhase) {
  const d = defOf(e);
  if (!d) return null;
  const main = evalConds(state, d.conds, e.lot, finalPhase);
  const alt = d.altConds ? evalConds(state, d.altConds, e.lot, finalPhase) : null;
  const okMain = main.every(x => x.ok), okAlt = !!alt && alt.every(x => x.ok);
  return { d, main, alt, done: okMain || okAlt };
}

function viewGoal(state, e) {
  const st = entryStatus(state, e, true);   // display: a year-end-only condition shows as met while it is currently on track
  if (!st) return null;
  const { d } = st;
  const rw = scaledReward(state, d.reward, d.scale);
  const conds = st.main.map(x => ({ key: x.key, label: x.label, value: x.value, target: x.target, cmp: x.cmp, ok: e.done || x.ok }));
  if (st.alt) for (const x of st.alt) conds.push({ key: x.key, label: '或 ' + x.label, value: x.value, target: x.target, cmp: x.cmp, ok: e.done || x.ok });
  const pm = st.main.reduce((s, x) => s + x.pct, 0) / Math.max(1, st.main.length);
  const pa = st.alt ? st.alt.reduce((s, x) => s + x.pct, 0) / Math.max(1, st.alt.length) : 0;
  const pct = e.done ? 1 : clamp(Math.max(pm, pa), 0, 1);
  const first = st.main[0];
  return { id: e.id, kind: e.kind, name: d.name, desc: d.desc, progress: first ? first.value : 0, target: first ? first.target : 0, pct, done: !!e.done, claimed: !!e.claimed,
    rewardText: rewardTextOf(rw), conds, group: d.group || null };
}

export function currentGoals(state) {
  const c = ensureCareer(state);
  return c.goals.list.map(e => viewGoal(state, e)).filter(Boolean);
}

function claim(state, c, e) {
  const d = defOf(e);
  if (!d || e.claimed) return false;
  e.done = true; e.claimed = true;
  const rw = scaledReward(state, d.reward, d.scale);
  payReward(state, rw);
  refreshProgress(state, e);
  c.counters.goalsDone = (c.counters.goalsDone || 0) + 1;
  if (e.kind === 'bonus' && !c.doneOnce.includes(e.id)) c.doneOnce.push(e.id);
  const rewardText = rewardTextOf(rw);
  bus.emit('toast', { text: (T.toastGoalDone || '🎯 目標達成：{name}　{reward}').replace('{name}', d.name).replace('{reward}', rewardText), kind: 'good' });
  bus.emit('career:goal-done', { goal: viewGoal(state, e), rewardText });
  return true;
}

function tickGoals(state, c, finalPhase) {
  let changed = false;
  for (const e of c.goals.list) {
    if (e.done) continue;
    const st = entryStatus(state, e, finalPhase);
    if (!st) continue;
    if (st.done) { if (claim(state, c, e)) changed = true; }
    else refreshProgress(state, e);
  }
  return changed;
}

function tick(state, finalPhase = false) {
  const c = ensureCareer(state);
  let ch = tickOnboarding(state, c);
  if (tickGoals(state, c, finalPhase)) ch = true;
  if (ch) bus.emit('career:changed', {});
  return ch;
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------
export function gradeOf(total) {
  for (const g of G.GRADES) if (total >= g.min) return g.grade;
  return 'D';
}
const benchLot = (l) => (G.DIM_BENCH.monthlyNetByLot[clamp(l | 0, 0, 3)]);
function repTarget(year) { const cv = G.DIM_BENCH.repCurve; return cv[Math.min(year, CAREER_YEARS)] || cv[CAREER_YEARS] || 700; }

function yearRaw(state, year) {
  const c = state.career || {}, k = c.counters || {};
  const live = k.yrYear === year;
  const hist = yearHist(state, year);
  const wd = state.inspections && state.inspections.lastYearResult;
  return {
    live, hist,
    net: hist.reduce((s, h) => s + num(h.net), 0), income: hist.reduce((s, h) => s + num(h.income), 0), expense: hist.reduce((s, h) => s + num(h.expense), 0),
    patients: hist.reduce((s, h) => s + num(h.patients), 0),
    cured: live ? num(k.yrCured) : 0, slip: live ? num(k.yrSlip) : 0, resign: live ? num(k.yrResign) : 0, brk: live ? num(k.yrBreak) : 0,
    train: live ? num(k.yrTrain) : 0, community: live ? num(k.yrCommunity) : 0, dilemma: live ? num(k.yrDilemma) : 0, events: live ? num(k.yrEvents) : 0,
    morale: live && k.moraleN > 0 ? k.moraleSum / k.moraleN : moraleAvgNow(state),
    wear: live && k.wearN > 0 ? k.wearSum / k.wearN : wearAvgNow(state),
    lotStart: live ? num(k.lotStart) : (state.lotLevel || 0),
    insp: wd && wd.year === year ? wd : null,
  };
}

export function computeYearScore(state, year) {
  year = year == null ? state.time.year : year;
  const rv = (state.career && state.career.reviews || []).find(r => r.year === year);
  if (rv && (!state.career.counters || state.career.counters.yrYear !== year)) return { dims: { ...rv.dims }, total: rv.score, grade: rv.grade };
  const r = yearRaw(state, year);
  const bench = (benchLot(r.lotStart) + benchLot(state.lotLevel)) / 2 * 12;
  const fin = clamp(r.net / bench * 100 * SCORE_TUNE.finRef, 0, 100);
  const rep = clamp(state.reputation / repTarget(year) * 100, 0, 100);
  const sat = avgSatisfaction(state, 12, year);
  const satScore = clamp((sat == null ? 0 : sat) / G.DIM_BENCH.satFull * 100, 0, 100);
  const cureScore = r.patients > 0 ? clamp(r.cured / r.patients / SCORE_TUNE.cureRef * 100, 0, 100) : 0;
  const slipScore = clamp(100 - (r.patients > 0 ? r.slip / r.patients * 1000 : 0) * SCORE_TUNE.slipPenalty, 0, 100);
  const care = 0.6 * satScore + 0.25 * cureScore + 0.15 * slipScore;
  const retention = clamp(100 - r.resign * SCORE_TUNE.resignPenalty, 0, 100);
  const equip = clamp(100 - r.wear - Math.min(40, r.brk * 10), 0, 100);
  const team = (state.staff || []).length ? 0.5 * clamp(r.morale, 0, 100) + 0.25 * retention + 0.25 * equip : 0;
  let insp = 0;
  if (r.insp) insp = r.insp.pass ? 40 + clamp(((r.insp.score || 0) - 70) / 30, 0, 1) * 20 : clamp((r.insp.score || 0) / 70, 0, 1) * 30;
  const rate = totalCount() ? unlockedCount(state) / totalCount() : 0;
  const local = clamp(Math.min(50, insp) + clamp(r.community / 4, 0, 1) * 30 + clamp(rate / SCORE_TUNE.achvFull, 0, 1) * 20, 0, 100);
  const dims = { fin: rnd1(fin), rep: rnd1(rep), care: rnd1(care), team: rnd1(team), local: rnd1(local) };
  const raw = (fin + rep + care + team + local) / 5;
  return { dims, total: rnd1(raw), grade: gradeOf(raw) };
}
const rnd1 = (v) => Math.round(v * 10) / 10;

export function yearReviews(state) { return ensureCareer(state).reviews; }

function weightOfYear(y) { return y >= SCORE_TUNE.lateYearsFrom ? SCORE_TUNE.lateWeight : 1; }
export function careerScore(state) {
  const c = ensureCareer(state);
  const rv = c.reviews.filter(r => r.year >= 1 && r.year <= CAREER_YEARS);
  let sw = 0, s = 0;
  for (const r of rv) { const w = weightOfYear(r.year); sw += w; s += w * r.score; }
  const avg = sw ? s / sw : 0;
  const rate = totalCount() ? unlockedCount(state) / totalCount() : 0;
  return rnd1(avg + SCORE_TUNE.lotBonus[clamp(state.lotLevel || 0, 0, 3)] + rate * SCORE_TUNE.achvK);
}

function strongestWeakest(dims) {
  const ks = Object.keys(dims);
  let hi = ks[0], lo = ks[0];
  for (const k of ks) { if (dims[k] > dims[hi]) hi = k; if (dims[k] < dims[lo]) lo = k; }
  return { hi, lo };
}

function buildReview(state, c, year) {
  const sc = computeYearScore(state, year);
  const r = yearRaw(state, year);
  const { hi, lo } = strongestWeakest(sc.dims);
  const idx = Math.abs((state.seed | 0) + year * 31) % 2;
  const gl = ((G.GRADE_LINES[sc.grade] || {})[hi]) || [];
  const wl = (G.WEAKEST_LINES[lo]) || [];
  const goals = c.goals.year === year ? c.goals.list.map(e => { const d = defOf(e); return d ? { id: e.id, name: d.name, done: !!e.done } : null; }).filter(Boolean) : [];
  const k = c.counters;
  const prevRep = k.repStart || 0, prevMoney = k.moneyStart || 0;
  const review = {
    year, grade: sc.grade, score: sc.total, dims: sc.dims,
    stats: {
      income: r.income, expense: r.expense, net: r.net, patients: r.patients, cured: r.cured, reputation: Math.round(state.reputation), repDelta: Math.round(state.reputation) - prevRep,
      money: Math.round(state.money), moneyDelta: Math.round(state.money) - prevMoney, lot: state.lotLevel || 0, expanded: (state.lotLevel || 0) > (k.lotStart || 0) ? 1 : 0,
      events: r.events, community: r.community, dilemmas: r.dilemma, research: Math.max(0, ((state.research.done || []).length) - num(k.rdStart)),
      slip: r.slip, resign: r.resign, breakdown: r.brk, train: r.train, morale: rnd1(r.morale),
      inspectionPass: r.insp ? (r.insp.pass ? 1 : 0) : 0, inspectionScore: r.insp ? num(r.insp.score) : 0,
    },
    goals, line: gl[idx % Math.max(1, gl.length)] || '', weakLine: wl[idx % Math.max(1, wl.length)] || '', strongest: hi, weakest: lo,
  };
  const jl = G.JOURNAL && G.JOURNAL[year];
  if (jl && jl.length) review.journal = jl[Math.abs((state.seed | 0) + year) % jl.length];
  return review;
}

// ---------------------------------------------------------------------------
// ending
// ---------------------------------------------------------------------------
function statsFor(state, c) {
  const k = c.counters;
  let top = null, topN = 0;
  for (const key of Object.keys(k)) if (key.startsWith('tx_') && k[key] > topN) { topN = k[key]; top = key.slice(3); }
  const lot = state.lotLevel || 0;
  return {
    totalIncome: Math.round(k.incomeTotal || 0), totalPatients: Math.round((state.stats && state.stats.patientsTotal) || 0), totalCured: Math.round((state.stats && state.stats.cured) || 0),
    eventsHandled: Math.round(k.events || 0), achievementsDone: unlockedCount(state), peakReputation: Math.round(Math.max(k.peakRep || 0, state.reputation)),
    finalLot: (LOTS[lot] || LOTS[0]).name, finalLotLevel: lot,
    topTreatment: top && TREATMENTS[top] ? TREATMENTS[top].name : (T.noTreatment || ''), topTreatmentId: top || null,
  };
}

// kids need 8-16 visits to be cured and (in the current sim) practically never finish, so a course is also credited per 8 treated visits
const kidCourses = (k) => (k.kidCured || 0) + Math.floor((k.kidServed || 0) / 8);
function selfShare12(c) { const a = (c.shares || []).slice(-12); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function sp40Run(c, months) { const a = c.shares || []; if (a.length < months) return false; return a.slice(-months).every(v => v >= 0.4 - 1e-9); }

function endingMatches(state, c, e, score) {
  const p = e.params || {}, k = c.counters;
  const lot = state.lotLevel || 0;
  switch (e.id) {
    case 'legend_center': return lot >= p.minLot && score >= p.minScore && state.reputation >= p.minRep;
    case 'ltc_guardian': return (k.fLtc || 0) >= p.focusYears && (k.elderCured || 0) >= p.minElderCured && metricValue(state, 'avgSat6') >= p.minSat;
    case 'sports_doctor': return (k.fOrtho || 0) >= p.focusYears && selfShare12(c) >= p.minSelfPayShare && (k.sportsServed || 0) >= p.minSportsServed;
    case 'peds_pioneer': return (k.fPeds || 0) >= p.focusYears && kidCourses(k) >= p.minKidCured && (p.needObjects || []).every(id => hasObj(state, id));
    case 'selfpay_brand': return sp40Run(c, p.months || 24) && (p.needResearch || []).every(id => (state.research.done || []).includes(id));
    case 'steady_clinic': case 'struggling_shop': return score >= (p.minScore || 0);
    default: return true;
  }
}

export function computeEnding(state, opts = {}) {
  const c = ensureCareer(state);
  const score = careerScore(state);
  const list = (G.ENDINGS || []).slice().sort((a, b) => a.order - b.order);
  let e = null;
  if (opts.bankrupt) e = list.find(x => x.id === 'bankrupt');
  else e = list.find(x => x.id !== 'bankrupt' && endingMatches(state, c, x, score)) || list.find(x => x.id === 'retire_handover');
  if (!e) e = list[list.length - 1];
  return { id: e.id, title: e.title, emoji: e.emoji, desc: e.desc, thanks: e.thanks.slice(), thanksText: e.thanks.join('\n'), stats: statsFor(state, c), score, grade: gradeOf(score), achievementId: e.achievementId };
}

function setEnding(state, c, ending) {
  c.ending = { id: ending.id, score: ending.score, year: state.time.year, at: state.time.year * 12 + state.time.month };
  bus.emit('career:ending', { ending });
  bus.emit('career:changed', {});
}

export function careerSummary(state) {
  const c = ensureCareer(state);
  const y = state.time.year;
  const rv = c.reviews;
  const avg = rv.length ? rv.reduce((s, r) => s + r.score, 0) / rv.length : null;
  let projected = null;
  if (rv.length) { try { const e = computeEnding(state, { bankrupt: false }); projected = { id: e.id, title: e.title, emoji: e.emoji }; } catch (err) { projected = null; } }
  let ending = null;
  if (c.ending) { const d = (G.ENDINGS || []).find(x => x.id === c.ending.id); ending = { ...c.ending, title: d ? d.title : '', emoji: d ? d.emoji : '' }; }
  return { year: y, yearsLeft: Math.max(0, CAREER_YEARS - y + 1), endless: !!c.endless, ending, scoreSoFar: careerScore(state), projected, avgGrade: avg == null ? null : gradeOf(avg) };
}

export function setEndless(state, on) {
  const c = ensureCareer(state);
  c.endless = !!on;
  bus.emit('career:changed', {});
}

export function markExpandTabOpened(state) {
  const c = ensureCareer(state);
  if (c.counters.expandTab) return;
  c.counters.expandTab = 1;
  tick(state);
}

export function careerCardText(state) {
  const c = ensureCareer(state);
  const ct = T.cardTemplate || {};
  const sm = careerSummary(state);
  const lines = [ct.header || '🏥 院長生涯卡'];
  let title = '';
  try { title = displayTitle(state); } catch (e) { title = ''; }
  lines.push(`院長稱號：${title || '—'}`);
  let en = null;
  if (c.ending) en = (G.ENDINGS || []).find(x => x.id === c.ending.id);
  const endText = en ? `${en.emoji} ${en.title}` : (sm.projected ? (T.estimateEnding || '估算生涯結局：{ending}（僅供參考）').replace('{ending}', `${sm.projected.emoji} ${sm.projected.title}`) : '經營中');
  lines.push((ct.ending || '結局：{ending}').replace('{ending}', endText));
  const s = statsFor(state, c);
  const score = c.ending ? c.ending.score : sm.scoreSoFar;
  lines.push(`等級：${c.ending ? gradeOf(score) : (sm.avgGrade || '—')}（第 ${state.time.year} 年）`);
  lines.push((ct.lot || '店面：{lot}').replace('{lot}', s.finalLot));
  lines.push((ct.score || '生涯總分：{score}').replace('{score}', score));
  lines.push((ct.income || '十年營收：NT$ {income}').replace('{income}', s.totalIncome.toLocaleString('en-US')));
  lines.push((ct.patients || '服務病患：{patients} 人次').replace('{patients}', s.totalPatients.toLocaleString('en-US')));
  lines.push((ct.cured || '治癒：{cured} 人').replace('{cured}', s.totalCured.toLocaleString('en-US')));
  lines.push((ct.events || '處理事件：{events} 件').replace('{events}', s.eventsHandled));
  lines.push((ct.achievements || '達成成就：{achievements} 個').replace('{achievements}', s.achievementsDone));
  lines.push((ct.peakRep || '最高聲譽：{rep}').replace('{rep}', s.peakReputation));
  lines.push((ct.topTreatment || '最常用療法：{treatment}').replace('{treatment}', s.topTreatment));
  const grades = c.reviews.slice(-10).map(r => `${r.year}:${r.grade}`).join(' ');
  if (grades) lines.push('年度等級：' + grades);
  lines.push(ct.footer || '—— 復健診所院長的十年');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// event wiring
// ---------------------------------------------------------------------------
function pollTrain(state, c) {
  const k = c.counters, sum = levelSum(state);
  if (sum > k.trainSum) k.yrTrain += sum - k.trainSum;
  k.trainSum = sum;
}

function sampleMonth(state, c) {
  const k = c.counters;
  if ((state.staff || []).length) { k.moraleSum += moraleAvgNow(state); k.moraleN++; }
  if ((state.objects || []).some(o => isWearable(o.defId))) { k.wearSum += wearAvgNow(state); k.wearN++; }
}

function finalizeYear(state, c, year) {
  pollTrain(state, c);
  tick(state, true);                       // year-end only goals (zero slips / resignations / breakdowns) latch here
  const k = c.counters;
  const f = (state.policy && state.policy.focus) || 'ortho';
  const fk = f === 'ltc' ? 'fLtc' : f === 'peds' ? 'fPeds' : 'fOrtho';
  k[fk] = (k[fk] || 0) + 1;
  k.peakRep = Math.max(k.peakRep || 0, Math.round(state.reputation));
  const review = buildReview(state, c, year);
  const i = c.reviews.findIndex(r => r.year === year);
  if (i >= 0) c.reviews[i] = review; else c.reviews.push(review);
  c.reviews.sort((a, b) => a.year - b.year);
  if (c.reviews.length > MAX_REVIEWS) c.reviews.splice(0, c.reviews.length - MAX_REVIEWS);
  if (!(state.flags && state.flags.gameOver)) bus.emit('career:year-review', { review });
  if (year >= CAREER_YEARS && !c.ending && !c.endless && !(state.flags && state.flags.gameOver)) setEnding(state, c, computeEnding(state, { bankrupt: false }));
  bus.emit('career:changed', {});
}

let unsub = [];
export function initCareer() {
  unsub.forEach(f => f());
  const S = () => singleton;
  const on = (evt, fn) => bus.on(evt, (p) => {
    const st = S();
    try { const c = ensureCareer(st); fn(st, c, p || {}); } catch (e) { console.warn('[career]', evt, e); }
  });
  unsub = [
    on('treatment:done', (s, c, p) => {
      const k = c.counters;
      k.treat++;
      if (p.treatmentId) { const key = 'tx_' + p.treatmentId; k[key] = (k[key] || 0) + 1; }
      if (k.treat === 1) tick(s);
    }),
    on('patient:left', (s, c, p) => {
      const k = c.counters, pat = p.patient || {};
      if (p.cured || pat.cured) {
        k.yrCured++;
        if (pat.type === 'elder') k.elderCured++;
        if (pat.type === 'kid') k.kidCured++;
      }
      if ((pat.treated || 0) > 0 && pat.type === 'sports') k.sportsServed++;
      if ((pat.treated || 0) > 0 && pat.type === 'kid') k.kidServed++;
    }),
    on('patient:slip', (s, c) => { c.counters.yrSlip++; }),
    on('staff:resigned', (s, c) => { c.counters.yrResign++; }),
    on('equipment:broken', (s, c) => { c.counters.yrBreak++; }),
    on('community:started', (s, c) => { c.counters.yrCommunity++; tick(s); }),
    on('dilemma:resolved', (s, c, p) => { c.counters.events++; c.counters.yrEvents++; if (p.kind === 'dilemma') c.counters.yrDilemma++; }),
    on('research:done', (s) => { tick(s); }),
    on('lot:expanded', (s) => { tick(s); }),
    on('map:changed', (s) => { tick(s); }),
    on('inspection:result', (s) => { tick(s); }),
    on('week:end', (s, c) => {
      pollTrain(s, c);
      c.counters.peakRep = Math.max(c.counters.peakRep || 0, Math.round(s.reputation));
      tick(s);
    }),
    on('nhi:settled', (s, c, rec) => {
      const k = c.counters;
      const base = num(rec.nhiIncome) + num(rec.selfIncome) + num(rec.copayIncome);
      c.shares.push(base > 0 ? Math.round(clamp(num(rec.selfIncome) / base, 0, 1) * 1000) / 1000 : 0);
      if (c.shares.length > 24) c.shares.splice(0, c.shares.length - 24);
      k.incomeTotal += Math.max(0, Math.round(num(rec.income)));
      pollTrain(s, c);
      sampleMonth(s, c);
      tick(s);
    }),
    on('year:end', () => { /* the review is built on the following year:start (see below) so that it always comes after inspection.js */ }),
    on('state:loaded', () => {}),
    // year:start (emitted by calendar.js after every year:end listener, inspection included) -> ensureCareer closes the finished year
    // (review / ending) and rolls the goals. Whoever touches the career first after the year turned does the same through ensureCareer.
    bus.on('year:start', () => {
      const st = S();
      try { ensureCareer(st); bus.emit('career:changed', {}); } catch (e) { console.warn('[career] year:start', e); }
    }),
    on('game:over', (s, c) => {
      if (c.ending) return;
      setEnding(s, c, computeEnding(s, { bankrupt: true }));
    }),
  ];
}

// Removes the bus listeners (tools / tests). initCareer() is idempotent; the game never calls this.
export function stopCareer() { unsub.forEach(f => f()); unsub = []; }
