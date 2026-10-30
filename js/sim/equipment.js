// M2: equipment wear, breakdown, repair / service actions and maintenance contracts (docs/EVENTS_EXT.md §4).
//   obj.wear 0..100 (only WEAR_DEFS wear), obj.broken (bool; patients.js never uses a broken station),
//   obj.maintainedUntil = absolute week until which a maintenance contract halves the wear speed.
// Everything here is plain state mutation; the weekly tick is driven by events.js (week:start).
import { bus } from '../core/bus.js';
import { BUILDABLES } from '../data/buildables.js';
import { spend } from './economy.js';
import { absoluteWeek } from './calendar.js';

// ---- tuning constants ----
export const WEAR_DEFS = ['fryer', 'noodle_stove', 'braise_pot', 'griddle', 'teppan', 'chef_range', 'drink_bar', 'ice_shop', 'soup_pot', 'chef_table', 'wok_range', 'bbq_grill'];
export const LIGHT_USE_DEFS = ['soup_pot', 'braise_pot', 'ice_shop'];   // slow-cook / cold gear: half the wear per dish
export const WEAR_TUNE = {
  USE: 0.4, USE_LIGHT: 0.2,       // wear per completed treatment
  WEEK: 0.3,                      // base wear per week
  OLD_AT: 70,                     // shown as 老舊
  BREAK_AT: 90,                   // from here on: weekly chance of an automatic breakdown
  BREAK_P: 0.25,
  CONTRACT_MULT: 0.5,             // wear speed under a maintenance contract
  RATE_MIN: 0.3, RATE_MAX: 3,     // clamp of mods.wearRate
  REPAIR_PCT: 0.08, REPAIR_MIN: 2000,
  SERVICE_PCT: 0.03, SERVICE_MIN: 1000,
  CONTRACT_PCT_PER_WEEK: 0.004,   // contract price = sum(build cost of wearable machines) * this * weeks (min CONTRACT_MIN)
  CONTRACT_MIN: 3000,
  CONTRACT_WEEKS: [13, 26, 52],   // offered terms in the UI
};

const rnd = () => Math.random();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function isWearable(defId) { return WEAR_DEFS.includes(defId); }
export function wearOf(o) { return clamp(Number(o && o.wear) || 0, 0, 100); }
export function isBroken(o) { return !!(o && o.broken); }
export function isWorn(o) { return wearOf(o) >= WEAR_TUNE.OLD_AT; }
export function isMaintained(state, o) { return !!(o && o.maintainedUntil > absoluteWeek(state)); }
export function maintainedWeeksLeft(state, o) { return o && o.maintainedUntil > absoluteWeek(state) ? o.maintainedUntil - absoluteWeek(state) : 0; }
export function defName(defId) { return (BUILDABLES[defId] && BUILDABLES[defId].name) || defId; }

export function wearables(state) { return (state.objects || []).filter(o => isWearable(o.defId)); }
export function brokenObjects(state) { return (state.objects || []).filter(o => o.broken); }

// mods.wearRate (設備精進) scales every wear accumulation; clamped so a stack of upgrades can neither stop wear nor explode it
export function wearRateOf(state) {
  const w = state && state.mods && Number(state.mods.wearRate);
  return clamp(Number.isFinite(w) ? w : 1, WEAR_TUNE.RATE_MIN, WEAR_TUNE.RATE_MAX);
}
function speed(state, o) { return (isMaintained(state, o) ? WEAR_TUNE.CONTRACT_MULT : 1) * wearRateOf(state); }

// One completed treatment on station `o` (patients.js).
export function useWear(state, o) {
  if (!o || !isWearable(o.defId)) return;
  const base = LIGHT_USE_DEFS.includes(o.defId) ? WEAR_TUNE.USE_LIGHT : WEAR_TUNE.USE;
  o.wear = clamp(wearOf(o) + base * speed(state, o), 0, 100);
}

export function breakObject(state, o) {
  if (!o || o.broken) return false;
  o.broken = true;
  o.busy = false; o.usedBy = null; o.staffId = null;     // patients.js reconcile() releases whoever was using it
  bus.emit('equipment:broken', { id: o.id, defId: o.defId });
  return true;
}

// Weekly tick: base wear for every wearable machine, then the automatic-breakdown roll for worn-out ones.
// Returns the objects that broke down this week.
export function weeklyWear(state) {
  const broke = [];
  for (const o of state.objects || []) {
    if (!isWearable(o.defId)) continue;
    o.wear = clamp(wearOf(o) + WEAR_TUNE.WEEK * speed(state, o), 0, 100);
    if (o.maintainedUntil !== undefined && o.maintainedUntil <= absoluteWeek(state)) delete o.maintainedUntil;
    if (!o.broken && o.wear >= WEAR_TUNE.BREAK_AT && rnd() < WEAR_TUNE.BREAK_P) { breakObject(state, o); broke.push(o); }
  }
  return broke;
}

// ---- prices ----
function costOf(o) { return (BUILDABLES[o.defId] && BUILDABLES[o.defId].cost) || 0; }
export function repairCost(o) { return Math.max(WEAR_TUNE.REPAIR_MIN, Math.round(costOf(o) * WEAR_TUNE.REPAIR_PCT)); }
export function serviceCost(o) { return Math.max(WEAR_TUNE.SERVICE_MIN, Math.round(costOf(o) * WEAR_TUNE.SERVICE_PCT)); }
export function contractCost(state, weeks) {
  let sum = 0;
  for (const o of wearables(state)) sum += costOf(o);
  return Math.max(WEAR_TUNE.CONTRACT_MIN, Math.round(sum * WEAR_TUNE.CONTRACT_PCT_PER_WEEK * weeks / 100) * 100);
}

function find(state, id) { return (state.objects || []).find(o => o.id === id) || null; }

// ---- player actions (charge through economy.spend, category 'maintain') ----
// 維修: fixes a broken machine (and resets its wear). Returns {ok, cost, reason}.
export function repairObject(state, id) {
  const o = find(state, id);
  if (!o) return { ok: false, cost: 0, reason: '找不到這個設備' };
  if (!o.broken) return { ok: false, cost: 0, reason: '這台設備沒有故障' };
  const cost = repairCost(o);
  if (!spend(state, cost, 'maintain')) return { ok: false, cost, reason: '資金不足' };
  o.broken = false; o.wear = 0;
  bus.emit('equipment:fixed', { id: o.id, defId: o.defId });
  return { ok: true, cost, reason: '' };
}

// 保養: preventive service, wear back to 0 (cheaper than a repair). Broken machines need 維修 first.
export function serviceObject(state, id) {
  const o = find(state, id);
  if (!o) return { ok: false, cost: 0, reason: '找不到這個設備' };
  if (!isWearable(o.defId)) return { ok: false, cost: 0, reason: '這類設備不需要保養' };
  if (o.broken) return { ok: false, cost: 0, reason: '設備故障中，請先維修' };
  if (wearOf(o) <= 0) return { ok: false, cost: 0, reason: '設備狀態良好' };
  const cost = serviceCost(o);
  if (!spend(state, cost, 'maintain')) return { ok: false, cost, reason: '資金不足' };
  o.wear = 0;
  return { ok: true, cost, reason: '' };
}

// 保養合約: for `weeks` weeks every machine owned now wears at half speed. Pays the price via spend(); {ok, cost, reason}.
export function signMaintenance(state, weeks) {
  weeks = Math.round(Number(weeks));
  if (!(weeks > 0)) return { ok: false, cost: 0, reason: '合約週數不正確' };
  const list = wearables(state);
  if (!list.length) return { ok: false, cost: 0, reason: '目前沒有需要保養的儀器' };
  const cost = contractCost(state, weeks);
  if (!spend(state, cost, 'maintain')) return { ok: false, cost, reason: '資金不足' };
  applyMaintenance(state, weeks);
  return { ok: true, cost, reason: '' };
}

// Contract effect only (no charge): used by signMaintenance and by the `maintenance` event effect.
export function applyMaintenance(state, weeks) {
  const until = absoluteWeek(state) + Math.max(1, Math.round(weeks));
  for (const o of wearables(state)) o.maintainedUntil = Math.max(o.maintainedUntil || 0, until);
  return until;
}

// ---- event effects ----
// target: 'all' | 'random' | defId ; returns the touched objects
export function wearTargets(state, target) {
  const list = wearables(state);
  if (target === 'all') return list;
  if (target === 'random') return list.length ? [list[Math.floor(rnd() * list.length)]] : [];
  return list.filter(o => o.defId === target);
}
export function addWear(state, target, delta) {
  const hit = wearTargets(state, target);
  for (const o of hit) {
    o.wear = clamp(wearOf(o) + delta, 0, 100);
    if (delta <= -100) o.broken = false;       // a full reset (e.g. 叫師傅來修: wear -100) is a repair
  }
  return hit;
}
export function breakdownTarget(state, target) {
  let list = wearables(state).filter(o => !o.broken);
  if (target && target !== 'random') list = list.filter(o => o.defId === target);
  if (!list.length) return null;
  const o = list[Math.floor(rnd() * list.length)];
  breakObject(state, o);
  return o;
}
// repair 'all' (service everything) | 'broken' (only the broken ones); no charge. Returns the touched objects.
export function freeRepair(state, mode) {
  const hit = [];
  for (const o of wearables(state)) {
    if (mode === 'broken' && !o.broken) continue;
    if (o.broken || wearOf(o) > 0) { o.broken = false; o.wear = 0; hit.push(o); }
  }
  return hit;
}
