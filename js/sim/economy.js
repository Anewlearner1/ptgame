// Economy: NHI points & dilution, ledger, monthly settlement, bankruptcy.
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { LOTS } from '../data/lots.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';
import { NHI_POINT_VALUE, TREATMENT_FEES, COPAY_NTD, examFeePoints } from '../data/fees.js';

// ---- tuning constants ----
// REAL NUMBERS live in data/fees.js (point value, exam tiers, PT tiers, self-pay prices, copay). The knobs below are ABSTRACTION only.
export const PV_MIN = NHI_POINT_VALUE.min;          // floor of the diluted point value (game rule, 0.6)
export const PV_BASE = NHI_POINT_VALUE.typical;     // undiluted NT$ per NHI point (real: ~0.95)
export const PV_MAX = PV_BASE;                      // legacy alias
// PATIENT_WEIGHT: each simulated patient stands for PATIENT_WEIGHT real patients. It multiplies ALL patient-generated revenue the same way:
//   NHI income = points * pointValue * PATIENT_WEIGHT, self-pay = real price * priceMult * mods * PATIENT_WEIGHT, copay = 50 * PATIENT_WEIGHT.
// Salaries / rent / build costs / event money / inspection rewards are plain NT$ (never multiplied). Balance knob (docs/ARCHITECTURE.md §2).
export const PATIENT_WEIGHT = 15;
export const BANKRUPT_LIMIT = -300000;      // money below this at month end -> game over
export const DEFAULT_UPKEEP = 0;            // object upkeep when def.upkeep is missing
export const HISTORY_MAX = 240;             // months of history kept
export const LEDGER_INCOME_KEYS = ['nhi', 'self', 'copay', 'other'];
export const LEDGER_EXPENSE_KEYS = ['salary', 'rent', 'build', 'maintain', 'other'];

// M3 (健保審查風險, state.nhi.risk 0..100) and M7 (網路評價, state.reviewScore 1..5): docs/EVENTS_EXT.md §6.
export const RISK_TUNE = {
  MAX: 100, WEEK_DECAY: 1,          // natural decay per week
  OVER_START: 0.9, OVER_K: 40,      // month points / cap above this ratio: +OVER_K per 1.0 of ratio
  GROWTH_FREE: 0.25, GROWTH_K: 12,  // month-on-month growth above 25%: +K per 1.0
  COMPLEX_PTS: 300, COMPLEX_FREE: 0.4, COMPLEX_K: 10,   // share of complex (>= COMPLEX_PTS) NHI treatments above 40%
  MONTH_CAP: 15,                    // max risk added by one settlement
  HIGH: 60,                         // above this nhi-category audit events weigh x2 (events.js)
};
export const REVIEW_TUNE = {
  START: 4.0, MIN: 1.0, MAX: 5.0,
  UP_SAT: 70, UP: 0.05, DOWN_SAT: 45, DOWN: 0.1,   // monthly drift by average satisfaction
  ARRIVAL_K: 0.1,                   // arrivals x (1 + (score - 4) * K)  ->  every 0.1 of score = 1%
};

let unsub = [];

export function lotDef(state) { return LOTS[state.lotLevel || 0] || LOTS[0]; }

function ensureLedger(state) {
  if (!state.ledger) state.ledger = { income: {}, expense: {} };
  for (const k of LEDGER_INCOME_KEYS) if (typeof state.ledger.income[k] !== 'number') state.ledger.income[k] = 0;
  for (const k of LEDGER_EXPENSE_KEYS) if (typeof state.ledger.expense[k] !== 'number') state.ledger.expense[k] = 0;
  return state.ledger;
}

export function initEconomy() {
  unsub.forEach(f => f());
  unsub = [
    bus.on('treatment:done', (e) => onTreatmentDone(singleton, e)),
    bus.on('week:end', () => onWeekEnd(singleton)),
    bus.on('month:end', () => settleMonth(singleton)),
  ];
}

// ---- money primitives ----
export function spend(state, amount, category = 'other') {
  if (!Number.isFinite(amount)) return false;     // NaN / Infinity would poison state.money
  amount = Math.max(0, Math.round(amount));
  if (state.money < amount) return false;
  const l = ensureLedger(state);
  const k = LEDGER_EXPENSE_KEYS.includes(category) ? category : 'other';
  state.money -= amount;
  l.expense[k] += amount;
  return true;
}

export function earn(state, amount, category = 'other') {
  amount = Math.round(amount);
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  const l = ensureLedger(state);
  const k = LEDGER_INCOME_KEYS.includes(category) ? category : 'other';
  state.money += amount;
  l.income[k] += amount;
}

// Unconditional expense (salary/rent may push money negative).
function charge(state, amount, category) {
  amount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  const l = ensureLedger(state);
  state.money -= amount;
  l.expense[category] += amount;
}

// ---- NHI ----
export function nhiCap(state) {
  const mods = state.mods || {};
  return (lotDef(state).nhiCap || 0) * (1 + (mods.nhiCapBonus || 0));
}

// NT$/point for the current month so far: PV_BASE (real ~0.95) under the cap, diluted above: clamp(cap / points, PV_MIN, PV_BASE).
export function getPointValue(state) {
  const pts = (state.nhi && state.nhi.monthPoints) || 0;
  const cap = nhiCap(state);
  if (pts <= cap || pts <= 0) return PV_BASE;
  return Math.max(PV_MIN, Math.min(PV_BASE, cap / pts));
}

// NT$ the NHI points banked so far this month are worth at the current (diluted) point value, weighted. UI may show this.
export function projectedNhiIncome(state) {
  return Math.round(((state.nhi && state.nhi.monthPoints) || 0) * getPointValue(state) * PATIENT_WEIGHT);
}

// ---- NHI claim rules (real, docs/FEE_RESEARCH.md) ----
// Daily exam fee (診察費) by how many patients the clinic served that day: the patient being examined is number patientsToday + 1.
export function examFeeNow(state) {
  return examFeePoints((((state && state.stats && state.stats.patientsToday) || 0) + 1));
}
// Listed NHI points of a treatment right now (exam depends on the day's volume).
export function listedPoints(state, treatmentId) {
  const f = TREATMENT_FEES[treatmentId];
  if (!f || f.kind !== 'nhi') return 0;
  return treatmentId === 'exam' ? examFeeNow(state) : f.nhiPoints;
}
// Single-claim rule: per patient per visit each claim group ('exam' | 'pt' | 'ot' | 'st' | 'us') is paid once, at its HIGHEST listed value.
// `claims` is the patient's running {group: pointsPaidSoFar} for this visit (mutated). Treatments run in sequence, so a later, higher
// item pays only the difference: the visit's total for a group is always its highest listed item. Returns {listed, paid, group}.
export function nhiClaim(state, claims, treatmentId) {
  const f = TREATMENT_FEES[treatmentId];
  const listed = listedPoints(state, treatmentId);
  if (!f || f.kind !== 'nhi' || !(listed > 0)) return { listed: 0, paid: 0, group: null };
  const g = f.claim || treatmentId;
  const had = Number(claims && claims[g]) || 0;
  const paid = Math.max(0, listed - had);
  if (claims) claims[g] = Math.max(had, listed);
  return { listed, paid, group: g };
}
// Copay for a visit: flat COPAY_NTD for a returning visit (visit >= 1), 0 for the first. Real NT$, before PATIENT_WEIGHT.
export function copayFor(visit) { return (Number(visit) || 0) >= 1 ? COPAY_NTD : 0; }

// Self-pay price (REAL NT$ per session, not weighted) after the player's slider and synergy bonus.
export function selfPayPrice(state, treatmentId) {
  const t = TREATMENTS[treatmentId];
  if (!t) return 0;
  const pm = (state.policy && state.policy.priceMult && state.policy.priceMult[treatmentId]);
  const mods = state.mods || {};
  return Math.round((t.price || 0) * (typeof pm === 'number' ? pm : 1) * (typeof mods.selfPayPrice === 'number' ? mods.selfPayPrice : 1));
}

// ---- M3 / M7 accessors (fields are created lazily; save.js sanitises them) ----
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
export function riskOf(state) { const r = state.nhi && state.nhi.risk; return typeof r === 'number' && Number.isFinite(r) ? clampN(r, 0, RISK_TUNE.MAX) : 0; }
export function addRisk(state, d) { state.nhi.risk = clampN(riskOf(state) + (Number(d) || 0), 0, RISK_TUNE.MAX); return state.nhi.risk; }
export function reviewOf(state) { const r = state.reviewScore; return typeof r === 'number' && Number.isFinite(r) ? clampN(r, REVIEW_TUNE.MIN, REVIEW_TUNE.MAX) : REVIEW_TUNE.START; }
export function addReview(state, d) { state.reviewScore = Math.round(clampN(reviewOf(state) + (Number(d) || 0), REVIEW_TUNE.MIN, REVIEW_TUNE.MAX) * 100) / 100; return state.reviewScore; }
// arrivals multiplier from the online review score (patients.js)
export function reviewFactor(state) { return 1 + (reviewOf(state) - 4) * REVIEW_TUNE.ARRIVAL_K; }

// Monthly risk input from this month's NHI behaviour (called by settleMonth before the counters reset).
export function monthlyRiskDelta(state, points) {
  const T = RISK_TUNE, cap = nhiCap(state) || 1;
  const over = Math.max(0, points / cap - T.OVER_START);
  const prev = state.history && state.history.length ? (state.history[state.history.length - 1].nhiPoints || 0) : 0;
  const growth = prev > 200 ? points / prev - 1 : 0;
  const n = (state.nhi && state.nhi.nhiN) || 0;
  const cx = n > 20 ? ((state.nhi.complexN || 0) / n) : 0;
  const d = over * T.OVER_K + Math.max(0, growth - T.GROWTH_FREE) * T.GROWTH_K + Math.max(0, cx - T.COMPLEX_FREE) * T.COMPLEX_K;
  return clampN(d, 0, T.MONTH_CAP);
}

function onTreatmentDone(state, e) {
  if (!e) return;
  const pts = Number(e.nhiPoints) || 0;                 // points actually paid (after the single-claim rule)
  const listed = e.nhiListed != null ? Number(e.nhiListed) || 0 : pts;   // listed value, for the share-of-complex-claims risk input
  if (pts > 0) state.nhi.weekPoints += pts, state.nhi.monthPoints += pts;
  if (listed > 0) {
    state.nhi.nhiN = (state.nhi.nhiN || 0) + 1;
    if (e.treatmentId !== 'exam' && listed >= RISK_TUNE.COMPLEX_PTS) state.nhi.complexN = (state.nhi.complexN || 0) + 1;
  }
  let pay = 0;
  if (typeof e.selfPay === 'number') pay = e.selfPay;
  else if (e.selfPay) pay = selfPayPrice(state, e.treatmentId);   // boolean flag: price it ourselves
  if (pay > 0) earn(state, pay * PATIENT_WEIGHT, 'self');
  const cp = Number(e.copay) || 0;
  if (cp > 0) earn(state, cp * PATIENT_WEIGHT, 'copay');
}

function onWeekEnd(state) {
  state.nhi.lastWeekPoints = state.nhi.weekPoints;
  state.nhi.weekPoints = 0;
  if (riskOf(state) > 0) addRisk(state, -RISK_TUNE.WEEK_DECAY);
  if (state.stats) state.stats.patientsToday = 0;
}

// ---- costs ----
export function monthlyCosts(state) {
  const mods = state.mods || {};
  let salary = 0;
  for (const s of state.staff || []) salary += s.salary || 0;
  salary = Math.round(salary * (typeof mods.wageMult === 'number' ? mods.wageMult : 1));
  const rent = Math.round((lotDef(state).rent || 0) * (typeof mods.rentMult === 'number' ? mods.rentMult : 1));
  let maintain = 0;
  for (const o of state.objects || []) {
    const d = BUILDABLES[o.defId];
    maintain += d && typeof d.upkeep === 'number' ? d.upkeep : DEFAULT_UPKEEP;
  }
  for (const id of (state.policy && state.policy.boards) || []) maintain += boardUpkeep(id);
  return { salary, rent, maintain: Math.round(maintain) };
}

let boardUpkeepFn = () => 0;
export function setBoardUpkeepResolver(fn) { boardUpkeepFn = fn; }   // set by events.js (avoids an import cycle)
function boardUpkeep(id) { try { return boardUpkeepFn(id) || 0; } catch (e) { return 0; } }

// ---- monthly settlement ----
export function settleMonth(state) {
  const l = ensureLedger(state);
  const points = state.nhi.monthPoints || 0;
  const pv = getPointValue(state);
  const nhiIncome = Math.round(points * pv * PATIENT_WEIGHT);
  earn(state, nhiIncome, 'nhi');

  const c = monthlyCosts(state);
  charge(state, c.salary, 'salary');
  charge(state, c.rent, 'rent');
  charge(state, c.maintain, 'maintain');

  const income = LEDGER_INCOME_KEYS.reduce((s, k) => s + l.income[k], 0);
  const expense = LEDGER_EXPENSE_KEYS.reduce((s, k) => s + l.expense[k], 0);
  const net = income - expense;
  const st = state.stats || {};
  const satisfaction = st.satN > 0 ? st.satSum / st.satN : 0;
  // M3 / M7 monthly updates (before the counters reset)
  addRisk(state, monthlyRiskDelta(state, points));
  if (st.satN > 0) {
    if (satisfaction > REVIEW_TUNE.UP_SAT) addReview(state, REVIEW_TUNE.UP);
    else if (satisfaction < REVIEW_TUNE.DOWN_SAT) addReview(state, -REVIEW_TUNE.DOWN);
  }

  const record = {
    points, pointValue: pv, income, expense, net, nhiIncome, patientWeight: PATIENT_WEIGHT, basePointValue: PV_BASE,
    selfIncome: l.income.self, copayIncome: l.income.copay, otherIncome: l.income.other,
    salary: l.expense.salary, rent: l.expense.rent, maintain: l.expense.maintain, build: l.expense.build, otherExpense: l.expense.other,
    cap: nhiCap(state), diluted: pv < PV_BASE - 1e-9,
    year: state.time.year, month: state.time.month, money: state.money,
    risk: Math.round(riskOf(state) * 10) / 10, reviewScore: reviewOf(state),
  };

  state.nhi.pointValue = pv;
  state.nhi.lastSettlement = { points, pointValue: pv, income: nhiIncome };
  state.history.push({
    year: state.time.year, month: state.time.month, income, expense, net, money: state.money,
    patients: st.patientsMonth || 0, satisfaction: Math.round(satisfaction * 10) / 10,
    reputation: Math.round(state.reputation), nhiPoints: points, pointValue: pv,
    risk: record.risk, review: record.reviewScore,
  });
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);

  // reset the month
  for (const k of LEDGER_INCOME_KEYS) l.income[k] = 0;
  for (const k of LEDGER_EXPENSE_KEYS) l.expense[k] = 0;
  state.nhi.monthPoints = 0;
  state.nhi.weekPoints = 0;
  state.nhi.nhiN = 0; state.nhi.complexN = 0;
  if (state.stats) { st.patientsMonth = 0; st.satSum = 0; st.satN = 0; }

  bus.emit('nhi:settled', record);

  if (state.money < BANKRUPT_LIMIT && !(state.flags && state.flags.gameOver)) {
    if (state.flags) state.flags.gameOver = true;
    bus.emit('game:over', { reason: `資金低於 NT$ ${BANKRUPT_LIMIT.toLocaleString('en-US')}，診所宣告破產。` });
  }
  return record;
}

// Helper for patients.js: did a leaving patient count as cured? (hp >= cureNeeded, else probabilistic hp/cureNeeded).
export function resolveCured(patient, patientType, rand = Math.random) {
  const need = (patientType && patientType.cureNeeded) || 0.7;
  if (patient.hp >= need) return true;
  return rand() < Math.min(1, Math.max(0, patient.hp / need));
}
