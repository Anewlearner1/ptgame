// Building: placement validation, floor painting, demolition and the starter clinic.
import { bus } from '../core/bus.js';
import { ui, newId } from '../core/state.js';
import { START_MONEY } from '../core/constants.js';
import { BUILDABLES } from '../data/buildables.js';
import { LOTS } from '../data/lots.js';
import { STAFF_ROLES, STAFF_NAMES } from '../data/staffdefs.js';
import { footprint, sizeOf, inLot, entryTile, rebuildOccupancy } from '../core/grid.js';
import { spend } from './economy.js';
import { isBuildableUnlocked } from './research.js';
import { recomputeZones } from './synergy.js';
import { recomputeMods } from './modifiers.js';

// ---- tuning constants ----
export const REFUND_FRAC = 0.5;            // demolition refund
export const STARTER_CHARGE_FRAC = 0.4;    // share of the starter objects' list price deducted from the start money
export const STARTER_SKILL = 5;            // skill of the three pre-hired staff
export const STARTER_CHARM = 5;

export function placementCost(defId) {
  const d = BUILDABLES[defId];
  return d ? d.cost || 0 : 0;
}

export function isUnlocked(state, defId) {
  return isBuildableUnlocked(state, defId);
}

function cellsFor(def, x, y, rot) {
  const { w, h } = sizeOf(def, rot || 0);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

// Objects that still have walkable access from the entry tile, given a set of blocked cells.
function accessMap(state, blockers, entry) {
  const key = (x, y) => x + ',' + y;
  const blocked = new Set();
  for (const b of blockers) for (const c of b.cells) blocked.add(key(c.x, c.y));
  const seen = new Set([key(entry.x, entry.y)]);
  const q = [entry];
  while (q.length) {
    const c = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
      if (seen.has(k) || blocked.has(k) || !inLot(state, nx, ny)) continue;
      seen.add(k);
      q.push({ x: nx, y: ny });
    }
  }
  const res = new Map();
  for (const b of blockers) {
    let ok = false;
    for (const c of b.cells) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (seen.has(key(c.x + dx, c.y + dy))) ok = true;
    }
    res.set(b.id, ok);
  }
  return res;
}

function blockingList(state) {
  const out = [];
  for (const o of state.objects) {
    const d = BUILDABLES[o.defId];
    if (d && d.blocks !== false) out.push({ id: o.id, cells: footprint(o) });
  }
  return out;
}

export function canPlace(state, defId, x, y, rot) {
  const def = BUILDABLES[defId];
  if (!def) return { ok: false, reason: '未知的建築' };
  if (!isUnlocked(state, defId)) return { ok: false, reason: '尚未解鎖（需研發）' };
  rot = rot ? 1 : 0;

  if (def.layer === 'floor') {
    if (!inLot(state, x, y)) return { ok: false, reason: '必須在診所範圍內' };
    if (state.map.floor[y] && state.map.floor[y][x] === defId) return { ok: false, reason: '已經鋪設相同地板' };
    if (state.money < def.cost) return { ok: false, reason: '資金不足' };
    return { ok: true, reason: '' };
  }

  const cells = cellsFor(def, x, y, rot);
  const entry = entryTile(state);
  for (const c of cells) {
    if (!inLot(state, c.x, c.y)) return { ok: false, reason: '必須完全在診所範圍內' };
    if (c.x === entry.x && c.y === entry.y) return { ok: false, reason: '不能擋住入口' };
  }
  const taken = new Set();
  for (const o of state.objects) for (const c of footprint(o)) taken.add(c.x + ',' + c.y);
  for (const c of cells) if (taken.has(c.x + ',' + c.y)) return { ok: false, reason: '該位置已被佔用' };
  if (state.money < def.cost) return { ok: false, reason: '資金不足' };

  if (def.blocks !== false) {
    // do not wall anything in: every blocking object must keep a walkable neighbour reachable from the entry
    const before = blockingList(state);
    const hadAccess = accessMap(state, before, entry);
    const after = before.concat([{ id: -1, cells }]);
    const now = accessMap(state, after, entry);
    if (!now.get(-1)) return { ok: false, reason: '會擋住通道，病患走不進去' };
    for (const b of before) if (hadAccess.get(b.id) && !now.get(b.id)) return { ok: false, reason: '會擋住其他設施的通道' };
  }
  return { ok: true, reason: '' };
}

function afterChange(state, objectsChanged) {
  ui.dirtyOcc = true;
  rebuildOccupancy(state);
  if (objectsChanged) { recomputeZones(state); recomputeMods(state); }
  bus.emit('map:changed', {});
}

export function placeObject(state, defId, x, y, rot) {
  const def = BUILDABLES[defId];
  if (!def || def.layer === 'floor') return null;
  rot = rot ? 1 : 0;
  if (!canPlace(state, defId, x, y, rot).ok) return null;
  if (!spend(state, def.cost, 'build')) return null;
  const obj = { id: newId(state), defId, x, y, rot, busy: false, usedBy: null, staffId: null, wear: 0 };
  state.objects.push(obj);
  afterChange(state, true);
  return obj;
}

export function paintFloor(state, floorId, x, y) {
  const def = BUILDABLES[floorId];
  if (!def || def.layer !== 'floor') return false;
  if (!canPlace(state, floorId, x, y, 0).ok) return false;
  if (!spend(state, def.cost, 'build')) return false;
  state.map.floor[y][x] = floorId;
  afterChange(state, false);
  return true;
}

function refund(state, amount) {
  amount = Math.round(amount);
  if (amount <= 0) return;
  state.money += amount;
  const l = state.ledger;
  const fromBuild = Math.min(amount, l.expense.build || 0);
  l.expense.build -= fromBuild;                      // refunds net against this month's build spending
  if (amount > fromBuild) l.income.other += amount - fromBuild;
}

// Release patients/staff that were using or heading to an object that is going away.
function freeAgentsOf(state, obj) {
  for (const p of state.patients || []) {
    if (p.targetObj === obj.id || obj.usedBy === p.id) {
      p.targetObj = null;
      p.path = [];
      if (p.stage === 'to_station' || p.stage === 'treating') p.stage = 'waiting';
      p.staffId = null;
    }
  }
  for (const s of state.staff || []) {
    if (s.task && s.task.objId === obj.id) {
      s.task = null;
      s.path = [];
      s.state = 'idle';
    }
  }
}

export function removeAt(state, x, y) {
  // topmost object first (blocking objects win, then flat ones)
  let hit = null;
  for (const o of state.objects) {
    if (!footprint(o).some(c => c.x === x && c.y === y)) continue;
    const blocks = BUILDABLES[o.defId] && BUILDABLES[o.defId].blocks !== false;
    if (!hit || (blocks && !(BUILDABLES[hit.defId].blocks !== false))) hit = o;
  }
  if (hit) {
    freeAgentsOf(state, hit);
    state.objects.splice(state.objects.indexOf(hit), 1);
    refund(state, placementCost(hit.defId) * REFUND_FRAC);
    afterChange(state, true);
    return true;
  }
  const row = state.map.floor[y];
  const fid = row ? row[x] : null;
  if (fid && inLot(state, x, y)) {
    row[x] = null;
    refund(state, placementCost(fid) * REFUND_FRAC);
    afterChange(state, false);
    return true;
  }
  return false;
}

// ---- starter clinic ----
const STARTER_OBJECTS = [
  // [defId, x, y, rot]   lot is x 10..21, y 10..19; entry tile (15,19); x=14..15 is a clear walkway
  ['reception', 16, 17, 0],
  ['sofa', 12, 18, 0],
  ['plant', 13, 19, 0],
  ['exam_room', 11, 12, 0],
  ['heatbox', 17, 12, 0],
  ['heatbox', 18, 12, 0],
  ['tens', 19, 12, 0],
];
// role -> preferred stand tile (float centre added below)
const STARTER_STAFF = [
  ['doctor', 13, 13],
  ['nurse', 18, 16],
  ['pt', 18, 14],
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function makeStarterStaff(state, role, tx, ty) {
  const r = STAFF_ROLES[role] || {};
  const range = r.skillRange || [1, 10];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const names = STAFF_NAMES || { surnames: ['王'], given: ['小明'] };
  return {
    id: newId(state), role,
    name: pick(names.surnames) + pick(names.given),
    skill: clamp(STARTER_SKILL, range[0], range[1]), charm: STARTER_CHARM,
    stamina: r.staminaMax || 100, staminaMax: r.staminaMax || 100,
    salary: r.baseSalary || 50000, trait: null, level: 1,
    x: tx + 0.5, y: ty + 0.5, path: [], state: 'idle', task: null, wait: 0,
  };
}

export function seedStarterClinic(state) {
  const L = LOTS[0];
  state.lotLevel = 0;
  state.lot = { ...L.lot };
  state.door = { ...L.door };
  state.objects = [];
  state.staff = [];
  state.map.floor = state.map.floor.map(row => row.map(() => null));
  state.money = START_MONEY;

  let list = 0;
  for (const [defId, x, y, rot] of STARTER_OBJECTS) {
    const def = BUILDABLES[defId];
    if (!def) continue;
    let px = x, py = y;
    if (!cellsFree(state, def, px, py, rot)) {
      const alt = findFreeSpot(state, def, rot);
      if (!alt) continue;
      px = alt.x; py = alt.y;
    }
    state.objects.push({ id: newId(state), defId, x: px, y: py, rot, busy: false, usedBy: null, staffId: null, wear: 0 });
    list += def.cost || 0;
  }
  rebuildOccupancy(state);
  for (const [role, sx, sy] of STARTER_STAFF) {
    const spot = nearestWalkable(state, sx, sy);
    state.staff.push(makeStarterStaff(state, role, spot.x, spot.y));
  }
  state.money = START_MONEY - Math.round(list * STARTER_CHARGE_FRAC / 1000) * 1000;
  ui.dirtyOcc = true;
  recomputeZones(state);
  recomputeMods(state);
  return state;
}

function cellsFree(state, def, x, y, rot) {
  const cells = cellsFor(def, x, y, rot);
  const entry = entryTile(state);
  const taken = new Set();
  for (const o of state.objects) for (const c of footprint(o)) taken.add(c.x + ',' + c.y);
  return cells.every(c => inLot(state, c.x, c.y) && !taken.has(c.x + ',' + c.y) && !(c.x === entry.x && c.y === entry.y) &&
    // keep the walkway x=14..15 free of blockers in the lower half
    !(def.blocks !== false && (c.x === 14 || c.x === 15) && c.y >= 13));
}

function findFreeSpot(state, def, rot) {
  for (let y = state.lot.y0; y < state.lot.y0 + state.lot.h; y++) {
    for (let x = state.lot.x0; x < state.lot.x0 + state.lot.w; x++) if (cellsFree(state, def, x, y, rot)) return { x, y };
  }
  return null;
}

function nearestWalkable(state, x, y) {
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!inLot(state, tx, ty)) continue;
      if (state.map.occ && state.map.occ[ty][tx]) continue;
      if (state.staff.some(s => Math.floor(s.x) === tx && Math.floor(s.y) === ty)) continue;
      return { x: tx, y: ty };
    }
  }
  return { x, y };
}
