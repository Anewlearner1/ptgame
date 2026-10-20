// Aggregates every modifier source into state.mods, plus spatial helpers (comfort / floor grip).
// Order (ARCHITECTURE §4): synergy zones -> research -> weather -> events/community -> boards -> focus -> environment.
//
// Patch semantics ("mods patch" in synergies / events / boards / community):
//   every numeric key is an ADDITIVE DELTA on the current value (multipliers have base 1, so +0.2 -> 1.2).
//   dotted keys 'typeSpawn.<patientType>' are deltas on that type's multiplier (absent == 1).
// Research mod effects carry an explicit op ('add' | 'mul').
import { defaultMods } from '../core/state.js';
import { BUILDABLES } from '../data/buildables.js';
import { RESEARCH } from '../data/research.js';
import { FOCUS } from '../data/patients.js';
import * as EV from '../data/events.js';
import { synergyList } from './synergy.js';

// ---- tuning ----
export const BARE_GRIP = 0.45;            // floor grip with no floor painted
export const COMFORT_RADIUS = 4;          // tiles
export const COMFORT_MAX = 12;            // cap on comfortScoreAt
export const ENV_PATIENCE_PER_COMFORT = 0.004;   // clinic-wide comfort -> patience multiplier delta
export const ENV_PATIENCE_PER_RELIEF = 0.008;    // anxietyRelief -> patience
export const ENV_PATIENCE_CAP = 0.2;
const MULT_MIN = 0.1;                     // floor for multiplier-type mods
const MODS_MIN_ZERO_OK = new Set(['selfPayConv', 'elderSat']);

function typeBase(mods, t) { return mods.typeSpawn[t] == null ? 1 : mods.typeSpawn[t]; }

export function applyPatch(mods, patch, scale = 1) {
  if (!patch) return;
  for (const key of Object.keys(patch)) {
    const v = patch[key] * scale;
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    if (key.startsWith('typeSpawn.')) {
      const t = key.slice('typeSpawn.'.length);
      mods.typeSpawn[t] = typeBase(mods, t) + v;
    } else if (typeof mods[key] === 'number') {
      mods[key] += v;
    } else if (!(key in mods)) {
      mods[key] = v;     // unknown key: keep as extra (additive from 0)
    }
  }
}

export function applyOp(mods, key, op, value) {
  if (typeof value !== 'number') return;
  if (key.startsWith('typeSpawn.')) {
    const t = key.slice('typeSpawn.'.length);
    const b = typeBase(mods, t);
    mods.typeSpawn[t] = op === 'mul' ? b * value : b + value;
  } else if (typeof mods[key] === 'number') {
    mods[key] = op === 'mul' ? mods[key] * value : mods[key] + value;
  }
}

function weatherDef(kind) {
  return (EV.WEATHER || []).find(w => w.kind === kind) || null;
}

function clampMods(m) {
  for (const k of Object.keys(m)) {
    if (typeof m[k] !== 'number') continue;
    if (MODS_MIN_ZERO_OK.has(k)) continue;
    if (['nhiTurnover', 'selfPayPrice', 'researchGain', 'walkSpeed', 'spawnMult', 'patience', 'slipRisk', 'staffStamina', 'rentMult', 'wageMult'].includes(k)) {
      if (m[k] < MULT_MIN) m[k] = MULT_MIN;
    }
  }
  for (const t of Object.keys(m.typeSpawn)) if (m.typeSpawn[t] < 0) m.typeSpawn[t] = 0;
}

export function recomputeMods(state) {
  const m = defaultMods();

  // 1. active synergy zones (each synergy once, however many copies of the zone exist)
  const seen = new Set();
  for (const z of state.zones || []) {
    if (seen.has(z.id)) continue;
    seen.add(z.id);
    const syn = synergyList().find(s => s.id === z.id);
    if (syn) applyPatch(m, syn.effects);
  }

  // 2. completed research
  for (const id of (state.research && state.research.done) || []) {
    const node = RESEARCH[id];
    if (!node) continue;
    for (const e of node.effects || []) if (e.type === 'mod') applyOp(m, e.key, e.op || 'add', e.value);
  }

  // 3. weather
  const w = weatherDef(state.weather && state.weather.kind);
  if (w) {
    applyPatch(m, w.mods);
    for (const t of Object.keys(w.typeBoost || {})) m.typeSpawn[t] = typeBase(m, t) * w.typeBoost[t];
    if (typeof w.slip === 'number' && w.slip > 0) m.slipRisk *= w.slip;
  }

  // 4. active events / community actions (their mods patch is stored on the entry)
  for (const a of (state.events && state.events.active) || []) applyPatch(m, a.mods);

  // 5. enabled health-education boards
  for (const id of (state.policy && state.policy.boards) || []) {
    const b = (EV.BOARDS || []).find(x => x.id === id);
    if (b) applyPatch(m, b.effects);
  }

  // 6. policy focus
  const f = FOCUS && state.policy && FOCUS[state.policy.focus];
  if (f && f.spawnMult) for (const t of Object.keys(f.spawnMult)) m.typeSpawn[t] = typeBase(m, t) * f.spawnMult[t];

  // 7. environment comfort (clinic-wide, small patience bonus; local effects use comfortScoreAt)
  let comfort = 0, relief = 0;
  for (const o of state.objects || []) {
    const d = BUILDABLES[o.defId];
    if (!d) continue;
    comfort += d.comfort || 0;
    relief += d.anxietyRelief || 0;
  }
  m.patience += Math.min(ENV_PATIENCE_CAP, comfort * ENV_PATIENCE_PER_COMFORT + relief * ENV_PATIENCE_PER_RELIEF);

  clampMods(m);
  state.mods = m;
  return m;
}

// ---- spatial helpers ----

// Euclidean distance (tiles) from point (px,py) to the rectangle covered by the object's footprint.
function distToObject(o, def, px, py) {
  const w = (o.rot ? def.h : def.w), h = (o.rot ? def.w : def.h);
  const dx = Math.max(o.x - px, 0, px - (o.x + w));
  const dy = Math.max(o.y - py, 0, py - (o.y + h));
  return Math.sqrt(dx * dx + dy * dy);
}

function spatialSum(state, x, y, field, cap) {
  // integer coordinates are tile corners: sample the tile centre
  const px = Number.isInteger(x) ? x + 0.5 : x, py = Number.isInteger(y) ? y + 0.5 : y;
  let sum = 0;
  for (const o of state.objects || []) {
    const def = BUILDABLES[o.defId];
    if (!def || !def[field]) continue;
    const d = distToObject(o, def, px, py);
    if (d > COMFORT_RADIUS) continue;
    sum += def[field] * (1 - d / (COMFORT_RADIUS + 1));
  }
  return Math.min(sum, cap);
}

// Comfort felt at a position: sum of nearby objects' `comfort` with linear falloff over COMFORT_RADIUS.
export function comfortScoreAt(state, x, y) {
  return spatialSum(state, x, y, 'comfort', COMFORT_MAX);
}

// Calming effect (tv, sign, water) at a position.
export function anxietyReliefAt(state, x, y) {
  return spatialSum(state, x, y, 'anxietyRelief', COMFORT_MAX);
}

// Slip safety 0..1 of the floor under (x,y). Painted floor grip, or BARE_GRIP; flat objects with `grip` can raise it.
export function floorGripAt(state, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  const row = state.map && state.map.floor && state.map.floor[ty];
  const id = row ? row[tx] : null;
  let grip = BARE_GRIP;
  if (id) {
    const g = BUILDABLES[id] && BUILDABLES[id].grip;
    grip = typeof g === 'number' ? g : BARE_GRIP;
  }
  for (const o of state.objects || []) {
    const def = BUILDABLES[o.defId];
    if (!def || def.blocks !== false || typeof def.grip !== 'number') continue;
    const w = o.rot ? def.h : def.w, h = o.rot ? def.w : def.h;
    if (tx >= o.x && tx < o.x + w && ty >= o.y && ty < o.y + h) grip = Math.max(grip, def.grip);
  }
  return grip;
}

// Walk-speed multiplier of the floor under (x,y) (ramps are faster for everyone).
export function floorWalkMultAt(state, x, y) {
  const row = state.map && state.map.floor && state.map.floor[Math.floor(y)];
  const id = row ? row[Math.floor(x)] : null;
  const def = id && BUILDABLES[id];
  return (def && def.walkMult) || 1;
}
