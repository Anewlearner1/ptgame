// Economy (restaurant): dish sales, ingredient cost, ledger, monthly settlement, bankruptcy, 食安風險 and 網路評價.
// There is no insurance: every dish is paid in cash when it is served (see docs/RESTAURANT_DESIGN.md §6).
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { LOTS } from '../data/lots.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';

// ---- tuning constants ----
// REAL NUMBERS (dish prices, ingredient-cost rates) live in data/fees.js. The knobs below are ABSTRACTION only.
// PATIENT_WEIGHT: each simulated guest stands for PATIENT_WEIGHT real diners. It multiplies ALL guest-generated revenue AND the
//   ingredient cost the same way: sales = real price * priceMult * mods * PATIENT_WEIGHT.
// Salaries / rent / build costs / event money / inspection rewards are plain NT$ (never multiplied). Balance knob (docs/ARCHITECTURE.md §2).
export const PATIENT_WEIGHT = 28;
// Per-lot override: lots.js `patientWeight` (the biggest lot is capped by the same on-screen crowd, so each simulated guest there stands for more).
export function patientWeight(state) { const w = lotDef(state).patientWeight; return typeof w === 'number' && w > 0 ? w : PATIENT_WEIGHT; }
export const BANKRUPT_LIMIT = -300000;      // money below this at month end -> game over
export const DEFAULT_UPKEEP = 0;            // object upkeep when def.upkeep is missing
export const HISTORY_MAX = 240;             // months of history kept
export const LEDGER_INCOME_KEYS = ['menu', 'special', 'other'];
export const LEDGER_EXPENSE_KEYS = ['salary', 'rent', 'build', 'maintain', 'food', 'other'];
export const GOOD_MARGIN = 0.62;            // a month counts as 毛利達標 (career metric marginGoodMonthsYear) when (income - food) / income >= this

// 食安風險 (state.safety.risk 0..100) and 網路評價 (state.reviewScore 1..5): docs/EVENTS_EXT.md §6.
export const RISK_TUNE = {
  MAX: 100, WEEK_DECAY: 1,          // natural decay per week
  WEAR_FREE: 30, WEAR_K: 12,        // average wear (0..100) of cooking equipment above 30%: +K per 1.0 of the excess share
  TIRED_K: 5,                       // share of staff below 30% stamina at settlement: +K per 1.0
  LOWSAT_BELOW: 45, LOWSAT_ADD: 2,  // monthly average satisfaction below this adds LOWSAT_ADD
  NO_REST_ADD: 1,                   // no staff room at all and 4+ staff
  MONTH_CAP: 15,                    // max risk added by one settlement
  HIGH: 60,                         // above this 'safety' category events weigh x2 (events.js)
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

// Unconditional expense (salary / rent / ingredients may push money negative).
function charge(state, amount, category) {
  amount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  const l = ensureLedger(state);
  state.money -= amount;
  l.expense[category] += amount;
}

// ---- dish prices ----
// Special-dish price (REAL NT$ per diner, not weighted) after the player's slider and synergy bonus.
export function selfPayPrice(state, treatmentId) {
  const t = TREATMENTS[treatmentId];
  if (!t) return 0;
  const pm = (state.policy && state.policy.priceMult && state.policy.priceMult[treatmentId]);
  const mods = state.mods || {};
  return Math.round((t.price || 0) * (typeof pm === 'number' ? pm : 1) * (typeof mods.selfPayPrice === 'number' ? mods.selfPayPrice : 1));
}
// Price one diner pays for a dish right now (REAL NT$): menu dishes are fixed, special dishes follow the slider.
export function dishPrice(state, treatmentId) {
  const t = TREATMENTS[treatmentId];
  if (!t) return 0;
  return t.kind === 'special' ? selfPayPrice(state, treatmentId) : (t.price || 0);
}
// Ingredient cost of one served dish (REAL NT$ per diner) = price * the dish's cost rate * mods.foodCost (the price used is what was charged).
export function dishFoodCost(state, treatmentId, price) {
  const t = TREATMENTS[treatmentId];
  if (!t) return 0;
  const m = state.mods && typeof state.mods.foodCost === 'number' ? Math.max(0.3, state.mods.foodCost) : 1;
  return (price != null ? price : dishPrice(state, treatmentId)) * (t.foodCost || 0) * m;
}

// ---- 食安風險 / 網路評價 accessors (fields are created lazily; save.js sanitises them) ----
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
export function riskOf(state) { const r = state.safety && state.safety.risk; return typeof r === 'number' && Number.isFinite(r) ? clampN(r, 0, RISK_TUNE.MAX) : 0; }
export function addRisk(state, d) { if (!state.safety) state.safety = { risk: 0 }; state.safety.risk = clampN(riskOf(state) + (Number(d) || 0), 0, RISK_TUNE.MAX); return state.safety.risk; }
export function reviewOf(state) { const r = state.reviewScore; return typeof r === 'number' && Number.isFinite(r) ? clampN(r, REVIEW_TUNE.MIN, REVIEW_TUNE.MAX) : REVIEW_TUNE.START; }
export function addReview(state, d) { state.reviewScore = Math.round(clampN(reviewOf(state) + (Number(d) || 0), REVIEW_TUNE.MIN, REVIEW_TUNE.MAX) * 100) / 100; return state.reviewScore; }
// arrivals multiplier from the online review score (patients.js)
export function reviewFactor(state) { return 1 + (reviewOf(state) - 4) * REVIEW_TUNE.ARRIVAL_K; }

// Monthly risk input from the kitchen's condition (called by settleMonth before the counters reset).
export function monthlyRiskDelta(state) {
  const T = RISK_TUNE;
  let wsum = 0, wn = 0;
  for (const o of state.objects || []) { if (typeof o.wear === 'number') { wsum += o.wear; wn++; } }
  const avgWear = wn ? wsum / wn : 0;
  const wearPart = Math.max(0, (avgWear - T.WEAR_FREE) / (100 - T.WEAR_FREE)) * T.WEAR_K;
  const staff = state.staff || [];
  let tired = 0;
  for (const s of staff) if (s.staminaMax > 0 && s.stamina / s.staminaMax < 0.3) tired++;
  const tiredPart = staff.length ? tired / staff.length * T.TIRED_K : 0;
  const st = state.stats || {};
  const sat = st.satN > 0 ? st.satSum / st.satN : 100;
  const satPart = sat < T.LOWSAT_BELOW ? T.LOWSAT_ADD : 0;
  const restPart = staff.length >= 4 && !(state.objects || []).some(o => o.defId === 'rest_room') ? T.NO_REST_ADD : 0;
  return clampN(wearPart + tiredPart + satPart + restPart, 0, T.MONTH_CAP);
}

// A served dish (patients.js emits treatment:done): cash in at the dish price x guest weight, ingredient cost out at the same weight.
//   e = { treatmentId, price (REAL NT$ per diner, from dishPrice), ... }
function onTreatmentDone(state, e) {
  if (!e) return;
  const T = TREATMENTS[e.treatmentId];
  if (!T) return;
  const price = typeof e.price === 'number' ? e.price : dishPrice(state, e.treatmentId);
  if (!(price > 0)) return;
  const w = patientWeight(state);
  earn(state, price * w, T.kind === 'special' ? 'special' : 'menu');
  charge(state, dishFoodCost(state, e.treatmentId, price) * w, 'food');
  state.safety = state.safety || { risk: 0 };
  state.stats.dishesToday = (state.stats.dishesToday || 0) + 1;
}

function onWeekEnd(state) {
  if (riskOf(state) > 0) addRisk(state, -RISK_TUNE.WEEK_DECAY);
  if (state.stats) { state.stats.patientsToday = 0; state.stats.dishesToday = 0; }
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
  const c = monthlyCosts(state);
  charge(state, c.salary, 'salary');
  charge(state, c.rent, 'rent');
  charge(state, c.maintain, 'maintain');

  const income = LEDGER_INCOME_KEYS.reduce((s, k) => s + l.income[k], 0);
  const expense = LEDGER_EXPENSE_KEYS.reduce((s, k) => s + l.expense[k], 0);
  const net = income - expense;
  const sales = l.income.menu + l.income.special;
  const margin = sales > 0 ? (sales - l.expense.food) / sales : 0;
  const st = state.stats || {};
  const satisfaction = st.satN > 0 ? st.satSum / st.satN : 0;
  // 食安風險 / 網路評價 monthly updates (before the counters reset)
  addRisk(state, monthlyRiskDelta(state));
  if (st.satN > 0) {
    if (satisfaction > REVIEW_TUNE.UP_SAT) addReview(state, REVIEW_TUNE.UP);
    else if (satisfaction < REVIEW_TUNE.DOWN_SAT) addReview(state, -REVIEW_TUNE.DOWN);
  }

  const record = {
    income, expense, net, patientWeight: patientWeight(state),
    menuIncome: l.income.menu, specialIncome: l.income.special, otherIncome: l.income.other,
    food: l.expense.food, margin: Math.round(margin * 1000) / 1000,
    salary: l.expense.salary, rent: l.expense.rent, maintain: l.expense.maintain, build: l.expense.build, otherExpense: l.expense.other,
    year: state.time.year, month: state.time.month, money: state.money,
    risk: Math.round(riskOf(state) * 10) / 10, reviewScore: reviewOf(state),
  };

  state.history.push({
    year: state.time.year, month: state.time.month, income, expense, net, money: state.money,
    patients: st.patientsMonth || 0, satisfaction: Math.round(satisfaction * 10) / 10,
    reputation: Math.round(state.reputation), margin: record.margin, food: record.food,
    risk: record.risk, review: record.reviewScore,
  });
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);

  // reset the month
  for (const k of LEDGER_INCOME_KEYS) l.income[k] = 0;
  for (const k of LEDGER_EXPENSE_KEYS) l.expense[k] = 0;
  if (state.stats) { st.patientsMonth = 0; st.satSum = 0; st.satN = 0; }

  bus.emit('month:settled', record);

  if (state.money < BANKRUPT_LIMIT && !(state.flags && state.flags.gameOver)) {
    if (state.flags) state.flags.gameOver = true;
    bus.emit('game:over', { reason: `資金低於 NT$ ${BANKRUPT_LIMIT.toLocaleString('en-US')}，餐廳宣告破產。` });
  }
  return record;
}

// Helper for patients.js: did a leaving guest count as a 熟客 ("cured")? (hp >= cureNeeded, else probabilistic hp/cureNeeded).
export function resolveCured(patient, patientType, rand = Math.random) {
  const need = (patientType && patientType.cureNeeded) || 0.7;
  if (patient.hp >= need) return true;
  return rand() < Math.min(1, Math.max(0, patient.hp / need));
}
