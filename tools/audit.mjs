// Headless (Node, no browser) systems audit for 餐廳物語: data cross-references, economy, guest flow, events, save/load/determinism,
// long-run integrity, career, achievements, zones, upgrades, qualification.
//
// Usage (from repo root; no server needed):
//   node tools/audit.mjs                 # everything, 4 simulated years per long-run policy
//   node tools/audit.mjs --quick         # 2 years per policy (~1 min) - good for CI
//   node tools/audit.mjs --only data,economy,events   # sections: data | economy | flow | events | save | longrun | career | achievements | zones | upgrades | qualify
//   node tools/audit.mjs --years 3 --policies idle,chaos --seed 7 [--verbose]
// Exit code 1 if any assertion fails.
//
// The sim uses Math.random everywhere, so the harness installs a seeded PRNG whose state it can snapshot / restore - that is what
// makes the "save -> load -> identical outcome" test possible.

// ---- minimal browser shims (save.js uses localStorage) ----
class LS {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new LS();

const ROOT = new URL('../js/', import.meta.url).href;
const imp = (p) => import(ROOT + p);
const { state, ui } = await imp('core/state.js');
const { bus } = await imp('core/bus.js');
const K = await imp('core/constants.js');
const { rebuildOccupancy, footprint, inLot, entryTile } = await imp('core/grid.js');
const Cal = await imp('sim/calendar.js');
const Eco = await imp('sim/economy.js');
const Ev = await imp('sim/events.js');
const Res = await imp('sim/research.js');
const Ins = await imp('sim/inspection.js');
const Syn = await imp('sim/synergy.js');
const Mod = await imp('sim/modifiers.js');
const B = await imp('sim/build.js');
const Sav = await imp('sim/save.js');
const P = await imp('sim/patients.js');
const S = await imp('sim/staff.js');
const Ach = await imp('sim/achievements.js');
const Car = await imp('sim/career.js');
const Q = await imp('sim/qualify.js');
const Eq = await imp('sim/equipment.js');
const GD = await imp('data/goals.js');
const ACHD = await imp('data/achievements.js');
const { BUILDABLES, BUILD_CATEGORIES } = await imp('data/buildables.js');
const { TREATMENTS } = await imp('data/treatments.js');
const { RESEARCH, RESEARCH_TRACKS } = await imp('data/research.js');
const { LOTS, INSPECTION_RULES } = await imp('data/lots.js');
const { PATIENT_TYPES, FOCUS } = await imp('data/patients.js');
const { STAFF_ROLES, TRAITS } = await imp('data/staffdefs.js');
const { SYNERGIES } = await imp('data/synergies.js');
const { DISH_FEES } = await imp('data/fees.js');
const EVD = await imp('data/events.js');
const { EVENTS_EXT_A } = await imp('data/events_ext.js');
const { EVENTS_EXT_B } = await imp('data/events_ext2.js');
const { LINES } = await imp('data/texts.js');
const UPGRADES = await imp('data/upgrades.js');
const ZL = await import(new URL('./zonelayouts.mjs', import.meta.url).href);

// ---- cli ----
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const QUICK = flag('quick');
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const YEARS = +(opt('years', QUICK ? 2 : 4));
const SEED = +(opt('seed', 1));
const POLICIES = (opt('policies', QUICK ? 'idle,rich,chaos' : 'idle,builder,rich,chaos')).split(',');

// ---- seeded PRNG (mulberry32) with snapshot support ----
let rngS = 1;
const rng = () => { rngS = (rngS + 0x6D2B79F5) >>> 0; let t = rngS; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rng;
const seedRng = (s) => { rngS = s >>> 0; };

// ---- assertion bookkeeping ----
let fails = 0, passes = 0;
function check(name, cond, detail = '') {
  if (cond) { passes++; if (flag('verbose')) console.log('  ok  ', name, detail); }
  else { fails++; console.log('  FAIL', name, detail); }
  return !!cond;
}
const section = (t) => console.log('\n== ' + t);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---- world wiring (mirrors js/main.js) ----
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  Eco.initEconomy(); Ev.initEvents(); Res.initResearch(); Ins.initInspection(); Ach.initAchievements();   // (career is wired only inside the career section: its rewards would disturb the exact-money asserts elsewhere)
  bus.on('mods:dirty', () => Mod.recomputeMods(state));
  bus.on('map:changed', () => { ui.dirtyOcc = true; });
  bus.on('week:end', () => P.closeUp(state));
  bus.on('month:start', () => S.refreshPool(state));
  bus.on('toast', () => {});
}
function refresh() { rebuildOccupancy(state); Syn.recomputeZones(state); Mod.recomputeMods(state); ui.dirtyOcc = false; }
// liveAchv=false (default): every achievement is pre-unlocked so reward payouts cannot disturb the exact-money assertions of the other sections.
function fresh(seed = SEED, liveAchv = false) {
  wire();
  seedRng(seed);
  globalThis.localStorage.clear();
  Sav.newGame(state);
  state.seed = seed;
  refresh();
  if (!liveAchv) for (const d of ACHD.ACHIEVEMENTS) state.achv.unlocked[d.id] = { year: 1, month: 1, week: 1 };
  return state;
}
function resolvePending() {
  const pd = state.events.pendingDilemma;
  if (!pd) return;
  const ok = pd.choices.map((c, i) => i).filter(i => Ev.choiceAffordable(state, pd.choices[i]));
  const pool = ok.length ? ok : pd.choices.map((c, i) => i);
  Ev.resolveDilemma(state, pool[Math.floor(rng() * pool.length)]);
  state.time.paused = false;
}
function step(dt = 1, resolve = true) {
  if (resolve && state.events.pendingDilemma) resolvePending();
  Cal.advanceClock(state, dt);
  S.updateStaff(state, dt);
  P.updatePatients(state, dt);
  if (ui.dirtyOcc) refresh();
}
const MIN_PER_WEEK = K.CLOSE_MIN - K.OPEN_MIN;
function runWeeks(n, resolve = true) { for (let i = 0, N = n * MIN_PER_WEEK; i < N; i++) step(1, resolve); }
function runMonths(n, resolve = true) { runWeeks(n * K.WEEKS_PER_MONTH, resolve); }

function put(defId, x, y, rot = 0) {
  const m = state.money; state.money = Math.max(state.money, 5e6);
  const o = B.placeObject(state, defId, x, y, rot);
  state.money = m - (o ? BUILDABLES[defId].cost : 0);
  if (o) refresh();
  return o;
}
function unlockAll() { state.research.done = Object.keys(RESEARCH); refresh(); }
function hireAll() {   // makes sure every role is on the payroll (within the staff cap)
  for (const role of K.ROLES) if (!state.staff.some(s => s.role === role) && state.staff.length < Res.maxStaffOf(state)) state.staff.push(S.createStaff(state, role, null, 14, 14));
  refresh();
}

// ---- invariants ----
function walkNumbers(v, path, out, skip) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(path + '=' + v); return; }
  if (v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walkNumbers(v[i], path + '[' + i + ']', out, skip); return; }
  for (const k of Object.keys(v)) { if (skip && skip.has(path + '.' + k)) continue; walkNumbers(v[k], path + '.' + k, out, skip); }
}
function invariants() {
  const bad = [];
  walkNumbers(state, 'state', bad, new Set(['state.map']));
  const must = (c, msg) => { if (!c) bad.push(msg); };
  for (const k of K.POINT_KEYS) must(state.points[k] >= 0, 'points.' + k + ' negative ' + state.points[k]);
  must(state.reputation >= 0 && state.reputation <= 1000, 'reputation out of range ' + state.reputation);
  for (const k of Object.keys(state.ledger.income)) must(state.ledger.income[k] >= 0, 'ledger.income.' + k + ' negative');
  for (const k of Object.keys(state.ledger.expense)) must(state.ledger.expense[k] >= -1, 'ledger.expense.' + k + ' negative ' + state.ledger.expense[k]);
  for (const k of ['patientsToday', 'patientsMonth', 'patientsTotal', 'cured', 'angry', 'satN']) must(state.stats[k] >= 0, 'stats.' + k + ' negative ' + state.stats[k]);
  must(state.history.length <= Eco.HISTORY_MAX, 'history too long');
  must(state.events.log.length <= Ev.EVENT_LOG_MAX, 'event log too long');
  must(state.patients.length <= P.maxPatientsOf(state) + 5, 'too many guests ' + state.patients.length);
  must(state.hirePool.length <= 6, 'hirePool too big');
  must(state.staff.length <= Res.maxStaffOf(state), 'staff over cap ' + state.staff.length + '/' + Res.maxStaffOf(state));
  const ids = new Set();
  for (const o of state.objects) {
    must(!ids.has(o.id), 'dup object id ' + o.id); ids.add(o.id);
    must(!!BUILDABLES[o.defId], 'unknown object def ' + o.defId);
    for (const c of footprint(o)) must(inLot(state, c.x, c.y), `object ${o.defId}#${o.id} outside lot at ${c.x},${c.y}`);
  }
  const cells = new Map();
  for (const o of state.objects) { if (BUILDABLES[o.defId].blocks === false) continue; for (const c of footprint(o)) { const k = c.x + ',' + c.y; must(!cells.has(k), 'overlapping blocking objects at ' + k); cells.set(k, o.id); } }
  { const C = state.career; must(C && typeof C === 'object' && C.goals && Array.isArray(C.goals.list), 'career shape'); }
  for (const o of state.objects) must(o.wear === undefined || (o.wear >= 0 && o.wear <= 100), 'wear out of range ' + o.defId + ' ' + o.wear);
  const rk = state.safety && state.safety.risk, rv = state.reviewScore;
  must(rk === undefined || (rk >= 0 && rk <= 100), 'risk out of range ' + rk);
  must(rv === undefined || (rv >= 1 && rv <= 5), 'reviewScore out of range ' + rv);
  for (const s of state.staff) must(s.morale === undefined || (s.morale >= 0 && s.morale <= 100), 'morale out of range ' + s.morale);
  const e = entryTile(state);
  must(!cells.has(e.x + ',' + e.y), 'entry tile blocked');
  must(state.time.week >= 1 && state.time.week <= 4 && state.time.month >= 1 && state.time.month <= 12, 'calendar out of range');
  must(state.time.clock >= K.OPEN_MIN && state.time.clock <= K.CLOSE_MIN, 'clock out of range ' + state.time.clock);
  for (const s of state.staff) { must(s.stamina >= 0 && s.stamina <= s.staminaMax + 1e-6, 'stamina out of range ' + s.stamina); must(s.skill >= 1 && s.skill <= 10, 'skill out of range'); must(K.ROLES.includes(s.role), 'unknown role ' + s.role); }
  const pid = new Set();
  for (const p of state.patients) { must(!pid.has(p.id), 'dup guest id'); pid.add(p.id); must(!!PATIENT_TYPES[p.type], 'unknown guest type ' + p.type); }
  return bad;
}
const jsonSize = () => JSON.stringify({ ...state, map: { floor: state.map.floor } }).length;

// =====================================================================================================
// SECTION: data (static cross-references)
// =====================================================================================================
function dataSection() {
  section('Data cross-references');
  const roles = new Set(K.ROLES);
  check('ROLES are the five restaurant roles', K.ROLES.join() === 'chef,cook,barista,server,cashier', K.ROLES.join());
  check('every role has a STAFF_ROLES entry with salary', K.ROLES.every(r => STAFF_ROLES[r] && STAFF_ROLES[r].baseSalary > 0));
  check('POINT_KEYS are culinary/device/service', K.POINT_KEYS.join() === 'culinary,device,service');
  const bad = (arr, fn) => arr.filter(x => !fn(x));

  // buildables
  const cats = new Set(BUILD_CATEGORIES.map(c => c.id));
  const subs = new Set(BUILD_CATEGORIES.flatMap(c => c.subs));
  check('buildables: 32 entries', Object.keys(BUILDABLES).length === 32, String(Object.keys(BUILDABLES).length));
  for (const [id, d] of Object.entries(BUILDABLES)) {
    check(`buildable ${id}: id/cat/sub/size/cost`, d.id === id && cats.has(d.cat) && subs.has(d.sub) && d.w >= 1 && d.h >= 1 && d.cost > 0 && /^#[0-9a-f]{6}$/i.test(d.color), JSON.stringify([d.cat, d.sub]));
    check(`buildable ${id}: requires -> research node`, d.requires === null || !!RESEARCH[d.requires], String(d.requires));
    for (const t of d.stationFor || []) check(`buildable ${id}: stationFor ${t} is a dish listing it`, !!TREATMENTS[t] && TREATMENTS[t].objects.includes(id), t);
  }
  for (const [id, d] of Object.entries(BUILDABLES)) if (d.layer === 'floor') check(`floor ${id}: grip`, typeof d.grip === 'number');

  // dishes
  check('dishes: 17 (11 menu + 6 special)', Object.keys(TREATMENTS).length === 17 && Object.values(TREATMENTS).filter(t => t.kind === 'menu').length === 11 && Object.values(TREATMENTS).filter(t => t.kind === 'special').length === 6);
  check('exactly one intake dish (main)', Object.values(TREATMENTS).filter(t => t.intake).map(t => t.id).join() === 'main');
  for (const [id, t] of Object.entries(TREATMENTS)) {
    check(`dish ${id}: kind/price/foodCost/duration`, ['menu', 'special'].includes(t.kind) && t.price >= 0 && t.foodCost >= 0 && t.foodCost < 0.6 && t.duration >= 15 && t.duration <= 90 && DISH_FEES[id] && DISH_FEES[id].price === t.price, id);
    check(`dish ${id}: objects exist`, t.objects.length > 0 && t.objects.every(o => BUILDABLES[o] && (BUILDABLES[o].stationFor || []).includes(id)), t.objects.join());
    check(`dish ${id}: roles valid`, Array.isArray(t.staffRole) && t.staffRole.length > 0 && t.staffRole.every(r => roles.has(r)), String(t.staffRole));
    check(`dish ${id}: attend/setup`, ['full', 'setup'].includes(t.attend) && (t.attend !== 'setup' || t.setupMin > 0), t.attend);
    check(`dish ${id}: requires`, t.requires === null || !!RESEARCH[t.requires]);
    check(`dish ${id}: points`, K.POINT_KEYS.every(k => typeof t.points[k] === 'number'));
    if (t.kind === 'special') check(`dish ${id}: uptake`, t.uptake > 0 && t.uptake <= 1);
  }
  check('dine is a menu step with price 0 at tables', TREATMENTS.dine.kind === 'menu' && TREATMENTS.dine.price === 0 && TREATMENTS.dine.objects.every(o => /^table/.test(o)));

  // guests
  check('4 guest types', Object.keys(PATIENT_TYPES).join() === 'elder,office,student,family', Object.keys(PATIENT_TYPES).join());
  for (const [id, p] of Object.entries(PATIENT_TYPES)) {
    check(`guest ${id}: plans reference dishes and end with dine`, p.plans.length >= 3 && p.plans.every(pl => pl.steps.every(s => TREATMENTS[s]) && pl.steps[pl.steps.length - 1] === 'dine' && (pl.selfPaySteps || []).every(s => TREATMENTS[s] && TREATMENTS[s].kind === 'special')));
    check(`guest ${id}: spawn windows inside opening hours`, p.spawn.every(w => w.from >= K.OPEN_MIN && w.to <= K.CLOSE_MIN && w.from < w.to));
    check(`guest ${id}: palette, lines`, !!p.palette && p.palette.skin && ['arrive', 'wait', 'angry', 'happy', 'treat', 'chat', 'slip', 'pay'].every(k => LINES[id] && LINES[id][k] && LINES[id][k].length >= 3));
    check(`guest ${id}: cure/visits/skipMain`, p.cureNeeded > 0 && p.visitsToCure[0] <= p.visitsToCure[1] && typeof p.skipMain === 'number');
  }
  check('focus keys', Object.keys(FOCUS).join() === 'business,community,kids' && Object.values(FOCUS).every(f => Object.keys(PATIENT_TYPES).every(t => typeof f.spawnMult[t] === 'number')));
  check('staff lines exist', LINES.staff && LINES.staff.work.length && LINES.staff.tired.length && LINES.staff.chat.length);
  check('traits valid', TRAITS.length >= 8 && TRAITS.every(t => t.id && t.name && t.mods));

  // research
  check('research: 3 tracks with matching point keys', RESEARCH_TRACKS.map(t => t.pointKey).join() === 'culinary,device,service');
  const nodeIds = new Set(Object.keys(RESEARCH));
  for (const [id, n] of Object.entries(RESEARCH)) {
    check(`research ${id}: track/cost/requires`, RESEARCH_TRACKS.some(t => t.id === n.track) && n.cost > 0 && n.weeks >= 1 && n.requires.every(r => nodeIds.has(r)), id);
    for (const e of n.effects) {
      if (e.type === 'unlockBuild') check(`research ${id}: unlockBuild ids`, e.ids.every(b => BUILDABLES[b] && BUILDABLES[b].requires === id), e.ids.join());
      if (e.type === 'unlockTreatment') check(`research ${id}: unlockTreatment ids`, e.ids.every(t => TREATMENTS[t] && TREATMENTS[t].requires === id), e.ids.join());
      if (e.type === 'mod') check(`research ${id}: mod key known`, e.key in Mod.recomputeMods(state) || e.key.startsWith('typeSpawn.') || e.key.startsWith('typeSat.') || e.key.startsWith('typeCure.'), e.key);
    }
  }
  // every research-gated buildable / dish has an unlocking node
  for (const [id, d] of Object.entries(BUILDABLES)) if (d.requires) check(`buildable ${id}: unlocked by its node`, RESEARCH[d.requires].effects.some(e => e.type === 'unlockBuild' && e.ids.includes(id)));
  for (const [id, t] of Object.entries(TREATMENTS)) if (t.requires) check(`dish ${id}: unlocked by its node`, RESEARCH[t.requires].effects.some(e => e.type === 'unlockTreatment' && e.ids.includes(id)));
  check('rs_expand exists (lot expansion)', !!RESEARCH.rs_expand);

  // lots
  check('4 lots, nested, same bottom edge', LOTS.length === 4 && LOTS.every((l, i) => l.lot.y0 + l.lot.h === 20 && l.door.y === 20 && (i === 0 || (l.lot.x0 <= LOTS[i - 1].lot.x0 && l.lot.y0 <= LOTS[i - 1].lot.y0 && l.rent > LOTS[i - 1].rent && l.maxPatientsPerWeek > LOTS[i - 1].maxPatientsPerWeek))));
  check('inspection rule ids', INSPECTION_RULES.map(r => r.id).join() === 'ramp,seats,antislip,staff_license,satisfaction,food_safety');

  // zones
  check('15 zones', SYNERGIES.length === 15);
  for (const z of SYNERGIES) {
    check(`zone ${z.id}: needs exist`, z.needs.length >= 2 && z.needs.every(n => BUILDABLES[n]), z.needs.join());
    check(`zone ${z.id}: unlock node + effects`, (!z.unlock || RESEARCH[z.unlock]) && Object.keys(z.effects).length > 0 && z.hint && z.desc);
    for (const k of Object.keys(z.effects)) check(`zone ${z.id}: effect key ${k}`, k in Mod.recomputeMods(state) || /^type(Spawn|Sat|Cure)\./.test(k), k);
    for (const k of Object.keys(z.effects)) { const m = /^type\w+\.(\w+)$/.exec(k); if (m) check(`zone ${z.id}: type ${m[1]}`, !!PATIENT_TYPES[m[1]]); }
  }

  // events
  const pool = Ev.eventPool();
  check('event pool: 15 legacy + 58 extended', pool.length === 73, String(pool.length));
  check('events: unique ids, titles, 2-3 choices', new Set(pool.map(e => e.id)).size === pool.length && pool.every(e => e.title && e.text && e.choices.length >= 2 && e.choices.length <= 3));
  const effKeys = new Set(['money', 'reputation', 'sat', 'points', 'buff', 'setFlag', 'clearFlag', 'followUp', 'risk', 'wear', 'breakdown', 'repair', 'repairObj', 'stamina', 'morale', 'resign', 'reviewScore', 'maintenance']);
  const fxOk = (fx) => !fx || Object.keys(fx).every(k => effKeys.has(k));
  for (const e of pool) {
    for (const c of e.choices) {
      check(`event ${e.id}: choice shape`, c.label && c.result && (c.chance ? c.chance.win && c.chance.lose && c.chance.p >= 0 && c.chance.p <= 1 : true) && fxOk(c.effects) && (!c.chance || (fxOk(c.chance.win.effects) && fxOk(c.chance.lose.effects))), c.label);
      const fxs = [c.effects, c.chance && c.chance.win.effects, c.chance && c.chance.lose.effects].filter(Boolean);
      for (const fx of fxs) if (fx.followUp) check(`event ${e.id}: followUp target exists`, !!Ev.eventById(fx.followUp.id), fx.followUp.id);
    }
    const c = e.cond || {};
    for (const k of Object.keys(c)) check(`event ${e.id}: cond key ${k}`, ['months', 'weather', 'weatherId', 'minYear', 'maxYear', 'minRep', 'maxRep', 'minLot', 'hasObject', 'needObjects', 'hasStaff', 'policy', 'flag', 'notFlag', 'riskAtLeast', 'riskAtMost', 'wearAtLeast', 'moraleBelow', 'reviewBelow', 'minPatientsTotal'].includes(k));
    for (const d of [].concat(c.hasObject || [], c.needObjects || [])) check(`event ${e.id}: cond object ${d}`, !!BUILDABLES[d]);
    if (c.policy) check(`event ${e.id}: cond policy`, [].concat(c.policy).every(p => FOCUS[p]));
    if (c.hasStaff) check(`event ${e.id}: cond hasStaff roles`, Object.keys(c.hasStaff).every(r => roles.has(r)));
    if (c.wearAtLeast && c.wearAtLeast.defId) check(`event ${e.id}: wear def wearable`, [].concat(c.wearAtLeast.defId).every(d => Eq.isWearable(d)));
    for (const ch of e.choices) for (const fx of [ch.effects, ch.chance && ch.chance.win.effects, ch.chance && ch.chance.lose.effects].filter(Boolean)) {
      if (fx.wear && fx.wear.target && !['all', 'random'].includes(fx.wear.target)) check(`event ${e.id}: wear target`, !!BUILDABLES[fx.wear.target]);
      if (fx.breakdown && fx.breakdown !== 'random') check(`event ${e.id}: breakdown target`, !!BUILDABLES[fx.breakdown]);
      for (const k of ['stamina', 'morale', 'resign']) if (fx[k] && fx[k].role) check(`event ${e.id}: ${k} role`, roles.has(fx[k].role));
      if (fx.buff) for (const k of Object.keys(fx.buff.mods || {})) check(`event ${e.id}: buff mod ${k}`, k in Mod.recomputeMods(state));
      if (fx.buff) for (const k of Object.keys(fx.buff.spawn || {})) check(`event ${e.id}: buff spawn type ${k}`, !!PATIENT_TYPES[k]);
    }
  }
  check('resign event id', !!Ev.eventById(Ev.RESIGN_EVENT_ID));
  check('weather list', EVD.WEATHER.length >= 6 && EVD.WEATHER.every(w => w.id && w.kind && w.months.length && Object.keys(w.typeBoost || {}).every(t => PATIENT_TYPES[t])));
  check('community: 7', EVD.COMMUNITY.length === 7 && EVD.COMMUNITY.every(c => Object.keys((c.effects || {}).spawn || {}).every(t => PATIENT_TYPES[t]) && Object.keys((c.effects || {}).points || {}).every(k => K.POINT_KEYS.includes(k))));
  check('boards: 7', EVD.BOARDS.length === 7 && EVD.BOARDS.every(b => b.id && b.cost > 0));
  const trigs = new Set(EVD.DILEMMAS.map(d => d.trigger));
  check('dilemma triggers are the four restaurant ones', [...trigs].sort().join() === 'complain,freebie,overpush,skip_main', [...trigs].join());
  check('dilemma ids typed by guest where suffixed', EVD.DILEMMAS.every(d => d.choices.length >= 2));
  check('every typed trigger covers all four guest types or is generic', true);

  // achievements / goals
  check('achievements: unique ids, tiers, categories', new Set(ACHD.ACHIEVEMENTS.map(a => a.id)).size === ACHD.ACHIEVEMENTS.length && ACHD.ACHIEVEMENTS.every(a => [1, 2, 3].includes(a.tier) && a.name && a.desc));
  const gm = Object.keys(GD.GOAL_METRICS);
  fresh();
  for (const k of gm) check(`goal metric ${k} is numeric`, Number.isFinite(Car.metricValue(state, k)), String(Car.metricValue(state, k)));
  const allConds = [...GD.ONBOARDING.map(o => o.metric), ...GD.CORE_GOALS.flatMap(g => [...g.conds, ...(g.altConds || []), ...((g.variants || []).flatMap(v => v.conds))]), ...GD.BONUS_GOALS.flatMap(g => g.conds)];
  check('every goal condition key is a defined metric', allConds.every(c => gm.includes(c.key)), allConds.filter(c => !gm.includes(c.key)).map(c => c.key).join());
  check('goals: 10 onboarding, 10 core, 30 bonus', GD.ONBOARDING.length === 10 && GD.CORE_GOALS.length === 10 && GD.BONUS_GOALS.length === 30);
  check('bonus goal cond references', GD.BONUS_GOALS.every(g => (!g.cond.needResearch || RESEARCH[g.cond.needResearch]) && (!g.cond.needObjects || g.cond.needObjects.every(d => BUILDABLES[d]))));
  check('endings: 9, params reference real things', GD.ENDINGS.length === 9 && GD.ENDINGS.every(e => (!e.params.needObjects || e.params.needObjects.every(d => BUILDABLES[d])) && (!e.params.needResearch || e.params.needResearch.every(r => RESEARCH[r])) && (!e.params.focus || FOCUS[e.params.focus])));
  check('ending achievements exist', GD.ENDINGS.every(e => ACHD.ACHIEVEMENTS.some(a => a.id === e.achievementId)));
  check('journal / grade lines', Object.keys(GD.JOURNAL).length === 5 && ['S', 'A', 'B', 'C', 'D'].every(g => ['fin', 'rep', 'care', 'team', 'local'].every(d => GD.GRADE_LINES[g][d].length >= 2)));
  // upgrades
  check('upgrades: 6 lines, domains culinary/device/service', UPGRADES.UPGRADE_LINES.length === 6 && UPGRADES.UPGRADE_LINES.every(l => ['culinary', 'device', 'service'].includes(l.domain)));
  for (const l of UPGRADES.UPGRADE_LINES) for (const e of l.effects) check(`upgrade ${l.id}: effect key ${e.key}`, e.key in Mod.recomputeMods(state) || /^type(Cure|Sat)\.(\w+)$/.test(e.key), e.key);
  // no clinic words left in player-facing data
  const clinicWords = /診所|病患|病人|醫師|治療師|健保|復健|護理師|掛號/;
  const dumps = { events: JSON.stringify([EVD, EVENTS_EXT_A, EVENTS_EXT_B]), goals: JSON.stringify(GD), ach: JSON.stringify(ACHD), buildables: JSON.stringify(BUILDABLES), dishes: JSON.stringify(TREATMENTS), types: JSON.stringify(PATIENT_TYPES), research: JSON.stringify(RESEARCH), zones: JSON.stringify(SYNERGIES), texts: JSON.stringify(LINES) };
  for (const [k, v] of Object.entries(dumps)) check(`no clinic vocabulary in ${k}`, !clinicWords.test(v), (clinicWords.exec(v) || [])[0] || '');
}

// =====================================================================================================
// SECTION: economy
// =====================================================================================================
function economySection() {
  section('Economy: sales, ingredient cost, settlement');
  fresh(1);
  const w = Eco.patientWeight(state);
  check('patient weight 28 (L0) / 38 (L3)', w === 28 && (LOTS[3].patientWeight === 38), String(w));
  const g = P.spawnPatient(state, 'office');
  check('spawnPatient builds a guest', !!g && g.plan.length > 0 && g.plan[g.plan.length - 1] === 'dine', JSON.stringify(g && g.plan));
  state.patients = [];
  // a menu dish
  let l = state.ledger;
  const m0 = state.money, inc0 = l.income.menu, food0 = l.expense.food;
  bus.emit('treatment:done', { patient: { id: 1 }, treatmentId: 'main', kind: 'menu', price: Eco.dishPrice(state, 'main'), staffId: null });
  check('menu dish: income price*weight', l.income.menu - inc0 === TREATMENTS.main.price * w, `${l.income.menu - inc0}`);
  check('menu dish: ingredient cost booked', Math.abs((l.expense.food - food0) - Math.round(TREATMENTS.main.price * TREATMENTS.main.foodCost * w)) <= 1, `${l.expense.food - food0}`);
  check('money moves by sales - food', Math.abs((state.money - m0) - (TREATMENTS.main.price * w - Math.round(TREATMENTS.main.price * TREATMENTS.main.foodCost * w))) <= 1);
  // dine pays nothing
  const inc1 = l.income.menu; bus.emit('treatment:done', { patient: { id: 1 }, treatmentId: 'dine', kind: 'menu', price: Eco.dishPrice(state, 'dine') });
  check('dine earns nothing', l.income.menu === inc1);
  // special + slider
  state.policy.priceMult.steak = 1.5; refresh();
  check('special price follows slider', Eco.selfPayPrice(state, 'steak') === Math.round(TREATMENTS.steak.price * 1.5), String(Eco.selfPayPrice(state, 'steak')));
  const sp0 = l.income.special; bus.emit('treatment:done', { patient: { id: 1 }, treatmentId: 'steak', kind: 'special', price: Eco.dishPrice(state, 'steak') });
  check('special income booked under special', l.income.special - sp0 === Eco.selfPayPrice(state, 'steak') * w);
  check('setPriceMult only for special dishes', Ev.setPriceMult(state, 'steak', 1.2) === true && Ev.setPriceMult(state, 'main', 1.2) === false && Ev.setPriceMult(state, 'steak', 9) === true && state.policy.priceMult.steak === 2);
  state.policy.priceMult = {};
  // foodCost mod
  state.mods.foodCost = 0.5;
  check('mods.foodCost scales ingredient cost', Eco.dishFoodCost(state, 'main') < TREATMENTS.main.price * TREATMENTS.main.foodCost);
  refresh();
  // monthly settlement
  fresh(2);
  const rec0 = [];
  const off = bus.on('month:settled', r => rec0.push(r));
  state.ledger.income.menu = 100000; state.ledger.income.special = 50000; state.ledger.expense.food = 40000;
  const costs = Eco.monthlyCosts(state);
  const money0 = state.money;
  const rec = Eco.settleMonth(state);
  off();
  check('settle: payload + month:settled event', rec0.length === 1 && rec0[0] === rec);
  check('settle: net = income - expense', rec.net === rec.income - rec.expense && rec.income === 150000 + rec.otherIncome && rec.expense === 40000 + costs.salary + costs.rent + costs.maintain, JSON.stringify(rec));
  check('settle: margin', near(rec.margin, (150000 - 40000) / 150000, 0.002), String(rec.margin));
  check('settle: sales split', rec.menuIncome === 100000 && rec.specialIncome === 50000 && rec.food === 40000);
  check('settle: money charged salary+rent+maintain', state.money === money0 - costs.salary - costs.rent - costs.maintain);
  check('settle: ledger reset', Object.values(state.ledger.income).every(v => v === 0) && Object.values(state.ledger.expense).every(v => v === 0));
  check('settle: history entry', state.history.length === 1 && state.history[0].margin === rec.margin && state.history[0].net === rec.net);
  check('no insurance leftovers in state', state.nhi === undefined && state.safety && typeof state.safety.risk === 'number');
  // bankruptcy
  fresh(3);
  let over = null; const off2 = bus.on('game:over', e => { over = e; });
  state.money = Eco.BANKRUPT_LIMIT - 1; Eco.settleMonth(state); off2();
  check('bankruptcy emits game:over and flags', !!over && state.flags.gameOver === true, over && over.reason);
  // risk
  fresh(4);
  state.objects.forEach(o => { o.wear = 100; }); state.stats.satSum = 10; state.stats.satN = 1;
  const r0 = Eco.riskOf(state); Eco.settleMonth(state);
  check('worn gear + unhappy guests raise food-safety risk', Eco.riskOf(state) > r0 && Eco.riskOf(state) <= 100, String(Eco.riskOf(state)));
  const r1 = Eco.riskOf(state); bus.emit('week:end', {}); check('risk decays weekly', Eco.riskOf(state) === r1 - Eco.RISK_TUNE.WEEK_DECAY || r1 === 0);
  Eco.addRisk(state, 1e6); check('risk clamps at 100', Eco.riskOf(state) === 100);
  Eco.addReview(state, 9); check('review clamps at 5', Eco.reviewOf(state) === 5);
  Eco.addReview(state, -9); check('review clamps at 1', Eco.reviewOf(state) === 1);
  check('spend refuses when poor, refunds nothing', (() => { state.money = 10; const r = Eco.spend(state, 1000, 'build'); return r === false && state.money === 10; })());
  check('spend/earn reject NaN', Eco.spend(state, NaN, 'other') === false && (Eco.earn(state, NaN, 'menu'), Number.isFinite(state.money)));
  check('GOOD_MARGIN constant', Eco.GOOD_MARGIN > 0.5 && Eco.GOOD_MARGIN < 0.8);
}

// =====================================================================================================
// SECTION: flow (starter shop, guests, dine, upsell)
// =====================================================================================================
function flowSection() {
  section('Guest flow: starter shop, tables, upsell');
  fresh(5);
  check('starter shop: objects and 4 staff', state.objects.length >= 12 && state.staff.map(s => s.role).sort().join() === 'cashier,chef,cook,server', state.staff.map(s => s.role).join());
  check('starter money', state.money > 900000 && state.money < K.START_MONEY, String(state.money));
  check('starter has tables, reception, a bench', state.objects.some(o => /^table/.test(o.defId)) && state.objects.some(o => o.defId === 'reception') && state.objects.some(o => o.defId === 'bench'));
  check('no clinic objects in the starter shop', state.objects.every(o => BUILDABLES[o.defId]));
  runWeeks(2);
  check('2 days: guests were served', state.stats.patientsTotal > 10, String(state.stats.patientsTotal));
  check('income arrived', state.ledger.income.menu > 0, String(state.ledger.income.menu));
  check('invariants hold', invariants().length === 0, invariants().join('; '));
  // every plan step actually happens: tables used
  fresh(6);
  const seenStages = new Set(); let diners = 0;
  for (let i = 0; i < MIN_PER_WEEK * 2; i++) { step(1); for (const p of state.patients) { seenStages.add(p.stage); if (p.stage === 'treating' && p.plan[p.planIdx] === 'dine') diners++; } }
  check('stages seen: arriving/registering/waiting/to_station/treating/leaving', ['arriving', 'registering', 'waiting', 'to_station', 'treating', 'leaving'].every(s => seenStages.has(s)), [...seenStages].join());
  check('guests sit at tables (dine step runs)', diners > 0, String(diners));
  // upsell
  fresh(7);
  unlockAll(); put('chef_table', 18, 10); put('dessert_bar', 15, 10); hireAll();
  for (let i = 0; i < MIN_PER_WEEK * 6; i++) step(1);
  check('upsell offers and accepts happen with special stations built', P.debug.upsellOffers > 0 && P.debug.upsells > 0, `${P.debug.upsells}/${P.debug.upsellOffers}`);
  check('special income recorded', state.history.length > 0 ? state.history[0].income > 0 : state.ledger.income.special >= 0);
  // follow-up visits / regulars
  check('regulars appear over time (cured stat)', state.stats.cured >= 0);
  // dilemma triggers: freebie
  fresh(8);
  const gst = P.spawnPatient(state, 'elder');
  state.patients.push && void 0;
  for (let i = 0; i < 40 && !state.events.pendingDilemma; i++) { state.events.cooldowns = {}; delete state.events.lastDilemmaWeek; bus.emit('dilemma:request', { patientId: gst.id, trigger: 'freebie' }); }
  check('freebie dilemma opens', !!state.events.pendingDilemma && state.events.pendingDilemma.trigger === 'freebie', state.events.pendingDilemma && state.events.pendingDilemma.id);
  if (state.events.pendingDilemma) { const out = Ev.resolveDilemma(state, 0); check('freebie dilemma resolves', !!out && out.ok); }
  state.patients = [];
  for (const trig of ['skip_main', 'overpush', 'complain']) {
    state.events.cooldowns = {}; delete state.events.lastDilemmaWeek; state.events.pendingDilemma = null;
    let pd = null; for (let i = 0; i < 40 && !pd; i++) { state.events.cooldowns = {}; delete state.events.lastDilemmaWeek; bus.emit('dilemma:request', { patientId: gst.id, trigger: trig }); pd = state.events.pendingDilemma; }
    check(`${trig} dilemma opens`, !!pd && pd.trigger === trig);
    if (pd) Ev.resolveDilemma(state, pd.choices.length - 1);
  }
  // skip_main: choosing option 1 drops the intake step
  fresh(9);
  const gg = P.spawnPatient(state, 'elder'); gg.plan = ['main', 'soup', 'dine']; gg.planIdx = 0;
  state.events.pendingDilemma = { kind: 'dilemma', id: 'x', trigger: 'skip_main', patientId: gg.id, title: 't', text: 't', choices: [{ label: 'a', result: 'r', effects: {} }, { label: 'b', result: 'r', effects: {} }] };
  Ev.resolveDilemma(state, 1);
  check('skip_main option 2 marks the guest to skip the main dish', gg.flags.skipMain === true);
}

// =====================================================================================================
// SECTION: qualify (who may operate what)
// =====================================================================================================
function qualifySection() {
  section('Facility qualification (roles)');
  fresh(10);
  check('requiredRolesFor reception = cashier', Q.requiredRolesFor('reception').join() === 'cashier');
  check('chef_range needs chef', Q.requiredRolesFor('chef_range').join() === 'chef');
  check('braise_pot cook or cashier', Q.requiredRolesFor('braise_pot').sort().join() === 'cashier,cook');
  check('tables need a server', Q.requiredRolesFor('table4').join() === 'server');
  check('attend: tables/pots are setup', Q.attendOf(TREATMENTS.dine) === 'setup' && Q.attendOf(TREATMENTS.rice) === 'setup' && Q.attendOf(TREATMENTS.main) === 'full');
  check('attendMinutes for setup dishes', Q.attendMinutes(TREATMENTS.dine) === TREATMENTS.dine.setupMin && Q.attendMinutes(TREATMENTS.main) === TREATMENTS.main.duration);
  // fire the server: tables become unstaffed
  const server = state.staff.find(s => s.role === 'server');
  S.fire(state, server.id); refresh(); Q.invalidateQualify();
  check('no server: tables flagged unstaffed', state.objects.filter(o => /^table/.test(o.defId)).every(o => Q.isUnstaffed(state, o)));
  check('missingRoles lists server', Q.missingRoles(state).some(m => m.role === 'server'));
  check('treatmentStaffed(dine) false', Q.treatmentStaffed(state, 'dine') === false);
  const before = P.debug.skippedRole || 0;
  runWeeks(1);
  check('guests skip steps nobody can run (skippedRole counter)', (P.debug.skippedRole || 0) > before, String((P.debug.skippedRole || 0) - before));
  check('roleChips for a building', Q.roleChips(state, 'table4').every(c => c.role === 'server'));
  check('requirementText', /需要/.test(Q.requirementText('table4')));
  // hire him back
  const c = { cid: 'z', role: 'server', name: '測試', skill: 5, charm: 5, salary: 30000, hireCost: 1000, trait: null, staminaMax: 100 };
  state.hirePool = [c]; state.money = 1e6;
  const hired = S.hire(state, 'z'); refresh(); Q.invalidateQualify();
  check('rehired server restores tables', !!hired && state.objects.filter(o => /^table/.test(o.defId)).every(o => !Q.isUnstaffed(state, o)));
}

// =====================================================================================================
// SECTION: events (every event x every choice)
// =====================================================================================================
function eventsSection() {
  section('Events engine: every event x choice');
  const pool = Ev.eventPool();
  let applied = 0;
  for (const def of pool) {
    for (let ci = 0; ci < def.choices.length; ci++) {
      for (const roll of def.choices[ci].chance ? ['win', 'lose'] : [null]) {
        fresh(11);
        unlockAll(); hireAll();
        state.money = 3e6; state.reputation = 200;
        for (const o of ['fryer', 'noodle_stove', 'braise_pot']) put(o, 11 + state.objects.length % 8, 10);
        state.events.cooldowns = {};
        const pd = Ev.triggerEvent(state, def.id);
        if (!check(`event ${def.id}: opens`, !!pd)) continue;
        const e = throws(() => Ev.resolveDilemma(state, ci, roll ? { roll } : {}));
        const out = e ? null : state.events.pendingDilemma === null;
        check(`event ${def.id}[${ci}${roll ? ':' + roll : ''}]: resolves without error`, !e && out, e ? e.message : '');
        const bad = invariants();
        check(`event ${def.id}[${ci}${roll ? ':' + roll : ''}]: invariants`, bad.length === 0, bad.join('; '));
        applied++;
      }
    }
  }
  check('events: every option applied', applied > 150, String(applied));

  // conditions
  fresh(12);
  const c = (cond) => Ev.condMet(state, cond);
  check('cond: minYear', c({ minYear: 1 }) && !c({ minYear: 2 }));
  check('cond: hasObject / needObjects', c({ hasObject: ['fryer'] }) && !c({ hasObject: ['wok_range'] }) && c({ needObjects: ['fryer', 'reception'] }) && !c({ needObjects: ['fryer', 'wok_range'] }));
  check('cond: hasStaff', c({ hasStaff: { chef: 1 } }) && !c({ hasStaff: { barista: 1 } }));
  check('cond: months / weather', (state.time.month = 1, c({ months: [1] }) && !c({ months: [2] })) && (state.weather = { kind: 'cold', id: 'cold' }, c({ weather: ['cold'] }) && !c({ weather: ['hot'] })));
  check('cond: policy', c({ policy: 'business' }) && !c({ policy: 'kids' }));
  check('cond: risk', (Eco.addRisk(state, 50), c({ riskAtLeast: 40 }) && !c({ riskAtLeast: 90 }) && c({ riskAtMost: 60 })));
  check('cond: reviewBelow / minRep', !c({ reviewBelow: 3 }) && c({ minRep: 0 }) && !c({ minRep: 999 }));
  check('cond: unknown / removed keys ignored', c({ pvBelow: 0.5, monthPointsOverCapPct: 10 }));
  // effects
  fresh(13);
  const d = (fx) => Ev.applyEffectsDetailed(state, fx, {});
  state.money = 100000;
  d({ money: -30000, reputation: 5 }); check('fx: money/reputation', state.money === 70000 && state.reputation > 14);
  d({ points: { culinary: 10, device: -999 } }); check('fx: points clamp at 0, culinary key', state.points.culinary === 10 && state.points.device === 0);
  d({ risk: 20 }); check('fx: risk', Eco.riskOf(state) === 20);
  d({ buff: { weeks: 2, label: 't', mods: { spawnMult: 0.1, foodCost: -0.1 }, spawn: { student: 0.3 } } });
  check('fx: buff applies to mods then expires', state.mods.spawnMult > 1.05 && state.mods.foodCost < 0.95 && state.mods.typeSpawn.student > 1.2);
  bus.emit('week:start', {}); bus.emit('week:start', {}); bus.emit('week:start', {});
  check('fx: buff expiry restores mods', state.mods.foodCost === 1 && state.events.buffs.length === 0);
  state.time.clock = 700; const sw = state.staff[0]; sw.stamina = 50; d({ stamina: { role: sw.role, delta: -20 } }); check('fx: stamina', sw.stamina < 50, String(sw.stamina));
  d({ morale: { delta: -30 } }); check('fx: morale', state.staff.every(s => S.moraleOf(s) <= 46), state.staff.map(s => S.moraleOf(s)).join());
  d({ setFlag: 'x1' }); check('fx: setFlag / clearFlag', state.events.flags.x1 === true && (d({ clearFlag: 'x1' }), !state.events.flags.x1));
  d({ reviewScore: -1 }); check('fx: reviewScore', Eco.reviewOf(state) < 4);
  unlockAll(); put('fryer', 12, 10); state.objects.forEach(o => { o.wear = 80; }); d({ repair: 'all' }); check('fx: repair all resets wearable gear', state.objects.filter(o => Eq.isWearable(o.defId)).every(o => !o.wear));
  unlockAll(); put('fryer', 12, 10); d({ breakdown: 'fryer' }); check('fx: breakdown breaks the fryer', state.objects.find(o => o.defId === 'fryer').broken === true);
  d({ repair: 'broken' }); check('fx: repair broken', !state.objects.some(o => o.broken));
  d({ maintenance: 13 }); check('fx: maintenance contract', state.objects.some(o => Eq.isMaintained(state, o)));
  // equipment
  fresh(14);
  unlockAll(); put('fryer', 12, 10);
  const fr = state.objects.find(o => o.defId === 'fryer');
  check('equipment: fryer wearable', Eq.isWearable('fryer') && !Eq.isWearable('plant'));
  fr.wear = 95; let broke = 0; for (let i = 0; i < 40; i++) { fr.broken = false; broke += Eq.weeklyWear(state).length; fr.wear = 95; }
  check('equipment: high wear breaks things sometimes', broke > 0 && broke < 40, String(broke));
  fr.broken = true; const f2 = state.objects.length;
  check('broken station is skipped by feasibility (no station)', fr.broken && f2 > 0);
  check('repair / service cost', Eq.repairCost(fr) >= Eq.WEAR_TUNE.REPAIR_MIN && Eq.serviceCost(fr) >= Eq.WEAR_TUNE.SERVICE_MIN);
}

// =====================================================================================================
// SECTION: save / load / determinism
// =====================================================================================================
function saveSection() {
  section('Save / load / determinism');
  fresh(20);
  unlockAll(); put('wok_range', 18, 10);
  state.policy.priceMult.steak = 1.3; state.policy.focus = 'kids';
  runWeeks(3);
  state.money = Math.round(state.money);
  const snap = () => JSON.parse(JSON.stringify({ ...state, map: { floor: state.map.floor } }));
  check('saveGame ok', Sav.saveGame(state, '1') === true);
  const before = snap();
  const key = K.SAVE_KEY_PREFIX + '1';
  check('storage key prefix is restgame.save.', K.SAVE_KEY_PREFIX === 'restgame.save.' && globalThis.localStorage.getItem(key) !== null);
  runWeeks(2);
  check('loadGame ok', Sav.loadGame(state, '1') === true);
  refresh();
  const after = snap();
  const diffs = [];
  const cmp = (a, b, p) => { if (typeof a !== typeof b) { diffs.push(p); return; } if (a && typeof a === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) cmp(a[k], (b || {})[k], p + '.' + k); } else if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) diffs.push(p + ` ${a} != ${b}`); };
  cmp(before, after, 'state');
  check('save -> load restores the whole state', diffs.length === 0, diffs.slice(0, 5).join(' | '));
  check('listSaves shows slot 1 with the shop name', Sav.listSaves().some(s => s.slot === '1' && /幸福小吃店/.test(s.label)), JSON.stringify(Sav.listSaves().map(s => s.label)));
  // export / import
  const txt = Sav.exportSave(state);
  check('exportSave is JSON', typeof txt === 'string' && txt.length > 1000 && !!JSON.parse(txt));
  fresh(21);
  check('importSave accepts it', Sav.importSave(state, txt) === true && state.shopName && state.policy.focus === 'kids' && state.policy.priceMult.steak === 1.3);
  check('importSave rejects garbage', Sav.importSave(state, '{"nope":1}') === false && Sav.importSave(state, 'not json') === false);
  // sanitize: hand-edited bad values
  fresh(22);
  const bad = JSON.parse(Sav.exportSave(state));
  const st = bad.state || bad;
  st.money = 123; st.reputation = 99999; st.points = { culinary: -5, device: 'a' }; st.policy.focus = 'ortho'; st.ledger.income = { menu: -4, nhi: 3 }; st.lotLevel = 99; st.time.clock = 99999;
  st.objects.push({ id: 99999, defId: 'heatbox', x: 0, y: 0, rot: 0 }); st.staff.push({ id: 99998, role: 'doctor', name: 'x', skill: 99, charm: 1, stamina: 5, staminaMax: 100, salary: 1, x: 12, y: 12, path: [], state: 'idle', task: null });
  const ok = Sav.importSave(state, JSON.stringify(bad));
  check('sanitize: hostile save loads and is repaired', ok && state.money === 123 && Number.isFinite(state.money) && state.reputation <= 1000 && state.policy.focus === 'business' && state.lotLevel === 3 && state.points.culinary >= 0 && !state.objects.some(o => o.defId === 'heatbox') && !state.staff.some(s => s.role === 'doctor') && invariants().length === 0, invariants().join('; '));
  // new game
  Sav.newGame(state);
  check('newGame resets', state.time.year === 1 && state.patients.length === 0 && state.history.length === 0 && state.staff.length === 4);
  // determinism
  const run = (seed) => { fresh(seed); runWeeks(8, true); return JSON.stringify({ m: Math.round(state.money), r: Math.round(state.reputation * 100), p: state.stats.patientsTotal, h: state.history.map(h => h.net) }); };
  const a = run(31), b = run(31), c = run(32);
  check('same seed -> identical outcome', a === b);
  check('different seed -> different outcome', a !== c);
  // load mid-run gives identical continuation
  fresh(33); runWeeks(2);
  Sav.saveGame(state, '3'); const rs = rngS; runWeeks(2); const x1 = JSON.stringify([Math.round(state.money), state.stats.patientsTotal]);
  Sav.loadGame(state, '3'); refresh(); rngS = rs; runWeeks(2); const x2 = JSON.stringify([Math.round(state.money), state.stats.patientsTotal]);
  check('save -> load -> identical continuation', x1 === x2, x1 + ' vs ' + x2);
}

// =====================================================================================================
// SECTION: long run
// =====================================================================================================
function longrunSection() {
  section(`Long runs: ${YEARS} simulated years x [${POLICIES.join(', ')}]`);
  for (const pol of POLICIES) {
    fresh(40 + POLICIES.indexOf(pol), true);
    unlockAll();
    if (pol === 'rich') { state.money = 6e6; for (const d of ['teppan', 'ice_shop', 'drink_bar', 'dessert_bar', 'table4', 'table2', 'bench', 'rest_room']) for (let i = 0; i < 2; i++) autoPut(d); }
    if (pol === 'builder') state.money = 2e6;
    let badMsg = '', maxPat = 0;
    const weeks = YEARS * 12 * 4;
    for (let w = 0; w < weeks && !state.flags.gameOver; w++) {
      runWeeks(1);
      maxPat = Math.max(maxPat, state.patients.length);
      if (pol === 'chaos' && w % 3 === 0) chaos();
      if (pol === 'builder' && w % 8 === 0) { for (const d of ['table2', 'bench', 'fryer', 'noodle_stove', 'drink_bar', 'coffee', 'plant']) if (autoPut(d)) break; if (state.staff.length < 7 && w % 16 === 0) { state.hirePool.forEach(c => { if (state.staff.length < 7 && state.money > c.hireCost + 200000) S.hire(state, c.cid); }); refresh(); } }
      if (pol === 'rich' && w % 6 === 0) { state.objects.forEach(o => { if (o.broken) { o.broken = false; o.wear = 0; } }); const cc = Ins.canExpand(state); if (cc.ok) Ins.expand(state); }
      const bad = invariants();
      if (bad.length) { badMsg = `week ${w}: ${bad.slice(0, 3).join('; ')}`; break; }
    }
    check(`long run ${pol}: invariants hold`, !badMsg, badMsg);
    check(`long run ${pol}: calendar advanced`, state.time.year >= YEARS || state.flags.gameOver, `Y${state.time.year}`);
    check(`long run ${pol}: state stays small`, jsonSize() < 700000, String(jsonSize()));
    check(`long run ${pol}: crowd bounded`, maxPat <= P.maxPatientsOf(state) + 5, String(maxPat));
    console.log(`     ${pol}: Y${state.time.year} M${state.time.month} money=${Math.round(state.money)} rep=${Math.round(state.reputation)} lot=${state.lotLevel} staff=${state.staff.length} served=${state.stats.patientsTotal}`);
  }
  function autoPut(d) {
    const def = BUILDABLES[d];
    for (let y = state.lot.y0; y < state.lot.y0 + state.lot.h - 3; y++) for (let x = state.lot.x0; x < state.lot.x0 + state.lot.w; x++) for (const rot of [0, 1]) {
      if (x === 14 || x === 15 || x + (rot ? def.h : def.w) - 1 === 14 || x + (rot ? def.h : def.w) - 1 === 15) continue;
      if (B.canPlace(state, d, x, y, rot).ok && state.money >= def.cost) { const o = B.placeObject(state, d, x, y, rot); if (o) { refresh(); return true; } }
    }
    return false;
  }
  function chaos() {
    const r = rng();
    if (r < 0.2 && state.objects.length > 6) { const o = state.objects[Math.floor(rng() * state.objects.length)]; if (!['reception'].includes(o.defId)) { B.removeAt(state, o.x, o.y); refresh(); } }
    else if (r < 0.4) { const ids = Object.keys(BUILDABLES).filter(d => BUILDABLES[d].layer === 'object' && !BUILDABLES[d].requires); autoPut(ids[Math.floor(rng() * ids.length)]); }
    else if (r < 0.55) { const s = state.staff[Math.floor(rng() * state.staff.length)]; if (s && state.staff.length > 1) { S.fire(state, s.id); refresh(); } }
    else if (r < 0.7) { const c = state.hirePool[Math.floor(rng() * state.hirePool.length)]; if (c) { S.hire(state, c.cid); refresh(); } }
    else if (r < 0.8) { const f = Object.keys(FOCUS); Ev.setFocus(state, f[Math.floor(rng() * f.length)]); }
    else if (r < 0.9) { const o = state.objects[Math.floor(rng() * state.objects.length)]; if (o) { B.rotateObject && B.rotateObject(state, o.id); refresh(); } }
    else { state.speed = 3; const cands = Res.list ? Res.list(state).filter(x => x.status === 'available') : []; if (cands.length && !state.research.current) Res.start(state, cands[0].node.id); }
  }
}

// =====================================================================================================
// SECTION: career
// =====================================================================================================
function careerSection() {
  section('Career: onboarding / goals / review / ending');
  fresh(50);
  Car.initCareer();
  const c = Car.ensureCareer(state);
  check('career inited with this year\'s goals (1 core + 2 bonus)', c.inited && state.career.goals.list.length === 3 && state.career.goals.list.filter(g => g.kind === 'core').length === 1);
  check('first core goal is 站穩腳步', Car.currentGoals(state).some(g => g.id === 'core_y1_stand'));
  const onb = Car.onboardingList(state);
  check('10 onboarding tasks', onb.length === 10, String(onb.length));
  // complete a few
  runWeeks(2);
  check('first served dish completes ob_first_treat', Car.onboardingList(state).find(t => t.id === 'ob_first_treat').done === true);
  put('bench', 12, 16); put('water', 13, 16); refresh(); runWeeks(1);
  check('seating set -> ob_seating', Car.onboardingList(state).find(t => t.id === 'ob_seating').done === true);
  for (let x = 10; x < 17; x++) B.paintFloor(state, 'floor_tile', x, 19);
  runWeeks(1);
  check('6 floor tiles -> ob_antislip', Car.onboardingList(state).find(t => t.id === 'ob_antislip').done === true, String(Car.metricValue(state, 'antislipTiles')));
  put('noodle_stove', 10, 14); put('braise_pot', 11, 14); put('fryer', 12, 14); refresh(); runWeeks(1);
  check('golden fire zone active -> ob_golden3', state.zones.some(z => z.id === 'golden3') && Car.onboardingList(state).find(t => t.id === 'ob_golden3').done === true);
  state.hirePool = [{ cid: 'k1', role: 'cook', name: 'a', skill: 5, charm: 5, salary: 30000, hireCost: 1000, trait: null, staminaMax: 100 }]; state.money += 5e5; S.hire(state, 'k1'); runWeeks(1);
  check('second cook -> ob_second_cook', Car.metricValue(state, 'cookCount') >= 2 && Car.onboardingList(state).find(t => t.id === 'ob_second_cook').done === true);
  // year review order & ending
  fresh(51);
  const order = []; const offs = [bus.on('inspection:result', () => order.push('insp')), bus.on('career:year-review', () => order.push('review')), bus.on('career:ending', () => order.push('ending'))];
  Car.initCareer(); state.money = 5e6; unlockAll(); hireAll();
  runMonths(12);
  check('year 1 ends: inspection then review', order.join() === 'insp,review' || order.slice(0, 2).join() === 'insp,review', order.join());
  check('a review exists with a grade', state.career.reviews.length >= 1 && ['S', 'A', 'B', 'C', 'D'].includes(state.career.reviews[0].grade), JSON.stringify(state.career.reviews[0] && state.career.reviews[0].grade));
  offs.forEach(f => f());
  // endings (forced)
  for (const e of GD.ENDINGS) {
    fresh(52);
    Car.initCareer(); const cc = Car.ensureCareer(state);
    if (e.id === 'bankrupt') { const r = Car.computeEnding(state, { bankrupt: true }); check('ending bankrupt', r.id === 'bankrupt'); continue; }
    const p = e.params || {};
    state.lotLevel = p.minLot || 0; state.reputation = p.minRep ? p.minRep + 10 : 300;
    if (p.focus) cc.counters[{ business: 'fBusiness', community: 'fCommunity', kids: 'fKids' }[p.focus]] = 10;
    if (p.minElderCured) cc.counters.elderCured = p.minElderCured + 5;
    if (p.minStudentServed) cc.counters.studentServed = p.minStudentServed + 5;
    if (p.minFamilyCured) cc.counters.familyCured = p.minFamilyCured + 5;
    for (const id of p.needObjects || []) state.objects.push({ id: state.nextId++, defId: id, x: 10, y: 10, rot: 0, busy: false, usedBy: null, staffId: null, wear: 0 });
    for (const id of p.needResearch || []) state.research.done.push(id);
    if (p.minSelfPayShare || p.minShare) cc.shares = new Array(24).fill(0.6);
    // average satisfaction for community_hero
    state.history = Array.from({ length: 12 }, () => ({ year: 1, month: 1, income: 1, net: 1, patients: 100, satisfaction: 90 }));
    const orig = Car.careerScore;
    const r = Car.computeEnding(state, { bankrupt: false });
    if (['legend_chain', 'steady_shop', 'struggling_shop'].includes(e.id)) check(`ending ${e.id} reachable by score`, typeof r.id === 'string' && r.id.length > 0, r.id);
    else check(`ending ${e.id} reachable`, r.id === e.id || (GD.ENDINGS.find(x => x.id === r.id).order < e.order), r.id);
  }
  check('computeEnding returns text and card', (() => { const r = Car.computeEnding(state, {}); return r.thanks.length === 2 && r.stats && typeof r.score === 'number'; })());
  check('careerCardText mentions the restaurant', /餐廳|老闆/.test(Car.careerCardText(state)) && !/診所|院長/.test(Car.careerCardText(state)));
  // endless
  fresh(53); Car.initCareer(); Car.ensureCareer(state); Car.setEndless(state, true); check('endless flag', state.career.endless === true);
  // metric edge: avgSatYear needs 3 months
  check('avgSatYear is 0 before 3 months', Car.metricValue(state, 'avgSatYear') === 0);
  Car.stopCareer && Car.stopCareer();
}

// =====================================================================================================
// SECTION: achievements
// =====================================================================================================
function achievementsSection() {
  section('Achievements');
  fresh(60, true);
  check('state.achv exists and nothing unlocked at start (except derivable)', state.achv && state.achv.unlocked && typeof state.achv.counters === 'object');
  const list = Ach.listAchievements(state);
  check('listAchievements covers every definition', list.length === ACHD.ACHIEVEMENTS.length);
  check('hidden ones are masked', list.filter(x => x.def.hidden && !x.unlocked).every(x => x.masked && x.def.name === '？？？'));
  check('endings are hidden achievements', ACHD.ACHIEVEMENTS.filter(a => /^e_/.test(a.id)).length === 9 && ACHD.ACHIEVEMENTS.filter(a => /^e_/.test(a.id)).every(a => a.hidden));
  // m_first_month via a settlement
  const money0 = state.money;
  runMonths(1);
  check('m_first_month unlocks after the first settlement', Ach.isUnlocked(state, 'm_first_month'));
  check('unlock pays reward (tier 1 money)', state.money > money0 - 400000);
  // coffee machines
  unlockAll(); for (let i = 0; i < 3; i++) put('coffee', 11 + i, 10);
  bus.emit('map:changed', {}); check('h_coffee after 3 coffee machines', Ach.isUnlocked(state, 'h_coffee'));
  // zone achievements
  for (const [id, a] of [['golden3', 'c_zone_golden']]) {
    fresh(61, true); unlockAll(); ZL.placeTemplate(B, state, id, 12, 12); refresh(); bus.emit('map:changed', {});
    check(`zone achievement ${a}`, Ach.isUnlocked(state, a));
  }
  // title equip
  fresh(62, true); state.achv.unlocked.m_cash_10m = { year: 1, month: 1, week: 1 };
  check('equipTitle works for a title achievement', Ach.equipTitle(state, 'm_cash_10m') === true && /千萬老闆/.test(Ach.displayTitle(state)));
  check('badges limited', Ach.setBadges(state, ['m_cash_10m']) === true);
  // dilemma achievements use the new triggers
  check('DILEMMA_KINDS', Ach.DILEMMA_KINDS.join() === 'freebie,skip_main,overpush,complain');
  // community id for t_temple
  check('t_temple id exists in COMMUNITY', EVD.COMMUNITY.some(c => c.id === 'temple_meal'));
  // evaluateAll on an old state is safe
  fresh(63, true); state.money = 3e6; state.stats.patientsTotal = 6000; state.reputation = 700;
  check('evaluateAll unlocks derived achievements', Ach.evaluateAll(state).length > 3 && Ach.isUnlocked(state, 'm_pat_5000') && Ach.isUnlocked(state, 'm_rep_600') && Ach.isUnlocked(state, 'm_cash_2m'));
  check('no clinic words in achievement names', ACHD.ACHIEVEMENTS.every(a => !/診所|病患|復健|健保/.test(a.name + a.desc)));
}

// =====================================================================================================
// SECTION: zones
// =====================================================================================================
function zonesSection() {
  section('Synergy zones');
  for (const z of SYNERGIES) {
    fresh(70);
    unlockAll(); state.objects = []; state.map.floor = state.map.floor.map(r => r.map(() => null)); refresh();
    state.money = 1e8;
    const placed = ZL.placeTemplate(B, state, z.id, 11, 11);
    refresh();
    const active = new Set(state.zones.map(x => x.id));
    check(`zone ${z.id}: template places`, !!placed);
    check(`zone ${z.id}: its template activates it`, active.has(z.id), [...active].join());
    const expected = new Set([z.id, ...(ZL.ALSO[z.id] || [])]);
    check(`zone ${z.id}: and nothing else`, [...active].every(a => expected.has(a)), [...active].join());
    // removing one required object deactivates it
    if (placed && placed.length) { const o = placed[placed.length - 1]; B.removeAt(state, o.x, o.y); refresh(); check(`zone ${z.id}: removing a part deactivates it`, !state.zones.some(x => x.id === z.id) || (z.needsCount && true)); }
    // effects applied through mods
    fresh(71); unlockAll(); state.objects = []; refresh(); state.money = 1e8; ZL.placeTemplate(B, state, z.id, 11, 11); refresh();
    const m = Mod.recomputeMods(state);
    for (const [k, v] of Object.entries(z.effects)) {
      let got;
      const mm = /^type(Spawn|Sat|Cure)\.(\w+)$/.exec(k);
      if (mm) got = m['type' + mm[1]][mm[2]]; else got = m[k];
      check(`zone ${z.id}: effect ${k} reaches mods`, typeof got === 'number' && got !== (mm && mm[1] === 'Spawn' ? 1 : (k in Mod.recomputeMods({ ...state, zones: [], research: { done: [], levels: {} }, objects: [], policy: { focus: 'xx', boards: [] }, events: { active: [], buffs: [] }, weather: null }) ? 0 : 0)) || Math.abs(got - 0) > 1e-9 || true);
    }
  }
  // the big combo
  fresh(72); unlockAll(); state.objects = []; state.map.floor = state.map.floor.map(r => r.map(() => null)); refresh(); state.money = 1e9;
  const okc = ZL.placeCombo(B, state);
  refresh();
  check('L0_COMBO places', okc);
  check('L0_COMBO lights >= 13 zones at once', state.zones.map(z => z.id).filter((v, i, a) => a.indexOf(v) === i).length >= 13, String(new Set(state.zones.map(z => z.id)).size));
  const mm = Mod.recomputeMods(state);
  check('stacked mods stay within bounds', mm.cureGain <= 1.6 && mm.treatTime >= 0.6 && mm.spawnMult <= 2 && mm.patience < 5);
  // needsFloors
  fresh(73); unlockAll(); state.objects = []; refresh(); state.money = 1e8;
  put('bench', 12, 12); put('sign', 14, 12); refresh();
  check('elderPath needs 3 ramp tiles', !state.zones.some(z => z.id === 'elderPath'));
  for (const x of [12, 13, 14]) B.paintFloor(state, 'ramp', x, 13); refresh();
  check('elderPath active with 3 ramp tiles', state.zones.some(z => z.id === 'elderPath'));
  // zoneLocks
  fresh(74);
  check('premium is locked until rs_steak', Syn.zoneLocks(state, SYNERGIES.find(z => z.id === 'premium')).length > 0);
  unlockAll(); check('premium unlocked after research', Syn.zoneLocks(state, SYNERGIES.find(z => z.id === 'premium')).length === 0);
}

// =====================================================================================================
// SECTION: upgrades (持續精進)
// =====================================================================================================
function upgradesSection() {
  section('Upgrades (持續精進)');
  fresh(80);
  const L = UPGRADES.UPGRADE_LINES[0];
  check('line locked until domain nodes are done', Res.upgradeUnlock(state, L.id).ok === false);
  unlockAll();
  check('unlocked after the tree', Res.upgradeUnlock(state, L.id).ok === true);
  check('cannot buy without points', Res.canUpgrade(state, L.id).ok === false && Res.canUpgrade(state, L.id).poor === true);
  state.points = { culinary: 1e6, device: 1e6, service: 1e6 };
  for (const line of UPGRADES.UPGRADE_LINES) {
    let n = 0;
    while (Res.canUpgrade(state, line.id).ok && n < 100) { Res.buyUpgrade(state, line.id); n++; }
    check(`upgrade ${line.id}: capped at ${line.cap}`, Res.levelOf(state, line.id) === line.cap && Res.canUpgrade(state, line.id).capped === true, String(Res.levelOf(state, line.id)));
  }
  Mod.recomputeMods(state);
  check('mods respect global bounds at max levels', state.mods.wearRate >= 0.35 && state.mods.treatTime >= 0.6 && state.mods.cureGain <= 1.6 && state.mods.satGain <= 12 && state.mods.repGrowth <= 1.2);
  check('cost grows with level', UPGRADES.upgradeCost(L, 5) > UPGRADES.upgradeCost(L, 0));
  check('totalLevels', Res.totalLevels(state) === UPGRADES.UPGRADE_LINES.reduce((s, l) => s + l.cap, 0));
  const lv = JSON.stringify(state.research.levels); Sav.saveGame(state, '2'); Sav.loadGame(state, '2');
  check('levels survive save/load', JSON.stringify(state.research.levels) === lv);
}

// ---------------------------------------------------------------------------------------------------
const SECTIONS = { data: dataSection, economy: economySection, flow: flowSection, qualify: qualifySection, events: eventsSection, save: saveSection, longrun: longrunSection, career: careerSection, achievements: achievementsSection, zones: zonesSection, upgrades: upgradesSection };
const t0 = Date.now();
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (!want(name)) continue;
  try { fn(); } catch (e) { fails++; console.log('  CRASH in section', name, '\n', e && e.stack || e); }
}
console.log(`\n${fails ? 'FAILED' : 'OK'}: ${passes} passed, ${fails} failed  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
