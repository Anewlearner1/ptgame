// Headless (Node, no browser) systems audit: PRD conformance, determinism / long-run integrity, edge cases.
//
// Usage (from repo root; no server needed):
//   node tools/audit.mjs                 # everything, 5 simulated years per long-run policy (a few minutes)
//   node tools/audit.mjs --quick         # 2 years per policy (~1-2 min) - good for CI
//   node tools/audit.mjs --only features,edge,save   # run only some sections: features | edge | save | longrun
//   node tools/audit.mjs --years 3 --policies idle,chaos --seed 7 [--verbose]
// Exit code 1 if any assertion fails. Prints a feature-conformance table at the end.
//
// The sim uses Math.random everywhere (state.seed is only informational), so the harness installs a seeded PRNG
// whose state it can snapshot / restore - that is what makes the "save -> load -> identical outcome" test possible.
import { readFileSync } from 'node:fs';

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
const { state, ui, defaultMods } = await imp('core/state.js');
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
const { BUILDABLES } = await imp('data/buildables.js');
const { TREATMENTS } = await imp('data/treatments.js');
const { RESEARCH } = await imp('data/research.js');
const { LOTS } = await imp('data/lots.js');
const { PATIENT_TYPES } = await imp('data/patients.js');
const EVD = await imp('data/events.js');
const { SYNERGIES } = await imp('data/synergies.js');

// ---- cli ----
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const QUICK = flag('quick');
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const YEARS = +(opt('years', QUICK ? 2 : 5));
const SEED = +(opt('seed', 1));
const POLICIES = (opt('policies', QUICK ? 'idle,rich,chaos' : 'idle,bad,builder,rich,chaos')).split(',');

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
const FEATURES = [];   // [feature, status, evidence]
function feature(name, status, evidence) { FEATURES.push([name, status, evidence]); }
const section = (t) => console.log('\n== ' + t);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- world wiring (mirrors js/main.js) ----
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  Eco.initEconomy(); Ev.initEvents(); Res.initResearch(); Ins.initInspection();
  bus.on('mods:dirty', () => Mod.recomputeMods(state));
  bus.on('map:changed', () => { ui.dirtyOcc = true; });
  bus.on('week:end', () => P.closeUp(state));
  bus.on('month:start', () => S.refreshPool(state));
  bus.on('toast', () => {});
}
function refresh() { rebuildOccupancy(state); Syn.recomputeZones(state); Mod.recomputeMods(state); ui.dirtyOcc = false; }
function fresh(seed = SEED) {
  wire();
  seedRng(seed);
  globalThis.localStorage.clear();
  Sav.newGame(state);
  state.seed = seed;
  refresh();
  return state;
}
function resolvePending() {
  const pd = state.events.pendingDilemma;
  if (!pd) return;
  Ev.resolveDilemma(state, Math.floor(rng() * pd.choices.length));
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
function monthsPassed() { return (state.time.year - 1) * 12 + state.time.month - 1; }

let opts_quietPut = false;
// place helper that bypasses affordability (cost is still deducted when money allows)
function put(defId, x, y, rot = 0) {
  const m = state.money; state.money = Math.max(state.money, 5e6);
  const o = B.placeObject(state, defId, x, y, rot);
  if (!o && !opts_quietPut) console.log('  (audit layout note) could not place', defId, x, y, B.canPlace(state, defId, x, y, rot).reason, (new Error().stack.split('\n')[2] || '').trim());
  state.money = m - (o ? BUILDABLES[defId].cost : 0);
  if (o) refresh();
  return o;
}
function clearObjects() { state.objects = []; refresh(); }
function triggerDilemma(patientId, trigger) {
  for (let i = 0; i < 40 && !state.events.pendingDilemma; i++) { state.events.cooldowns = {}; delete state.events.lastDilemmaWeek; bus.emit('dilemma:request', { patientId, trigger }); }
  return state.events.pendingDilemma;
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
  must(state.nhi.monthPoints >= 0 && state.nhi.weekPoints >= 0, 'nhi counters negative');
  for (const k of ['patientsToday', 'patientsMonth', 'patientsTotal', 'cured', 'angry', 'satN']) must(state.stats[k] >= 0, 'stats.' + k + ' negative ' + state.stats[k]);
  must(state.history.length <= Eco.HISTORY_MAX, 'history too long');
  must(state.events.log.length <= Ev.EVENT_LOG_MAX, 'event log too long');
  must(state.patients.length <= P.TUNE.MAX_PATIENTS + 5, 'too many patients ' + state.patients.length);
  must(state.hirePool.length <= 6, 'hirePool too big');
  must(state.staff.length <= Res.maxStaffOf(state), 'staff over cap ' + state.staff.length + '/' + Res.maxStaffOf(state));
  const ids = new Set();
  for (const o of state.objects) {
    must(!ids.has(o.id), 'dup object id ' + o.id); ids.add(o.id);
    for (const c of footprint(o)) must(inLot(state, c.x, c.y), `object ${o.defId}#${o.id} outside lot at ${c.x},${c.y}`);
  }
  const cells = new Map();
  for (const o of state.objects) { if (BUILDABLES[o.defId].blocks === false) continue; for (const c of footprint(o)) { const k = c.x + ',' + c.y; must(!cells.has(k), 'overlapping blocking objects at ' + k); cells.set(k, o.id); } }
  const e = entryTile(state);
  must(!cells.has(e.x + ',' + e.y), 'entry tile blocked');
  must(state.time.week >= 1 && state.time.week <= 4 && state.time.month >= 1 && state.time.month <= 12, 'calendar out of range');
  must(state.time.clock >= K.OPEN_MIN && state.time.clock <= K.CLOSE_MIN, 'clock out of range ' + state.time.clock);
  const sid = new Set();
  for (const s of state.staff) { must(!sid.has(s.id), 'dup staff id'); sid.add(s.id); must(s.stamina >= 0 && s.stamina <= s.staminaMax + 1e-6, 'stamina out of range ' + s.stamina); must(s.skill >= 1 && s.skill <= 10, 'skill out of range'); }
  const pid = new Set();
  for (const p of state.patients) { must(!pid.has(p.id), 'dup patient id'); pid.add(p.id); }
  return bad;
}
const jsonSize = () => JSON.stringify({ ...state, map: { floor: state.map.floor } }).length;
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

// =====================================================================================================
// SECTION: features (PRD conformance)
// =====================================================================================================
function featuresSection() {
  section('PRD conformance');

  // ---- 營業曆 ----
  {
    fresh();
    const seen = { 'week:end': 0, 'week:start': 0, 'month:end': 0, 'month:start': 0, 'year:end': 0, 'year:start': 0 };
    const offs = Object.keys(seen).map(k => bus.on(k, () => seen[k]++));
    runWeeks(48 * 2 + 1);
    offs.forEach(f => f());
    const t = state.time;
    const okCal = check('calendar: 2 years + 1 week -> year 3 month 1 week 2', t.year === 3 && t.month === 1 && t.week === 2, JSON.stringify(t));
    const okEv = check('calendar: event counts', seen['week:end'] === 97 && seen['month:end'] === 24 && seen['year:end'] === 2 && seen['year:start'] === 2 && seen['month:start'] === 24, JSON.stringify(seen));
    const okFmt = check('calendar: formatDate/formatClock', Cal.formatDate(state) === '第3年 1月 第2週' && /^\d\d:\d\d$/.test(Cal.formatClock(state)), Cal.formatDate(state));
    const c0 = state.time.clock; state.events.pendingDilemma = { kind: 'event', id: 'x', title: 't', text: '', choices: [{ label: 'a', effects: {}, result: '' }] };
    Cal.advanceClock(state, 5);
    const frozen = check('calendar: pending decision freezes clock', state.time.clock === c0);
    state.events.pendingDilemma = null;
    Cal.advanceClock(state, 5000);
    const okBig = check('calendar: giant dt keeps clock in range', state.time.clock >= K.OPEN_MIN && state.time.clock <= K.CLOSE_MIN, String(state.time.clock));
    feature('營業曆 年/月/週 + 事件', okCal && okEv && okFmt && frozen && okBig ? 'works' : 'partial', JSON.stringify(seen));
  }

  // ---- 月底健保結算 / 點值 / 薪水 ----
  {
    fresh();
    const cap = Eco.nhiCap(state);
    check('economy: cap from lot data', cap === LOTS[0].nhiCap, String(cap));
    state.nhi.monthPoints = cap - 1;
    check('economy: pv=1 under cap', Eco.getPointValue(state) === 1);
    state.nhi.monthPoints = cap * 1.25;
    check('economy: pv=cap/points above cap', near(Eco.getPointValue(state), 0.8, 1e-9), String(Eco.getPointValue(state)));
    state.nhi.monthPoints = cap * 10;
    check('economy: pv floor 0.6', Eco.getPointValue(state) === 0.6);
    const costs = Eco.monthlyCosts(state);
    state.nhi.monthPoints = cap * 2;
    const m0 = state.money;
    state.ledger.income.self = 123;
    const rec = Eco.settleMonth(state);
    const expectNhi = Math.round(cap * 2 * 0.6 * Eco.NHI_NTD_PER_POINT * Eco.REVENUE_SCALE);
    check('economy: settle nhi income = points*pv*scale', rec.nhiIncome === expectNhi, `${rec.nhiIncome} vs ${expectNhi}`);
    check('economy: salaries+rent+maintain charged', near(m0 + expectNhi - costs.salary - costs.rent - costs.maintain, state.money, 1), `${state.money}`);
    check('economy: ledger reset + history pushed + monthPoints reset', state.history.length === 1 && state.nhi.monthPoints === 0 && state.ledger.income.nhi === 0 && state.ledger.expense.salary === 0);
    check('economy: record has diluted flag', rec.diluted === true && rec.pointValue === 0.6);
    state.mods.wageMult = 0.5; state.mods.rentMult = 2;
    const c2 = Eco.monthlyCosts(state);
    check('economy: wageMult/rentMult applied', c2.salary === Math.round(costs.salary * 0.5) && c2.rent === costs.rent * 2, JSON.stringify(c2));
    state.mods = defaultMods();
    let over = 0; const off2 = bus.on('game:over', () => over++);
    state.money = Eco.BANKRUPT_LIMIT - 1; state.nhi.monthPoints = 0;
    Eco.settleMonth(state);
    check('economy: bankruptcy emits game:over once', over === 1, 'over=' + over);
    Eco.settleMonth(state);
    check('economy: game:over not re-emitted', over === 1);
    off2();
    fresh(); state.money = 1e9;
    for (let i = 0; i < Eco.HISTORY_MAX + 60; i++) { state.time.month = (i % 12) + 1; Eco.settleMonth(state); }
    check('economy: history capped at HISTORY_MAX months', state.history.length === Eco.HISTORY_MAX, String(state.history.length));
    for (let i = 0; i < 100; i++) Ins.runInspection(state);
    check('inspection: log capped', state.inspections.log.length <= 40, String(state.inspections.log.length));
    feature('月底健保結算 + 浮動點值打折 + 薪水/租金/維護', 'works', 'pv=cap/pts clamp 0.6..1; salaries/rent/maintain charged; bankrupt < -300k');
  }

  // ---- 資金 primitives ----
  {
    fresh();
    state.money = 1000;
    const l0 = JSON.stringify(state.ledger);
    check('spend: insufficient funds refused, nothing changes', Eco.spend(state, 1001, 'build') === false && state.money === 1000 && JSON.stringify(state.ledger) === l0);
    check('spend: exact balance ok', Eco.spend(state, 1000, 'build') === true && state.money === 0);
    state.money = 500;
    check('spend: NaN refused', Eco.spend(state, NaN, 'other') === false && Number.isFinite(state.money), String(state.money));
    check('spend: Infinity refused', Eco.spend(state, Infinity, 'other') === false && Number.isFinite(state.money), String(state.money));
    Eco.spend(state, -999, 'other');
    check('spend: negative amount is not a refund', state.money <= 500, String(state.money));
    Eco.earn(state, NaN, 'self'); Eco.earn(state, -5, 'self'); Eco.earn(state, Infinity, 'self');
    check('earn: NaN/negative/Infinity ignored', Number.isFinite(state.money) && state.money <= 500, String(state.money));
  }

  // ---- 研發點數: sources and sinks ----
  {
    fresh();
    runWeeks(8);
    const pts = { ...state.points };
    const okSrc = check('points: all three types gained by normal play (8 weeks)', pts.medical > 0 && pts.device > 0 && pts.service > 0, JSON.stringify(pts));
    const byTrack = { medical: [], device: [], service: [] };
    for (const n of Object.values(RESEARCH)) byTrack[n.track].push(n);
    const sinkInfo = {};
    for (const k of K.POINT_KEYS) sinkInfo[k] = `${byTrack[k].length} nodes, cost ${Math.min(...byTrack[k].map(n => n.cost))}-${Math.max(...byTrack[k].map(n => n.cost))}`;
    check('research: each track has >=6 nodes', K.POINT_KEYS.every(k => byTrack[k].length >= 6), JSON.stringify(sinkInfo));
    for (const k of K.POINT_KEYS) {
      fresh();
      const n = byTrack[k].filter(x => !x.requires.length).sort((a, b) => a.cost - b.cost)[0];
      state.points = { medical: 1000, device: 1000, service: 1000 };
      const ok = Res.start(state, n.id);
      const o = { medical: 1000, device: 1000, service: 1000 }; o[k] -= n.cost;
      check(`research: ${n.id} (${k}) debits only ${k}`, ok && JSON.stringify(state.points) === JSON.stringify(o), JSON.stringify(state.points));
    }
    const svc = byTrack.service;
    const hasAdmin = svc.some(n => (n.effects || []).some(e => e.type === 'mod' && e.key === 'walkSpeed'));
    const hasRep = svc.some(n => (n.effects || []).some(e => e.type === 'rep'));
    const gate = LOTS.map(l => l.requires && l.requires.research).filter(Boolean);
    const hasExpand = svc.some(n => (n.effects || []).some(e => e.type === 'maxStaff')) && gate.some(id => RESEARCH[id] && RESEARCH[id].track === 'service');
    check('service points sink: 行政效率 (walkSpeed)', hasAdmin);
    check('service points sink: 聲譽 (rep)', hasRep);
    check('service points sink: 擴建 (expansion gated on a service-track node)', hasExpand, JSON.stringify(LOTS.map(l => l.requires.research || null)));
    fresh(); state.points.service = 100; state.money = 1e6;
    const s0 = state.staff[0]; const sk = s0.skill;
    const trained = S.train(state, s0.id);
    check('service points sink: staff training consumes service points', trained && state.points.service === 90 && s0.skill === sk + 1, JSON.stringify(state.points));
    state.points.service = 5; const sk2 = s0.skill;
    check('training: insufficient service points refused', S.train(state, s0.id) === false && s0.skill === sk2);
    feature('三大研發點數 醫術/儀器/服務 來源', okSrc ? 'works' : 'partial', JSON.stringify(pts));
    feature('點數去處: 醫術/儀器 -> 研發解鎖; 服務 -> 行政/聲譽/擴建研發 + 員工訓練', hasAdmin && hasRep && hasExpand ? 'works' : 'partial', JSON.stringify(sinkInfo));
  }

  // ---- research tree integrity ----
  {
    fresh();
    const unlockedB = new Set(), unlockedT = new Set();
    for (const n of Object.values(RESEARCH)) for (const e of n.effects) { if (e.type === 'unlockBuild') e.ids.forEach(i => unlockedB.add(i)); if (e.type === 'unlockTreatment') e.ids.forEach(i => unlockedT.add(i)); }
    const missB = Object.values(BUILDABLES).filter(b => b.requires && !(unlockedB.has(b.id) || RESEARCH[b.requires]));
    check('research: every locked buildable has an unlocking node', missB.length === 0, missB.map(b => b.id).join());
    const missT = Object.values(TREATMENTS).filter(t => t.requires && !(unlockedT.has(t.id) || RESEARCH[t.requires]));
    check('research: every locked treatment has an unlocking node', missT.length === 0, missT.map(t => t.id).join());
    const dangling = Object.values(RESEARCH).flatMap(n => n.requires.filter(q => !RESEARCH[q]).map(q => n.id + '->' + q));
    check('research: no dangling prerequisites', dangling.length === 0, dangling.join());
    const done = new Set(); let prog = true;
    while (prog) { prog = false; for (const n of Object.values(RESEARCH)) if (!done.has(n.id) && n.requires.every(q => done.has(q))) { done.add(n.id); prog = true; } }
    check('research: whole tree reachable (acyclic)', done.size === Object.keys(RESEARCH).length, done.size + '/' + Object.keys(RESEARCH).length);
    const noStation = Object.values(TREATMENTS).flatMap(t => t.objects.filter(o => !BUILDABLES[o]).map(o => t.id + ':' + o));
    check('treatments: every station object exists', noStation.length === 0, noStation.join());
    const noKey = Object.values(RESEARCH).flatMap(n => n.effects.filter(e => e.type === 'mod' && !(e.key in defaultMods()) && !e.key.startsWith('typeSpawn.')).map(e => n.id + ':' + e.key));
    check('research: every mod effect targets a real mods key', noKey.length === 0, noKey.join());
    fresh(); state.points = { medical: 0, device: 0, service: 0 };
    check('research: start with insufficient points refused', Res.start(state, 'rs_evidence') === false && state.research.current === null);
    state.points.medical = 40;
    check('research: start with exact points ok', Res.start(state, 'rs_evidence') === true && state.points.medical === 0);
    check('research: only one at a time', Res.canStart(state, 'rs_heat').ok === false);
    state.points.device = 99;
    state.research.current = null;
    check('research: prerequisites enforced', Res.canStart(state, 'rs_shockwave').ok === false);
    fresh(); state.points.medical = 40; Res.start(state, 'rs_evidence');
    const rep0 = state.reputation;
    runWeeks(1);
    check('research: finishes after node.weeks weeks, rep applied, mods recomputed', Res.isDone(state, 'rs_evidence') && state.reputation >= rep0 + 3 && state.mods.elderSat >= 2);
    feature('研發樹 (unlock / prereq / 一次一項)', 'works', Object.keys(RESEARCH).length + ' nodes');
  }

  // ---- 建造 three categories ----
  {
    fresh();
    const cats = {};
    for (const b of Object.values(BUILDABLES)) (cats[b.cat] = cats[b.cat] || []).push(b.id);
    check('build: three categories env/facility/special populated', ['env', 'facility', 'special'].every(c => (cats[c] || []).length >= 3), Object.entries(cats).map(([k, v]) => k + ':' + v.length).join());
    const required = ['floor_mat', 'floor_wood', 'ramp', 'sofa', 'water', 'tv', 'plant', 'sign', 'reception', 'exam_room', 'us_room', 'rest_room', 'heatbox', 'tens', 'traction', 'ir_lamp', 'bed', 'redcord', 'shockwave_room', 'laser_room', 'manual_room', 'si_room', 'fine_table', 'speech_room', 'shockwave', 'coffee', 'ball_pit', 'soft_mat', 'bookshelf'];
    check('build: all required ids exist', required.every(i => BUILDABLES[i]), required.filter(i => !BUILDABLES[i]).join());
    feature('建造 環境/設施/特殊 三大類', 'works', Object.entries(cats).map(([k, v]) => k + ':' + v.length).join());
  }

  // ---- synergy zones end-to-end ----
  {
    fresh(); clearObjects(); state.money = 5e6;
    put('heatbox', 11, 11); put('tens', 12, 11);
    check('synergy: not active with 2/3', !Syn.isZoneActive(state, 'golden3') && state.mods.nhiTurnover === 1);
    put('traction', 13, 11, 0);
    check('synergy golden3 active -> nhiTurnover 1.2, elderSat +8', Syn.isZoneActive(state, 'golden3') && near(state.mods.nhiTurnover, 1.2) && near(state.mods.elderSat, 8), JSON.stringify([state.mods.nhiTurnover, state.mods.elderSat]));
    fresh(); clearObjects(); put('heatbox', 11, 11); put('tens', 12, 11); put('traction', 15, 11);
    check('synergy: gap of 2 tiles breaks adjacency', !Syn.isZoneActive(state, 'golden3'));
    fresh(); clearObjects(); put('heatbox', 11, 11); put('tens', 12, 12); put('traction', 13, 13);
    check('synergy: diagonal touching counts', Syn.isZoneActive(state, 'golden3'));
    B.removeAt(state, 12, 12);
    check('synergy: demolishing a member deactivates the zone & mods', !Syn.isZoneActive(state, 'golden3') && state.mods.nhiTurnover === 1);
    fresh(); clearObjects(); state.research.done = ['rs_manual', 'rs_shockwave', 'rs_heat', 'rs_evidence']; refresh();
    put('manual_room', 11, 11); put('shockwave', 13, 11); put('coffee', 14, 11);
    check('synergy premium -> selfPayConv +0.15, selfPayPrice x1.1', Syn.isZoneActive(state, 'premium') && near(state.mods.selfPayConv, 0.15) && near(state.mods.selfPayPrice, 1.1), JSON.stringify([state.mods.selfPayConv, state.mods.selfPayPrice]));
    check('synergy premium: economy.selfPayPrice applies selfPayPrice', Eco.selfPayPrice(state, 'shockwave') === Math.round(TREATMENTS.shockwave.price * 1.1), String(Eco.selfPayPrice(state, 'shockwave')));
    fresh(); clearObjects(); state.research.done = ['rs_evidence', 'rs_ot']; refresh();
    put('ball_pit', 11, 11); put('soft_mat', 13, 11); put('bookshelf', 15, 11);
    check('synergy kidpark active -> researchGain 1.25', Syn.isZoneActive(state, 'kidpark') && near(state.mods.researchGain, 1.25), String(state.mods.researchGain));
    fresh(); clearObjects();
    put('heatbox', 11, 11); put('tens', 12, 11); put('traction', 13, 11); put('heatbox', 11, 16); put('tens', 12, 16); put('traction', 13, 16);
    check('synergy: duplicate zones do not stack twice', near(state.mods.nhiTurnover, 1.2) && state.zones.filter(z => z.id === 'golden3').length === 2, state.mods.nhiTurnover + ' zones=' + state.zones.length);

    // ---- end to end through patients.js ----
    // (a) nhiTurnover: self-service NHI station durations shrink by exactly 1/1.2
    const sampleRatios = (zone) => {
      fresh(77); clearObjects();
      put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18);
      if (zone) { put('heatbox', 17, 12); put('tens', 18, 12); put('traction', 19, 12); put('heatbox', 17, 14); put('tens', 18, 14); }
      else { put('heatbox', 17, 12); put('tens', 17, 14); put('traction', 20, 12); put('heatbox', 18, 16); put('tens', 20, 14); }
      const seen = new Set(), ratios = [];
      for (let i = 0, N = 8 * MIN_PER_WEEK; i < N; i++) {
        step(1);
        for (const p of state.patients) if (p.stage === 'treating' && p.total && !seen.has(p.id + ':' + p.planIdx)) { seen.add(p.id + ':' + p.planIdx); const t = TREATMENTS[p.plan[p.planIdx]]; if (t && t.kind === 'nhi' && !t.staffRole) ratios.push(p.total / t.duration); }
      }
      return { ratios, zone: Syn.isZoneActive(state, 'golden3') };
    };
    const rz = sampleRatios(true), rn = sampleRatios(false);
    check('e2e golden3: self-service NHI durations x(1/1.2) with the zone, x1 without', rz.zone && !rn.zone && rz.ratios.length > 5 && near(avg(rz.ratios), 1 / 1.2, 0.01) && near(avg(rn.ratios), 1, 0.01), `zone ${avg(rz.ratios).toFixed(3)} (n=${rz.ratios.length}) none ${avg(rn.ratios).toFixed(3)} (n=${rn.ratios.length})`);

    // (b) researchGain: points gained == formula * mods.researchGain
    const pointRun = (kidpark) => {
      fresh(31); clearObjects(); state.research.done = ['rs_evidence', 'rs_ot']; refresh();
      put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18); put('heatbox', 17, 12); put('tens', 18, 12);
      if (kidpark) { put('ball_pit', 10, 15); put('soft_mat', 12, 15); put('bookshelf', 14, 15); }
      const expected = { medical: 0, device: 0, service: 0 };
      const off = bus.on('treatment:done', ({ patient, treatmentId, staffId }) => {
        const T = TREATMENTS[treatmentId], Pt = PATIENT_TYPES[patient.type];
        const st = staffId && state.staff.find(s => s.id === staffId);
        const skillF = st ? 0.7 + 0.06 * st.skill : 1;
        for (const k of K.POINT_KEYS) expected[k] += (T.points[k] || 0) * (Pt.pointBias[k] || 1) * skillF * P.TUNE.POINT_SCALE[k];
      });
      const p0 = { ...state.points };
      runWeeks(6);
      off();
      const got = {}; for (const k of K.POINT_KEYS) got[k] = state.points[k] - p0[k];
      return { expected, got, gain: state.mods.researchGain };
    };
    const pk = pointRun(true), pn = pointRun(false);
    const ratio = (r, k) => r.got[k] / Math.max(1e-9, r.expected[k]);
    check('e2e kidpark: researchGain 1.25 / 1.0 reaches point gains', near(pk.gain, 1.25) && near(pn.gain, 1) && near(ratio(pk, 'device'), 1.25, 0.02) && near(ratio(pn, 'device'), 1, 0.02), `with ${ratio(pk, 'device').toFixed(3)} without ${ratio(pn, 'device').toFixed(3)} (device)`);

    // (c) selfPayPrice carried by treatment:done
    {
      fresh(5); clearObjects(); state.research.done = Object.keys(RESEARCH); refresh();
      put('manual_room', 11, 11); put('shockwave', 13, 11); put('coffee', 14, 11);
      const prices = []; const off = bus.on('treatment:done', (e) => { if (e.selfPay) prices.push([e.treatmentId, e.selfPay]); });
      put('exam_room', 11, 14); put('reception', 16, 17); put('sofa', 12, 18); put('bed', 18, 13);
      state.staff.push(S.createStaff(state, 'pt', null, 17, 15));
      state.reputation = 200;
      runWeeks(8); off();
      const bad = prices.filter(([id, p]) => p !== Eco.selfPayPrice(state, id));
      check('e2e premium: every self-pay treatment:done credits selfPayPrice() (incl +10%)', prices.length > 0 && bad.length === 0, `n=${prices.length} bad=${JSON.stringify(bad.slice(0, 3))}`);
    }

    // (d) selfPayConv: self-pay sales per patient served rise with the premium zone
    const upsellRate = (zone) => {
      let sold = 0, left = 0, conv = 0, zoneOn = false;
      for (const sd of [12, 13, 14, 15, 16, 17]) { const r = upsellRun(zone, sd); sold += r.sold; left += r.left; conv = r.conv; zoneOn = r.zone; }
      return { rate: sold / Math.max(1, left), sold, left, conv, zone: zoneOn };
    };
    const upsellRun = (zone, seed) => {
      fresh(seed); clearObjects(); state.research.done = ['rs_manual', 'rs_shockwave', 'rs_heat', 'rs_evidence']; state.reputation = 40; state.money = 9e6;
      put('exam_room', 10, 15); put('reception', 16, 17); put('sofa', 12, 18); put('sofa', 10, 18); put('heatbox', 17, 12); put('tens', 18, 12); put('bed', 18, 14);
      put('manual_room', 12, 10); put('shockwave', 14, 12); put('coffee', zone ? 13 : 20, zone ? 13 : 10);
      state.staff.push(S.createStaff(state, 'pt', null, 17, 15));
      let sold = 0, left = 0;
      const o1 = bus.on('treatment:done', (e) => { if (e.selfPay) sold++; }), o2 = bus.on('patient:left', () => left++);
      runWeeks(30);
      o1(); o2();
      return { sold, left, conv: state.mods.selfPayConv, zone: Syn.isZoneActive(state, 'premium') };
    };
    const uz = upsellRate(true), un = upsellRate(false);
    check('e2e premium: self-pay sales per patient higher with zone (selfPayConv)', uz.zone && !un.zone && near(uz.conv - un.conv, 0.15) && uz.rate > un.rate * 1.1, `zone ${uz.rate.toFixed(3)} (${uz.sold}/${uz.left}, conv ${uz.conv}, on ${uz.zone}) vs ${un.rate.toFixed(3)} (${un.sold}/${un.left}, conv ${un.conv}, on ${un.zone})`);
    feature('專區 黃金三寶 (+20% 翻桌)', 'works', `mods 1.2; self-service NHI treat-time ratio ${avg(rz.ratios).toFixed(3)} vs ${avg(rn.ratios).toFixed(3)}`);
    feature('專區 高階自費 (+15% 轉單 / +10% 單價)', 'works', `self-pay sales/patient ${uz.rate.toFixed(3)} vs ${un.rate.toFixed(3)}; price x1.1 on every sale`);
    feature('專區 早療樂園 (+25% 研發點數)', 'works', `point gain ratio ${ratio(pk, 'device').toFixed(3)} vs ${ratio(pn, 'device').toFixed(3)}`);
  }

  // ---- staff stats (技術, 體力, 親和力) ----
  {
    fresh(); clearObjects();
    put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18); put('bed', 18, 13); put('heatbox', 17, 11);
    state.staff = [];
    state.staff.push(S.createStaff(state, 'doctor', null, 13, 14), S.createStaff(state, 'nurse', null, 18, 16), S.createStaff(state, 'pt', null, 18, 15), S.createStaff(state, 'pt', null, 19, 15));
    state.staff[2].skill = 10; state.staff[3].skill = 2;
    const samples = [], seen = new Set();
    for (let i = 0, N = 10 * MIN_PER_WEEK; i < N; i++) {
      step(1);
      for (const p of state.patients) if (p.stage === 'treating' && p.total && p.staffId && !seen.has(p.id + ':' + p.planIdx)) {
        seen.add(p.id + ':' + p.planIdx);
        const st = state.staff.find(s => s.id === p.staffId); const t = TREATMENTS[p.plan[p.planIdx]];
        if (st && t) samples.push({ skill: st.skill, ratio: p.total / t.duration, exp: (1.1 - 0.02 * st.skill) * S.tiredFactor(st) / (t.kind === 'nhi' ? Math.max(0.2, state.mods.nhiTurnover) : 1) });
      }
    }
    const bad = samples.filter(s => !near(s.ratio, s.exp, 0.03));
    check('staff skill: treatment duration follows (1.1-0.02*skill)*tiredFactor', samples.length > 5 && bad.length <= Math.ceil(samples.length * 0.05), `n=${samples.length} off=${bad.length}`);
    const doc = state.staff.find(s => s.role === 'doctor');
    doc.stamina = doc.staminaMax * 0.1;
    const tiredF = S.tiredFactor(doc);
    doc.stamina = doc.staminaMax;
    check('staff stamina: tiredFactor > 1.3 when exhausted, 1 when fresh', tiredF > 1.3 && S.tiredFactor(doc) === 1, String(tiredF));
    check('staff stamina stays within [0,max] over the run', state.staff.every(s => s.stamina >= 0 && s.stamina <= s.staminaMax + 1e-6));
    const src = readFileSync(new URL('../js/sim/patients.js', import.meta.url), 'utf8');
    check('staff charm (親和力) feeds the upsell chance', /staff \? staff\.charm : 5/.test(src) && /charm - 5/.test(src));
    feature('員工屬性 技術/體力/親和力', 'works', `n=${samples.length} duration samples match formula; charm in upsell`);
  }

  // ---- static data integrity ----
  {
    const modKeys = new Set(Object.keys(defaultMods()));
    const okKey = (k) => modKeys.has(k) || (k.startsWith('typeSpawn.') && PATIENT_TYPES[k.slice(10)]);
    const bad = [];
    for (const w of EVD.WEATHER) for (const k of Object.keys(w.mods || {})) if (!okKey(k)) bad.push('weather ' + w.id + ':' + k);
    for (const w of EVD.WEATHER) for (const t of Object.keys(w.typeBoost || {})) if (!PATIENT_TYPES[t]) bad.push('weather ' + w.id + ' type ' + t);
    for (const b of EVD.BOARDS) for (const k of Object.keys(b.effects || {})) if (!okKey(k)) bad.push('board ' + b.id + ':' + k);
    for (const z of SYNERGIES) { for (const k of Object.keys(z.effects || {})) if (!okKey(k)) bad.push('synergy ' + z.id + ':' + k); for (const n of z.needs) if (!BUILDABLES[n]) bad.push('synergy ' + z.id + ' needs ' + n); }
    for (const c of EVD.COMMUNITY) { for (const t of Object.keys((c.effects || {}).spawn || {})) if (!PATIENT_TYPES[t]) bad.push('community ' + c.id + ' type ' + t); for (const k of Object.keys((c.effects || {}).mods || {})) if (!okKey(k)) bad.push('community ' + c.id + ':' + k); }
    const fxKeys = new Set(['money', 'reputation', 'points', 'sat', 'nhiPenalty']);
    for (const e of [...EVD.RANDOM_EVENTS, ...EVD.DILEMMAS]) for (const ch of e.choices) {
      for (const k of Object.keys(ch.effects || {})) if (!fxKeys.has(k)) bad.push(e.id + ' effect ' + k);
      for (const k of Object.keys((ch.effects || {}).points || {})) if (!K.POINT_KEYS.includes(k)) bad.push(e.id + ' points ' + k);
    }
    for (const P1 of Object.values(PATIENT_TYPES)) for (const pl of P1.plans) for (const t of [...pl.steps, ...(pl.selfPaySteps || [])]) if (!TREATMENTS[t]) bad.push(P1.id + ' plan ' + t);
    for (const P1 of Object.values(PATIENT_TYPES)) for (const pl of P1.plans) for (const t of (pl.selfPaySteps || [])) if (TREATMENTS[t] && TREATMENTS[t].kind !== 'self') bad.push(P1.id + ' selfPayStep not self ' + t);
    for (const t of Object.values(TREATMENTS)) for (const r of (t.staffRole || [])) if (!K.ROLES.includes(r)) bad.push('treatment ' + t.id + ' role ' + r);
    check('data: every mod key / patient type / treatment / effect reference in static data is valid', bad.length === 0, bad.slice(0, 6).join('; '));
    // every self-pay treatment is reachable through some patient plan
    const reach = new Set(Object.values(PATIENT_TYPES).flatMap(P1 => P1.plans.flatMap(pl => [...pl.steps, ...(pl.selfPaySteps || [])])));
    const unreachable = Object.values(TREATMENTS).filter(t => !reach.has(t.id)).map(t => t.id);
    check('data: every treatment appears in at least one patient plan', unreachable.length === 0, unreachable.join());
    fresh(); state.weather = { kind: 'typhoon', id: 'typhoon' }; Mod.recomputeMods(state);
    check('weather: 颱風 cuts arrivals (spawnMult 0.4)', near(state.mods.spawnMult, 0.4));
    state.weather = { kind: 'hot', id: 'hot' }; Mod.recomputeMods(state);
    check('weather: 炎熱 raises staff stamina drain', state.mods.staffStamina > 1.1 && state.mods.spawnMult < 1);
    state.money = 1e6; const mb = JSON.stringify(state.mods); Ev.setBoard(state, 'elder_fall', true);
    check('boards: enabling a health-education board changes mods and charges its cost', JSON.stringify(state.mods) !== mb && state.money === 1e6 - EVD.BOARDS.find(b => b.id === 'elder_fall').cost);
    feature('靜態資料一致性 (events/boards/synergies/plans)', bad.length === 0 ? 'works' : 'partial', bad.length + ' dangling references');
  }

  // ---- four patient groups ----
  {
    fresh(3); clearObjects(); state.research.done = Object.keys(RESEARCH); state.reputation = 40;   // low rep: arrivals stay below the daily lot cap
    put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18); put('heatbox', 17, 12); put('tens', 18, 12); put('bed', 18, 14); put('si_room', 10, 15); put('speech_room', 13, 16); put('fine_table', 20, 17);
    state.staff.push(S.createStaff(state, 'pt', null, 17, 15));
    state.staff.push(S.createStaff(state, 'ot', null, 18, 14), S.createStaff(state, 'st', null, 19, 14));
    const seenTypes = {};
    const off = bus.on('patient:spawn', ({ patient }) => { seenTypes[patient.type] = (seenTypes[patient.type] || 0) + 1; });
    runWeeks(24); off();
    check('patients: all four groups (elder/office/sports/kid) spawn', ['elder', 'office', 'sports', 'kid'].every(t => seenTypes[t] > 0), JSON.stringify(seenTypes));
    feature('四大客群 長輩/上班族/運動族/早療兒童', 'works', JSON.stringify(seenTypes));
  }

  // ---- 台灣在地化 ----
  {
    fresh(); state.time.month = 1;
    let cold = null;
    for (let i = 0; i < 200 && !(cold && cold.id === 'cold'); i++) cold = Ev.rollWeather(state);
    check('weather: 寒流 rolls in January', cold && cold.kind === 'cold');
    Mod.recomputeMods(state);
    check('weather: 寒流 -> typeSpawn.elder = 1.6 x focus(ortho 0.9)', near(state.mods.typeSpawn.elder, 1.6 * 0.9, 1e-6), JSON.stringify(state.mods.typeSpawn));
    state.time.month = 7;
    const kinds = new Set(); for (let i = 0; i < 300; i++) kinds.add(Ev.rollWeather(state).kind);
    check('weather: no cold in July, hot possible', !kinds.has('cold') && kinds.has('hot'), [...kinds].join());
    // measured effect on arrivals: elder share on a pinned weather week
    const elderArrivals = (weatherId) => {
      let n = 0;
      for (let rep = 0; rep < 8; rep++) {
        fresh(300 + rep); state.reputation = 150; state.time.month = 1;
        const w = EVD.WEATHER.find(x => x.id === weatherId);
        const pin = () => { state.weather = { kind: w.kind, id: w.id, name: w.name, icon: w.icon, temp: 12 }; Mod.recomputeMods(state); };
        const lock = bus.on('week:start', pin); pin();
        const off = bus.on('patient:spawn', ({ patient }) => { if (patient.type === 'elder') n++; });
        runWeeks(3); off(); lock();
      }
      return n;
    };
    const eCold = elderArrivals('cold'), eCloud = elderArrivals('cloudy');
    check('weather e2e: 寒流 elder arrivals >= 1.2x an ordinary cloudy week', eCold >= eCloud * 1.2, `cold ${eCold} vs cloudy ${eCloud}`);

    const slipRun = (mats) => {
      let slips = 0;
      for (let rep = 0; rep < 3; rep++) {
        fresh(200 + rep); state.reputation = 300;
        if (mats) for (let y = state.lot.y0; y < state.lot.y0 + state.lot.h; y++) for (let x = state.lot.x0; x < state.lot.x0 + state.lot.w; x++) state.map.floor[y][x] = 'floor_mat';
        const rainDef = EVD.WEATHER.find(w => w.id === 'plumrain');
        const force = () => { state.weather = { kind: 'rain', id: 'plumrain', name: rainDef.name, icon: rainDef.icon, temp: 24 }; Mod.recomputeMods(state); };
        const lock = bus.on('week:start', force); force();
        const off = bus.on('patient:slip', () => slips++);
        runWeeks(24); off(); lock();
      }
      return slips;
    };
    const sNo = slipRun(false), sMat = slipRun(true);
    check('rain: slips happen on bare floor in rain', sNo > 3, 'slips=' + sNo);
    check('rain: 防滑地墊 cuts slips by >= 60%', sMat <= sNo * 0.4, `bare ${sNo} vs mat ${sMat}`);
    check('rain: slipRisk modifier > 1.5 in 梅雨', (() => { fresh(); state.weather = { kind: 'rain', id: 'plumrain' }; Mod.recomputeMods(state); return state.mods.slipRisk > 1.5; })());
    check('floor grip: mat .95 / ramp .8 / bare .45', (() => { fresh(); state.map.floor[12][12] = 'floor_mat'; state.map.floor[12][13] = 'ramp'; return near(Mod.floorGripAt(state, 12.5, 12.5), 0.95) && near(Mod.floorGripAt(state, 13.5, 12.5), 0.8) && near(Mod.floorGripAt(state, 14.5, 12.5), 0.45); })());
    feature('台灣在地化: 寒流 -> 長輩暴增', 'works', `elder arrivals cold ${eCold} vs cloudy ${eCloud}`);
    feature('台灣在地化: 雨天滑倒 (防滑地墊)', 'works', `slips bare ${sNo} vs mat ${sMat}`);

    // 社區肌少症篩檢
    fresh(); state.money = 1e6;
    const e0 = state.mods.typeSpawn.elder == null ? 1 : state.mods.typeSpawn.elder;
    const r = Ev.startCommunity(state, 'temple_sarcopenia');
    const e1 = state.mods.typeSpawn.elder;
    check('community: 宮廟肌少症篩檢 starts, pays cost, boosts elder spawn', r.ok && e1 > e0 + 0.25 && state.money === 1e6 - 75000, `${e0} -> ${e1}`);
    check('community: repeat refused while active', Ev.startCommunity(state, 'temple_sarcopenia').ok === false);
    runWeeks(3);
    const cdLeft = Ev.communityList(state).find(c => c.def.id === 'temple_sarcopenia');
    check('community: effect expires after durationWeeks and cooldown applies', !state.events.active.some(a => a.id === 'temple_sarcopenia') && cdLeft.status === 'cooldown', JSON.stringify({ s: cdLeft.status, cd: cdLeft.cooldownLeft }));
    state.money = 0;
    check('community: refused when broke', Ev.startCommunity(state, 'ltc_partner').ok === false && state.money === 0);
    // 醫病溝通 dilemmas
    const dilemmaTest = (trigger, type) => { fresh(); state.time.year = 2; const pat = P.spawnPatient(state, type); return triggerDilemma(pat.id, trigger); };
    const dPain = dilemmaTest('painkiller', 'elder'), dSkip = dilemmaTest('skip_doctor', 'elder');
    check('dilemma painkiller reachable (elder variant)', dPain && dPain.id === 'painkiller_elder' && dPain.choices.length >= 2, dPain && dPain.id);
    check('dilemma 只做電療不看醫生 reachable (elder variant)', dSkip && dSkip.id === 'skip_doctor_elder', dSkip && dSkip.id);
    fresh(); const pt2 = P.spawnPatient(state, 'elder');
    const pd = triggerDilemma(pt2.id, 'skip_doctor');
    const rep0 = state.reputation; state.nhi.monthPoints = 500;
    const ch = pd.choices[1];
    const out = Ev.resolveDilemma(state, 1);
    check('dilemma: resolve applies effects, clears pending, unpauses', out && out.ok && !state.events.pendingDilemma && state.time.paused === false && (!ch.effects.reputation || near(state.reputation, Math.max(0, Math.min(1000, rep0 + ch.effects.reputation)))) && (!ch.effects.nhiPenalty || state.nhi.monthPoints === Math.max(0, 500 - ch.effects.nhiPenalty)), JSON.stringify(ch.effects));
    check('dilemma: bad choice index is a no-op', (() => { fresh(); const p3 = P.spawnPatient(state, 'elder'); triggerDilemma(p3.id, 'painkiller'); const r1 = Ev.resolveDilemma(state, 99); const stillPending = !!state.events.pendingDilemma; Ev.resolveDilemma(state, 0); return r1 === null && stillPending && !state.events.pendingDilemma; })());
    // every dilemma trigger in data is reachable from patients.js
    const src = readFileSync(new URL('../js/sim/patients.js', import.meta.url), 'utf8');
    const trigs = [...new Set(EVD.DILEMMAS.map(d => d.trigger))];
    check('dilemma triggers in data all emitted by patients.js', trigs.every(t => src.includes(`'${t}'`)), trigs.join());
    feature('台灣在地化: 社區肌少症篩檢', 'partial', 'works (elder spawn +30% for 2 weeks, +rep, +service pts, cooldown) but only multiplies the existing elder group - it does not unlock a new group');
    feature('台灣在地化: 醫病溝通兩難 (止痛藥 / 只做電療)', dPain && dSkip ? 'works' : 'partial', (dPain && dPain.id) + ', ' + (dSkip && dSkip.id));
  }

  // ---- 評鑑 + 擴建 ----
  {
    fresh();
    let got = null; const off = bus.on('inspection:result', (r) => { got = r; });
    state.history.push({ year: 1, month: 1, satisfaction: 70, patients: 10, pointValue: 1 });
    const rep0 = state.reputation, m0 = state.money;
    Ins.runInspection(state);
    check('inspection: result emitted with score/pass/notes/rewardOrFine', got && typeof got.score === 'number' && Array.isArray(got.notes) && got.notes.length === 6 && typeof got.rewardOrFine === 'number', JSON.stringify(got && { s: got.score, p: got.pass }));
    check('inspection: money/reputation consistent with result', state.money === m0 + got.rewardOrFine && near(state.reputation, Math.max(0, Math.min(1000, rep0 + got.reputationDelta))), `${state.money - m0} vs ${got.rewardOrFine}`);
    const base = got.score;
    for (let x = 10; x < 16; x++) for (let y = 12; y < 20; y++) state.map.floor[y][x] = 'floor_mat';
    state.map.floor[19][11] = 'ramp';
    Ins.runInspection(state);
    check('inspection: ramp + 防滑 raise the score', got.score > base, `${base} -> ${got.score}`);
    state.staff = state.staff.filter(s => s.role !== 'doctor');
    const mm = state.money;
    Ins.runInspection(state);
    check('inspection: no licensed doctor fails with a fine', got.pass === false && got.rewardOrFine < 0 && state.money < mm);
    off();
    fresh(); let auto = 0; const off2 = bus.on('inspection:result', () => auto++);
    runMonths(12);
    off2();
    check('inspection: runs automatically at year end', auto === 1, 'n=' + auto);
    // NHI abuse is penalised: diluted months lower the score
    fresh(); state.history = Array.from({ length: 12 }, (_, i) => ({ year: 1, month: i + 1, satisfaction: 70, patients: 20, pointValue: 0.6 }));
    const abuse = Ins.evaluateRules(state, 1).find(r => r.id === 'nhi_abuse');
    check('inspection: NHI over-claiming (diluted point value) scores 0 on nhi_abuse', abuse && abuse.frac === 0, JSON.stringify(abuse && abuse.frac));
    // expansion gating
    fresh(); state.money = 1e8;
    let c1 = Ins.canExpand(state);
    check('expansion: blocked without requirements (lists missing)', !c1.ok && c1.missing.length >= 3 && Ins.expand(state) === false && state.lotLevel === 0, c1.missing.join(' | '));
    state.reputation = 500; state.time.year = 5; state.history.push({ year: 1, month: 1, satisfaction: 80, patients: 20 });
    state.research.done = Object.keys(RESEARCH);
    for (const [x, y] of [[10, 18], [12, 16], [10, 16], [13, 14], [10, 14]]) put('sofa', x, y);
    state.map.floor[18][14] = 'ramp';
    for (let i = 0; i < 12; i++) state.staff.push(S.createStaff(state, 'pt', null, 14, 18));
    c1 = Ins.canExpand(state);
    check('expansion: allowed once every requirement is met', c1.ok, c1.missing.join(' | '));
    const objs0 = JSON.stringify(state.objects), money0 = state.money;
    let lotEv = null; const off3 = bus.on('lot:expanded', (e) => { lotEv = e; });
    check('expansion: expand() pays and upgrades', Ins.expand(state) && state.lotLevel === 1 && state.money === money0 - LOTS[1].expandCost && lotEv && lotEv.level === 1 && JSON.stringify(state.lot) === JSON.stringify(LOTS[1].lot));
    off3();
    check('expansion: existing objects untouched, door and entry unchanged', JSON.stringify(state.objects) === objs0 && state.door.x === 15 && state.door.y === 20 && inLot(state, 15, 19));
    state.money = 1e8; state.reputation = 900; state.research.done = state.research.done.filter(id => id !== 'rs_expand');
    const noRes = Ins.canExpand(state);
    check('expansion L1->L2 needs the service-track research 擴建規劃', !noRes.ok && noRes.missing.some(m => m.includes('擴建規劃')) && Ins.expand(state) === false, noRes.missing.join(' | '));
    state.research.done.push('rs_expand');
    check('expansion L1->L2 allowed once 擴建規劃 is done', Ins.canExpand(state).ok, Ins.canExpand(state).missing.join(' | '));
    check('expansion: new area is placeable, outside still not', B.canPlace(state, 'plant', 9, 8, 0).ok && !B.canPlace(state, 'plant', 8, 8, 0).ok);
    feature('評鑑 衛生局督導 + 健保署抽查', 'works', 'year:end -> 6 rules (ramp/seats/antislip/license/sat/nhi_abuse) -> pass/fine/bonus + rep');
    feature('評鑑 -> 解鎖更大診所 (擴建)', 'works', 'L0->L3 gated by rep/year/staff/sat/ramp/seats (+ rs_expand for L2/L3)');
  }

  // ---- 自費轉型 ----
  {
    fresh(9); state.research.done = Object.keys(RESEARCH); state.reputation = 250; state.money = 9e6;
    clearObjects();
    put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18); put('sofa', 10, 18); put('bed', 18, 13); put('shockwave_room', 19, 15); put('manual_room', 11, 15); put('laser_room', 19, 10); put('redcord', 15, 11);
    state.staff.push(S.createStaff(state, 'pt', null, 17, 15), S.createStaff(state, 'pt', null, 17, 16));
    const count = {}; const off = bus.on('treatment:done', ({ treatmentId, selfPay }) => { if (selfPay) count[treatmentId] = (count[treatmentId] || 0) + 1; });
    runWeeks(24); off();
    check('self-pay: PRP / 震波 / 客製化鞋墊 actually get sold', ['prp', 'shockwave', 'insole'].every(t => count[t] > 0), JSON.stringify(count));
    check('self-pay: locked treatments are NOT sold before research', (() => { fresh(9); opts_quietPut = true; put('shockwave_room', 19, 15); opts_quietPut = false; const c = {}; const o2 = bus.on('treatment:done', (e) => { if (e.selfPay) c[e.treatmentId] = 1; }); state.reputation = 300; runWeeks(10); o2(); return Object.keys(c).length === 0; })());
    fresh(); const pm = [0.5, 2.0, 0.1, 9, NaN];
    const clamped = pm.map(v => { Ev.setPriceMult(state, 'prp', v); return state.policy.priceMult.prp; });
    check('priceMult clamps to 0.5..2.0, NaN rejected', clamped[0] === 0.5 && clamped[1] === 2 && clamped[2] === 0.5 && clamped[3] === 2 && clamped[4] === 2, JSON.stringify(clamped));
    check('priceMult only for self-pay treatments', Ev.setPriceMult(state, 'heat', 1.5) === false);
    state.policy.priceMult.prp = 0.5; const lo = Eco.selfPayPrice(state, 'prp');
    state.policy.priceMult.prp = 2.0; const hi = Eco.selfPayPrice(state, 'prp');
    check('priceMult 0.5/2.0 scale price exactly', lo === TREATMENTS.prp.price * 0.5 && hi === TREATMENTS.prp.price * 2);
    feature('自費轉型 PRP / 震波 / 客製化鞋墊 + 定價', ['prp', 'shockwave', 'insole'].every(t => count[t] > 0) ? 'works' : 'partial', JSON.stringify(count));
  }
}

// =====================================================================================================
// SECTION: edge cases
// =====================================================================================================
function edgeSection() {
  section('Edge cases');
  fresh(); clearObjects();
  const cost = BUILDABLES.exam_room.cost;
  state.money = cost - 1;
  check('build: insufficient funds -> canPlace refuses, nothing changes', B.canPlace(state, 'exam_room', 11, 12, 0).reason === '資金不足' && B.placeObject(state, 'exam_room', 11, 12, 0) === null && state.money === cost - 1 && state.objects.length === 0);
  state.money = cost;
  const o = B.placeObject(state, 'exam_room', 11, 12, 0);
  check('build: exact funds placement ok, money 0', o && state.money === 0);
  B.removeAt(state, 11, 12);
  check('demolish: refund 50% and object gone', state.money === Math.round(cost * 0.5) && state.objects.length === 0, String(state.money));
  check('demolish: place/remove loop cannot mint money', (() => { state.money = 100000; const m = state.money; for (let i = 0; i < 20; i++) { B.placeObject(state, 'tens', 12, 12, 0); B.removeAt(state, 12, 12); } return state.money <= m && state.money >= m - 20 * BUILDABLES.tens.cost; })());
  check('demolish: empty tile returns false', B.removeAt(state, 12, 12) === false);
  check('demolish: outside map does not throw', (() => { try { return B.removeAt(state, -5, 99) === false && B.removeAt(state, 500, 500) === false; } catch (e) { console.log(e); return false; } })());
  state.money = 1000; B.paintFloor(state, 'floor_mat', 12, 12);
  const afterPaint = state.money;
  B.removeAt(state, 12, 12);
  check('floor: paint costs, demolish refunds 50%', afterPaint === 1000 - BUILDABLES.floor_mat.cost && state.money === afterPaint + Math.round(BUILDABLES.floor_mat.cost * 0.5) && state.map.floor[12][12] === null);
  state.money = 1e7;
  const L = state.lot;
  check('border: object flush with lot edges ok', B.canPlace(state, 'tens', L.x0, L.y0, 0).ok && B.canPlace(state, 'tens', L.x0 + L.w - 1, L.y0, 0).ok);
  check('border: object crossing the right/top/left edge refused', !B.canPlace(state, 'exam_room', L.x0 + L.w - 1, L.y0, 0).ok && !B.canPlace(state, 'tens', L.x0 - 1, L.y0, 0).ok && !B.canPlace(state, 'tens', L.x0, L.y0 - 1, 0).ok);
  check('border: rotated footprint past bottom edge refused', !B.canPlace(state, 'traction', L.x0, L.y0 + L.h - 1, 0).ok && B.canPlace(state, 'traction', L.x0, L.y0 + L.h - 2, 0).ok);
  const e = entryTile(state);
  check('entry tile: cannot be built on (1x1, 2x2 overlapping, rot)', !B.canPlace(state, 'tens', e.x, e.y, 0).ok && !B.canPlace(state, 'exam_room', e.x - 1, e.y - 1, 0).ok && !B.canPlace(state, 'sofa', e.x - 1, e.y, 0).ok && !B.canPlace(state, 'traction', e.x, e.y - 1, 0).ok);
  check('street row (door.y) not buildable', !B.canPlace(state, 'tens', e.x, state.door.y, 0).ok);
  check('entry tile: floor can be painted (walkable)', B.paintFloor(state, 'floor_mat', e.x, e.y) === true);
  check('floor outside lot refused', B.paintFloor(state, 'floor_mat', 5, 5) === false && B.paintFloor(state, 'floor_mat', -1, 0) === false && B.paintFloor(state, 'floor_mat', 99, 99) === false);
  check('floor: re-painting same floor refused (no double charge)', (() => { const m = state.money; return B.paintFloor(state, 'floor_mat', e.x, e.y) === false && state.money === m; })());
  check('floor under object: stays when the object is demolished; 2nd demolish removes floor', (() => { B.paintFloor(state, 'floor_wood', 13, 13); const ob = B.placeObject(state, 'tens', 13, 13, 0); const kept = state.map.floor[13][13] === 'floor_wood'; B.removeAt(state, 13, 13); const still = state.map.floor[13][13] === 'floor_wood'; B.removeAt(state, 13, 13); return !!ob && kept && still && state.map.floor[13][13] === null; })());
  check('locked buildable refused', !B.canPlace(state, 'redcord', 12, 12, 0).ok && B.placeObject(state, 'redcord', 12, 12, 0) === null);
  check('unknown def refused', !B.canPlace(state, 'nope', 12, 12, 0).ok && B.placeObject(state, 'nope', 12, 12, 0) === null);
  check('overlap refused', (() => { B.placeObject(state, 'exam_room', 12, 12, 0); return !B.canPlace(state, 'tens', 13, 13, 0).ok; })());
  fresh(); clearObjects(); state.money = 1e8;
  B.placeObject(state, 'exam_room', 11, 12, 0);
  let blocked = 0;
  for (let x = state.lot.x0; x < state.lot.x0 + state.lot.w; x++) { if (!B.placeObject(state, 'tens', x, 16, 0)) blocked++; }
  check('build: a full-width wall cannot seal an existing room off from the door', blocked >= 1, 'refused=' + blocked);
  check('sign (non-blocking) may not sit on the entry tile', !B.canPlace(state, 'sign', e.x, e.y, 0).ok);

  // ---- staff ----
  fresh(); state.money = 1e7;
  const doc = state.staff.find(s => s.role === 'doctor');
  check('fire: last doctor can be fired', S.fire(state, doc.id) === true && !state.staff.some(s => s.role === 'doctor'));
  runWeeks(2);
  check('after firing the only doctor: sim keeps running', invariants().length === 0 && Number.isFinite(state.money), invariants().join(';'));
  check('fire: unknown id false', S.fire(state, 999999) === false);
  fresh(); state.money = 1e8;
  for (let i = 0; i < 20; i++) { if (state.hirePool.length === 0) S.refreshPool(state); S.hire(state, state.hirePool[0].cid); }
  check('hire: stops at maxStaff', state.staff.length === Res.maxStaffOf(state) && state.staff.length === LOTS[0].maxStaff, `staff=${state.staff.length}`);
  check('hire: over cap leaves money/pool untouched', (() => { const m = state.money; if (!state.hirePool.length) S.refreshPool(state); const n = state.hirePool.length; const ok = S.hire(state, state.hirePool[0].cid) === null; return ok && state.money === m && state.hirePool.length === n; })());
  fresh(); state.money = 10; S.refreshPool(state);
  check('hire: insufficient funds refused', S.hire(state, state.hirePool[0].cid) === null && state.staff.length === 3);
  check('hire: bad candidate id refused', S.hire(state, 'zzz') === null);
  check('research maxStaff effect raises the cap', (() => { fresh(); const base = Res.maxStaffOf(state); state.research.done = ['rs_staffing']; return Res.maxStaffOf(state) === base + 1; })());

  // ---- expansion with objects hugging the old border ----
  fresh(); state.money = 1e8; clearObjects();
  put('tens', 10, 10); put('tens', 21, 10); put('tens', 10, 19); put('tens', 21, 18);
  state.reputation = 999; state.time.year = 9; state.history.push({ year: 1, month: 1, satisfaction: 90, patients: 50 });
  state.research.done = Object.keys(RESEARCH);
  for (let i = 0; i < 12; i++) state.staff.push(S.createStaff(state, 'pt', null, 14, 18));
  for (let i = 0; i < 8; i++) put('sofa', 10 + (i % 4) * 2, 11 + Math.floor(i / 4) * 2);
  state.map.floor[18][14] = 'ramp'; state.map.floor[10][10] = 'floor_mat';
  const before = JSON.parse(JSON.stringify(state.objects.slice(0, 4)));
  let lvl = 0;
  while (Ins.canExpand(state).ok && lvl < 5) { state.reputation = 999; state.money = 1e8; Ins.expand(state); refresh(); lvl++; }
  check('expansion x3: steps through every lot level, border objects/floors intact', state.lotLevel === 3 && JSON.stringify(state.objects.slice(0, 4)) === JSON.stringify(before) && state.map.floor[10][10] === 'floor_mat', 'level ' + state.lotLevel);
  check('expansion: further expand refused at max level', Ins.expand(state) === false && Ins.canExpand(state).ok === false);
  runWeeks(3);
  check('sim runs fine after expansions', invariants().length === 0, invariants().join('; '));

  // ---- price extremes ----
  for (const pmv of [0.5, 2.0]) {
    fresh(4); clearObjects(); state.research.done = Object.keys(RESEARCH); state.reputation = 300; state.money = 9e6;
    for (const id of Object.keys(TREATMENTS)) if (TREATMENTS[id].kind === 'self') Ev.setPriceMult(state, id, pmv);
    put('exam_room', 11, 12); put('reception', 16, 17); put('sofa', 12, 18); put('bed', 18, 13); put('shockwave_room', 19, 15); put('manual_room', 11, 15);
    state.staff.push(S.createStaff(state, 'pt', null, 17, 15));
    let sum = 0, n = 0; const off = bus.on('treatment:done', (ev) => { if (ev.selfPay) { sum += ev.selfPay; n++; } });
    runWeeks(16); off();
    check(`price x${pmv}: sim stable, finite`, invariants().length === 0 && n > 0, `selfPay n=${n} avg=${Math.round(sum / Math.max(1, n))}`);
  }

  // ---- pendingDilemma + save/load ----
  fresh(); const pt = P.spawnPatient(state, 'elder');
  triggerDilemma(pt.id, 'painkiller');
  const pendingId = state.events.pendingDilemma && state.events.pendingDilemma.id;
  check('dilemma pending', !!pendingId);
  let reshown = 0; const offS = bus.on('dilemma:show', () => reshown++);
  const savedOk = Sav.saveGame(state, '1');
  state.events.pendingDilemma = null; state.time.paused = false;
  const loadedOk = Sav.loadGame(state, '1');
  offS();
  check('save/load with pending dilemma: restored, paused, modal re-shown', savedOk && loadedOk && state.events.pendingDilemma && state.events.pendingDilemma.id === pendingId && state.time.paused === true && reshown === 1);
  const clk = state.time.clock; step(1, false); step(1, false);
  check('pending dilemma after load still freezes the clock', state.time.clock === clk);
  Ev.resolveDilemma(state, 0);
  step(1, false);
  check('resolve after load: unpaused and sim proceeds', !state.events.pendingDilemma && state.time.paused === false && state.time.clock > clk);
  fresh(); state.time.paused = true; const p4 = P.spawnPatient(state, 'elder');
  triggerDilemma(p4.id, 'painkiller');
  Ev.resolveDilemma(state, 0);
  check('dilemma remembers user pause (stays paused after resolving)', state.time.paused === true);

  // ---- month boundary in the middle of a modal ----
  fresh(); state.time.week = 4; state.time.clock = K.CLOSE_MIN - 2;
  const trig = bus.on('month:start', () => { Ev.triggerEvent(state, 'li_chief'); });
  step(1, false); step(1, false); step(1, false);
  trig();
  check('month rollover with a decision modal opening on month:start', state.time.month === 2 && state.time.week === 1 && !!state.events.pendingDilemma && state.time.clock === K.OPEN_MIN, JSON.stringify(state.time));
  const mcount = state.history.length, m1 = state.money;
  for (let i = 0; i < 100; i++) step(1, false);
  check('modal open: no time passes, no double settlement', state.history.length === mcount && state.money === m1 && state.time.clock === K.OPEN_MIN);
  Ev.resolveDilemma(state, 0);
  step(1);
  check('modal closed: time continues from 08:00', state.time.clock > K.OPEN_MIN);
  fresh(); const p5 = P.spawnPatient(state, 'elder'); Ev.triggerEvent(state, 'li_chief');
  const first = state.events.pendingDilemma;
  for (let i = 0; i < 10; i++) { state.events.cooldowns = {}; bus.emit('dilemma:request', { patientId: p5.id, trigger: 'painkiller' }); }
  check('second request while pending is ignored', state.events.pendingDilemma === first);
  check('triggerEvent while pending is refused', Ev.triggerEvent(state, 'nhi_audit') === null);

  // ---- bankruptcy ----
  fresh();
  let over = 0; const offB = bus.on('game:over', () => over++);
  state.money = -299999; state.nhi.monthPoints = 0;
  runMonths(1);
  offB();
  check('bankruptcy: money < -300k at month end -> game:over once', state.money < Eco.BANKRUPT_LIMIT ? over === 1 : over === 0, `money=${Math.round(state.money)} over=${over}`);
  check('bankruptcy: autosave deleted on game over', over === 0 || Sav.listSaves().every(s => s.slot !== 'auto'));
  check('bankruptcy: exactly at the limit does not trigger', (() => { fresh(); let o = 0; const f = bus.on('game:over', () => o++); state.staff = []; state.objects = []; state.money = Eco.BANKRUPT_LIMIT + Eco.monthlyCosts(state).rent; Eco.settleMonth(state); f(); return o === 0 && state.money === Eco.BANKRUPT_LIMIT; })());

  // ---- misc ----
  fresh(); state.points.medical = 100; Res.start(state, 'rs_evidence');
  Sav.saveGame(state, '2'); runWeeks(2); Sav.loadGame(state, '2');
  check('research in progress survives save/load', state.research.current === 'rs_evidence' && state.research.progress === 0);
  runWeeks(1);
  check('...and completes afterwards', Res.isDone(state, 'rs_evidence'));
  fresh(); state.money = 0;
  check('board: toggling on without funds refused', Ev.setBoard(state, EVD.BOARDS[0].id, true) === false && !state.policy.boards.length);
  state.money = 1e6; check('board: on then off', Ev.setBoard(state, EVD.BOARDS[0].id, true) && Ev.setBoard(state, EVD.BOARDS[0].id, false) && !state.policy.boards.length);
  check('focus: bad value refused, good applied', Ev.setFocus(state, 'xxx') === false && Ev.setFocus(state, 'ltc') && near(state.mods.typeSpawn.elder, 1.6));
  fresh(); state.money = 0; Ev.triggerEvent(state, 'vendor_promo'); Ev.resolveDilemma(state, 0);
  check('event cost with no money: money may go negative, ledger consistent', state.money < 0 && invariants().length === 0, invariants().join(';'));
}

// =====================================================================================================
// SECTION: save / load / determinism
// =====================================================================================================
function dump() { return JSON.stringify({ ...state, map: { floor: state.map.floor } }); }
function firstDiff(a, b, path = 'state', out = []) {
  if (out.length >= 12 || a === b) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { out.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} != ${JSON.stringify(b)?.slice(0, 60)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) firstDiff(a[k], b[k], path + (Array.isArray(a) ? `[${k}]` : '.' + k), out);
  return out;
}
function mkPlayer(seed) {
  fresh(seed); state.research.done = ['rs_ultrasound', 'rs_evidence', 'rs_heat', 'rs_manual', 'rs_shockwave', 'rs_ot', 'rs_edu']; state.money = 5e6; state.reputation = 120;
  put('traction', 20, 12); put('bed', 13, 15); put('rest_room', 19, 17); put('shockwave', 11, 10); put('manual_room', 13, 10); put('coffee', 15, 10); put('si_room', 10, 15);
  state.staff.push(S.createStaff(state, 'pt', null, 17, 15), S.createStaff(state, 'ot', null, 14, 18));
  Ev.startCommunity(state, 'health_talk'); Ev.setBoard(state, EVD.BOARDS[0].id, true);
}
function saveSection() {
  section('Save / load / determinism');
  mkPlayer(11);
  runMonths(3);
  runWeeks(1); for (let i = 0; i < 300; i++) step(1);
  check('mid-run state has live agents to serialise', state.patients.length > 0 && state.agents && Array.isArray(state.agents.returning), `patients=${state.patients.length}`);
  const before = dump();
  const rngAt = rngS;
  check('saveGame ok', Sav.saveGame(state, '3'));
  const payload = globalThis.localStorage.getItem(K.SAVE_KEY_PREFIX + '3');
  check('save payload carries version/savedAt/label', (() => { const p = JSON.parse(payload); return p.version === K.SAVE_VERSION && p.savedAt > 0 && /NT\$/.test(p.label); })());
  check('save does not store map.occ (cache)', !payload.includes('"occ"'));
  check('save size reasonable (<400KB)', payload.length < 400000, payload.length + ' bytes');

  runMonths(2);
  const contA = dump();

  seedRng(rngAt);
  check('loadGame ok', Sav.loadGame(state, '3'));
  const afterLoad = dump();
  const d0 = firstDiff(JSON.parse(before), JSON.parse(afterLoad));
  check('JSON round trip: state after load == state before save', d0.length === 0, d0.join(' ; '));
  check('load rebuilds caches (occ, zones, mods)', !!state.map.occ && state.zones.length === JSON.parse(before).zones.length && JSON.stringify(state.mods) === JSON.stringify(JSON.parse(before).mods));
  runMonths(2);
  const d1 = firstDiff(JSON.parse(contA), JSON.parse(dump()));
  check('determinism: load + 2 months == uninterrupted 2 months (same seed)', d1.length === 0, d1.join(' ; '));

  mkPlayer(12); runMonths(2);
  const ex = Sav.exportSave(state); const b4 = dump();
  fresh(99);
  check('importSave ok & equals exported state', Sav.importSave(state, ex) && firstDiff(JSON.parse(b4), JSON.parse(dump())).length === 0);
  check('importSave rejects garbage', !Sav.importSave(state, '{{{') && !Sav.importSave(state, '{"a":1}') && !Sav.importSave(state, '[]') && !Sav.importSave(state, 'null') && !Sav.importSave(state, '"x"'));
  check('importSave rejects future version', !Sav.importSave(state, JSON.stringify({ version: K.SAVE_VERSION + 5, state: JSON.parse(b4) })));
  check('importSave of a bare state dump works', Sav.importSave(state, b4));
  check('listSaves / deleteSave', (() => { Sav.saveGame(state, '1'); const n = Sav.listSaves().filter(s => s.slot === '1').length; Sav.deleteSave('1'); return n === 1 && Sav.listSaves().every(s => s.slot !== '1'); })());
  check('loadGame of missing slot returns false', Sav.loadGame(state, 'nope') === false);
  globalThis.localStorage.setItem(K.SAVE_KEY_PREFIX + 'bad', '{truncated');
  check('loadGame of corrupt slot returns false and keeps the game', (() => { const m = state.money; return Sav.loadGame(state, 'bad') === false && state.money === m; })());
  check('listSaves skips corrupt slots', Sav.listSaves().every(s => s.slot !== 'bad'));
  const realLS = globalThis.localStorage;
  globalThis.localStorage = { setItem() { throw new Error('quota'); }, getItem() { throw new Error('blocked'); }, get length() { throw new Error('x'); }, key() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  check('storage that throws: saveGame/loadGame false, listSaves [] (no crash)', Sav.saveGame(state, 'auto') === false && Sav.loadGame(state, 'auto') === false && Sav.listSaves().length === 0);
  globalThis.localStorage = undefined;
  check('no localStorage at all: no crash', Sav.saveGame(state, 'auto') === false);
  globalThis.localStorage = realLS;

  // ---- old / partial saves ----
  fresh(5); runMonths(1);
  const full = JSON.parse(dump());
  const strip = (mut) => { const s = JSON.parse(JSON.stringify(full)); mut(s); return s; };
  const variants = {
    'no agents/meta': (s) => { delete s.agents; },
    'no mods': (s) => { delete s.mods; },
    'no events': (s) => { delete s.events; },
    'no inspections/flags': (s) => { delete s.inspections; delete s.flags; },
    'no policy.boards/priceMult': (s) => { delete s.policy.boards; delete s.policy.priceMult; },
    'no ledger/stats/nhi': (s) => { delete s.ledger; delete s.stats; delete s.nhi; },
    'no hirePool/queue/zones/history': (s) => { delete s.hirePool; delete s.queue; delete s.zones; delete s.history; },
    'no weather': (s) => { delete s.weather; },
    'no research': (s) => { delete s.research; },
    'no points': (s) => { delete s.points; },
    'no policy': (s) => { delete s.policy; },
    'no time.speed': (s) => { delete s.time.speed; delete s.time.paused; },
    'staff w/o runtime fields': (s) => { s.staff = s.staff.map(({ id, role, name, skill, charm, stamina, staminaMax, salary, x, y }) => ({ id, role, name, skill, charm, stamina, staminaMax, salary, x, y })); },
    'patients w/o runtime fields': (s) => { s.patients = [{ id: 9001, type: 'elder', name: 'x', x: 15.5, y: 19.5, stage: 'waiting', plan: ['heat'], planIdx: 0 }]; },
    'objects w/o runtime fields': (s) => { s.objects = s.objects.map(({ id, defId, x, y, rot }) => ({ id, defId, x, y, rot })); },
    'old version 0': (s) => { s.version = 0; },
    'unknown object defId': (s) => { s.objects.push({ id: 777, defId: 'ghost', x: 1, y: 1, rot: 0 }); },
    'unknown staff role': (s) => { s.staff.push({ id: 778, role: 'wizard', x: 1, y: 1 }); },
    'unknown research done': (s) => { s.research.done.push('rs_future'); s.research.current = 'rs_future'; },
    'unknown policy focus': (s) => { s.policy.focus = 'zzz'; },
    'unknown weather id': (s) => { s.weather = { kind: 'meteor', id: 'meteor', temp: 20 }; },
    'lotLevel beyond data': (s) => { s.lotLevel = 99; },
    'money null': (s) => { s.money = null; },
    'string numbers': (s) => { s.reputation = '120'; s.points = { medical: '5', device: null, service: 'x' }; },
    'short map.floor': (s) => { s.map.floor = s.map.floor.slice(0, 5); },
  };
  for (const [name, mut] of Object.entries(variants)) {
    fresh(6);
    let okLoad, err = '';
    try {
      okLoad = Sav.importSave(state, JSON.stringify({ version: full.version, savedAt: 1, label: 'x', state: strip(mut) }));
      if (okLoad) runWeeks(5);
    } catch (e) { err = e.stack.split('\n').slice(0, 3).join(' | '); okLoad = false; }
    const inv = okLoad ? invariants() : [];
    const mayReject = name === 'money null';
    check(`old save "${name}": ${mayReject ? 'rejected or loads safely' : 'loads + runs 5 weeks'}`, !err && (mayReject ? (!okLoad || inv.length === 0) : okLoad && inv.length === 0), err || inv.slice(0, 3).join('; '));
  }
}

// =====================================================================================================
// SECTION: long run
// =====================================================================================================
const ORDER = ['rs_ultrasound', 'rs_heat', 'rs_queue', 'rs_admin', 'rs_evidence', 'rs_edu', 'rs_maint', 'rs_manual', 'rs_shockwave', 'rs_rep', 'rs_selfpay', 'rs_redcord', 'rs_insole', 'rs_laser', 'rs_prp', 'rs_ot', 'rs_staffing', 'rs_geriatric', 'rs_insurance', 'rs_sports_med', 'rs_expand', 'rs_st', 'rs_pediatric', 'rs_gait', 'rs_chronic', 'rs_brand'];
function tryBuyRandom() {
  const ids = Object.keys(BUILDABLES).filter(id => B.isUnlocked(state, id) && BUILDABLES[id].layer === 'object');
  const id = ids[Math.floor(rng() * ids.length)];
  const l = state.lot;
  for (let k = 0; k < 25; k++) { const x = l.x0 + Math.floor(rng() * l.w), y = l.y0 + Math.floor(rng() * l.h), r = rng() < 0.5 ? 0 : 1; if (B.canPlace(state, id, x, y, r).ok) { B.placeObject(state, id, x, y, r); return true; } }
  return false;
}
const POLICY = {
  idle: () => {},
  bad: () => {},
  rich: (weekNo) => { POLICY.builder(weekNo); },
  richstatic: () => {},
  builder: (weekNo) => {
    for (const id of ORDER) if (Res.canStart(state, id).ok) { Res.start(state, id); break; }
    if (state.money > 1500000 && weekNo % 6 === 0) tryBuyRandom();
    if (state.money > 1500000 && state.staff.length < Math.min(Res.maxStaffOf(state), 4 + state.lotLevel * 3) && weekNo % 8 === 0) { if (!state.hirePool.length) S.refreshPool(state); const c = state.hirePool.slice().sort((a, b) => b.skill - a.skill)[0]; if (c) S.hire(state, c.cid); }
    if (weekNo % 12 === 5) for (const s of state.staff) S.train(state, s.id);
    if (Ins.canExpand(state).ok && state.money > LOTS[Math.min(3, state.lotLevel + 1)].expandCost + 1500000) Ins.expand(state);
    if (weekNo % 20 === 0) { const l = Ev.communityList(state).find(c => c.status === 'ready' && c.affordable && c.def.cost < state.money / 6); if (l) Ev.startCommunity(state, l.def.id); }
    if (weekNo % 30 === 3) { for (const t of Object.values(TREATMENTS)) if (t.kind === 'self') Ev.setPriceMult(state, t.id, 0.8 + rng() * 0.8); }
  },
  chaos: () => {
    const rx = () => Math.floor(rng() * 34) - 1, ry = () => Math.floor(rng() * 34) - 1;
    for (let k = 0; k < 6; k++) {
      const a = Math.floor(rng() * 16);
      if (a === 0) { const ids = Object.keys(BUILDABLES); B.placeObject(state, ids[Math.floor(rng() * ids.length)], rx(), ry(), rng() < 0.5 ? 0 : 1); }
      else if (a === 1) B.removeAt(state, rx(), ry());
      else if (a === 2) { const ids = ['floor_mat', 'floor_wood', 'ramp']; B.paintFloor(state, ids[Math.floor(rng() * 3)], rx(), ry()); }
      else if (a === 3) { const ids = Object.keys(RESEARCH); if (rng() < 0.5) state.points[K.POINT_KEYS[Math.floor(rng() * 3)]] += 200; Res.start(state, ids[Math.floor(rng() * ids.length)]); }
      else if (a === 4) { if (!state.hirePool.length) S.refreshPool(state); const c = state.hirePool[Math.floor(rng() * state.hirePool.length)]; S.hire(state, c && c.cid); }
      else if (a === 5) { const s = state.staff[Math.floor(rng() * state.staff.length)]; if (s && rng() < 0.4) S.fire(state, s.id); }
      else if (a === 6) { const s = state.staff[Math.floor(rng() * state.staff.length)]; if (s) { state.points.service += 20; S.train(state, s.id); } }
      else if (a === 7) { const ids = Object.keys(TREATMENTS); Ev.setPriceMult(state, ids[Math.floor(rng() * ids.length)], rng() * 3); }
      else if (a === 8) Ev.startCommunity(state, EVD.COMMUNITY[Math.floor(rng() * EVD.COMMUNITY.length)].id);
      else if (a === 9) Ev.setBoard(state, EVD.BOARDS[Math.floor(rng() * EVD.BOARDS.length)].id, rng() < 0.6);
      else if (a === 10) Ev.setFocus(state, ['ortho', 'ltc', 'peds', 'bogus'][Math.floor(rng() * 4)]);
      else if (a === 11) Ins.expand(state);
      else if (a === 12) Eco.spend(state, (rng() - 0.3) * 3e6, ['build', 'other', 'weird'][Math.floor(rng() * 3)]);
      else if (a === 13) { if (rng() < 0.5) Sav.saveGame(state, '1'); else if (Sav.loadGame(state, '1')) refresh(); }
      else if (a === 14) { if (rng() < 0.05) state.money += 2e6; }
      else if (a === 15) { if (rng() < 0.1) P.spawnPatient(state, ['elder', 'office', 'sports', 'kid'][Math.floor(rng() * 4)]); }
    }
    refresh();
  },
};
function longRun(policy, years, seed) {
  fresh(seed);
  if (policy === 'rich' || policy === 'richstatic') {
    // steady-state stress: L1 lot, everything researched, many stations + staff, high reputation (busy clinic, many agents)
    state.money = 9e6; state.reputation = 200; state.research.done = Object.keys(RESEARCH);
    state.lotLevel = 1; state.lot = { ...LOTS[1].lot }; state.door = { ...LOTS[1].door }; state.time.year = 2;
    state.objects = []; state.staff = []; refresh();
    const lay = [['reception', 16, 17], ['sofa', 10, 17], ['sofa', 12, 17], ['sofa', 10, 15], ['tv', 12, 15], ['water', 14, 17], ['plant', 9, 19], ['plant', 13, 19], ['plant', 14, 15],
      ['exam_room', 9, 8], ['exam_room', 11, 8], ['manual_room', 14, 8], ['laser_room', 16, 8], ['redcord', 18, 8], ['shockwave', 13, 10], ['coffee', 12, 10],
      ['heatbox', 10, 12], ['heatbox', 11, 12], ['heatbox', 12, 12], ['tens', 13, 12], ['tens', 14, 12], ['tens', 15, 12], ['traction', 16, 12], ['traction', 17, 12], ['bed', 19, 12], ['bed', 20, 12], ['bed', 21, 12],
      ['rest_room', 21, 16], ['ir_lamp', 18, 15], ['ball_pit', 20, 9], ['soft_mat', 20, 11]];
    opts_quietPut = true;
    for (const [d, x, y] of lay) put(d, x, y);
    opts_quietPut = false;
    state.map.floor[19][12] = 'ramp';
    for (const r of ['doctor', 'doctor', 'pt', 'pt', 'pt', 'pt', 'nurse', 'nurse']) state.staff.push(S.createStaff(state, r, null, 16 + (state.staff.length % 3), 14));
    refresh();
  }
  if (policy === 'bad') {
    state.objects = state.objects.filter(o => !['sofa', 'plant', 'reception'].includes(o.defId)); refresh();
    B.placeObject(state, 'reception', 10, 10); refresh();
  }
  const months = monthsPassed() + years * 12;
  const startHist = state.history.length;
  let weekNo = 0, lastWeek = state.time.week;
  const stats = { maxPatients: 0, maxSize: 0, sizes: [], minMoney: Infinity, maxMoney: -Infinity, gameOver: 0, bad: [], inspections: 0, expansions: 0, researched: 0, events: 0, maxRet: 0 };
  const offs = [bus.on('game:over', () => stats.gameOver++), bus.on('inspection:result', () => stats.inspections++), bus.on('lot:expanded', () => stats.expansions++)];
  const t0 = Date.now();
  while (monthsPassed() < months) {
    if (state.events.pendingDilemma) stats.events++;
    step(1);
    if (state.time.week !== lastWeek) {
      lastWeek = state.time.week; weekNo++;
      POLICY[policy](weekNo);
      stats.maxPatients = Math.max(stats.maxPatients, state.patients.length);
      stats.minMoney = Math.min(stats.minMoney, state.money); stats.maxMoney = Math.max(stats.maxMoney, state.money);
      stats.maxRet = Math.max(stats.maxRet, state.agents && state.agents.returning ? state.agents.returning.length : 0);
      if (weekNo % 4 === 0) {
        const bad = invariants();
        if (bad.length) { stats.bad.push(`y${state.time.year}m${state.time.month}: ` + bad.slice(0, 3).join('; ')); if (stats.bad.length > 5) break; }
      }
      if (weekNo % 48 === 0) { const sz = jsonSize(); stats.sizes.push(sz); stats.maxSize = Math.max(stats.maxSize, sz); }
    }
  }
  offs.forEach(f => f());
  stats.researched = state.research.done.length;
  stats.ms = Date.now() - t0;
  return stats;
}
function longrunSection() {
  section(`Long runs: ${YEARS} simulated years x [${POLICIES.join(', ')}]`);
  for (const pol of POLICIES) {
    if (!POLICY[pol]) { console.log('  unknown policy', pol); continue; }
    const st = longRun(pol, YEARS, SEED);
    const fin = invariants();
    console.log(`  ${pol.padEnd(8)} ${(st.ms / 1000).toFixed(1)}s money ${Math.round(state.money / 1000)}k [min ${Math.round(st.minMoney / 1000)}k max ${Math.round(st.maxMoney / 1000)}k] rep ${Math.round(state.reputation)} L${state.lotLevel} staff ${state.staff.length} objs ${state.objects.length} research ${st.researched}/${Object.keys(RESEARCH).length} hist ${state.history.length} peak-pat ${st.maxPatients} returning<=${st.maxRet} save ${(jsonSize() / 1024).toFixed(0)}KB nextId ${state.nextId} insp ${st.inspections} exp ${st.expansions} gameOver ${st.gameOver} events ${st.events}`);
    check(`longrun ${pol}: no invariant violations during ${YEARS}y`, st.bad.length === 0, st.bad.slice(0, 3).join(' || '));
    check(`longrun ${pol}: final invariants`, fin.length === 0, fin.slice(0, 4).join('; '));
    check(`longrun ${pol}: history length == simulated months`, state.history.length === Math.min(Eco.HISTORY_MAX, YEARS * 12), String(state.history.length));
    if (flag('monthly')) console.log('   ' + state.history.map(h => `${h.year}.${h.month}:${Math.round(h.net / 1000)}k/${h.patients}p`).join(' '));
    check(`longrun ${pol}: save size stays bounded (<600KB)`, st.maxSize < 600000, st.sizes.map(s => Math.round(s / 1024) + 'KB').join(','));
    if (pol !== 'chaos') check(`longrun ${pol}: inspection ran every year`, st.inspections === YEARS, String(st.inspections));
    if (st.sizes.length >= 3) check(`longrun ${pol}: no runaway growth (last year < 2.5x year 2)`, st.sizes[st.sizes.length - 1] < st.sizes[1] * 2.5 + 20000, st.sizes.join(','));
    if (pol !== 'chaos') {
      longRun(pol, 1, SEED); const b1 = dump();
      longRun(pol, 1, SEED); const b2 = dump();
      check(`longrun ${pol}: same seed -> bit-identical state (1y, run twice)`, b1 === b2, firstDiff(JSON.parse(b1), JSON.parse(b2)).join(' ; '));
    }
  }
}

// =====================================================================================================
if (want('features')) featuresSection();
if (want('edge')) edgeSection();
if (want('save')) saveSection();
if (want('longrun')) longrunSection();

if (FEATURES.length) {
  section('Feature conformance');
  for (const [n, s, e] of FEATURES) console.log(`  ${s.padEnd(8)} ${n}  --  ${e}`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
