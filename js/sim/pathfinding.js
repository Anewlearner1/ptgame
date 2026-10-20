// Grid pathfinding (4-neighbour A*) + a shared "walk along path" helper for patients and staff.
// Agents may only walk inside the lot (plus the single door tile outside it): shortest paths therefore never
// leak through the street when the interior is walled off by furniture.
import { MAP_W, MAP_H } from '../core/constants.js';
import { isWalkable, inLot, adjacentTiles, entryTile } from '../core/grid.js';

const N = MAP_W * MAP_H;
const gScore = new Int32Array(N);
const parent = new Int32Array(N);
const seen = new Int32Array(N);       // generation stamps (avoids clearing arrays each search)
const closed = new Int32Array(N);
let gen = 0;
const heapIdx = new Int32Array(N * 4);
const heapKey = new Int32Array(N * 4);
let heapN = 0;
const queue = new Int32Array(N);

// ---- cache ----
let cache = new Map();
let cacheOcc = null;
let cacheLot = '';
const CACHE_MAX = 3000;

export function invalidatePathCache() { cache = new Map(); cacheOcc = null; }

function checkCache(state) {
  const lotKey = state.lot ? state.lot.x0 + ',' + state.lot.y0 + ',' + state.lot.w + ',' + state.lot.h + ',' + state.door.x + ',' + state.door.y : '';
  if (!state.map.occ) isWalkable(state, 0, 0);       // forces occupancy rebuild
  if (cacheOcc !== state.map.occ || cacheLot !== lotKey || cache.size > CACHE_MAX) {
    cache = new Map();
    cacheOcc = state.map.occ;
    cacheLot = lotKey;
  }
}

// Is (x,y) a tile agents may stand on? (walkable and inside the lot, or the door tile)
export function agentTileOk(state, x, y) {
  if (!isWalkable(state, x, y)) return false;
  return inLot(state, x, y) || (x === state.door.x && y === state.door.y);
}

function regionTile(state, x, y) {
  return inLot(state, x, y) || (x === state.door.x && y === state.door.y);
}

// ---- binary heap (min on key) ----
function hpush(i, k) {
  let p = heapN++;
  while (p > 0) {
    const q = (p - 1) >> 1;
    if (heapKey[q] <= k) break;
    heapKey[p] = heapKey[q]; heapIdx[p] = heapIdx[q];
    p = q;
  }
  heapKey[p] = k; heapIdx[p] = i;
}
function hpop() {
  const top = heapIdx[0];
  heapN--;
  if (heapN > 0) {
    const k = heapKey[heapN], i = heapIdx[heapN];
    let p = 0;
    for (;;) {
      let c = p * 2 + 1;
      if (c >= heapN) break;
      if (c + 1 < heapN && heapKey[c + 1] < heapKey[c]) c++;
      if (heapKey[c] >= k) break;
      heapKey[p] = heapKey[c]; heapIdx[p] = heapIdx[c];
      p = c;
    }
    heapKey[p] = k; heapIdx[p] = i;
  }
  return top;
}

const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];

function rebuild(endIdx, startIdx) {
  const out = [];
  let c = endIdx;
  while (c !== startIdx) { out.push({ x: c % MAP_W, y: (c / MAP_W) | 0 }); c = parent[c]; }
  out.reverse();
  return out;
}

// Extra cost of stepping onto a tile where somebody is standing still (soft obstacle: walk around if it is cheap).
export const CROWD_COST = 3;

// A* from (sx,sy) to (tx,ty). Integer tiles; the start tile itself may be blocked (agent stood on a sofa / got built over).
// `crowd` (optional Set of tile indices y*MAP_W+x) marks tiles occupied by standing agents: they are never hard
// obstacles (the path may always cross them) but cost CROWD_COST extra, so queues get walked around. Crowd
// searches bypass the path cache (the crowd changes every tick).
export function findPath(state, sx, sy, tx, ty, crowd) {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (sx === tx && sy === ty) return [];
  if (!isWalkable(state, tx, ty)) return null;
  checkCache(state);
  const useCrowd = !!(crowd && crowd.size);
  const key = ((sy * MAP_W + sx) * N) + ty * MAP_W + tx;
  if (!useCrowd) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit ? hit.slice() : null;
  }

  const restrict = regionTile(state, sx, sy) && regionTile(state, tx, ty);
  const sIdx = sy * MAP_W + sx, tIdx = ty * MAP_W + tx;
  gen++;
  heapN = 0;
  gScore[sIdx] = 0; seen[sIdx] = gen; parent[sIdx] = -1;
  hpush(sIdx, Math.abs(sx - tx) + Math.abs(sy - ty));
  let result = null;
  while (heapN > 0) {
    const cur = hpop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === tIdx) { result = rebuild(cur, sIdx); break; }
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (!isWalkable(state, nx, ny)) continue;
      if (restrict && !regionTile(state, nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (closed[ni] === gen) continue;
      const g = gScore[cur] + 1 + (useCrowd && ni !== tIdx && crowd.has(ni) ? CROWD_COST : 0);
      if (seen[ni] === gen && gScore[ni] <= g) continue;
      seen[ni] = gen; gScore[ni] = g; parent[ni] = cur;
      // tie-break towards the goal (h * 1.001 scaled to ints)
      const h = Math.abs(nx - tx) + Math.abs(ny - ty);
      hpush(ni, (g + h) * 16 + h);
    }
  }
  if (!useCrowd) cache.set(key, result);
  return result ? result.slice() : null;
}

// Breadth-first search to the nearest tile of `goals` (array of {x,y}). Returns {path, stand} | null.
function bfsToAny(state, sx, sy, goals) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (!goals.length) return null;
  const goalSet = new Set();
  for (const g of goals) goalSet.add(g.y * MAP_W + g.x);
  const sIdx = sy * MAP_W + sx;
  if (goalSet.has(sIdx)) return { path: [], stand: { x: sx, y: sy } };
  checkCache(state);
  const restrict = regionTile(state, sx, sy);
  gen++;
  let qh = 0, qt = 0;
  queue[qt++] = sIdx; seen[sIdx] = gen; parent[sIdx] = -1;
  while (qh < qt) {
    const cur = queue[qh++];
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (seen[ni] === gen) continue;
      if (!isWalkable(state, nx, ny)) continue;
      if (restrict && !regionTile(state, nx, ny)) continue;
      seen[ni] = gen; parent[ni] = cur;
      if (goalSet.has(ni)) return { path: rebuild(ni, sIdx), stand: { x: nx, y: ny } };
      queue[qt++] = ni;
    }
  }
  return null;
}

// Nearest free walkable tile adjacent to the object's footprint. `claimed` (optional Set of "x,y") are tiles
// already taken by somebody else. Returns {path, stand} or null.
export function findPathToAdjacent(state, sx, sy, obj, claimed) {
  const goals = adjacentTiles(state, obj).filter(t =>
    regionTile(state, t.x, t.y) && !(claimed && claimed.has(t.x + ',' + t.y)));
  return bfsToAny(state, sx, sy, goals);
}

// Path to any free walkable 4-neighbour of tile (tx,ty) (used to walk up to a standing person).
export function findPathNear(state, sx, sy, tx, ty, claimed) {
  tx = Math.floor(tx); ty = Math.floor(ty);
  const goals = [];
  for (let d = 0; d < 4; d++) {
    const nx = tx + DX[d], ny = ty + DY[d];
    if (isWalkable(state, nx, ny) && regionTile(state, nx, ny) && !(claimed && claimed.has(nx + ',' + ny))) goals.push({ x: nx, y: ny });
  }
  return bfsToAny(state, sx, sy, goals);
}

// The tile behind a reception counter where its nurse stands: the walkable adjacent tile farthest from the entrance
// (patients queue on the street side). null when the counter is boxed in.
export function receptionPost(state, obj) {
  const e = entryTile(state);
  let best = null, bd = -1;
  for (const t of adjacentTiles(state, obj)) {
    if (!regionTile(state, t.x, t.y)) continue;
    const d = Math.abs(t.x - e.x) + Math.abs(t.y - e.y) + (t.x + t.y * 0.01) * 0.001;
    if (d > bd) { bd = d; best = t; }
  }
  return best;
}

// Are all remaining path tiles still walkable? (used after map changes). `lastOpen` skips the final tile
// (a sofa seat the agent deliberately steps onto).
export function pathStillValid(state, path, lastOpen) {
  const n = lastOpen ? path.length - 1 : path.length;
  for (let i = 0; i < n; i++) if (!isWalkable(state, path[i].x, path[i].y)) return false;
  return true;
}

// Move an agent ({x,y,path,dir,moving}) along its path. speed = tiles per game minute (already multiplied).
// onTile(tx,ty) is called whenever a tile centre is reached; returning true stops movement this step.
// Returns true if the agent moved.
export function moveAlongPath(a, dtMin, speed, onTile) {
  a.moving = false;
  if (!a.path || a.path.length === 0) return false;
  let budget = speed * dtMin;
  let moved = false;
  while (budget > 1e-9 && a.path.length) {
    const t = a.path[0];
    const tx = t.x + 0.5, ty = t.y + 0.5;
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? 0 : 2; else if (d > 1e-6) a.dir = dy > 0 ? 1 : 3;
    if (d <= budget) {
      a.x = tx; a.y = ty; budget -= d; a.path.shift(); moved = true;
      if (onTile && onTile(t.x, t.y)) break;
    } else {
      // move along the dominant axis first (keeps tile-aligned, isometric-friendly movement)
      if (Math.abs(dx) >= Math.abs(dy)) {
        const sgn = dx > 0 ? 1 : -1, m = Math.min(budget, Math.abs(dx));
        a.x += sgn * m; budget -= m;
        if (budget > 0) { const m2 = Math.min(budget, Math.abs(dy)); a.y += (dy > 0 ? 1 : -1) * m2; budget -= m2; }
      } else {
        const sgn = dy > 0 ? 1 : -1, m = Math.min(budget, Math.abs(dy));
        a.y += sgn * m; budget -= m;
        if (budget > 0) { const m2 = Math.min(budget, Math.abs(dx)); a.x += (dx > 0 ? 1 : -1) * m2; budget -= m2; }
      }
      moved = true;
      break;
    }
  }
  a.moving = moved;
  return moved;
}

// Rescue for an agent that is standing still on a tile a blocking object now covers (built over it, or a 3x3 room dropped
// on top): A* from inside a boxed-in cell can have no way out, so snap it to the nearest standable tile that connects
// to the entrance. `allow` ({x,y}) is a tile the agent may legitimately stand on (its sofa seat). Returns true if moved.
export function rescueIfBlocked(state, a, allow) {
  const tx = Math.floor(a.x), ty = Math.floor(a.y);
  if (isWalkable(state, tx, ty)) return false;
  if (allow && allow.x === tx && allow.y === ty) return false;
  const e = entryTile(state);
  let tried = 0;
  for (let r = 1; r <= 24 && tried < 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const rem = r - Math.abs(dx);
      for (const dy of rem === 0 ? [0] : [-rem, rem]) {
        const nx = tx + dx, ny = ty + dy;
        if (!agentTileOk(state, nx, ny)) continue;
        tried++;
        const p = findPath(state, nx, ny, e.x, e.y);
        if (p === null) continue;
        a.x = nx + 0.5; a.y = ny + 0.5; a.path = []; a.moving = false;
        return true;
      }
    }
  }
  // nowhere connected: fall back to the entrance itself
  a.x = e.x + 0.5; a.y = e.y + 0.5; a.path = []; a.moving = false;
  return true;
}
