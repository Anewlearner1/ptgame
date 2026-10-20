// Economy: NHI points & dilution, ledger, monthly settlement, bankruptcy.
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { LOTS } from '../data/lots.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';

// ---- tuning constants ----
export const PV_MIN = 0.6;                  // floor of the diluted point value
export const PV_MAX = 1.0;
export const NHI_NTD_PER_POINT = 1.0;       // NT$ per NHI point at pointValue 1.0 (before REVENUE_SCALE)
// GLOBAL REVENUE KNOB. Each on-screen patient stands for many real patients, so every NT$ of *income* that a
// treatment produces is multiplied by this: NHI income = points * pointValue * NHI_NTD_PER_POINT * REVENUE_SCALE,
// and a self-pay treatment credits price * priceMult * mods.selfPayPrice * REVENUE_SCALE (see selfPayPrice()).
// Salaries / rent / build costs are NOT scaled. The UI therefore shows the (scaled) real credit via selfPayPrice().
export const REVENUE_SCALE = 1.0;
export const BANKRUPT_LIMIT = -300000;      // money below this at month end -> game over
export const DEFAULT_UPKEEP = 0;            // object upkeep when def.upkeep is missing
export const HISTORY_MAX = 240;             // months of history kept
export const LEDGER_INCOME_KEYS = ['nhi', 'self', 'other'];
export const LEDGER_EXPENSE_KEYS = ['salary', 'rent', 'build', 'maintain', 'other'];

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
  if (!(amount > 0)) return;
  const l = ensureLedger(state);
  const k = LEDGER_INCOME_KEYS.includes(category) ? category : 'other';
  state.money += amount;
  l.income[k] += amount;
}

// Unconditional expense (salary/rent may push money negative).
function charge(state, amount, category) {
  amount = Math.max(0, Math.round(amount));
  const l = ensureLedger(state);
  state.money -= amount;
  l.expense[category] += amount;
}

// ---- NHI ----
export function nhiCap(state) {
  const mods = state.mods || {};
  return (lotDef(state).nhiCap || 0) * (1 + (mods.nhiCapBonus || 0));
}

// NT$/point for the current month so far: 1.0 under the cap, diluted above (cap / points, clamped 0.6..1).
export function getPointValue(state) {
  const pts = (state.nhi && state.nhi.monthPoints) || 0;
  const cap = nhiCap(state);
  if (pts <= cap || pts <= 0) return PV_MAX;
  return Math.max(PV_MIN, Math.min(PV_MAX, cap / pts));
}

// Self-pay price after the player's slider and synergy bonus.
export function selfPayPrice(state, treatmentId) {
  const t = TREATMENTS[treatmentId];
  if (!t) return 0;
  const pm = (state.policy && state.policy.priceMult && state.policy.priceMult[treatmentId]);
  const mods = state.mods || {};
  return Math.round((t.price || 0) * (typeof pm === 'number' ? pm : 1) * (typeof mods.selfPayPrice === 'number' ? mods.selfPayPrice : 1));
}

function onTreatmentDone(state, e) {
  if (!e) return;
  const pts = Number(e.nhiPoints) || 0;
  if (pts > 0) state.nhi.weekPoints += pts, state.nhi.monthPoints += pts;
  let pay = 0;
  if (typeof e.selfPay === 'number') pay = e.selfPay;
  else if (e.selfPay) pay = selfPayPrice(state, e.treatmentId);   // boolean flag: price it ourselves
  if (pay > 0) earn(state, pay, 'self');
}

function onWeekEnd(state) {
  state.nhi.lastWeekPoints = state.nhi.weekPoints;
  state.nhi.weekPoints = 0;
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
  const nhiIncome = Math.round(points * pv * NHI_NTD_PER_POINT * REVENUE_SCALE);
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

  const record = {
    points, pointValue: pv, income, expense, net, nhiIncome,
    selfIncome: l.income.self, otherIncome: l.income.other,
    salary: l.expense.salary, rent: l.expense.rent, maintain: l.expense.maintain, build: l.expense.build, otherExpense: l.expense.other,
    cap: nhiCap(state), diluted: pv < PV_MAX,
    year: state.time.year, month: state.time.month, money: state.money,
  };

  state.nhi.pointValue = pv;
  state.nhi.lastSettlement = { points, pointValue: pv, income: nhiIncome };
  state.history.push({
    year: state.time.year, month: state.time.month, income, expense, net, money: state.money,
    patients: st.patientsMonth || 0, satisfaction: Math.round(satisfaction * 10) / 10,
    reputation: Math.round(state.reputation), nhiPoints: points, pointValue: pv,
  });
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);

  // reset the month
  for (const k of LEDGER_INCOME_KEYS) l.income[k] = 0;
  for (const k of LEDGER_EXPENSE_KEYS) l.expense[k] = 0;
  state.nhi.monthPoints = 0;
  state.nhi.weekPoints = 0;
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
