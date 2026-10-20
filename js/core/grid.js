// Grid helpers shared by sim / render / build. Pure functions over `state`.
import { MAP_W, MAP_H } from './constants.js';
import { BUILDABLES } from '../data/buildables.js';

export function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

export function inLot(state, x, y) {
  const l = state.lot;
  return x >= l.x0 && y >= l.y0 && x < l.x0 + l.w && y < l.y0 + l.h;
}

// The tile inside the lot that connects to the street door. Never buildable.
export function entryTile(state) { return { x: state.door.x, y: state.door.y - 1 }; }

// Footprint size after rotation (rot 0|1 swaps w/h)
export function sizeOf(def, rot) {
  return rot ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

export function footprint(obj) {
  const def = BUILDABLES[obj.defId];
  const { w, h } = sizeOf(def, obj.rot || 0);
  const cells = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: obj.x + dx, y: obj.y + dy });
  return cells;
}

// Rebuild state.map.occ: occ[y][x] = objectId of a BLOCKING object, else 0.
// Objects with def.blocks === false (flat items, signs, soft mats) never block.
export function rebuildOccupancy(state) {
  const occ = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));
  for (const o of state.objects) {
    const def = BUILDABLES[o.defId];
    if (!def || def.blocks === false) continue;
    for (const c of footprint(o)) if (inMap(c.x, c.y)) occ[c.y][c.x] = o.id;
  }
  state.map.occ = occ;
  return occ;
}

export function isWalkable(state, x, y) {
  if (!inMap(x, y)) return false;
  if (!state.map.occ) rebuildOccupancy(state);
  return state.map.occ[y][x] === 0;
}

export function objectAt(state, x, y) {
  // any object (blocking or not) whose footprint covers x,y; blocking ones win
  let flat = null;
  for (const o of state.objects) {
    for (const c of footprint(o)) {
      if (c.x === x && c.y === y) {
        if (BUILDABLES[o.defId].blocks !== false) return o;
        flat = o;
      }
    }
  }
  return flat;
}

export function getObject(state, id) { return state.objects.find(o => o.id === id) || null; }

// Walkable 4-neighbour tiles around an object's footprint (where users stand).
export function adjacentTiles(state, obj) {
  const cells = footprint(obj);
  const set = new Set(cells.map(c => c.x + ',' + c.y));
  const out = [], seen = new Set();
  for (const c of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, k = nx + ',' + ny;
      if (set.has(k) || seen.has(k)) continue;
      seen.add(k);
      if (isWalkable(state, nx, ny)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}

export function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
