// Finds an L0 layout that lights as many zones as possible at once (run: node tools/zonecombo.mjs [tries]); prints the L0_COMBO literal for
// tools/zonelayouts.mjs. Uses the real build rules (placeObject / paintFloor) on the empty 12x10 starter lot.
class LS { constructor() { this.m = new Map(); } get length() { return this.m.size; } key(i) { return [...this.m.keys()][i] ?? null; } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } clear() { this.m.clear(); } }
globalThis.localStorage = new LS();
const ROOT = new URL('../js/', import.meta.url).href;
const { state, ui } = await import(ROOT + 'core/state.js');
const { rebuildOccupancy } = await import(ROOT + 'core/grid.js');
const B = await import(ROOT + 'sim/build.js');
const Syn = await import(ROOT + 'sim/synergy.js');
const Mod = await import(ROOT + 'sim/modifiers.js');
const { RESEARCH } = await import(ROOT + 'data/research.js');
const ZL = await import(new URL('./zonelayouts.mjs', import.meta.url).href);
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const tries = +(process.argv[2] || 400);
let best = null;
for (let t = 0; t < tries; t++) {
  seed = t + 1;
  B.seedStarterShop(state);
  state.objects = []; state.map.floor = state.map.floor.map(r => r.map(() => null));
  state.research.done = Object.keys(RESEARCH); state.money = 1e9;
  rebuildOccupancy(state);
  const ids = Object.keys(ZL.TEMPLATES).sort(() => rnd() - 0.5);
  const placedList = [];
  for (const id of ids) {
    const before = state.objects.length;
    const floorsBefore = state.map.floor.map(r => r.slice());
    const ok = ZL.placeTemplateAnywhere(B, state, id, rnd);
    rebuildOccupancy(state);
    if (!ok) { state.map.floor = floorsBefore; continue; }
    placedList.push(id);
  }
  rebuildOccupancy(state); Syn.recomputeZones(state);
  const active = new Set(state.zones.map(z => z.id));
  if (!best || active.size > best.n) best = { n: active.size, objs: state.objects.map(o => [o.defId, o.x, o.y, o.rot || 0]), floors: [], active: [...active], state_floors: state.map.floor.map((r, y) => r.map((f, x) => f ? [f, x, y] : null).filter(Boolean)).flat() };
}
console.log('best zones active:', best.n, best.active.join(','));
best.floors = best.state_floors;
console.log('export const L0_COMBO = ' + JSON.stringify({ objs: best.objs, floors: best.floors }) + ';');
