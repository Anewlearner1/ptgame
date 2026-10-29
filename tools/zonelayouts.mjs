// Hand-verified zone layouts shared by tools/audit.mjs (zones section), tools/zonesui.mjs and the balance harness.
//   TEMPLATES[zoneId] = { objs: [[defId, dx, dy, rot?]], floors: [[floorId, dx, dy]], w, h }   (relative, top-left origin)
//   Each template alone activates exactly its zone on an EMPTY lot with the entry tile free (checked by the audit with the real
//   build.js placement rules). `placeTemplate` places one with the real placeObject / paintFloor (so unlocks, money and
//   "don't wall anything in" apply); `flip` transposes it (swap x/y, toggle rot) which doubles the number of spots it fits.
//   L0_COMBO = an explicit list that puts 13 different zones active at once on the 12x10 starter lot (x10..21, y10..19).
export const TEMPLATES = {
  golden3:      { objs: [['heatbox', 0, 0], ['tens', 1, 0], ['traction', 2, 0]], floors: [] },
  premium:      { objs: [['manual_room', 0, 0], ['shockwave', 2, 0], ['coffee', 2, 1]], floors: [] },
  kidpark:      { objs: [['ball_pit', 0, 0], ['soft_mat', 2, 0], ['bookshelf', 2, 1]], floors: [] },
  waitRoom:     { objs: [['sofa', 0, 0], ['tv', 2, 0], ['water', 0, 1], ['plant', 1, 1]], floors: [] },
  restStation:  { objs: [['rest_room', 0, 0], ['water', 2, 0]], floors: [] },
  sportsRehab:  { objs: [['redcord', 0, 0], ['bed', 2, 0], ['soft_mat', 0, 2]], floors: [] },
  elderPath:    { objs: [['sofa', 0, 0], ['sign', 2, 0]], floors: [['ramp', 0, 1], ['ramp', 1, 1], ['ramp', 2, 1]] },
  orthoStation: { objs: [['exam_room', 0, 0], ['us_room', 2, 0], ['bed', 0, 2, 1]], floors: [] },
  hotCold:      { objs: [['ir_lamp', 0, 0], ['heatbox', 1, 0], ['bed', 0, 1]], floors: [] },
  kidLearn:     { objs: [['si_room', 0, 0], ['speech_room', 3, 0], ['fine_table', 3, 2]], floors: [] },
  kidCorner:    { objs: [['fine_table', 0, 0], ['bookshelf', 2, 0], ['soft_mat', 0, 1]], floors: [] },
  flagship:     { objs: [['laser_room', 0, 0], ['shockwave_room', 2, 0], ['manual_room', 4, 0]], floors: [] },
  staffBack:    { objs: [['rest_room', 0, 0], ['coffee', 2, 0], ['water', 2, 1], ['plant', 3, 0]], floors: [] },
  cafeNook:     { objs: [['sofa', 0, 0], ['tv', 2, 0], ['coffee', 0, 1], ['plant', 1, 1]], floors: [] },
  regDesk:      { objs: [['reception', 0, 0], ['sign', 2, 0], ['sofa', 0, 1], ['water', 2, 1]], floors: [] },
};

// zones a template ALSO activates because its parts overlap another zone's needs (e.g. rest_room + water = restStation)
export const ALSO = { staffBack: ['restStation'] };

export const L0_COMBO = {
  objs: [['manual_room', 18, 15, 1], ['shockwave', 18, 17, 1], ['coffee', 19, 17, 1], ['rest_room', 18, 10, 0], ['water', 20, 10, 0],
    ['laser_room', 10, 14, 1], ['shockwave_room', 10, 16, 1], ['manual_room', 10, 18, 1], ['fine_table', 13, 15, 1], ['bookshelf', 13, 17, 1],
    ['soft_mat', 14, 15, 1], ['heatbox', 13, 11, 0], ['tens', 14, 11, 0], ['traction', 15, 11, 0], ['redcord', 18, 12, 0], ['bed', 20, 12, 0],
    ['soft_mat', 18, 14, 0], ['sofa', 13, 13, 0], ['tv', 15, 13, 0], ['coffee', 13, 14, 0], ['plant', 14, 14, 0], ['exam_room', 15, 15, 1],
    ['us_room', 15, 17, 1], ['bed', 17, 15, 0], ['sofa', 20, 17, 1], ['sign', 20, 19, 1], ['ir_lamp', 16, 10, 0], ['heatbox', 17, 10, 0],
    ['bed', 16, 11, 0], ['reception', 10, 11, 1], ['sign', 10, 13, 1], ['sofa', 11, 11, 1], ['water', 11, 13, 1]],
  floors: [['ramp', 21, 17], ['ramp', 21, 18], ['ramp', 21, 19]],
};

// Place template `id` at (ox,oy) through the real build rules. Returns the placed object list, or null (state may be partly filled:
// callers on a scratch lot just clear it). `B` = sim/build.js.
export function placeTemplate(B, state, id, ox, oy, flip = false, tpl = TEMPLATES) {
  const t = tpl[id];
  if (!t) return null;
  const placed = [];
  for (const [d, dx, dy, rot] of t.objs) {
    const x = ox + (flip ? dy : dx), y = oy + (flip ? dx : dy);
    const o = B.placeObject(state, d, x, y, flip ? (rot ? 0 : 1) : (rot || 0));
    if (!o) return null;
    placed.push(o);
  }
  for (const [f, dx, dy] of t.floors || []) if (!B.paintFloor(state, f, ox + (flip ? dy : dx), oy + (flip ? dx : dy))) return null;
  return placed;
}
export function placeCombo(B, state, combo = L0_COMBO) {
  for (const [d, x, y, rot] of combo.objs) if (!B.placeObject(state, d, x, y, rot || 0)) return false;
  for (const [f, x, y] of combo.floors || []) if (!B.paintFloor(state, f, x, y)) return false;
  return true;
}
// Try every spot of the lot (both orientations) until the template fits; returns the placed objects or null.
// Rolls back its own partial placement (objects + floors) when a spot fails. Used by the balance harness on bigger lots.
export function placeTemplateAnywhere(B, state, id, rnd = Math.random, tpl = TEMPLATES, accept = null) {
  const L = state.lot;
  const spots = [];
  for (let y = L.y0; y < L.y0 + L.h; y++) for (let x = L.x0; x < L.x0 + L.w; x++) for (const flip of [false, true]) spots.push([x, y, flip]);
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  for (const [x, y, flip] of spots) {
    const nObj = state.objects.length, nextId = state.nextId, floors = state.map.floor.map(r => r.slice()), money = state.money, ledger = JSON.stringify(state.ledger);
    const placed = placeTemplate(B, state, id, x, y, flip, tpl);
    if (placed && (!accept || accept(placed))) return placed;
    state.objects.length = nObj; state.nextId = nextId; state.map.floor = floors; state.money = money; state.ledger = JSON.parse(ledger);   // roll back (caller refreshes occupancy / zones)
  }
  return null;
}
