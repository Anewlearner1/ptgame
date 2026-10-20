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

// Fills state.zones with {id, name, icon, objectIds[], cells[{x,y}]} (one entry per qualifying component).
export function recomputeZones(state) {
  const zones = [];
  const comps = adjacencyComponents(state.objects || []);
  for (const syn of synergyList()) {
    if (!syn.needs || !syn.needs.length) continue;
    for (const comp of comps) {
      const ids = new Set(comp.map(o => o.defId));
      if (!syn.needs.every(n => ids.has(n))) continue;
      const members = comp.filter(o => syn.needs.includes(o.defId));
      const cells = [];
      for (const o of members) for (const c of footprint(o)) cells.push({ x: c.x, y: c.y });
      zones.push({ id: syn.id, name: syn.name, icon: syn.icon, objectIds: members.map(o => o.id), cells });
    }
  }
  state.zones = zones;
  return zones;
}

export function isZoneActive(state, id) {
  return (state.zones || []).some(z => z.id === id);
}

// Hint for the UI dictionary: which needed defIds the player already has placed.
export function synergyProgress(state, syn) {
  const have = new Set((state.objects || []).map(o => o.defId));
  return syn.needs.map(n => ({ defId: n, have: have.has(n) }));
}
