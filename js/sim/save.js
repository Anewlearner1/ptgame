// Save / load (localStorage), import / export, new game, autosave on month rollover.
import { bus } from '../core/bus.js';
import { createInitialState, replaceState, ui } from '../core/state.js';
import { state as singleton } from '../core/state.js';
import { SAVE_KEY_PREFIX, SAVE_VERSION } from '../core/constants.js';
import { rebuildOccupancy } from '../core/grid.js';
import { seedStarterClinic } from './build.js';
import { refreshPool } from './staff.js';
import { recomputeZones } from './synergy.js';
import { recomputeMods } from './modifiers.js';
import { rollWeather } from './events.js';
import { formatDate } from './calendar.js';
import { BUILDABLES } from '../data/buildables.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { STAFF_ROLES } from '../data/staffdefs.js';

export const SAVE_SLOTS = ['1', '2', '3'];      // manual slots; 'auto' is the autosave slot
const NESTED_KEYS = ['time', 'points', 'weather', 'lot', 'door', 'policy', 'research', 'nhi', 'ledger', 'stats', 'events', 'inspections', 'flags'];

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

function snapshot(state) {
  const { map, ...rest } = state;
  return { ...rest, map: { floor: map.floor } };   // occ is a runtime cache
}

function buildPayload(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    label: `${state.clinicName || '診所'}　${formatDate(state)}　NT$ ${Math.round(state.money).toLocaleString('en-US')}`,
    state: JSON.parse(JSON.stringify(snapshot(state))),
  };
}

export function saveGame(state, slot = 'auto') {
  try {
    const ls = storage();
    if (!ls) return false;
    ls.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(buildPayload(state)));
    return true;
  } catch (e) {
    console.warn('[save] failed', e);
    return false;
  }
}

// Merge a parsed payload into a fresh state so saves from older builds still load.
function hydrate(raw) {
  const fresh = createInitialState();
  const merged = Object.assign(fresh, raw);
  const base = createInitialState();
  for (const k of NESTED_KEYS) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merged[k] = { ...base[k], ...(raw[k] || {}) };
  }
  merged.mods = { ...base.mods, ...(raw.mods || {}) };
  merged.map = { floor: (raw.map && Array.isArray(raw.map.floor) && raw.map.floor.length === base.map.floor.length) ? raw.map.floor : base.map.floor, occ: null };
  for (const k of ['objects', 'staff', 'hirePool', 'patients', 'queue', 'history', 'zones']) if (!Array.isArray(merged[k])) merged[k] = [];
  merged.policy.boards = merged.policy.boards || [];
  merged.policy.priceMult = merged.policy.priceMult || {};
  merged.events.active = merged.events.active || [];
  merged.events.log = merged.events.log || [];
  merged.events.cooldowns = merged.events.cooldowns || {};
  merged.research.done = merged.research.done || [];
  return merged;
}

function applyPayload(state, payload) {
  if (!payload || typeof payload !== 'object' || !payload.state) return false;
  if (typeof payload.version === 'number' && payload.version > SAVE_VERSION) return false;
  const st = payload.state;
  // reject obviously foreign / truncated JSON instead of silently resetting the clinic
  if (typeof st !== 'object' || typeof st.money !== 'number' || !st.time || !st.lot || !Array.isArray(st.objects)) return false;
  const merged = hydrate(st);
  merged.objects = merged.objects.filter(o => o && BUILDABLES[o.defId]);
  merged.staff = merged.staff.filter(s => s && STAFF_ROLES[s.role]);
  merged.patients = merged.patients.filter(p => p && PATIENT_TYPES[p.type]);
  replaceState(state, merged);
  state.time.speed = state.time.speed || 1;
  state.time.paused = !!state.time.paused;
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  bus.emit('state:loaded', {});
  // a decision that was pending at save time is shown again
  const p = state.events.pendingDilemma;
  if (p) {
    state.time.paused = true;
    if (p.kind === 'dilemma') bus.emit('dilemma:show', { dilemma: p }); else bus.emit('event:show', { event: p });
  }
  return true;
}

export function loadGame(state, slot = 'auto') {
  try {
    const ls = storage();
    if (!ls) return false;
    const txt = ls.getItem(SAVE_KEY_PREFIX + slot);
    if (!txt) return false;
    return applyPayload(state, JSON.parse(txt));
  } catch (e) {
    console.warn('[save] load failed', e);
    return false;
  }
}

export function listSaves() {
  const out = [];
  try {
    const ls = storage();
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key || !key.startsWith(SAVE_KEY_PREFIX)) continue;
      try {
        const p = JSON.parse(ls.getItem(key));
        out.push({ slot: key.slice(SAVE_KEY_PREFIX.length), label: p.label || '', savedAt: p.savedAt || 0 });
      } catch (e) { /* corrupt slot: skip */ }
    }
  } catch (e) { /* storage unavailable */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSave(slot) {
  try { const ls = storage(); if (ls) ls.removeItem(SAVE_KEY_PREFIX + slot); } catch (e) { /* ignore */ }
}

export function exportSave(state) {
  return JSON.stringify(buildPayload(state));
}

export function importSave(state, str) {
  try {
    const payload = JSON.parse(str);
    // accept both a wrapped payload and a bare state dump
    return applyPayload(state, payload && payload.state ? payload : { version: SAVE_VERSION, state: payload });
  } catch (e) {
    console.warn('[save] import failed', e);
    return false;
  }
}

export function newGame(state) {
  const fresh = createInitialState();
  replaceState(state, fresh);
  seedStarterClinic(state);
  refreshPool(state);
  rollWeather(state);
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  bus.emit('state:loaded', {});
  return state;
}

// ---- autosave ----
let unsub = [];
export function initSave() {
  unsub.forEach(f => f());
  unsub = [
    // month:start fires after month:end settlement and the calendar rollover, so the save is fully consistent
    bus.on('month:start', () => { if (!(singleton.flags && singleton.flags.gameOver)) saveGame(singleton, 'auto'); }),
    bus.on('game:over', () => deleteSave('auto')),
  ];
}
initSave();   // main.js never calls this explicitly; importing save.js is enough
