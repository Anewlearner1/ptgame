// Synergy zones: connected components of adjacent objects that contain every defId of a SYNERGIES.needs.
// Adjacent = Chebyshev distance between footprints <= 1 (touching, diagonal ok).
import { BUILDABLES } from '../data/buildables.js';
import * as SYN from '../data/synergies.js';
import { footprint, sizeOf } from '../core/grid.js';

// Fallback if data/synergies.js is missing (keeps the three contract zones alive).
const FALLBACK_SYNERGIES = [
  { id: 'golden3', name: '黃金三寶區', icon: '🥇', needs: ['heatbox', 'tens', 'traction'], effects: { nhiTurnover: 0.2, elderSat: 8 } },
  { id: 'premium', name: '高階自費專區', icon: '💎', needs: ['manual_room', 'shockwave', 'coffee'], effects: { selfPayConv: 0.15, selfPayPrice: 0.1 } },
  { id: 'kidpark', name: '早療放電樂園', icon: '🧸', needs: ['ball_pit', 'soft_mat', 'bookshelf'], effects: { researchGain: 0.25 } },
];

export function synergyList() { return SYN.SYNERGIES || FALLBACK_SYNERGIES; }

function rectOf(o) {
  const def = BUILDABLES[o.defId];
  if (!def) return null;
  const { w, h } = sizeOf(def, o.rot || 0);
  return { x0: o.x, y0: o.y, x1: o.x + w - 1, y1: o.y + h - 1 };
}

// Chebyshev gap between two inclusive rectangles (0 = overlapping, 1 = touching edge/corner).
function rectGap(a, b) {
  const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const gy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  return Math.max(gx, gy);
}

export function areAdjacent(o1, o2) {
  const a = rectOf(o1), b = rectOf(o2);
  return !!a && !!b && rectGap(a, b) <= 1;
}

// Returns connected components (arrays of objects).
export function adjacencyComponents(objects) {
  const items = objects.map(o => ({ o, r: rectOf(o) })).filter(i => i.r);
  const parent = items.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectGap(items[i].r, items[j].r) <= 1) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it.o);
  });
  return [...groups.values()];
}

// ---- floor-tile requirement (needsFloors) ----
// Rule (docs/ARCHITECTURE.md §3.1): for `needsFloors: {ramp: 3}` the cluster's member objects (the ones whose defId is in `needs`)
// define SEED tiles = floor tiles of that type inside the member footprints grown by 1 (Chebyshev, so edges and corners touch).
// Every same-type tile 8-connected to a seed (a contiguous strip) also counts, so only ONE tile of a strip has to touch a member.
// The strip is walked breadth-first and stops after FLOOR_SCAN_CAP(n) tiles (>= n), so the cost is O(n) per zone; those tiles are
// returned as extra glow cells. Returns the tile list (length >= n for every floor type) or null when a requirement is not met.
const floorCap = (n) => n + 6;
function collectFloors(state, members, needsFloors) {
  const grid = state.map && state.map.floor;
  if (!grid) return null;
  const rects = members.map(rectOf).filter(Boolean);
  const out = [];
  for (const type of Object.keys(needsFloors)) {
    const need = needsFloors[type], cap = floorCap(need);
    const seen = new Set(), queue = [];
    const at = (x, y) => (grid[y] ? grid[y][x] : null);
    const push = (x, y) => {
      const k = y * 4096 + x;
      if (seen.has(k) || at(x, y) !== type) return;
      seen.add(k); queue.push(x, y);
    };
    for (const r of rects) for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) if (x >= 0 && y >= 0) push(x, y);
    const tiles = [];
    for (let qi = 0; qi < queue.length && tiles.length < cap; qi += 2) {
      const x = queue[qi], y = queue[qi + 1];
      tiles.push({ x, y });
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0) push(x + dx, y + dy);
    }
    if (tiles.length < need) return null;
    for (const t of tiles) out.push(t);
  }
  return out;
}

// Fills state.zones with {id, name, icon, objectIds[], cells[{x,y}]} (one entry per qualifying component).
// cells = footprints of the member objects (+ the counted floor tiles for needsFloors zones) so the renderer can outline them.
export function recomputeZones(state) {
  const zones = [];
  const comps = adjacencyComponents(state.objects || []);
  const compCounts = comps.map(comp => { const m = new Map(); for (const o of comp) m.set(o.defId, (m.get(o.defId) || 0) + 1); return m; });
  for (const syn of synergyList()) {
    if (!syn.needs || !syn.needs.length) continue;
    for (let ci = 0; ci < comps.length; ci++) {
      const have = compCounts[ci];
      if (!syn.needs.every(n => (have.get(n) || 0) >= ((syn.needsCount && syn.needsCount[n]) || 1))) continue;
      const members = comps[ci].filter(o => syn.needs.includes(o.defId));
      const cells = [];
      for (const o of members) for (const c of footprint(o)) cells.push({ x: c.x, y: c.y });
      if (syn.needsFloors) {
        const fl = collectFloors(state, members, syn.needsFloors);
        if (!fl) continue;
        for (const c of fl) cells.push(c);
      }
      zones.push({ id: syn.id, name: syn.name, icon: syn.icon, objectIds: members.map(o => o.id), cells });
    }
  }
  state.zones = zones;
  return zones;
}

export function isZoneActive(state, id) {
  return (state.zones || []).some(z => z.id === id);
}

// Hint for the UI dictionary: one row per requirement with how many the player owns.
//   [{kind:'obj', id, need, have, ok}, {kind:'floor', id, need, have, ok}]   (floor `have` = best strip touching a member, 0 if none)
// Cheap: counts placed objects once and, for floors, the painted tiles of that type in the lot (an upper bound shown as 2/3).
export function synergyProgress(state, syn) {
  const cnt = new Map();
  for (const o of state.objects || []) cnt.set(o.defId, (cnt.get(o.defId) || 0) + 1);
  const out = syn.needs.map(n => {
    const need = (syn.needsCount && syn.needsCount[n]) || 1, have = cnt.get(n) || 0;
    return { kind: 'obj', defId: n, id: n, need, have, ok: have >= need };
  });
  for (const f of Object.keys(syn.needsFloors || {})) {
    const need = syn.needsFloors[f];
    let have = 0;
    for (const row of (state.map && state.map.floor) || []) for (const id of row || []) if (id === f) have++;
    out.push({ kind: 'floor', defId: f, id: f, need, have: Math.min(have, need), ok: have >= need });
  }
  return out;
}

// Research nodes that must still be done before this zone can be built at all (syn.unlock + the `requires` of every needed buildable).
export function zoneLocks(state, syn) {
  const done = new Set((state.research && state.research.done) || []);
  const out = [];
  const add = (id) => { if (id && !done.has(id) && !out.includes(id)) out.push(id); };
  add(syn.unlock);
  for (const n of [...syn.needs, ...Object.keys(syn.needsFloors || {})]) add((BUILDABLES[n] || {}).requires);
  return out;
}
