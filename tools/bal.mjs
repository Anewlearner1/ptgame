// Headless balance harness for the restaurant economy (no browser): runs the real sim for N months and prints a monthly table.
// usage: node tools/bal.mjs policy=starter|good|expert months=12 seed=1 [events=0] [quiet=1]
//   starter : the pre-built shop, no player actions
//   good    : + bench / water / more tables, rest room, 2nd cook & ramp strip
//   expert  : good + research greedily, adds specials stations, hires, expands when allowed
// Output columns: month, guests (simulated), sales (menu+special), food cost, margin, salary+rent+maintain, net, money, rep, sat, skipped steps.
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../js/', import.meta.url));
class LS { constructor() { this.m = new Map(); } get length() { return this.m.size; } key(i) { return [...this.m.keys()][i]; } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new LS();
const { state, ui } = await import(R + 'core/state.js');
const { bus } = await import(R + 'core/bus.js');
const { rebuildOccupancy } = await import(R + 'core/grid.js');
const { advanceClock } = await import(R + 'sim/calendar.js');
const Eco = await import(R + 'sim/economy.js');
const Ev = await import(R + 'sim/events.js');
const Res = await import(R + 'sim/research.js');
const Ins = await import(R + 'sim/inspection.js');
const { recomputeZones } = await import(R + 'sim/synergy.js');
const { recomputeMods } = await import(R + 'sim/modifiers.js');
const B = await import(R + 'sim/build.js');
const P = await import(R + 'sim/patients.js');
const S = await import(R + 'sim/staff.js');
const Ach = await import(R + 'sim/achievements.js');
const EQ = await import(R + 'sim/equipment.js');
const Car = await import(R + 'sim/career.js');
const { BUILDABLES } = await import(R + 'data/buildables.js');
const { RESEARCH } = await import(R + 'data/research.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const POLICY = args.policy || 'starter';
const MONTHS = +(args.months || 12);
const QUIET = !!args.quiet;
let seed = +(args.seed || 1);
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
if (args.events === '0') Ev.EVENT_TUNE.CHANCE = 0;
const { LOTS } = await import(R + 'data/lots.js');
if (args.w) for (const l of LOTS) l.patientWeight = +args.w;
if (args.cap) { const k = +args.cap; LOTS.forEach((l, i) => { l.maxPatientsPerWeek = Math.round(l.maxPatientsPerWeek * k); }); }
if (args.tune) for (const kv of args.tune.split(',')) { const [k, v] = kv.split(':'); if (k in P.TUNE) P.TUNE[k] = +v; }

function refresh() { rebuildOccupancy(state); recomputeZones(state); recomputeMods(state); ui.dirtyOcc = false; }
Eco.initEconomy(); Ev.initEvents(); Res.initResearch(); Ins.initInspection(); Ach.initAchievements(); Car.initCareer();
bus.on('mods:dirty', () => recomputeMods(state));
bus.on('map:changed', () => { ui.dirtyOcc = true; });
bus.on('week:end', () => P.closeUp(state));
bus.on('month:start', () => S.refreshPool(state));
bus.on('toast', () => {});
// auto-resolve every decision: pick the first affordable option
bus.on('event:show', () => resolve());
bus.on('dilemma:show', () => resolve());
function resolve() {
  const pd = state.events.pendingDilemma; if (!pd) return;
  // greedy owner: best (money + 8000 x reputation) among affordable options (chance options score their win/lose mix)
  const fxv = (fx) => ((fx && fx.money) || 0) + 8000 * ((fx && fx.reputation) || 0) - 3000 * ((fx && fx.risk) || 0);
  let best = -1, bs = -Infinity;
  pd.choices.forEach((c, i) => {
    if (!Ev.choiceAffordable(state, c)) return;
    const v = c.chance ? c.chance.p * fxv(c.chance.win.effects) + (1 - c.chance.p) * fxv(c.chance.lose.effects) : fxv(c.effects);
    if (v > bs) { bs = v; best = i; }
  });
  Ev.resolveDilemma(state, best < 0 ? pd.choices.length - 1 : best);
}
B.seedStarterShop(state); S.refreshPool(state); refresh();

function buy(defId, x, y, rot = 0) { const o = B.placeObject(state, defId, x, y, rot); if (o) refresh(); else if (args.dbg) console.log('buy fail', defId, x, y, B.canPlace(state, defId, x, y, rot).reason); return !!o; }
function autoBuy(defId) {
  const def = BUILDABLES[defId]; if (!def || state.money < def.cost) return false;
  const L = state.lot, c = [];
  for (let rot = 0; rot < (def.w === def.h ? 1 : 2); rot++) for (let y = L.y0; y < L.y0 + L.h - 3; y++) for (let x = L.x0; x < L.x0 + L.w; x++) {
    const w = rot ? def.h : def.w; let bad = false;
    for (let dx = 0; dx < w; dx++) if (x + dx === 14 || x + dx === 15) bad = true;
    if (bad) continue;
    c.push({ x, y, rot, d: (y - L.y0) * 3 + x * 0.1 + rot * 0.5 });
  }
  c.sort((a, b) => a.d - b.d);
  for (const s of c) if (B.canPlace(state, defId, s.x, s.y, s.rot).ok) return buy(defId, s.x, s.y, s.rot);
  return false;
}
function hireRole(role, minMoney = 0) {
  if (state.money < minMoney) return false;
  const c = state.hirePool.filter(x => x.role === role).sort((a, b) => b.skill - a.skill)[0];
  if (!c) return false;
  const s = S.hire(state, c.cid); if (s) refresh(); return !!s;
}
const count = (d) => state.objects.filter(o => o.defId === d).length;
const rcount = (r) => state.staff.filter(s => s.role === r).length;

if (POLICY === 'good' || POLICY === 'expert') {
  buy('bench', 12, 16); buy('water', 14, 18); buy('rest_room', 20, 10);
  buy('table2', 11, 17); buy('table4', 20, 17);
  for (let x = 10; x < 14; x++) B.paintFloor(state, 'ramp', x, 19);
}

let rec = null;
bus.on('month:settled', r => { rec = r; });
const hist = [];
let skipped0 = P.debug.skipped;
const step = 1;
let lastMonth = -1;
for (let guard = 0; guard < MONTHS * 4 * 720 / step + 10 && hist.length < MONTHS; guard++) {
  advanceClock(state, step);
  S.updateStaff(state, step);
  P.updatePatients(state, step);
  if (ui.dirtyOcc) refresh();
  if (rec) {
    const r = rec; rec = null;
    const st = state;
    hist.push(r);
    if (!QUIET) console.log(`Y${r.year} M${String(r.month).padStart(2)} sales=${String(r.menuIncome + r.specialIncome).padStart(8)} (special ${String(r.specialIncome).padStart(7)}) food=${String(r.food).padStart(7)} margin=${(r.margin * 100).toFixed(0)}% fixed=${String(r.salary + r.rent + r.maintain).padStart(7)} net=${String(r.net).padStart(8)} opNet=${String(r.net + r.build).padStart(8)} money=${String(Math.round(r.money)).padStart(9)} rep=${Math.round(st.reputation)} guestsMonth(last)=${st.history[st.history.length - 1].patients} sat=${st.history[st.history.length - 1].satisfaction} skipped=${P.debug.skipped - skipped0} risk=${r.risk}`);
    skipped0 = P.debug.skipped;
    ownerRepairs();
    if (POLICY === 'expert') expertTurn();
  }
}
function ownerRepairs() {
  // a sensible owner repairs broken gear and services worn gear every month (EQ = sim/equipment.js)
  for (const o of state.objects) {
    if (o.broken && state.money > 20000) { o.broken = false; o.wear = 0; Eco.spend(state, EQ.repairCost(o), 'maintain'); }
    else if (EQ.isWearable(o.defId) && EQ.wearOf(o) >= 55 && state.money > 60000) { o.wear = 0; Eco.spend(state, EQ.serviceCost(o), 'maintain'); }
  }
}
function expertTurn() {
  // research greedily (cheapest available), keep stations coming
  if (!state.research.current) {
    const opts = Object.values(RESEARCH).filter(n => Res.canStart(state, n.id).ok).sort((a, b) => a.cost - b.cost);
    if (opts.length) Res.start(state, opts[0].id);
  }
  const wants = ['teppan', 'ice_shop', 'dessert_bar', 'chef_table', 'wok_range', 'bbq_grill', 'hotpot_table', 'bar_counter', 'fryer', 'drink_bar', 'cold_case', 'table4', 'table4', 'table2', 'bench'];
  for (const d of wants) if (BUILDABLES[d] && B.isUnlocked(state, d) && count(d) < (d.startsWith('table') ? 4 : 1) && state.money > (BUILDABLES[d].cost * 2.5)) autoBuy(d);
  if (rcount('barista') < 1 && state.objects.some(o => ['drink_bar', 'ice_shop', 'dessert_bar', 'bar_counter'].includes(o.defId))) hireRole('barista', 300000);
  if (rcount('cook') < 2) hireRole('cook', 400000);
  if (rcount('server') < 2) hireRole('server', 400000);
  const c = Ins.canExpand(state); if (c.ok && state.money > 2 * c.cost) Ins.expand(state);
}
const last = hist.slice(-Math.min(6, hist.length));
const avg = (f) => last.reduce((s, r) => s + f(r), 0) / Math.max(1, last.length);
console.log(`cured(total)=${(state.stats && state.stats.cured) || 0} patients(total)=${(state.stats && state.stats.patientsTotal) || 0}`);
console.log(`\n${POLICY}: avg last ${last.length} months  sales=${Math.round(avg(r => r.menuIncome + r.specialIncome))} net=${Math.round(avg(r => r.net))} opNet=${Math.round(avg(r => r.net + r.build))} margin=${(avg(r => r.margin) * 100).toFixed(0)}%  money=${Math.round(state.money)} rep=${Math.round(state.reputation)} dishes/skips=${JSON.stringify({ skipped: P.debug.skipped, skippedRole: P.debug.skippedRole || 0, selfReg: P.debug.selfReg, upsellOffers: P.debug.upsellOffers, upsells: P.debug.upsells })}`);
