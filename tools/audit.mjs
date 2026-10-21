// Headless (Node, no browser) systems audit: PRD conformance, determinism / long-run integrity, edge cases.
//
// Usage (from repo root; no server needed):
//   node tools/audit.mjs                 # everything, 5 simulated years per long-run policy (a few minutes)
//   node tools/audit.mjs --quick         # 2 years per policy (~1-2 min) - good for CI
//   node tools/audit.mjs --only features,edge,save   # run only some sections: features | edge | save | longrun | achievements | events
//   node tools/audit.mjs --years 3 --policies idle,chaos --seed 7 [--verbose]
//   (events = docs/EVENTS_EXT.md: every event x every choice, cond evaluator, wear/morale/risk/review/buffs/follow-ups)
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
const Ach = await imp('sim/achievements.js');
const ACHD = await imp('data/achievements.js');
const { BUILDABLES } = await imp('data/buildables.js');
const { TREATMENTS } = await imp('data/treatments.js');
const { RESEARCH } = await imp('data/research.js');
const { LOTS } = await imp('data/lots.js');
const { PATIENT_TYPES } = await imp('data/patients.js');
const EVD = await imp('data/events.js');
const { SYNERGIES } = await imp('data/synergies.js');
const FEES = await imp('data/fees.js');

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
  Eco.initEconomy(); Ev.initEvents(); Res.initResearch(); Ins.initInspection(); Ach.initAchievements();
  bus.on('mods:dirty', () => Mod.recomputeMods(state));
  bus.on('map:changed', () => { ui.dirtyOcc = true; });
  bus.on('week:end', () => P.closeUp(state));
  bus.on('month:start', () => S.refreshPool(state));
  bus.on('toast', () => {});
}
function refresh() { rebuildOccupancy(state); Syn.recomputeZones(state); Mod.recomputeMods(state); ui.dirtyOcc = false; }
// liveAchv=false (default): every achievement is pre-unlocked so reward payouts cannot disturb the exact-money assertions of the other
// sections; the achievements section and the long runs pass true to exercise the real system.
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
  const ok = pd.choices.map((c, i) => i).filter(i => Ev.choiceAffordable(state, pd.choices[i]));   // the UI disables unaffordable options
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
  { // achievements (state.achv) stay well-formed
    const A = state.achv, known = new Set(ACHD.ACHIEVEMENTS.map(d => d.id));
    must(A && typeof A === 'object' && A.unlocked && A.counters && Array.isArray(A.badges), 'achv shape');
    if (A && A.unlocked) {
      for (const id of Object.keys(A.unlocked)) must(known.has(id), 'achv unknown id ' + id);
      must(A.badges.length <= ACHD.MAX_BADGES && A.badges.every(id => A.unlocked[id]), 'achv badges invalid');
      must(A.title === null || !!(A.unlocked[A.title] && (ACHD.ACHIEVEMENTS.find(d => d.id === A.title) || {}).title), 'achv title invalid');
      for (const [k, v] of Object.entries(A.counters)) if (typeof v === 'number') must(Number.isFinite(v) && (k === 'lowestMoneySeen' || k === 'startMoney' || v >= 0), 'achv counter ' + k + '=' + v);
    }
  }
  { // M2 / M3 / M4 / M5 / M7 / M10 fields stay in range
    for (const o of state.objects) { must(o.wear === undefined || (o.wear >= 0 && o.wear <= 100), 'wear out of range ' + o.defId + ' ' + o.wear); }
    const rk = state.nhi.risk, rv = state.reviewScore;
    must(rk === undefined || (rk >= 0 && rk <= 100), 'risk out of range ' + rk);
    must(rv === undefined || (rv >= 1 && rv <= 5), 'reviewScore out of range ' + rv);
    for (const s of state.staff) must(s.morale === undefined || (s.morale >= 0 && s.morale <= 100), 'morale out of range ' + s.morale);
    const ev = state.events;
    must(!ev.buffs || (Array.isArray(ev.buffs) && ev.buffs.every(b => b.weeksLeft > 0 && b.mods && typeof b.label === 'string')), 'buffs malformed');
    must(!ev.flags || typeof ev.flags === 'object', 'flags malformed');
    must(!ev.pendingFollowUps || ev.pendingFollowUps.every(f => typeof f.id === 'string' && Number.isFinite(f.due)), 'followUps malformed');
    must(!ev.pendingFollowUps || ev.pendingFollowUps.length <= 40, 'too many follow-ups');
    must(!ev.buffs || ev.buffs.length <= 40, 'too many buffs');
  }
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
    check('economy: pv = undiluted real value (0.95) under cap', Eco.getPointValue(state) === FEES.NHI_POINT_VALUE.typical && Eco.PV_BASE === 0.95, String(Eco.getPointValue(state)));
    state.nhi.monthPoints = cap * 1.02;
    check('economy: just over the cap pv stays at the undiluted value (cap/pts > 0.95)', Eco.getPointValue(state) === Eco.PV_BASE, String(Eco.getPointValue(state)));
    state.nhi.monthPoints = cap * 1.25;
    check('economy: pv=cap/points above cap', near(Eco.getPointValue(state), 0.8, 1e-9), String(Eco.getPointValue(state)));
    state.nhi.monthPoints = cap * 10;
    check('economy: pv floor 0.6', Eco.getPointValue(state) === 0.6);
    const costs = Eco.monthlyCosts(state);
    state.nhi.monthPoints = cap * 2;
    const m0 = state.money;
    state.ledger.income.self = 123;
    const rec = Eco.settleMonth(state);
    const expectNhi = Math.round(cap * 2 * 0.6 * Eco.PATIENT_WEIGHT);
    check('economy: settle nhi income = points*pv*PATIENT_WEIGHT', rec.nhiIncome === expectNhi, `${rec.nhiIncome} vs ${expectNhi}`);
    check('economy: settle record carries weight + base point value + copay + self income', rec.patientWeight === Eco.PATIENT_WEIGHT && rec.basePointValue === 0.95 && rec.copayIncome === 0 && rec.selfIncome === 123, JSON.stringify([rec.patientWeight, rec.basePointValue, rec.copayIncome, rec.selfIncome]));
    check('economy: salaries+rent+maintain charged', near(m0 + expectNhi - costs.salary - costs.rent - costs.maintain, state.money, 1), `${state.money}`);
    check('economy: ledger reset (incl. copay) + history pushed + monthPoints reset', state.ledger.income.copay === 0 && state.history.length === 1 && state.nhi.monthPoints === 0 && state.ledger.income.nhi === 0 && state.ledger.expense.salary === 0);
    check('economy: record has diluted flag', rec.diluted === true && rec.pointValue === 0.6);
    state.nhi.monthPoints = cap * 0.5; const rec2 = Eco.settleMonth(state);
    check('economy: undiluted record: pointValue 0.95, diluted=false (nhi:settled shows the real value)', rec2.pointValue === 0.95 && rec2.diluted === false && state.nhi.lastSettlement.pointValue === 0.95, JSON.stringify([rec2.pointValue, rec2.diluted]));
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
    feature('月底健保結算 + 浮動點值打折 + 薪水/租金/維護', 'works', 'pv=cap/pts clamp 0.6..0.95; salaries/rent/maintain charged; bankrupt < -300k');
  }

  // ---- 真實費率 (data/fees.js) + 單一申報 + 診察費分段 + 部分負擔 + 代表人數 ----
  {
    fresh();
    // fees.js integrity: every treatment has an entry, finite numbers, low <= typical <= high, treatments.js is fed from it
    const ids = Object.keys(TREATMENTS);
    check('fees: 17 treatments, all with a TREATMENT_FEES entry (and nothing extra)', ids.length === 17 && ids.every(id => FEES.TREATMENT_FEES[id]) && Object.keys(FEES.TREATMENT_FEES).length === 17, ids.length + ' vs ' + Object.keys(FEES.TREATMENT_FEES).length);
    const badFee = [];
    for (const id of ids) {
      const F = FEES.TREATMENT_FEES[id], T = TREATMENTS[id];
      if (!['high', 'medium', 'low'].includes(F.confidence) || !Array.isArray(F.sources) || typeof F.note !== 'string' || !F.note) badFee.push(id + ':meta');
      if (F.kind !== T.kind) badFee.push(id + ':kind');
      if (F.kind === 'nhi') {
        if (!(Number.isFinite(F.nhiPoints) && F.nhiPoints > 0) || T.nhiPoints !== F.nhiPoints || T.price !== 0 || !['exam', 'pt', 'ot', 'st', 'us'].includes(F.claim)) badFee.push(id + ':nhi');
      } else {
        const sp = F.selfPrice;
        if (!sp || ![sp.low, sp.typical, sp.high].every(Number.isFinite) || !(sp.low > 0 && sp.low <= sp.typical && sp.typical <= sp.high) || T.price !== sp.typical || T.nhiPoints !== 0) badFee.push(id + ':self');
      }
      if (F.selfPrice && F.kind === 'nhi' && !(F.selfPrice.low <= F.selfPrice.typical && F.selfPrice.typical <= F.selfPrice.high)) badFee.push(id + ':ref');
    }
    check('fees: integrity (confidence+sources+note, finite, low <= typical <= high, treatments.js matches fees.js)', badFee.length === 0, badFee.join(' '));
    check('fees: real self-pay typical prices (shockwave 2500, laser 2000, manual 2000, redcord 1700, prp 17000, insole 5000)',
      [['shockwave', 2500], ['laser', 2000], ['manual_self', 2000], ['redcord', 1700], ['prp', 17000], ['insole', 5000]].every(([id, v]) => TREATMENTS[id].price === v));
    check('fees: PT tiers 95/200/330/400, copay 50, point value 0.95/floor 0.6, asOf 2026-10',
      FEES.PT_TIERS.simple === 95 && FEES.PT_TIERS.moderate === 200 && FEES.PT_TIERS.moderateComplex === 330 && FEES.PT_TIERS.complex === 400 && FEES.COPAY_NTD === 50 &&
      FEES.NHI_POINT_VALUE.typical === 0.95 && FEES.NHI_POINT_VALUE.min === 0.6 && Eco.PV_MIN === 0.6 && FEES.FEES_AS_OF === '2026-10');
    check('fees: PT tiers ascending, exam tiers ascending upTo and non-increasing points', FEES.PT_TIERS.simple < FEES.PT_TIERS.moderate && FEES.PT_TIERS.moderate < FEES.PT_TIERS.moderateComplex && FEES.PT_TIERS.moderateComplex < FEES.PT_TIERS.complex &&
      FEES.EXAM_FEE_TIERS.every((t, i, a) => i === 0 || (t.upTo > a[i - 1].upTo && t.points <= a[i - 1].points)));

    // exam fee tiers by patients per day (boundaries 35/36, 45/46, 65/66, 85/86)
    const ef = FEES.examFeePoints;
    check('exam fee tiers: 1..35 -> 364, 36..45 -> 250, 46..65 -> 200, 66..85 -> 160, 86+ -> 160',
      [1, 35].every(n => ef(n) === 364) && [36, 45].every(n => ef(n) === 250) && [46, 65].every(n => ef(n) === 200) && [66, 85, 86, 200].every(n => ef(n) === 160), JSON.stringify([1, 35, 36, 45, 46, 65, 66, 85, 86].map(ef)));
    check('exam fee tiers: low-confidence 46-65 tier is flagged as an estimate', FEES.EXAM_FEE_TIERS[2].confidence === 'low' && FEES.EXAM_FEE_TIERS[2].estimate === true);
    const exAt = (done) => { state.stats.patientsToday = done; return Eco.listedPoints(state, 'exam'); };
    check('exam fee uses state.stats.patientsToday (the patient being examined is #patientsToday+1)', exAt(0) === 364 && exAt(34) === 364 && exAt(35) === 250 && exAt(44) === 250 && exAt(45) === 200 && exAt(64) === 200 && exAt(65) === 160 && exAt(84) === 160 && exAt(85) === 160);
    state.stats.patientsToday = 0;

    // single-claim rule (economy.nhiClaim): per patient per visit only the highest PT item is paid
    const run = (ids2) => { const claims = {}; return ids2.map(id => Eco.nhiClaim(state, claims, id)); };
    const sum = (r) => r.reduce((a, x) => a + x.paid, 0);
    let r = run(['heat', 'tens', 'traction']);
    check('single claim: heat+tens+traction (3 moderate PT items) -> only 200 paid in total, the others pay 0', sum(r) === 200 && r[0].paid === 200 && r[1].paid === 0 && r[2].paid === 0 && r[1].listed === 200, JSON.stringify(r));
    r = run(['ir', 'heat']);
    check('single claim: infrared (95) then heat (200) -> 95 + 105 = the highest tier (200)', sum(r) === 200 && r[0].paid === 95 && r[1].paid === 105);
    r = run(['heat', 'ir', 'taping']);
    check('single claim: order does not matter (heat first, then ir / taping pay 0)', sum(r) === 200 && r[1].paid === 0 && r[2].paid === 0 && r[2].listed === 150);
    r = run(['taping', 'ir']);
    check('single claim: taping 150 > ir 95 -> 150', sum(r) === 150);
    r = run(['exam', 'us', 'heat', 'si', 'fine', 'speech']);
    check('separate claims: exam, us, PT, OT (si+fine = one claim), ST are each paid; fine pays 0 after si',
      r[0].paid === 364 && r[1].paid === 500 && r[2].paid === 200 && r[3].paid === 320 && r[4].paid === 0 && r[4].listed === 320 && r[5].paid === 320 && sum(r) === 364 + 500 + 200 + 320 + 320, JSON.stringify(r.map(x => x.paid)));
    check('single claim: self-pay treatments never claim NHI', Eco.nhiClaim(state, {}, 'shockwave').paid === 0 && Eco.nhiClaim(state, {}, 'prp').listed === 0);

    // treatment:done payload (e2e): per patient visit the PT claims sum to the highest listed PT value; paid <= listed; flagged when reduced
    {
      fresh(4); clearObjects();
      put('reception', 16, 17); put('sofa', 12, 18); put('exam_room', 11, 14); put('heatbox', 11, 11); put('tens', 13, 11); put('traction', 15, 11); put('bed', 18, 13);
      state.staff.push(S.createStaff(state, 'pt', null, 17, 15)); state.reputation = 120;
      const visits = new Map(); let reduced = 0, over = 0, sample = null;
      const off = bus.on('treatment:done', (e) => {
        const F = FEES.TREATMENT_FEES[e.treatmentId];
        if (e.nhiListed < e.nhiPoints) over++;
        if (e.singleClaim) { reduced++; sample = sample || { id: e.treatmentId, paid: e.nhiPoints, listed: e.nhiListed }; }
        if (F.claim !== 'pt') return;
        const k = e.patient.id + '/' + e.patient.visit;
        const v = visits.get(k) || { paid: 0, max: 0 }; v.paid += e.nhiPoints; v.max = Math.max(v.max, e.nhiListed); visits.set(k, v);
      });
      runWeeks(6); off();
      const wrong = [...visits.values()].filter(v => v.paid !== v.max);
      check('treatment:done e2e: per patient visit the paid PT points equal the highest listed PT item (6 weeks)', visits.size > 20 && wrong.length === 0, `visits=${visits.size} wrong=${JSON.stringify(wrong.slice(0, 3))}`);
      check('treatment:done e2e: some treatments are flagged singleClaim (paid < listed), paid never exceeds listed', reduced > 0 && over === 0, `reduced=${reduced} over=${over} ${JSON.stringify(sample)}`);
    }

    // exam fee e2e: crowded days pay less per exam than quiet days
    {
      fresh(4); clearObjects();
      put('reception', 16, 17); put('sofa', 12, 18); put('exam_room', 11, 14); put('heatbox', 11, 11);
      const seen = []; const off = bus.on('treatment:done', (e) => { if (e.treatmentId === 'exam') seen.push(e.nhiPoints); });
      runWeeks(1); off();
      check('exam fee e2e: exam claims on a quiet day are the first-tier 364 points', seen.length > 0 && seen.every(x => x === 364), JSON.stringify(seen));
      const crowded = []; const offC = bus.on('treatment:done', (e) => { if (e.treatmentId === 'exam') crowded.push([e.nhiPoints, e.nhiListed]); });
      state.stats.patientsToday = 36; runWeeks(1); offC();
      check('exam fee e2e: a crowded day (36 patients already served) pays 250 (200 once past 45) per exam instead of 364', crowded.length > 0 && crowded[0][0] === 250 && crowded.every(([paid, listed]) => (paid === 250 || paid === 200) && paid === listed), JSON.stringify(crowded));
      state.stats.patientsToday = 40;
      check('exam fee: with 40 patients already served the next exam lists 250 points', Eco.listedPoints(state, 'exam') === 250);
    }

    // weight applied consistently: NHI points x pv x W, self-pay price x W, copay x W; salaries/rent/events are NOT weighted
    {
      fresh(); state.money = 1000000; state.ledger = { income: { nhi: 0, self: 0, copay: 0, other: 0 }, expense: { salary: 0, rent: 0, build: 0, maintain: 0, other: 0 } };
      const W = Eco.PATIENT_WEIGHT;
      check('PATIENT_WEIGHT is a positive integer constant', Number.isInteger(W) && W > 1);
      const m0 = state.money;
      bus.emit('treatment:done', { patient: {}, treatmentId: 'heat', nhiPoints: 200, nhiListed: 200, selfPay: 0, copay: 0, staffId: null });
      check('weight: NHI points are only counted at treatment time (no cash yet)', state.money === m0 && state.nhi.monthPoints === 200);
      bus.emit('treatment:done', { patient: {}, treatmentId: 'shockwave', nhiPoints: 0, selfPay: Eco.selfPayPrice(state, 'shockwave'), copay: 0, staffId: null });
      check('weight: self-pay credits real price x PATIENT_WEIGHT immediately (2500 x W)', state.money === m0 + 2500 * W && state.ledger.income.self === 2500 * W, `${state.money - m0} vs ${2500 * W}`);
      bus.emit('treatment:done', { patient: {}, treatmentId: 'tens', nhiPoints: 0, nhiListed: 200, selfPay: 0, copay: FEES.COPAY_NTD, staffId: null });
      check('weight: copay credits NT$50 x PATIENT_WEIGHT into ledger.income.copay', state.ledger.income.copay === 50 * W, String(state.ledger.income.copay));
      const mm = state.money; state.staff = []; state.objects = [];
      state.mods.rentMult = 1; const costs = Eco.monthlyCosts(state);
      const rec = Eco.settleMonth(state);
      const expectNhi = Math.round(200 * 0.95 * W);
      check('weight: settlement NHI income = points x 0.95 x W', rec.nhiIncome === expectNhi, `${rec.nhiIncome} vs ${expectNhi}`);
      check('weight: rent is plain NT$ (not weighted) and net = income - expense', costs.rent === LOTS[0].rent && rec.income === expectNhi + 2500 * W + 50 * W && state.money === mm + expectNhi - costs.rent - costs.maintain - costs.salary, `${rec.income} money ${state.money - mm}`);
      check('month report breakdown: 健保 / 自費 / 部分負擔 are separate weighted incomes in the record', rec.nhiIncome === expectNhi && rec.selfIncome === 2500 * W && rec.copayIncome === 50 * W && rec.otherIncome === 0, JSON.stringify([rec.nhiIncome, rec.selfIncome, rec.copayIncome]));
      Eco.earn(state, 7777, 'other');
      check('events/other money stays plain NT$ (earn other = 7777 -> 7777)', state.ledger.income.other === 7777);
      state.ledger.income.other = 0;
    }

    // copay: flat NT$50 per RETURNING visit (visit >= 1), first visit free, collected once per visit
    check('copay: copayFor(visit) is 0 for the first visit and 50 afterwards', Eco.copayFor(0) === 0 && Eco.copayFor(1) === 50 && Eco.copayFor(5) === 50 && Eco.copayFor(undefined) === 0);
    {
      fresh(8); clearObjects();
      put('reception', 16, 17); put('sofa', 12, 18); put('exam_room', 11, 14); put('heatbox', 11, 11); put('heatbox', 12, 11); put('tens', 14, 11);
      state.reputation = 150; const perVisit = new Map(); let firstVisitCopay = 0, retCopay = 0, retTreat = 0, copayRec = 0;
      const offS = bus.on('nhi:settled', (rc) => { copayRec += rc.copayIncome || 0; });
      const off = bus.on('treatment:done', (e) => {
        const k = e.patient.id + '/' + e.patient.visit;
        if (e.copay > 0) { perVisit.set(k, (perVisit.get(k) || 0) + 1); if (e.patient.visit === 0) firstVisitCopay++; else retCopay++; }
        if (e.patient.visit > 0) retTreat++;
      });
      runWeeks(8); off(); offS();
      const multi = [...perVisit.values()].filter(n => n > 1).length;
      check('copay e2e: first visits never pay, each returning visit pays exactly once', retTreat > 0 && retCopay > 0 && firstVisitCopay === 0 && multi === 0, `ret=${retCopay} first=${firstVisitCopay} multi=${multi} retTreat=${retTreat}`);
      check('copay e2e: copay income reaches the month record (copayIncome = visits x 50 x PATIENT_WEIGHT)', state.history.length >= 1 && copayRec > 0 && copayRec % (50 * Eco.PATIENT_WEIGHT) === 0, `settled copay ${copayRec}`);
    }

    // price slider semantics: 0.5..2.0 x typical (real NT$ per session)
    state.policy.priceMult.shockwave = 1; state.mods.selfPayPrice = 1;
    check('selfPayPrice is the real per-session NT$ (typical x slider), never weighted', Eco.selfPayPrice(state, 'shockwave') === 2500 && (state.policy.priceMult.shockwave = 2, Eco.selfPayPrice(state, 'shockwave')) === 5000 && (state.policy.priceMult.shockwave = 0.5, Eco.selfPayPrice(state, 'shockwave')) === 1250);
    state.policy.priceMult.shockwave = 1;
    feature('真實費率 fees.js + 單一申報 + 診察費分段 + 部分負擔 + PATIENT_WEIGHT', 'works', 'one data module; PT highest-tier-only; exam 364/250/200/160 by patientsToday; copay 50 per returning visit; weight x' + Eco.PATIENT_WEIGHT);
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
    const fxKeys = new Set(['money', 'reputation', 'points', 'sat', 'nhiPenalty', 'risk']);
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
      for (let rep = 0; rep < 16; rep++) {
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

  // ---- moving / rotating placed objects ----
  {
    fresh(); clearObjects(); state.money = 1e7;
    const tens = put('tens', 12, 12), room = put('exam_room', 15, 12), plant = put('plant', 12, 15);
    const fee = B.relocationCost('tens');
    check('move: relocationCost = max(500, 10% of build cost)', fee === Math.max(500, Math.round(BUILDABLES.tens.cost * 0.1)) && B.relocationCost('plant') === Math.max(500, Math.round(BUILDABLES.plant.cost * 0.1)) && B.relocationCost('plant') >= 500 && B.relocationCost('floor_mat') === 0, `${fee}`);
    const snap = () => JSON.stringify([state.objects, state.money, state.ledger.expense.build]);
    const s0 = snap();
    check('move: onto another object refused (reason, nothing changes)', !B.canMove(state, tens.id, 15, 12, 0).ok && B.moveObject(state, tens.id, 16, 13, 0) === false && snap() === s0);
    check('move: overlapping its OWN old footprint is fine (shift by one)', B.canMove(state, room.id, 16, 12, 0).ok);
    check('move: outside the lot refused', !B.canMove(state, tens.id, state.lot.x0 - 1, 12, 0).ok && !B.canMove(state, room.id, state.lot.x0 + state.lot.w - 1, 12, 0).ok && !B.canMove(state, tens.id, 5, 5, 0).ok && B.moveObject(state, tens.id, 99, 99, 0) === false);
    const e = entryTile(state);
    check('move: entry tile refused', !B.canMove(state, tens.id, e.x, e.y, 0).ok && !B.canMove(state, room.id, e.x - 1, e.y - 1, 0).ok);
    check('move: same spot + same rotation = no-op refused', !B.canMove(state, tens.id, 12, 12, 0).ok && B.moveObject(state, tens.id, 12, 12, 0) === false);
    check('move: unknown id / non-object refused', !B.canMove(state, 99999, 12, 12, 0).ok && B.moveObject(state, 99999, 12, 12, 0) === false);
    state.money = fee - 1;
    check('move: unaffordable fee refused, nothing changes', !B.canMove(state, tens.id, 12, 14, 0).ok && B.moveObject(state, tens.id, 12, 14, 0) === false && state.money === fee - 1 && tens.x === 12 && tens.y === 12);
    state.money = 1e7; tens.wear = 37;
    const ev = []; const un1 = bus.on('object:moved', p => ev.push(p.id)); let mc = 0; const un2 = bus.on('map:changed', () => mc++);
    const m0 = state.money, b0 = state.ledger.expense.build; ui.dirtyOcc = false;
    check('move: valid move succeeds', B.moveObject(state, tens.id, 12, 14, 0) === true);
    check('move: keeps id + wear, new position, fee charged once as build expense', tens.id === state.objects.find(o => o.defId === 'tens').id && tens.wear === 37 && tens.x === 12 && tens.y === 14 && state.money === m0 - fee && state.ledger.expense.build === b0 + fee);
    check('move: dirtyOcc, map:changed and object:moved emitted; occupancy follows', ui.dirtyOcc === true && mc >= 1 && ev.length === 1 && ev[0] === tens.id && (refresh(), state.map.occ[14][12] === tens.id && state.map.occ[12][12] === 0));
    if (typeof un1 === 'function') { un1(); un2(); }
    check('move: result is a valid layout (invariants)', invariants().length === 0, invariants().join(';'));
    // pure rotation: free but must be valid
    const mr = state.money;
    check('rotate in place: free, valid, rot flips', B.canMove(state, room.id, 15, 12, 1).ok && B.canMove(state, room.id, 15, 12, 1).fee === 0 && B.moveObject(state, room.id, 15, 12, 1) === true && room.rot === 1 && state.money === mr);
    check('rotate in place: refused when the rotated footprint does not fit', (() => { const t = put('traction', state.lot.x0 + state.lot.w - 1, state.lot.y0 + 2, 0); return !!t && !B.canMove(state, t.id, t.x, t.y, 1).ok; })());
    check('rotateObject helper rotates back for free', (() => { const m = state.money; return B.rotateObject(state, room.id).ok && room.rot === 0 && state.money === m; })());
    // zone activation by moving
    fresh(); clearObjects(); state.money = 5e6;
    put('heatbox', 11, 11); const t2 = put('tens', 16, 14); put('traction', 13, 11, 0);
    check('move: golden3 inactive while tens is far away', !Syn.isZoneActive(state, 'golden3') && state.mods.nhiTurnover === 1);
    check('move: tens next to heatbox+traction forms golden3 (zones + mods recomputed)', B.moveObject(state, t2.id, 12, 11, 0) && Syn.isZoneActive(state, 'golden3') && near(state.mods.nhiTurnover, 1.2));
    check('move: moving a member away dissolves the zone again', B.moveObject(state, t2.id, 17, 15, 0) && !Syn.isZoneActive(state, 'golden3') && state.mods.nhiTurnover === 1);

    // moving objects that are in use: patient released gracefully, no deadlock, no double charge
    fresh(); state.money = 5e6;
    let victim = null, usedObj = null;
    for (let i = 0, N = 4 * MIN_PER_WEEK; i < N && !victim; i++) {
      step(1);
      for (const p of state.patients) if (p.stage === 'treating' && p.targetObj) { const ob = state.objects.find(o => o.id === p.targetObj); if (ob && ob.usedBy === p.id) { victim = p; usedObj = ob; break; } }
    }
    if (check('move-in-use: found a patient treating at a station', !!victim)) {
      const tgt = (() => { const l = state.lot; for (let y = l.y0 + 1; y < l.y0 + l.h - 1; y++) for (let x = l.x0 + 1; x < l.x0 + l.w - 1; x++) if (B.canMove(state, usedObj.id, x, y, usedObj.rot).ok && (x !== usedObj.x || y !== usedObj.y)) return { x, y }; return null; })();
      const pid = victim.id, sid = victim.staffId, ox = usedObj.id, mm = state.money, pay = JSON.stringify(victim.paid);
      check('move-in-use: moveObject on a busy station succeeds', !!tgt && B.moveObject(state, usedObj.id, tgt.x, tgt.y, usedObj.rot) === true);
      const st = state.staff.find(x => x.id === sid);
      check('move-in-use: treatment cancelled, patient back to waiting, links cleared', victim.stage === 'waiting' && victim.targetObj === null && victim.staffId === null && !usedObj.busy && usedObj.usedBy === null && (!st || !st.task || st.task.patientId !== pid), `${victim.stage}`);
      check('move-in-use: fee only (no double charge / payment)', state.money === mm - B.relocationCost(usedObj.defId) && JSON.stringify(victim.paid) === pay);
      runWeeks(2);
      check('move-in-use: sim continues (no pointers to the old spot, invariants hold)', invariants().length === 0 && state.objects.every(o => !o.usedBy || state.patients.some(p => p.id === o.usedBy)), invariants().join(';'));
      check('move-in-use: the moved station is usable again / patient not stuck', state.stats.patientsTotal > 0 && (victim.stage !== 'waiting' || victim.age - victim.waitStart < 600 || victim.stage === 'gone'));
    }
    // seated on a moved sofa: seat released
    fresh(); state.money = 5e6;
    let seated = null;
    for (let i = 0, N = 3 * MIN_PER_WEEK; i < N && !seated; i++) { step(1); seated = state.patients.find(p => p.seat && p.stage === 'waiting'); }
    if (check('move-seat: found a seated patient', !!seated)) {
      const sofa = state.objects.find(o => o.id === seated.seat.objId);
      const l = state.lot; let spot = null;
      for (let y = l.y0 + 1; y < l.y0 + l.h - 1 && !spot; y++) for (let x = l.x0 + 1; x < l.x0 + l.w - 1 && !spot; x++) if ((x !== sofa.x || y !== sofa.y) && B.canMove(state, sofa.id, x, y, sofa.rot).ok) spot = { x, y };
      check('move-seat: sofa moves, seat cleared (no stale seat coordinates)', B.moveObject(state, sofa.id, spot.x, spot.y, sofa.rot) && (!seated.seat || seated.seat.objId !== sofa.id || (seated.seat.x >= spot.x && seated.seat.y >= spot.y)));
      runWeeks(1);
      check('move-seat: invariants after a week', invariants().length === 0, invariants().join(';'));
    }
    // save / load round trip after a move
    fresh(); clearObjects(); state.money = 5e6;
    const mo = put('tens', 12, 12); B.moveObject(state, mo.id, 14, 14, 0); const room2 = put('exam_room', 17, 12); B.moveObject(state, room2.id, 17, 12, 1);
    const sig = JSON.stringify(state.objects.map(o => [o.id, o.defId, o.x, o.y, o.rot]));
    Sav.saveGame(state, 'mv'); state.objects = []; Sav.loadGame(state, 'mv'); refresh();
    check('move: save/load round-trip keeps moved + rotated objects', JSON.stringify(state.objects.map(o => [o.id, o.defId, o.x, o.y, o.rot])) === sig && state.map.occ[14][14] === mo.id && invariants().length === 0);
    runWeeks(1);
    check('move: week simulated after load without issues', invariants().length === 0, invariants().join(';'));
  }

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
  fresh(); state.money = 0; Ev.triggerEvent(state, 'nhi_audit'); Ev.resolveDilemma(state, 1);
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
    'pre fee-rules save (ledger without copay, mid-visit patients without claims)': (s) => { delete s.ledger.income.copay; s.patients = [{ id: 9002, type: 'elder', name: 'x', x: 15.5, y: 19.5, stage: 'waiting', plan: ['heat', 'tens', 'traction'], planIdx: 0, visit: 2, treated: 0 }]; },
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
  fresh(seed, true);
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
  const bigByMonth = new Map(); stats.bigMax = 0;
  const offs = [bus.on('game:over', () => stats.gameOver++), bus.on('inspection:result', () => stats.inspections++), bus.on('lot:expanded', () => stats.expansions++),
    bus.on('event:show', (e) => { const d = Ev.eventById(e.event.id); if (d && d.big) { const k = state.time.year * 12 + state.time.month; const n = (bigByMonth.get(k) || 0) + 1; bigByMonth.set(k, n); stats.bigMax = Math.max(stats.bigMax, n); } })];
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
    if (pol !== 'chaos') check(`longrun ${pol}: at most one big event per month`, st.bigMax <= 1, String(st.bigMax));   // (chaos reloads saves, so months repeat)
    if (pol !== 'chaos') check(`longrun ${pol}: about one decision every 1-3.5 game weeks (${(YEARS * 48 / Math.max(1, st.events)).toFixed(1)}w)`, st.events / (YEARS * 48) >= 1 / 3.5 && st.events / (YEARS * 48) <= 1, String(st.events));
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
// SECTION: achievements (docs/ACHIEVEMENTS.md §4 / §5.6)
// =====================================================================================================
function achievementsSection() {
  section('Achievements');
  const defs = ACHD.ACHIEVEMENTS;
  check('achv: 41 definitions, unique ids, 4 hidden', defs.length === 41 && new Set(defs.map(d => d.id)).size === 41 && defs.filter(d => d.hidden).length === 4);
  let unl = [], toasts = [];
  const offU = bus.on('achievement:unlocked', e => unl.push(e.id));
  const offT = bus.on('toast', t => toasts.push(t));
  const FRESH = () => { fresh(SEED, true); Ach.ensure(state); bus.emit('mods:dirty', {}); unl = []; toasts = []; };
  const add = (defId, x = 0, y = 0) => state.objects.push({ id: state.nextId++, defId, x, y, rot: 0, busy: false, usedBy: null, staffId: null, wear: 0 });
  const pat = (type = 'elder', extra = {}) => ({ id: state.nextId++, type, treated: 1, ...extra });
  const treat = (p, selfPay = 0) => bus.emit('treatment:done', { patient: p, treatmentId: 'x', nhiPoints: 0, selfPay, staffId: null });
  const left = (p, o = {}) => bus.emit('patient:left', { patient: p, satisfaction: 70, cured: false, reason: 'done', ...o });
  const weekEnd = () => { bus.emit('week:end', { ...state.time }); state.events.pendingDilemma = null; state.time.paused = false; };
  const settle = (rec = {}) => bus.emit('nhi:settled', { year: state.time.year, month: state.time.month, nhiIncome: 100000, selfIncome: 0, income: 100000, ...rec });
  const yearEnd = (y = 1) => Ach.evaluate(state, 'year:end', { year: y });   // (direct: the real year:end would also run a real inspection)
  const mkStaff = (role) => state.staff.push({ id: state.nextId++, role, skill: 5, charm: 5, salary: 1000 });
  const dil = (t) => bus.emit('dilemma:resolved', { ok: true, kind: 'dilemma', trigger: t, id: 'x' });
  const SC = {
    m_first_month: () => { state.history.push({ year: 1, month: 1, money: 1e6 }); settle(); },
    m_cash_2m: () => { state.money = 2.1e6; weekEnd(); }, m_cash_10m: () => { state.money = 10.1e6; weekEnd(); },
    m_pat_100: () => { state.stats.patientsTotal = 100; left(pat()); }, m_pat_1000: () => { state.stats.patientsTotal = 1000; left(pat()); }, m_pat_5000: () => { state.stats.patientsTotal = 5000; left(pat()); },
    m_cured_100: () => { state.stats.cured = 100; left(pat(), { cured: true }); },
    m_rep_100: () => { state.reputation = 101; left(pat()); }, m_rep_250: () => { state.reputation = 251; left(pat()); }, m_rep_600: () => { state.reputation = 601; left(pat()); },
    m_lot1: () => { state.lotLevel = 1; bus.emit('lot:expanded', { level: 1 }); }, m_lot2: () => { state.lotLevel = 2; bus.emit('lot:expanded', { level: 2 }); }, m_lot3: () => { state.lotLevel = 3; bus.emit('lot:expanded', { level: 3 }); },
    m_year3: () => { state.time.year = 4; bus.emit('year:start', { year: 4 }); },
    m_five_roles: () => { state.staff = []; for (const r of K.ROLES) mkStaff(r); weekEnd(); },
    m_research_all: () => { state.research.done = Object.keys(RESEARCH); bus.emit('research:done', { id: 'x' }); },
    t_cold_week: () => { state.weather = { kind: 'cold' }; for (let i = 0; i < 15; i++) treat(pat('elder')); weekEnd(); },
    t_rain_safe: () => { state.weather = { kind: 'rain' }; for (let i = 0; i < 12; i++) treat(pat('office')); weekEnd(); },
    t_typhoon: () => { state.weather = { kind: 'typhoon' }; for (let i = 0; i < 5; i++) treat(pat('office')); weekEnd(); },
    t_temple: () => { state.money = 1e6; Ev.startCommunity(state, 'temple_sarcopenia'); },
    t_community_all: () => { for (const c of EVD.COMMUNITY) bus.emit('community:started', { id: c.id }); },
    t_audit: () => bus.emit('inspection:result', { pass: true, score: 75 }),
    t_audit_excellent: () => bus.emit('inspection:result', { pass: true, score: Ins.EXCELLENT_SCORE }),
    t_audit_3: () => { for (let i = 0; i < 3; i++) bus.emit('inspection:result', { pass: true, score: 75 }); },
    t_dilemma_5: () => { for (let i = 0; i < 5; i++) dil('painkiller'); },
    t_dilemma_all: () => { for (const t of ['painkiller', 'skip_doctor', 'overtreat', 'complain']) dil(t); },
    t_selfpay_40: () => settle({ nhiIncome: 60000, selfIncome: 40000 }),
    t_board_3: () => { state.policy.boards = EVD.BOARDS.slice(0, 3).map(b => b.id); bus.emit('mods:dirty', {}); },
    c_zone_golden: () => { add('heatbox', 12, 12); add('tens', 14, 12); add('traction', 16, 12); Syn.recomputeZones(state); bus.emit('map:changed', {}); },
    c_zone_premium: () => { add('manual_room', 12, 12); add('shockwave', 14, 12); add('coffee', 15, 12); Syn.recomputeZones(state); bus.emit('map:changed', {}); },
    c_zone_kidpark: () => { add('ball_pit', 12, 12); add('soft_mat', 14, 12); add('bookshelf', 16, 12); Syn.recomputeZones(state); bus.emit('map:changed', {}); },
    c_zone_all: () => { state.zones = [{ id: 'golden3' }, { id: 'premium' }, { id: 'kidpark' }]; bus.emit('map:changed', {}); },
    c_zero_slip_year: () => { for (let i = 0; i < 200; i++) left(pat('office')); yearEnd(); },
    c_no_angry_month: () => { for (let i = 0; i < 20; i++) left(pat('office')); settle(); },
    c_full_house: () => { state.lotLevel = Math.max(state.lotLevel, 1); for (let i = 0, n = Math.ceil(0.9 * LOTS[state.lotLevel].maxPatientsPerWeek); i < n; i++) treat(pat('office')); },
    c_pure_nhi: () => { state.money = state.achv.counters.startMoney + 1000; yearEnd(); },
    c_one_week_cure: () => { for (let i = 0; i < 10; i++) left(pat(), { cured: true }); },
    h_coffee: () => { add('coffee', 1, 1); add('coffee', 3, 1); add('coffee', 5, 1); bus.emit('map:changed', {}); },
    h_chat: () => { for (let i = 0; i < 50; i++) bus.emit('patient:chat', { patient: pat('elder') }); },
    h_comeback: () => { state.money = 10000; weekEnd(); state.money = 1.1e6; weekEnd(); },
    h_plants: () => { for (let i = 0; i < 10; i++) add('plant', i, 2); bus.emit('map:changed', {}); },
  };
  const NO_EXACT_REWARD = new Set(['t_temple', 'h_comeback', 'm_cash_2m', 'm_cash_10m', 'c_pure_nhi']);
  check('achv: a scenario exists for every definition', defs.every(d => SC[d.id]), defs.filter(d => !SC[d.id]).map(d => d.id).join(','));
  let nOk = 0;
  for (const d of defs) {
    if (!SC[d.id]) continue;
    FRESH();
    // everything else pre-unlocked so only this achievement pays out (exact reward accounting)
    for (const o of defs) if (o.id !== d.id) state.achv.unlocked[o.id] = { year: 1, month: 1, week: 1 };
    const m0 = state.money, r0 = state.reputation, p0 = { ...state.points };
    SC[d.id]();
    state.events.pendingDilemma = null;
    const okU = Ach.isUnlocked(state, d.id);
    check(`achv ${d.id}: unlocks when condition is forced`, okU);
    if (!okU) continue;
    nOk++;
    check(`achv ${d.id}: unlock event + good toast exactly once`, unl.filter(x => x === d.id).length === 1 && toasts.filter(t => t.kind === 'good' && t.text.includes(d.name)).length === 1);
    const T = ACHD.ACHIEVEMENT_TIERS[d.tier], ov = d.reward || {};
    const key = d.tier === 3 ? 'service' : (ov.pointKey || 'service');
    if (!NO_EXACT_REWARD.has(d.id)) check(`achv ${d.id}: money reward == tier/override`, state.money - m0 === (ov.money ?? T.money), `${state.money - m0}`);
    if (!/^m_rep|^t_temple/.test(d.id)) check(`achv ${d.id}: reputation reward`, near(state.reputation - r0, ov.rep ?? T.rep, 1e-6), `${state.reputation - r0}`);
    if (d.id !== 't_temple') check(`achv ${d.id}: points reward in the right track`, K.POINT_KEYS.every(k => near(state.points[k] - p0[k], k === key ? T.points : 0, 1e-6)));
    const m1 = state.money; SC[d.id](); state.events.pendingDilemma = null;
    check(`achv ${d.id}: second trigger does not unlock/pay again`, unl.filter(x => x === d.id).length === 1 && (NO_EXACT_REWARD.has(d.id) || state.money === m1));
  }
  feature('Achievements: 41 unlock conditions', nOk === 41 ? 'OK' : 'PARTIAL', `${nOk}/41 forced via events`);

  // ---- negatives ----
  FRESH(); state.weather = { kind: 'rain' }; for (let i = 0; i < 12; i++) treat(pat('office')); bus.emit('patient:slip', { patient: pat() }); weekEnd();
  check('achv: rain week with a slip does not unlock t_rain_safe', !Ach.isUnlocked(state, 't_rain_safe'));
  FRESH(); state.weather = { kind: 'cold' }; for (let i = 0; i < 14; i++) treat(pat('elder')); weekEnd();
  check('achv: 14 elders in a cold week is not enough', !Ach.isUnlocked(state, 't_cold_week'));
  FRESH(); state.weather = { kind: 'cold' }; for (let i = 0; i < 15; i++) { const p = pat('elder'); treat(p); treat(p); }
  check('achv: weekly served counts unique patients', state.achv.counters.servedThisWeek === 15);
  weekEnd(); check('achv: weekly counters reset at week:end', state.achv.counters.servedThisWeek === 0 && state.achv.counters.weekSeen.length === 0);
  FRESH(); for (let i = 0; i < 25; i++) left(pat('office')); left(pat('office'), { reason: 'angry', satisfaction: 10 }); settle();
  check('achv: an angry leaver blocks c_no_angry_month', !Ach.isUnlocked(state, 'c_no_angry_month'));
  FRESH(); for (let i = 0; i < 25; i++) left(pat('office')); left(pat('office'), { satisfaction: 24 }); settle();
  check('achv: satisfaction < 25 counts as angry', !Ach.isUnlocked(state, 'c_no_angry_month'));
  FRESH(); for (let i = 0; i < 19; i++) left(pat('office')); settle();
  check('achv: < 20 served blocks c_no_angry_month', !Ach.isUnlocked(state, 'c_no_angry_month'));
  FRESH(); for (let i = 0; i < 200; i++) left(pat('office')); bus.emit('patient:slip', { patient: pat() }); state.events.pendingDilemma = null; yearEnd();
  check('achv: one slip blocks c_zero_slip_year', !Ach.isUnlocked(state, 'c_zero_slip_year'));
  FRESH(); treat(pat(), 500); state.money = 5e6; yearEnd();
  check('achv: a self-pay treatment blocks c_pure_nhi', !Ach.isUnlocked(state, 'c_pure_nhi'));
  FRESH(); state.achv.counters.trackYear = null; state.money = 5e6; yearEnd();
  check('achv: untracked (migrated mid-year) year cannot grant c_pure_nhi', !Ach.isUnlocked(state, 'c_pure_nhi'));
  FRESH(); bus.emit('inspection:result', { pass: false, score: 30 }); check('achv: failed audit does not unlock t_audit', !Ach.isUnlocked(state, 't_audit'));
  FRESH(); bus.emit('inspection:result', { pass: true, score: 80 }); bus.emit('inspection:result', { pass: true, score: 80 }); bus.emit('inspection:result', { pass: false, score: 30 }); bus.emit('inspection:result', { pass: true, score: 80 });
  check('achv: a failed audit resets the streak', !Ach.isUnlocked(state, 't_audit_3') && state.achv.counters.auditPassStreak === 1);
  FRESH(); bus.emit('dilemma:resolved', { ok: true, kind: 'event', trigger: null }); check('achv: random events are not dilemmas', Object.values(state.achv.counters.dilemmasDone).every(v => v === 0));
  FRESH(); settle({ nhiIncome: 61000, selfIncome: 39000 }); check('achv: 39% self-pay share does not unlock', !Ach.isUnlocked(state, 't_selfpay_40'));
  FRESH(); state.money = 900000; weekEnd(); state.money = 1.5e6; weekEnd(); check('achv: h_comeback needs money to have dipped < 50k', !Ach.isUnlocked(state, 'h_comeback'));
  FRESH(); for (let i = 0; i < 49; i++) bus.emit('patient:chat', { patient: pat('elder') }); bus.emit('patient:chat', { patient: pat('office') }); check('achv: only elder chats count', !Ach.isUnlocked(state, 'h_chat'));
  FRESH(); state.money = 5e6; const rc = Ev.startCommunity(state, 'health_talk'); check('achv: startCommunity emits community:started', rc.ok && state.achv.counters.communityDone.health_talk === 1);

  // ---- listAchievements masking / progress ----
  FRESH(); let L = Ach.listAchievements(state);
  check('achv: listAchievements returns 41 rows', L.length === 41);
  const hid = L.filter(x => x.def.hidden);
  check('achv: locked hidden ones masked (name ？？？, hint shown, no progress)', hid.length === 4 && hid.every(x => x.masked && x.def.name === '？？？' && x.def.desc === x.def.hint && !x.unlocked && x.goal === 0));
  check('achv: masked rows do not leak real names or titles', !hid.some(x => defs.some(d => d.hidden && JSON.stringify(x).includes(d.name))));
  SC.h_chat(); L = Ach.listAchievements(state); const hc = L.find(x => x.def.id === 'h_chat');
  check('achv: hidden achievement is revealed after unlock', hc.unlocked && !hc.masked && hc.def.name === '聊天治百病' && hc.at && hc.at.year === 1 && hc.progress === hc.goal && hc.goal === 50);
  state.stats.patientsTotal = 40; const pr = Ach.listAchievements(state).find(x => x.def.id === 'm_pat_100');
  check('achv: progress from metric (patientsTotal 40/100)', pr.progress === 40 && pr.goal === 100);

  // ---- title / badges ----
  FRESH();
  check('achv: equipTitle rejects locked / unknown', !Ach.equipTitle(state, 'm_cash_10m') && !Ach.equipTitle(state, 'nope'));
  SC.m_cash_10m(); state.reputation = 260;
  check('achv: equipTitle + displayTitle format', Ach.equipTitle(state, 'm_cash_10m') && Ach.displayTitle(state) === '〔千萬院長〕地方復健名醫', Ach.displayTitle(state));
  SC.m_cash_2m(); check('achv: equipTitle rejects achievements without a title', !Ach.equipTitle(state, 'm_cash_2m') && state.achv.title === 'm_cash_10m');
  check('achv: equipTitle(null) clears', Ach.equipTitle(state, null) && state.achv.title === null && Ach.displayTitle(state) === '地方復健名醫');
  SC.m_pat_100(); SC.m_lot1(); SC.m_year3(); SC.m_five_roles();
  check('achv: setBadges accepts 3 unlocked', Ach.setBadges(state, ['m_pat_100', 'm_lot1', 'm_year3']) && state.achv.badges.length === 3);
  check('achv: setBadges rejects >3 / locked / duplicates and keeps the old list', !Ach.setBadges(state, ['m_pat_100', 'm_lot1', 'm_year3', 'm_five_roles']) && !Ach.setBadges(state, ['h_coffee']) && !Ach.setBadges(state, ['m_pat_100', 'm_pat_100']) && state.achv.badges.length === 3);
  check('achv: badgeIcons <= 4 entries', Ach.badgeIcons(state).length <= 4 && Ach.badgeIcons(state).length >= 3);
  FRESH(); defs.slice(0, 10).forEach(d => { state.achv.unlocked[d.id] = {}; });
  const m10 = Ach.badgeIcons(state)[0]; defs.slice(10, 20).forEach(d => { state.achv.unlocked[d.id] = {}; }); const m20 = Ach.badgeIcons(state)[0];
  defs.slice(20, 30).forEach(d => { state.achv.unlocked[d.id] = {}; }); const m30 = Ach.badgeIcons(state)[0]; defs.slice(30).forEach(d => { state.achv.unlocked[d.id] = {}; });
  check('achv: milestone badge 10/20/30/all = 🥉🥈🥇🏆', m10 === '🥉' && m20 === '🥈' && m30 === '🥇' && Ach.badgeIcons(state)[0] === '🏆');

  // ---- evaluateAll retroactive ----
  FRESH(); state.money = 11e6; state.stats.patientsTotal = 1200; state.stats.cured = 150; state.reputation = 300; state.lotLevel = 1; state.history.push({ year: 1, month: 1, money: 1e6 }); state.research.done = Object.keys(RESEARCH);
  toasts = []; const got = Ach.evaluateAll(state);
  check('achv: evaluateAll catches up state-derivable ones', got.length >= 8, String(got.length));
  check('achv: > 5 retroactive unlocks produce a single summary toast', toasts.length === 1);
  check('achv: evaluateAll is idempotent', Ach.evaluateAll(state).length === 0);

  // ---- save / load / migration ----
  FRESH(); SC.m_cash_10m(); SC.h_chat(); SC.m_pat_100(); Ach.equipTitle(state, 'm_cash_10m'); Ach.setBadges(state, ['m_pat_100']);
  state.achv.counters.communityDone.health_talk = 2; state.achv.counters.dilemmasDone.painkiller = 3;
  const exp = Sav.exportSave(state), before = JSON.parse(JSON.stringify(state.achv));
  FRESH(); check('achv: import round trip', Sav.importSave(state, exp));
  check('achv: unlocked / title / badges / counters survive save->load', JSON.stringify(state.achv.unlocked) === JSON.stringify(before.unlocked) && state.achv.title === 'm_cash_10m' && JSON.stringify(state.achv.badges) === '["m_pat_100"]' && state.achv.counters.communityDone.health_talk === 2 && state.achv.counters.dilemmasDone.painkiller === 3 && state.achv.counters.chatCount === 50);
  const v1 = JSON.parse(exp); v1.version = 1; v1.state.version = 1; delete v1.state.achv; v1.state.money = 2.5e6; v1.state.stats.patientsTotal = 120; v1.state.history = [{ year: 1, month: 1, money: 1e6, income: 1, expense: 1, net: 0 }]; v1.state.time.week = 3; v1.state.time.clock = 700;
  FRESH(); check('achv: v1 save imports', Sav.importSave(state, JSON.stringify(v1)));
  check('achv: v1 -> v2 migration adds achv and retro-unlocks money / patients / first month', state.version === K.SAVE_VERSION && Ach.isUnlocked(state, 'm_cash_2m') && Ach.isUnlocked(state, 'm_pat_100') && Ach.isUnlocked(state, 'm_first_month') && !Ach.isUnlocked(state, 'm_cash_10m') && !Ach.isUnlocked(state, 'h_chat'));
  check('achv: migrated mid-year save does not track year / month as complete', state.achv.counters.trackYear == null && state.achv.counters.trackMonth == null);
  const junk = JSON.parse(exp);
  junk.state.achv = { unlocked: { m_cash_2m: { year: 2, month: 3, week: 1 }, bogus_id: {} }, counters: { chatCount: 'abc', slipThisYear: '7', dilemmasDone: { painkiller: 'x', evil: 9 }, communityDone: { nope: 3 } }, title: 'm_cash_10m', badges: ['m_cash_2m', 'h_coffee', 'zzz', 'm_cash_2m', 'm_pat_100', 'm_lot1', 'm_year3'] };
  FRESH(); check('achv: junk achv imports', Sav.importSave(state, JSON.stringify(junk)));
  const A = state.achv;
  check('achv sanitize: unknown ids dropped, counters numeric, locked title/badges removed', !('bogus_id' in A.unlocked) && A.unlocked.m_cash_2m.year === 2 && A.counters.chatCount === 0 && A.counters.slipThisYear === 7 && !('evil' in A.counters.dilemmasDone) && !('nope' in A.counters.communityDone) && A.title === null && JSON.stringify(A.badges) === '["m_cash_2m"]', JSON.stringify(A.badges));
  const junk2 = JSON.parse(exp); junk2.state.achv = { unlocked: Object.fromEntries(defs.map(d => [d.id, {}])), counters: {}, title: 'm_cash_2m', badges: defs.slice(0, 6).map(d => d.id) };
  FRESH(); Sav.importSave(state, JSON.stringify(junk2));
  check('achv sanitize: badges truncated to MAX_BADGES, title without title text dropped', state.achv.badges.length === ACHD.MAX_BADGES && state.achv.title === null);
  const junk3 = JSON.parse(exp); junk3.state.achv = 'garbage'; FRESH();
  check('achv sanitize: non-object achv is repaired', Sav.importSave(state, JSON.stringify(junk3)) && typeof state.achv.unlocked === 'object' && Array.isArray(state.achv.badges));

  // ---- a reward is never paid twice across save -> load -> save -> load ----
  FRESH(); state.money = 3e6; state.stats.patientsTotal = 150;           // m_cash_2m + m_pat_100 satisfied but not yet unlocked
  const dumpA = Sav.exportSave(state);
  FRESH(); Sav.importSave(state, dumpA);
  const paid = state.money - 3e6, wantPaid = 2 * ACHD.ACHIEVEMENT_TIERS[1].money;
  check('achv: loading a save pays the retroactive rewards once', Ach.isUnlocked(state, 'm_cash_2m') && Ach.isUnlocked(state, 'm_pat_100') && paid >= wantPaid, `${paid} vs ${wantPaid}`);
  const moneyAfter = state.money, nUnl = Ach.unlockedCount(state), dumpB = Sav.exportSave(state);
  FRESH(); Sav.importSave(state, dumpB); const m2 = state.money; const dumpC = Sav.exportSave(state);
  FRESH(); Sav.importSave(state, dumpC);
  check('achv: save -> load -> save -> load never re-pays', m2 === moneyAfter && state.money === moneyAfter && Ach.unlockedCount(state) === nUnl, `${moneyAfter} ${m2} ${state.money}`);

  // ---- integration: real month roll + real treatments feed the counters ----
  FRESH(); runMonths(2);
  check('achv: after 2 simulated months m_first_month is unlocked and the invariants hold', Ach.isUnlocked(state, 'm_first_month') && invariants().length === 0, invariants().join('; '));
  check('achv: real play feeds the counters (a patient was counted)', state.achv.counters.servedThisMonth > 0 || state.achv.counters.servedThisYear > 0);
  offU(); offT();
  feature('Achievements: save v2 migration + sanitize', 'OK', 'v1 import retro-unlocks; junk achv repaired');
}

// =====================================================================================================
// SECTION: events (docs/EVENTS_EXT.md): data validation, cond evaluator, every event x choice, M2 wear / M3 risk / M4 morale /
// M5 buffs / M7 review / M10 flags+follow-ups, save round trip mid-buff
// =====================================================================================================
const EQ = await imp('sim/equipment.js');
const { FOCUS } = await imp('data/patients.js');
const EXT = { A: await imp('data/events_ext.js'), B: await imp('data/events_ext2.js') };
const COND_KEYS = new Set(['months', 'weather', 'weatherId', 'minYear', 'maxYear', 'minRep', 'maxRep', 'minLot', 'hasObject', 'needObjects', 'hasStaff', 'pvBelow', 'policy', 'flag', 'notFlag',
  'riskAtLeast', 'riskAtMost', 'wearAtLeast', 'moraleBelow', 'reviewBelow', 'monthPointsOverCapPct', 'minPatientsTotal']);
const FX_KEYS = new Set(['money', 'reputation', 'sat', 'nhiPenalty', 'points', 'buff', 'setFlag', 'clearFlag', 'followUp', 'risk', 'wear', 'breakdown', 'repair', 'stamina', 'morale', 'resign', 'reviewScore', 'maintenance']);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const RICH_LAY = [['reception', 16, 17], ['sofa', 10, 17], ['sofa', 12, 17], ['sofa', 10, 15], ['tv', 12, 15], ['water', 14, 17], ['plant', 9, 19], ['plant', 13, 19], ['plant', 14, 15],
  ['exam_room', 9, 8], ['exam_room', 11, 8], ['manual_room', 14, 8], ['laser_room', 16, 8], ['redcord', 18, 8], ['shockwave', 13, 10], ['coffee', 12, 10],
  ['heatbox', 10, 12], ['heatbox', 11, 12], ['heatbox', 12, 12], ['tens', 13, 12], ['tens', 14, 12], ['tens', 15, 12], ['traction', 16, 12], ['traction', 17, 12], ['bed', 19, 12], ['bed', 20, 12], ['bed', 21, 12],
  ['rest_room', 21, 16], ['ir_lamp', 18, 15], ['ball_pit', 20, 9], ['soft_mat', 20, 11]];
function putAnywhere(defId) {
  const l = state.lot;
  for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) if (B.canPlace(state, defId, x, y, 0).ok) return put(defId, x, y);
  return null;
}
// L1 clinic with every wearable machine, two of each licensed role, lots of cash
function richClinic(seed = SEED) {
  fresh(seed);
  state.money = 5e6; state.reputation = 300; state.research.done = Object.keys(RESEARCH);
  state.lotLevel = 1; state.lot = { ...LOTS[1].lot }; state.door = { ...LOTS[1].door }; state.time.year = 2;
  state.objects = []; state.staff = []; refresh();
  opts_quietPut = true;
  for (const [d, x, y] of RICH_LAY) put(d, x, y);
  for (const d of ['us_room', 'shockwave_room']) putAnywhere(d);
  opts_quietPut = false;
  for (const r of ['doctor', 'doctor', 'pt', 'pt', 'ot', 'ot', 'st', 'st', 'nurse', 'nurse']) state.staff.push(S.createStaff(state, r, null, 16 + (state.staff.length % 3), 14));
  refresh();
  return state;
}
const wearables = () => state.objects.filter(o => EQ.isWearable(o.defId));
function baselineMods(withoutBuffs = true) {
  const keep = state.events.buffs; if (withoutBuffs) state.events.buffs = [];
  const m = JSON.parse(JSON.stringify(Mod.recomputeMods(state)));
  state.events.buffs = keep; Mod.recomputeMods(state);
  return m;
}

function eventsSection() {
  section('Events engine (EVENTS_EXT)');
  const pool = Ev.eventPool();
  const TUNE0 = { ...Ev.EVENT_TUNE };
  const restoreTune = () => Object.assign(Ev.EVENT_TUNE, TUNE0);

  // ---------------- A. data validation ----------------
  {
    const bad = [], notes = [];
    const ids = new Set(), dupe = [];
    const allDefs = [...EVD.RANDOM_EVENTS, ...EXT.A.EVENTS_EXT_A, ...EXT.B.EVENTS_EXT_B];
    for (const d of allDefs) { if (ids.has(d.id)) dupe.push(d.id); ids.add(d.id); }
    check('events: ids unique across RANDOM_EVENTS + EXT_A + EXT_B', dupe.length === 0, dupe.join());
    check('events: the pool merges all three data sets', pool.length === ids.size && pool.length >= 58, `${pool.length}/${ids.size}`);
    check('events: EXT_A has 30 and EXT_B 28 events (A01-A14,B01-B16 / C01-C16,D01-D12)', EXT.A.EVENTS_EXT_A.length === 30 && EXT.B.EVENTS_EXT_B.length === 28, `${EXT.A.EVENTS_EXT_A.length}/${EXT.B.EVENTS_EXT_B.length}`);
    const modKeys = new Set(Object.keys(defaultMods()));
    const okMod = (k) => modKeys.has(k) || k === 'satShift' || k === 'nhiCapBonus';
    const checkFx = (id, tag, fx) => {
      for (const k of Object.keys(fx || {})) {
        if (!FX_KEYS.has(k)) bad.push(`${id} ${tag}: unknown effect key ${k}`);
      }
      if (!fx) return;
      for (const k of Object.keys(fx.points || {})) if (!K.POINT_KEYS.includes(k)) bad.push(`${id} ${tag}: points.${k}`);
      for (const k of ['money', 'reputation', 'sat', 'nhiPenalty', 'risk', 'reviewScore', 'maintenance']) if (fx[k] !== undefined && !Number.isFinite(fx[k])) bad.push(`${id} ${tag}: ${k} not a number`);
      if (fx.buff) {
        const b = fx.buff;
        if (!(b.weeks >= 1) || !b.label) bad.push(`${id} ${tag}: buff needs weeks>=1 and a label`);
        for (const k of Object.keys(b.mods || {})) if (!okMod(k) || !Number.isFinite(b.mods[k])) bad.push(`${id} ${tag}: buff mod ${k}`);
        for (const t of Object.keys(b.spawn || {})) if (!PATIENT_TYPES[t] || !Number.isFinite(b.spawn[t])) bad.push(`${id} ${tag}: buff spawn ${t}`);
        if (!Object.keys(b.mods || {}).length && !Object.keys(b.spawn || {}).length) bad.push(`${id} ${tag}: buff without mods/spawn`);
      }
      if (fx.setFlag !== undefined && typeof fx.setFlag !== 'string') bad.push(`${id} ${tag}: setFlag`);
      if (fx.clearFlag !== undefined && typeof fx.clearFlag !== 'string') bad.push(`${id} ${tag}: clearFlag`);
      if (fx.followUp && (!ids.has(fx.followUp.id) || !(fx.followUp.afterWeeks >= 0) || (fx.followUp.p !== undefined && !(fx.followUp.p >= 0 && fx.followUp.p <= 1)))) bad.push(`${id} ${tag}: followUp ${JSON.stringify(fx.followUp)}`);
      if (fx.wear && (!(fx.wear.target === 'all' || fx.wear.target === 'random' || EQ.isWearable(fx.wear.target)) || !Number.isFinite(fx.wear.delta))) bad.push(`${id} ${tag}: wear ${JSON.stringify(fx.wear)}`);
      if (fx.breakdown !== undefined && !(fx.breakdown === 'random' || EQ.isWearable(fx.breakdown))) bad.push(`${id} ${tag}: breakdown ${fx.breakdown}`);
      if (fx.repair !== undefined && !(fx.repair === 'all' || fx.repair === 'broken')) bad.push(`${id} ${tag}: repair ${fx.repair}`);
      for (const k of ['stamina', 'morale']) if (fx[k] && (!Number.isFinite(fx[k].delta) || (fx[k].role !== undefined && !K.ROLES.includes(fx[k].role)))) bad.push(`${id} ${tag}: ${k} ${JSON.stringify(fx[k])}`);
      if (fx.resign && (!K.ROLES.includes(fx.resign.role) || !(fx.resign.p >= 0 && fx.resign.p <= 1))) bad.push(`${id} ${tag}: resign ${JSON.stringify(fx.resign)}`);
    };
    for (const d of allDefs) {
      if (!d.title || !d.text) bad.push(d.id + ': missing title/text');
      if (d.cat !== undefined && !['nhi', 'patient', 'ops', 'season'].includes(d.cat)) bad.push(d.id + ': cat ' + d.cat);
      for (const k of Object.keys(d.cond || {})) if (!COND_KEYS.has(k)) bad.push(`${d.id}: unknown cond key ${k}`);
      if (d.cond && d.cond.hasStaff) for (const r of Object.keys(d.cond.hasStaff)) if (!K.ROLES.includes(r)) bad.push(`${d.id}: hasStaff role ${r}`);
      for (const key of ['hasObject', 'needObjects']) for (const o of (d.cond && d.cond[key]) || []) if (!BUILDABLES[o]) bad.push(`${d.id}: ${key} ${o}`);
      if (d.cond && d.cond.wearAtLeast && d.cond.wearAtLeast.defId && !BUILDABLES[d.cond.wearAtLeast.defId]) bad.push(`${d.id}: wearAtLeast def`);
      if (!Array.isArray(d.choices) || d.choices.length < 2 || d.choices.length > 3) bad.push(`${d.id}: needs 2-3 choices (${(d.choices || []).length})`);
      let free = 0;
      (d.choices || []).forEach((c, i) => {
        const tag = 'c' + i;
        if (!c.label) bad.push(`${d.id} ${tag}: label`);
        if (c.chance) {
          if (c.effects) bad.push(`${d.id} ${tag}: chance and effects are exclusive`);
          if (!(c.chance.p >= 0 && c.chance.p <= 1)) bad.push(`${d.id} ${tag}: chance.p`);
          for (const side of ['win', 'lose']) {
            const s = c.chance[side];
            if (!s || typeof s.result !== 'string' || !s.result || !s.effects) bad.push(`${d.id} ${tag}: chance.${side} needs effects + result`);
            else checkFx(d.id, `${tag}.${side}`, s.effects);
          }
        } else {
          if (!c.result) bad.push(`${d.id} ${tag}: result`);
          if (!c.effects) bad.push(`${d.id} ${tag}: effects missing`);
          checkFx(d.id, tag, c.effects);
        }
        if (c.requires) { if (!(c.requires.money > 0)) bad.push(`${d.id} ${tag}: requires`); } else free++;
      });
      if (!free) notes.push(d.id);
    }
    if (notes.length) console.log('  (data note) every option needs money in: ' + notes.join(', ') + ' - the engine frees the last option when the player is broke');
    check('events data: schema (cond keys, effect keys, buffs, flags, follow-ups, wear/role targets) is valid', bad.length === 0, bad.slice(0, 6).join(' | ') + (bad.length > 6 ? ` (+${bad.length - 6})` : ''));
    // every flag that is read by a cond is set by some choice (otherwise the event can never fire)
    const setters = new Set(), readers = new Set();
    for (const d of allDefs) {
      for (const c of d.choices) for (const fx of [c.effects, c.chance && c.chance.win.effects, c.chance && c.chance.lose.effects]) if (fx && fx.setFlag) setters.add(fx.setFlag);
      for (const f of [].concat((d.cond || {}).flag || [])) readers.add(f);
    }
    check('events data: every cond.flag is set by some choice', [...readers].every(f => setters.has(f)), [...readers].filter(f => !setters.has(f)).join());
    check('events data: at least 1 event per category and 8+ season events', ['nhi', 'patient', 'ops', 'season'].every(c => pool.some(d => d.cat === c)) && pool.filter(d => d.cat === 'season').length >= 8);
  }

  // ---------------- B. cond evaluator, one test per key (M1) ----------------
  {
    const cm = (cond) => Ev.condMet(state, cond);
    richClinic();
    state.time.month = 5; state.weather = { kind: 'rain', id: 'plumrain', temp: 25 };
    check('cond: empty / missing cond is always true, unknown keys ignored', cm({}) && cm(undefined) && cm({ bogusKey: 1 }));
    check('cond.months', cm({ months: [5] }) && cm({ months: [1, 5, 12] }) && !cm({ months: [6, 7] }));
    check('cond.weather (kind)', cm({ weather: ['rain'] }) && cm({ weather: ['rain', 'cold'] }) && !cm({ weather: ['cold', 'hot'] }));
    check('cond.weatherId (梅雨)', cm({ weatherId: 'plumrain' }) && !cm({ weatherId: 'rain' }));
    state.time.year = 3;
    check('cond.minYear / maxYear', cm({ minYear: 3 }) && !cm({ minYear: 4 }) && cm({ maxYear: 3 }) && !cm({ maxYear: 2 }) && cm({ minYear: 2, maxYear: 4 }));
    state.reputation = 150;
    check('cond.minRep / maxRep', cm({ minRep: 150 }) && !cm({ minRep: 151 }) && cm({ maxRep: 150 }) && !cm({ maxRep: 149 }));
    check('cond.minLot', cm({ minLot: 1 }) && !cm({ minLot: 2 }));
    check('cond.hasObject (any of)', cm({ hasObject: ['tens'] }) && cm({ hasObject: ['nope', 'tens'] }) && !cm({ hasObject: ['nope'] }));
    check('cond.needObjects (all of)', cm({ needObjects: ['tens', 'heatbox'] }) && !cm({ needObjects: ['tens', 'nope'] }));
    check('cond.hasStaff {role:n}', cm({ hasStaff: { pt: 2 } }) && !cm({ hasStaff: { pt: 3 } }) && cm({ hasStaff: { pt: 1, nurse: 2 } }) && !cm({ hasStaff: { pt: 1, nurse: 3 } }));
    state.nhi.pointValue = 0.8;
    check('cond.pvBelow (last settled point value)', cm({ pvBelow: 0.9 }) && !cm({ pvBelow: 0.8 }) && !cm({ pvBelow: 0.5 }));
    state.policy.focus = 'ltc';
    check('cond.policy', cm({ policy: 'ltc' }) && !cm({ policy: 'ortho' }) && !cm({ policy: 'peds' }));
    state.events.flags = { seen_x: true };
    check('cond.flag / notFlag', cm({ flag: 'seen_x' }) && !cm({ flag: 'seen_y' }) && cm({ notFlag: 'seen_y' }) && !cm({ notFlag: 'seen_x' }));
    state.nhi.risk = 40;
    check('cond.riskAtLeast / riskAtMost', cm({ riskAtLeast: 40 }) && !cm({ riskAtLeast: 41 }) && cm({ riskAtMost: 40 }) && !cm({ riskAtMost: 39 }));
    for (const o of state.objects) if (EQ.isWearable(o.defId)) o.wear = 20;
    state.objects.find(o => o.defId === 'tens').wear = 75;
    check('cond.wearAtLeast {defId,n} (specific machine)', cm({ wearAtLeast: { defId: 'tens', n: 70 } }) && !cm({ wearAtLeast: { defId: 'tens', n: 80 } }) && !cm({ wearAtLeast: { defId: 'heatbox', n: 70 } }));
    check('cond.wearAtLeast {n} (any machine)', cm({ wearAtLeast: { n: 70 } }) && !cm({ wearAtLeast: { n: 80 } }));
    for (const s of state.staff) s.morale = 70;
    state.staff[2].morale = 30;
    check('cond.moraleBelow (any staff)', cm({ moraleBelow: 40 }) && !cm({ moraleBelow: 30 }) && !cm({ moraleBelow: 20 }));
    state.reviewScore = 3.5;
    check('cond.reviewBelow', cm({ reviewBelow: 4 }) && !cm({ reviewBelow: 3.5 }) && !cm({ reviewBelow: 3 }));
    const cap = Eco.nhiCap(state);
    state.nhi.monthPoints = cap * 0.95;
    check('cond.monthPointsOverCapPct', cm({ monthPointsOverCapPct: 90 }) && !cm({ monthPointsOverCapPct: 100 }));
    { const keep = { ...state.nhi.lastSettlement }, wk = state.time.week;
      state.nhi.monthPoints = 0; state.nhi.lastSettlement = { points: cap * 0.95, pointValue: 1, income: 0 };
      state.time.week = 1; const w1 = cm({ monthPointsOverCapPct: 90 }); state.time.week = 2; const w2 = cm({ monthPointsOverCapPct: 90 });
      check('cond.monthPointsOverCapPct: in week 1 the month that just closed counts (the counter has just been reset)', w1 && !w2);
      state.time.week = wk; state.nhi.lastSettlement = keep.points === undefined ? null : keep; state.nhi.monthPoints = cap * 0.95; }
    state.stats.patientsTotal = 120;
    check('cond.minPatientsTotal', cm({ minPatientsTotal: 100 }) && !cm({ minPatientsTotal: 121 }));
    check('cond: keys combine with AND', cm({ months: [5], minYear: 3, hasObject: ['tens'], flag: 'seen_x' }) && !cm({ months: [5], minYear: 3, hasObject: ['tens'], flag: 'nope' }));
    // pool filtering uses the same evaluator, honours cooldowns, and the monthly cap on `big` events
    richClinic(); state.time.month = 6; state.weather = { kind: 'sunny', id: 'sunny', temp: 28 };
    const all0 = Ev.eligibleEvents(state);
    check('events: eligibility respects cond (season events need their month/weather)', !all0.some(d => d.id === 'cold_joint_surge') && !all0.some(d => d.id === 'cny_back_strain'));
    state.time.month = 1; state.weather = { kind: 'cold', id: 'cold', temp: 10 };
    check('events: season events become eligible in season', Ev.eligibleEvents(state).some(d => d.id === 'cold_joint_surge') && Ev.eligibleEvents(state).some(d => d.id === 'cny_back_strain'));
    state.events.cooldowns = { 'evt:cold_joint_surge': Cal.absoluteWeek(state) + 5 };
    check('events: cooldownWeeks excludes an event until it expires', !Ev.eligibleEvents(state).some(d => d.id === 'cold_joint_surge'));
    state.events.cooldowns = {};
    state.time.year = 3; state.nhi.monthPoints = Eco.nhiCap(state);
    const bigs = pool.filter(d => d.big);
    check('events: there are big events and they carry weight 3 by default / explicit', bigs.length >= 6, String(bigs.length));
    check('events: before that, some big event is eligible', Ev.eligibleEvents(state).some(d => d.big));
    Ev.triggerEvent(state, bigs[0].id); Ev.resolveDilemma(state, 0);
    check('events: after one big event the month allows no other big (cap 1 per month)', !Ev.eligibleEvents(state).some(d => d.big));
    state.time.month = 2;
    check('events: the cap resets next month', Ev.eligibleEvents(state).some(d => d.big));
    // weights
    richClinic();
    const w0 = Ev.eventWeight(state, pool.find(d => d.cat === 'season'));
    check('events: season weight x1.5', near(w0, pool.find(d => d.cat === 'season').weight * 1.5));
    const nhiDef = pool.find(d => d.cat === 'nhi');
    state.nhi.risk = 10; const wLow = Ev.eventWeight(state, nhiDef); state.nhi.risk = 80; const wHigh = Ev.eventWeight(state, nhiDef);
    check('events: nhi-category weight x2 while risk > 60', near(wHigh, wLow * 2) && near(wLow, nhiDef.weight));
  }

  // ---------------- C. every event x every choice (x win/lose) ----------------
  {
    let combos = 0, fail = 0;
    const failures = [];
    const bad = (m) => { fail++; if (failures.length < 8) failures.push(m); };
    const clinicPre = () => {
      richClinic();
      state.time.clock = 600;                                   // mid-day: stamina effects apply immediately
      state.nhi.monthPoints = 20000; state.nhi.risk = 50; state.reviewScore = 3;
      for (const o of wearables()) { o.wear = 50; }
      for (const s of state.staff) { s.morale = 60; s.stamina = s.staminaMax / 2; }
    };
    for (const def of pool) {
      def.choices.forEach((c, i) => {
        for (const roll of c.chance ? ['win', 'lose'] : [undefined]) {
          const tag = `${def.id}#${i}${roll ? '/' + roll : ''}`;
          combos++;
          clinicPre();
          const hasRepair = (c.chance ? c.chance[roll].effects : c.effects).repair;
          if (hasRepair) { const v = state.objects.find(o => o.defId === 'ir_lamp'); EQ.breakObject(state, v); }
          const fx = c.chance ? c.chance[roll].effects : c.effects;
          const before = {
            money: state.money, rep: state.reputation, pts: { ...state.points }, mp: state.nhi.monthPoints, risk: Eco.riskOf(state), review: Eco.reviewOf(state),
            wear: new Map(state.objects.map(o => [o.id, o.wear || 0])), stam: new Map(state.staff.map(s => [s.id, s.stamina])), mor: new Map(state.staff.map(s => [s.id, S.moraleOf(s)])),
            staff: state.staff.length, broken: state.objects.filter(o => o.broken).length, fu: state.events.pendingFollowUps ? state.events.pendingFollowUps.length : 0,
            mods: baselineMods(),
          };
          let out = null;
          try {
            if (!Ev.triggerEvent(state, def.id)) { bad(tag + ': trigger returned null'); continue; }
            const pd = state.events.pendingDilemma;
            if (pd.id !== def.id || pd.choices.length !== def.choices.length) bad(tag + ': pending mismatch');
            const pc = pd.choices[i];
            if (!!pc.chance !== !!c.chance || (c.chance && Math.abs(pc.chance.p - c.chance.p) > 1e-9) || (!!pc.requires !== !!c.requires)) bad(tag + ': pending choice lost chance/requires');
            out = Ev.resolveDilemma(state, i, { roll });
          } catch (e) { bad(tag + ': THROW ' + e.message); state.events.pendingDilemma = null; state.time.paused = false; continue; }
          if (!out || !out.ok) { bad(tag + ': resolve returned ' + JSON.stringify(out)); continue; }
          if (state.events.pendingDilemma || state.time.paused) bad(tag + ': still pending/paused');
          if (c.chance ? out.roll !== roll : out.roll !== null) bad(tag + ': roll flag ' + out.roll);
          const expectResult = c.chance ? (c.chance[roll].result || c.result) : c.result;
          if (!out.result || out.result !== expectResult) bad(tag + ': result text');
          if (!Array.isArray(out.chips) || out.summary.length !== out.chips.length) bad(tag + ': chips/summary');
          const near2 = (a, b) => Math.abs(a - b) < 1e-6;
          // ---- effect-by-effect
          if (!near2(state.money, before.money + (fx.money || 0))) bad(`${tag}: money ${state.money - before.money} vs ${fx.money || 0}`);
          if (!near2(state.reputation, clampN(before.rep + (fx.reputation || 0), 0, 1000))) bad(tag + ': reputation');
          for (const k of K.POINT_KEYS) if (!near2(state.points[k], Math.max(0, before.pts[k] + ((fx.points && fx.points[k]) || 0)))) bad(tag + ': points.' + k);
          if (!near2(state.nhi.monthPoints, Math.max(0, before.mp - (fx.nhiPenalty || 0)))) bad(tag + ': nhiPenalty');
          if (!near2(Eco.riskOf(state), clampN(before.risk + (fx.risk || 0), 0, 100))) bad(tag + ': risk ' + Eco.riskOf(state));
          if (!near2(Eco.reviewOf(state), clampN(Math.round(clampN(before.review + (fx.reviewScore || 0), 1, 5) * 100) / 100, 1, 5))) bad(tag + ': reviewScore ' + Eco.reviewOf(state));
          if (fx.setFlag && !state.events.flags[fx.setFlag]) bad(tag + ': setFlag');
          if (fx.clearFlag && state.events.flags[fx.clearFlag] && fx.clearFlag !== fx.setFlag) bad(tag + ': clearFlag');
          if (fx.followUp) {
            const n = state.events.pendingFollowUps.filter(f => f.id === fx.followUp.id).length;
            if ((fx.followUp.p === undefined || fx.followUp.p >= 1) ? n !== 1 : n > 1) bad(tag + ': followUp count ' + n);
            const f = state.events.pendingFollowUps.find(q => q.id === fx.followUp.id);
            if (f && f.due !== Cal.absoluteWeek(state) + fx.followUp.afterWeeks) bad(tag + ': followUp due');
          } else if (state.events.pendingFollowUps.length !== before.fu) bad(tag + ': stray follow-up');
          if (fx.buff) {
            const b = state.events.buffs.find(x => x.label === fx.buff.label);
            if (!b || b.weeksLeft !== Math.round(fx.buff.weeks)) bad(tag + ': buff entry ' + JSON.stringify(b));
            else {
              for (const [k, v] of Object.entries(fx.buff.mods || {})) {
                let exp = before.mods[k] + v;
                if (MULT_FLOOR[k]) exp = Math.max(MULT_FLOOR[k], exp);
                if (k === 'spawnMult') exp = Math.min(2, exp);
                if (!near2(state.mods[k], exp)) bad(`${tag}: mods.${k} ${state.mods[k]} vs ${exp}`);
              }
              for (const [t, v] of Object.entries(fx.buff.spawn || {})) {
                const fm = (FOCUS[state.policy.focus].spawnMult || {})[t] == null ? 1 : FOCUS[state.policy.focus].spawnMult[t];   // the focus multiplier applies after buffs
                const exp = Math.max(0, (before.mods.typeSpawn[t] == null ? 1 : before.mods.typeSpawn[t]) + v * fm);
                if (!near2(state.mods.typeSpawn[t], Math.min(3.5, exp))) bad(`${tag}: typeSpawn.${t} ${state.mods.typeSpawn[t]} vs ${exp}`);
              }
            }
            if (!out.chips.some(x => x.text.startsWith(`持續 ${Math.round(fx.buff.weeks)} 週：`))) bad(tag + ': buff chip text ' + out.summary.join('|'));
          }
          if (fx.wear && fx.wear.delta) {
            const tg = fx.wear.target;
            const hit = state.objects.filter(o => EQ.isWearable(o.defId) && Math.abs((o.wear || 0) - before.wear.get(o.id)) > 1e-9);
            if (tg === 'random') { if (hit.length !== 1) bad(tag + ': wear random touched ' + hit.length); }
            else {
              for (const o of wearables()) {
                const want = (tg === 'all' || o.defId === tg) ? clampN(before.wear.get(o.id) + fx.wear.delta, 0, 100) : before.wear.get(o.id);
                if (!near2(o.wear || 0, want)) bad(`${tag}: wear ${o.defId} ${o.wear} vs ${want}`);
              }
            }
            if (!out.chips.some(x => x.text.includes('耗損'))) bad(tag + ': wear chip');
          }
          if (fx.breakdown) {
            const nb = state.objects.filter(o => o.broken).length - before.broken;
            if (nb < 1 && !fx.repair) bad(tag + ': breakdown did not break anything');
            if (fx.breakdown !== 'random' && !state.objects.some(o => o.broken && o.defId === fx.breakdown)) bad(tag + ': wrong machine broke');
            if (!out.chips.some(x => x.text.includes('故障'))) bad(tag + ': breakdown chip');
          }
          if (fx.repair) {
            if (state.objects.some(o => o.broken)) bad(tag + ': repair left a broken machine');
            if (fx.repair === 'all' && wearables().some(o => (o.wear || 0) !== 0)) bad(tag + ': repair all kept wear');
          }
          for (const k of ['stamina', 'morale']) if (fx[k] && fx[k].delta) {
            for (const s of state.staff) {
              const hit = !fx[k].role || s.role === fx[k].role;
              const was = k === 'stamina' ? before.stam.get(s.id) : before.mor.get(s.id);
              const now = k === 'stamina' ? s.stamina : S.moraleOf(s);
              const max = k === 'stamina' ? s.staminaMax : 100;
              if (!near2(now, hit ? clampN(was + fx[k].delta, 0, max) : was)) bad(`${tag}: ${k} ${s.role} ${now} vs ${was}`);
            }
            if (!out.chips.some(x => x.text.includes(k === 'stamina' ? '體力' : '士氣'))) bad(tag + ': ' + k + ' chip');
          }
          if (fx.resign) {
            const n0 = before.staff, n1 = state.staff.length;
            if (fx.resign.p >= 1 ? n1 !== n0 - 1 : !(n1 === n0 || n1 === n0 - 1)) bad(tag + ': resign headcount ' + n0 + '->' + n1);
            if (state.staff.filter(s => s.role === fx.resign.role).length < 1) bad(tag + ': resign emptied the role');
            if (fx.resign.p >= 1 && !out.chips.some(x => x.text.includes('離職'))) bad(tag + ': resign chip');
          } else if (state.staff.length !== before.staff) bad(tag + ': staff count changed without resign');
          if (fx.maintenance) {
            const until = Cal.absoluteWeek(state) + fx.maintenance;
            if (!wearables().every(o => o.maintainedUntil === until)) bad(tag + ': maintenance not applied');
          }
          if (fx.money && !out.chips.some(x => x.text.startsWith('資金'))) bad(tag + ': money chip');
          if (fx.risk && !out.chips.some(x => x.text.includes('風險'))) bad(tag + ': risk chip');
          if (fx.reviewScore && !out.chips.some(x => x.text.includes('評價'))) bad(tag + ': review chip');
          const inv = invariants();
          if (inv.length) bad(tag + ': invariants ' + inv.slice(0, 2).join(';'));
          // the sim keeps running after the decision
          try { for (let t = 0; t < 25; t++) step(1, false); } catch (e) { bad(tag + ': sim THROW ' + e.message); }
        }
      });
    }
    check(`events: ALL ${pool.length} events x every choice (x win/lose) = ${combos} combos apply their effects exactly, summarise them and keep the sim valid`, fail === 0, failures.join(' || '));
  }

  // ---------------- D. chance options + requires.money gate ----------------
  {
    richClinic();
    const def = pool.find(d => d.choices.some(c => c.chance));
    const ci = def.choices.findIndex(c => c.chance);
    // the roll is made once, when the decision opens: reloading the save cannot re-roll it
    Ev.triggerEvent(state, def.id);
    const u0 = state.events.pendingDilemma.choices[ci].chance.u;
    const dump = Sav.exportSave(state);
    check('chance: pre-rolled value stored in the pending decision (u in [0,1))', typeof u0 === 'number' && u0 >= 0 && u0 < 1);
    const outcomes = new Set();
    for (let k = 0; k < 3; k++) { Sav.importSave(state, dump); outcomes.add(Ev.resolveDilemma(state, ci).roll); if (k < 2) { Sav.importSave(state, dump); } }
    check('chance: the same save always resolves to the same side', outcomes.size === 1, [...outcomes].join());
    Sav.importSave(state, dump);
    state.events.pendingDilemma.choices[ci].chance.u = 0; state.events.pendingDilemma.choices[ci].chance.p = 0.5;
    check('chance: u < p wins', Ev.resolveDilemma(state, ci).roll === 'win');
    richClinic(); Ev.triggerEvent(state, def.id); state.events.pendingDilemma.choices[ci].chance.u = 0.999; state.events.pendingDilemma.choices[ci].chance.p = 0.5;
    check('chance: u >= p loses', Ev.resolveDilemma(state, ci).roll === 'lose');
    // distribution over many openings follows p
    let wins = 0, N = 400;
    const probe = pool.find(d => d.choices.some(c => c.chance && c.chance.p > 0.2 && c.chance.p < 0.8));
    const pi = probe.choices.findIndex(c => c.chance && c.chance.p > 0.2 && c.chance.p < 0.8), pp = probe.choices[pi].chance.p;
    for (let k = 0; k < N; k++) { richClinic(SEED + 1000 + k); Ev.triggerEvent(state, probe.id); if (Ev.resolveDilemma(state, pi).roll === 'win') wins++; }
    check(`chance: win rate ${(wins / N).toFixed(2)} ~ p ${pp}`, Math.abs(wins / N - pp) < 0.1);
    // requires.money: refused when poor, allowed when rich; a decision never strands a poor player
    const rq = pool.find(d => d.choices.some(c => c.requires));
    const ri = rq.choices.findIndex(c => c.requires);
    richClinic(); state.money = rq.choices[ri].requires.money - 1; Ev.triggerEvent(state, rq.id);
    const m0 = state.money;
    check('requires.money: choice refused (null, nothing applied) when money is short', Ev.resolveDilemma(state, ri) === null && !!state.events.pendingDilemma && state.money === m0);
    check('requires.money: choiceAffordable reflects it', !Ev.choiceAffordable(state, state.events.pendingDilemma.choices[ri]) && Ev.choiceAffordable(state, state.events.pendingDilemma.choices.find(c => !c.requires)));
    state.money = rq.choices[ri].requires.money;
    check('requires.money: allowed once money is enough (exactly equal counts)', !!Ev.resolveDilemma(state, ri));
    // all options unaffordable -> the last one is freed so the game cannot lock up
    richClinic(); state.money = 0;
    Ev.triggerEvent(state, 'infection_control_audit');
    const allReq = state.events.pendingDilemma.choices.every(c => c.requires);
    check('requires.money: if every option is unaffordable the last one loses its requirement', !allReq || (Ev.choiceAffordable(state, state.events.pendingDilemma.choices[state.events.pendingDilemma.choices.length - 1]) && !!Ev.resolveDilemma(state, state.events.pendingDilemma.choices.length - 1)));
  }

  // ---------------- E. pacing: grace, gap, cap, follow-ups ----------------
  {
    richClinic(); state.time.year = 1; state.time.month = 1; state.time.week = 1;
    const T = Ev.EVENT_TUNE, saved = { ...T };
    T.CHANCE = 1; T.GRACE = 6; T.MIN_GAP = 2; T.EARLY_MULT = 1;
    state.events.cooldowns = {}; delete state.events.lastEventWeek;
    let firstWeek = null, shown = [];
    const off = bus.on('event:show', (e) => shown.push({ week: Cal.absoluteWeek(state), id: e.event.id }));
    for (let w = 0; w < 12; w++) { bus.emit('week:start', { ...state.time }); if (state.events.pendingDilemma) { if (firstWeek === null) firstWeek = Cal.absoluteWeek(state); resolvePending(); } state.time.week++; if (state.time.week > 4) { state.time.week = 1; state.time.month++; } }
    off();
    check('pacing: no random event before the grace period (6 weeks)', firstWeek !== null && firstWeek >= 6, String(firstWeek));
    const weeks = shown.map(s => s.week);
    check('pacing: at least MIN_GAP weeks between random events', weeks.every((w, i) => i === 0 || w - weeks[i - 1] >= 2), weeks.join());
    // follow-ups: forced regardless of chance / gap, when due, one per week
    richClinic(); state.events.cooldowns = {};
    T.CHANCE = 0;
    state.events.pendingFollowUps = [{ id: 'dispute_mediation', due: Cal.absoluteWeek(state) + 2 }];
    let seen = [];
    const off2 = bus.on('event:show', (e) => seen.push(e.event.id));
    for (let w = 0; w < 4; w++) { bus.emit('week:start', {}); if (state.events.pendingDilemma) resolvePending(); state.time.week = (state.time.week % 4) + 1; }
    off2();
    check('follow-up: forced into the schedule once due (chance 0, no random roll), and consumed', seen.includes('dispute_mediation') && !state.events.pendingFollowUps.some(f => f.id === 'dispute_mediation'), seen.join());
    // a follow-up that is not due yet stays queued; unknown ids are dropped
    richClinic(); T.CHANCE = 0;
    state.events.pendingFollowUps = [{ id: 'dispute_mediation', due: Cal.absoluteWeek(state) + 9 }, { id: 'no_such_event', due: 0 }];
    bus.emit('week:start', {});
    check('follow-up: not-yet-due entries stay, dangling ids are discarded', !state.events.pendingDilemma && state.events.pendingFollowUps.length === 1 && state.events.pendingFollowUps[0].id === 'dispute_mediation');
    // `big` follow-ups wait for the next month after a big event
    richClinic(); T.CHANCE = 0;
    const big = pool.find(d => d.big && d.id !== 'dispute_mediation');
    const fuBig = pool.find(d => d.big);
    state.events.lastBigMonth = Math.floor(Cal.absoluteWeek(state) / K.WEEKS_PER_MONTH);
    state.events.pendingFollowUps = [{ id: fuBig.id, due: 0 }];
    bus.emit('week:start', {});
    check('follow-up: a due big event is postponed while the month already had one', !state.events.pendingDilemma && state.events.pendingFollowUps.length === 1);
    restoreTune();
  }

  // ---------------- F. M5/M6 buffs: expiry, rollback, save/load ----------------
  {
    richClinic();
    const fx = { buff: { weeks: 3, label: '測試浪湧', mods: { spawnMult: 0.15, elderSat: 2, patience: 0.1 }, spawn: { elder: 0.3, sports: -0.2 } } };
    const chips = Ev.applyEffectsDetailed(state, fx);
    check('buff: summary reads 「持續 3 週：…」 with a 病患 +15% part', chips.length === 1 && chips[0].text.startsWith('持續 3 週：') && chips[0].text.includes('病患 +15%'), chips.map(c => c.text).join('|'));
    const rel = (k, d) => near(state.mods[k], baselineMods()[k] + d);
    const fmo = (t) => { const v = (FOCUS[state.policy.focus].spawnMult || {})[t]; return v == null ? 1 : v; };
    const tsBase = (t) => { const v = baselineMods().typeSpawn[t]; return v == null ? 1 : v; };
    check('buff: applied through recomputeMods (spawnMult, elderSat, patience, typeSpawn)', rel('spawnMult', 0.15) && rel('elderSat', 2) && rel('patience', 0.1) && near(state.mods.typeSpawn.elder, tsBase('elder') + 0.3 * fmo('elder')) && near(state.mods.typeSpawn.sports, tsBase('sports') - 0.2 * fmo('sports')));
    check('buff: stored in state.events.buffs with weeksLeft', state.events.buffs.length === 1 && state.events.buffs[0].weeksLeft === 3 && state.events.buffs[0].label === '測試浪湧');
    check('buff: re-applying the same label refreshes it instead of stacking', (() => { Ev.applyEffects(state, fx); return state.events.buffs.length === 1 && rel('spawnMult', 0.15); })());
    check('buff: shown by activeEffects() (label + weeks left)', Ev.activeEffects(state).some(a => a.label === '測試浪湧' && a.weeksLeft === 3 && a.chips.length >= 3));
    // mid-buff save / load keeps it
    const dump = Sav.exportSave(state);
    state.events.cooldowns = {};
    const tick = () => { bus.emit('week:start', { ...state.time }); };
    Ev.EVENT_TUNE.CHANCE = 0;
    tick();
    check('buff: counts down at each week:start', state.events.buffs[0].weeksLeft === 2);
    Sav.importSave(state, dump);
    check('buff: survives save -> load (entry, weeksLeft 3, mods recomputed)', state.events.buffs.length === 1 && state.events.buffs[0].weeksLeft === 3 && rel('spawnMult', 0.15) && rel('elderSat', 2));
    tick(); tick();
    check('buff: still active with 1 week left', state.events.buffs.length === 1 && state.events.buffs[0].weeksLeft === 1 && rel('spawnMult', 0.15));
    const dump2 = Sav.exportSave(state);
    tick();
    check('buff: expires and every mod rolls back to the exact no-buff value', state.events.buffs.length === 0 && JSON.stringify(state.mods) === JSON.stringify(baselineMods()));
    Sav.importSave(state, dump2); tick();
    check('buff: expiry also works after a reload (save with 1 week left)', state.events.buffs.length === 0 && JSON.stringify(state.mods) === JSON.stringify(baselineMods()));
    restoreTune();
    // junk in a save is repaired
    richClinic();
    state.events.buffs = [{ label: 'x', weeksLeft: 2, mods: { spawnMult: 0.1, bad: 'str' } }, { label: 'y', weeksLeft: -1, mods: {} }, 5, null];
    state.events.flags = { a: true, b: 0, c: 'yes' }; state.events.pendingFollowUps = [{ id: 'dispute_mediation', due: 3 }, { id: 4 }, null];
    state.nhi.risk = 999; state.reviewScore = 17; state.objects[0].wear = -5; state.objects[1].broken = 1; state.staff[0].morale = 'abc';
    Sav.importSave(state, JSON.stringify({ version: K.SAVE_VERSION, state: JSON.parse(Sav.exportSave(state)).state }));
    check('save: sanitize repairs buffs / flags / follow-ups / risk / review / wear / broken / morale', state.events.buffs.length === 1 && state.events.buffs[0].mods.bad === undefined && state.events.buffs[0].id &&
      Object.keys(state.events.flags).sort().join() === 'a,c' && state.events.pendingFollowUps.length === 1 && state.nhi.risk === 100 && state.reviewScore === 5 && state.objects[0].wear === 0 && state.objects[1].broken === true && state.staff[0].morale === 70,
      JSON.stringify({ b: state.events.buffs, f: state.events.flags, fu: state.events.pendingFollowUps, r: state.nhi.risk, rv: state.reviewScore, w: state.objects[0].wear, br: state.objects[1].broken, m: state.staff[0].morale }));
    check('save: an event with `chance` pending survives export -> import', (() => { richClinic(); const d = pool.find(q => q.choices.some(c => c.chance)); Ev.triggerEvent(state, d.id); const j = Sav.exportSave(state); fresh(); Sav.importSave(state, j); return state.events.pendingDilemma && state.events.pendingDilemma.id === d.id && state.events.pendingDilemma.choices.some(c => c.chance); })());
    // flags / buffs / wear all round-trip exactly through a long sim
    richClinic(); Ev.applyEffects(state, { buff: { weeks: 40, label: '長期', mods: { patience: 0.05 } }, setFlag: 'long', risk: 7, reviewScore: -0.3, wear: { target: 'all', delta: 12 }, breakdown: 'tens', maintenance: 20 });
    const a = Sav.exportSave(state); Sav.importSave(state, a); const b = Sav.exportSave(state);
    check('save: events state (buffs, flags, risk, review, wear, broken, contract) is stable across import/export', JSON.parse(a).state.events.buffs[0].weeksLeft === 40 && JSON.stringify(JSON.parse(a).state.objects) === JSON.stringify(JSON.parse(b).state.objects) && JSON.stringify(JSON.parse(a).state.events) === JSON.stringify(JSON.parse(b).state.events));
  }

  // ---------------- G. M2 wear / breakdown / repair ----------------
  {
    richClinic();
    const tens = state.objects.find(o => o.defId === 'tens'), sw = state.objects.find(o => o.defId === 'shockwave');
    tens.wear = 0; sw.wear = 0;
    EQ.useWear(state, tens); EQ.useWear(state, sw);
    check('wear: +0.4 per treatment (+0.2 for shockwave)', near(tens.wear, 0.4) && near(sw.wear, 0.2));
    const bed = state.objects.find(o => o.defId === 'bed'); EQ.useWear(state, bed);
    check('wear: only the listed machine kinds wear (bed/exam_room do not)', !bed.wear);
    tens.wear = 10; EQ.weeklyWear(state);
    check('wear: +0.3 per week', near(tens.wear, 10.3));
    tens.wear = 10; EQ.applyMaintenance(state, 10); EQ.useWear(state, tens); EQ.weeklyWear(state);
    check('wear: a maintenance contract halves the speed (use and weekly)', near(tens.wear, 10 + 0.2 + 0.15), String(tens.wear));
    delete tens.maintainedUntil;
    const nine = EQ.WEAR_TUNE.BREAK_AT;
    tens.wear = nine - 1;
    for (let i = 0; i < 20; i++) EQ.weeklyWear(state);          // below 90 nothing breaks (89 + 0.3 stays < 90 for one tick only)
    // thresholds
    tens.wear = 89; tens.broken = false;
    let n = 0; for (let i = 0; i < 400; i++) { tens.wear = 95; tens.broken = false; if (EQ.weeklyWear(state).includes(tens)) n++; }
    check(`wear: >= 90 -> about 25% weekly breakdown chance (${(n / 400).toFixed(2)})`, n / 400 > 0.17 && n / 400 < 0.33);
    tens.wear = 80; tens.broken = false; let m = 0; for (let i = 0; i < 300; i++) { tens.wear = 80; if (EQ.weeklyWear(state).includes(tens)) m++; }
    check('wear: below 90 never breaks down by itself', m === 0);
    check('wear: 老舊 at >= 70', EQ.isWorn({ wear: 70 }) && !EQ.isWorn({ wear: 69.9 }));

    // ---- prices + actions
    richClinic();
    const t2 = state.objects.find(o => o.defId === 'tens'), uq = state.objects.find(o => o.defId === 'us_room');
    check('prices: repair 8% (min 2,000), service 3%', EQ.repairCost(t2) === Math.max(2000, Math.round(BUILDABLES.tens.cost * 0.08)) && EQ.repairCost(uq) === Math.round(BUILDABLES.us_room.cost * 0.08) && EQ.serviceCost(uq) === Math.round(BUILDABLES.us_room.cost * 0.03) && EQ.repairCost(state.objects.find(o => o.defId === 'heatbox')) === 2000);
    t2.wear = 60; const mo = state.money;
    const rs = EQ.serviceObject(state, t2.id);
    check('serviceObject: wear -> 0, charged via economy.spend (ledger.maintain)', rs.ok && t2.wear === 0 && state.money === mo - EQ.serviceCost(t2) && state.ledger.expense.maintain >= EQ.serviceCost(t2), JSON.stringify(rs));
    check('serviceObject: refused when already like new / not wearable / unknown', !EQ.serviceObject(state, t2.id).ok && !EQ.serviceObject(state, state.objects.find(o => o.defId === 'bed').id).ok && !EQ.serviceObject(state, 99999).ok);
    EQ.breakObject(state, t2); t2.wear = 95;
    check('serviceObject: refused on a broken machine (needs 維修)', !EQ.serviceObject(state, t2.id).ok);
    const m1 = state.money, rr = EQ.repairObject(state, t2.id);
    check('repairObject: broken -> false, wear 0, pays the repair price', rr.ok && !t2.broken && t2.wear === 0 && state.money === m1 - EQ.repairCost(t2) && rr.cost === EQ.repairCost(t2));
    check('repairObject: refused on a healthy machine', !EQ.repairObject(state, t2.id).ok);
    EQ.breakObject(state, t2); state.money = 100;
    check('repairObject / serviceObject / signMaintenance: refuse (and charge nothing) when poor', !EQ.repairObject(state, t2.id).ok && t2.broken && state.money === 100 && !EQ.signMaintenance(state, 26).ok && state.money === 100);
    state.money = 5e6;
    const c26 = EQ.contractCost(state, 26), m2 = state.money, sg = EQ.signMaintenance(state, 26);
    check('signMaintenance: pays the contract, every machine gets maintainedUntil = now + weeks', sg.ok && sg.cost === c26 && state.money === m2 - c26 && wearables().every(o => o.maintainedUntil === Cal.absoluteWeek(state) + 26) && EQ.maintainedWeeksLeft(state, t2) === 26);
    check('signMaintenance: refused for 0 weeks', !EQ.signMaintenance(state, 0).ok);
    state.objects = state.objects.filter(o => !EQ.isWearable(o.defId));
    check('signMaintenance: refused when there is nothing to maintain', !EQ.signMaintenance(state, 13).ok);

    // ---- a broken machine is never used; breakdown mid-treatment is released gracefully; repair resumes work
    fresh(); wire(); Ev.EVENT_TUNE.CHANCE = 0;      // (random events could repair it behind our back)
    state.money = 2e6; state.reputation = 120;
    state.objects = state.objects.filter(o => !['heatbox', 'tens'].includes(o.defId)); refresh();
    const tn = putAnywhere('tens'); refresh();
    for (let i = 0; i < 40; i++) { P.spawnPatient(state, 'elder'); }
    let doneTens = 0; const offT = bus.on('treatment:done', e => { if (e.treatmentId === 'tens') doneTens++; });
    let broke = false, midOk = true, treatingWas = null;
    for (let t = 0; t < MIN_PER_WEEK && !broke; t++) {
      step(1, true);
      const p = state.patients.find(q => q.stage === 'treating' && q.targetObj === tn.id);
      if (p) { treatingWas = p; EQ.breakObject(state, tn); broke = true; }
    }
    check('broken mid-treatment: a patient was being treated when it broke', !!treatingWas);
    if (treatingWas) {
      step(1, true);
      const p = state.patients.find(q => q.id === treatingWas.id);
      const stf = treatingWas.staffId && state.staff.find(s => s.id === treatingWas.staffId);
      check('broken mid-treatment: treatment aborted, patient released back to waiting/leaving (no deadlock)', !p || (p.targetObj !== tn.id && p.stage !== 'treating'), p && p.stage + '/' + p.targetObj);
      check('broken mid-treatment: station and staff are free again', !tn.busy && !tn.usedBy && !tn.staffId && (!stf || !stf.task || stf.task.objId !== tn.id));
    }
    const doneAtBreak = doneTens;
    for (let t = 0; t < MIN_PER_WEEK * 1.5; t++) step(1, true);
    check('broken machine is never used again (no tens treatments while broken)', doneTens === doneAtBreak, `${doneTens} vs ${doneAtBreak}`);
    check('broken machine: sim stays valid, patients do not pile up forever', invariants().length === 0 && state.patients.length < 60, invariants().join(';'));
    const pre = EQ.repairObject(state, tn.id);
    for (let t = 0; t < MIN_PER_WEEK * 2; t++) step(1, true);
    offT();
    check('after 維修 the machine is used again', pre.ok && doneTens > doneAtBreak, `${doneTens} vs ${doneAtBreak}`);
    restoreTune();
    check('feasibility: with every tens broken, patients skip the step (complain) instead of waiting forever', (() => {
      fresh(); wire(); state.money = 2e6;
      state.objects = state.objects.filter(o => !['heatbox', 'tens', 'traction', 'ir_lamp'].includes(o.defId)); refresh();
      const t3 = putAnywhere('tens'); EQ.breakObject(state, t3);
      state.reputation = 150; let tens3 = 0; const o3 = bus.on('treatment:done', e => { if (e.treatmentId === 'tens') tens3++; });
      for (let t = 0; t < MIN_PER_WEEK * 2; t++) step(1, true);
      o3();
      return tens3 === 0 && state.patients.every(p => p.age < 700) && invariants().length === 0;
    })());

    // ---- auto breakdown hook: weekly tick breaks it, a decision opens (event or generic) and can be answered
    richClinic(); Ev.EVENT_TUNE.CHANCE = 0;
    for (const o of state.objects) if (EQ.isWearable(o.defId)) o.wear = 99;
    let brokeSeen = 0; const offB = bus.on('equipment:broken', () => brokeSeen++);
    let shownId = null; const offS = bus.on('event:show', e => { shownId = e.event.id; });
    for (let i = 0; i < 40 && !state.events.pendingDilemma; i++) bus.emit('week:start', {});
    offB(); offS();
    check('auto-breakdown: weekly roll breaks a worn-out machine and opens a decision for it', brokeSeen >= 1 && !!state.events.pendingDilemma && !!shownId, String(shownId));
    const pdc = state.events.pendingDilemma;
    check('auto-breakdown: the decision offers an affordable way out', pdc.choices.some(c => Ev.choiceAffordable(state, c)));
    Ev.resolveDilemma(state, 0);
    check('auto-breakdown: resolving keeps the game consistent', !state.events.pendingDilemma && invariants().length === 0);
    // generic fallback (no C-event for ir_lamp)
    richClinic(); const lamp = state.objects.find(o => o.defId === 'ir_lamp'); EQ.breakObject(state, lamp);
    state.events.cooldowns = {};
    const gp = Ev.triggerBreakdownEvent(state, lamp);
    check('breakdown: machines without a dedicated event get the generic 叫修 decision that repairs exactly that machine', gp && gp.id === 'equip_breakdown' && (() => { const mm = state.money; Ev.resolveDilemma(state, 0); return !lamp.broken && state.money === mm - EQ.repairCost(lamp); })());
    richClinic(); const lamp2 = state.objects.find(o => o.defId === 'ir_lamp'); EQ.breakObject(state, lamp2); const mLamp = state.money; Ev.triggerBreakdownEvent(state, lamp2); Ev.resolveDilemma(state, 1);
    check('breakdown: 「先停用」 leaves it broken and costs nothing', lamp2.broken && state.money === mLamp);
    // wear -100 as an event repair clears broken
    richClinic(); const t5 = state.objects.find(o => o.defId === 'tens'); EQ.breakObject(state, t5); t5.wear = 95;
    Ev.applyEffects(state, { wear: { target: 'tens', delta: -100 } });
    check('event effect wear -100 on a broken machine repairs it', !t5.broken && t5.wear === 0);
  }

  // ---------------- H. M4 morale / resignation ----------------
  {
    richClinic();
    const pt = state.staff.filter(s => s.role === 'pt');
    for (const s of state.staff) { s.morale = 50; s.tiredAcc = 0; }
    state.objects = state.objects.filter(o => !(BUILDABLES[o.defId].restRecovery > 0)); refresh();
    S.weeklyMorale(state);
    check('morale: +1 per week without a rest room', state.staff.every(s => s.morale === 51));
    put('rest_room', 21, 16); S.weeklyMorale(state);
    check('morale: +1 more with a rest room (+2/week)', state.staff.every(s => s.morale === 53));
    pt[0].tiredAcc = S.MORALE.TIRED_MIN; S.weeklyMorale(state);
    check('morale: exhausted staff lose 3 net of the +2', near(pt[0].morale, 53 + 2 - 3) && near(pt[1].morale, 55) && pt[0].tiredAcc === 0);
    pt[1].workAcc = S.MORALE.OVERTIME_UTIL * K.CLOSE_MIN - S.MORALE.OVERTIME_UTIL * K.OPEN_MIN + 1; const mBefore = pt[1].morale; S.weeklyMorale(state);
    check('morale: -2 for 超時 (working >= 60% of the opening hours in the week), workAcc resets', near(pt[1].morale, mBefore + 2 - 2) && pt[1].workAcc === 0, String(pt[1].morale));
    for (const s of state.staff) s.morale = 99; S.weeklyMorale(state);
    check('morale: clamped at 100', state.staff.every(s => s.morale === 100));
    S.addMorale(state, 'pt', -200);
    check('morale effect: role filter + clamp at 0', pt.every(s => s.morale === 0) && state.staff.filter(s => s.role !== 'pt').every(s => s.morale === 100));
    // updateStaff accumulates exhaustion minutes
    const s0 = state.staff[0]; s0.stamina = 1; s0.tiredAcc = 0; for (let i = 0; i < 30; i++) S.updateStaff(state, 1);
    check('morale: updateStaff counts the minutes spent exhausted', s0.tiredAcc >= 5, String(s0.tiredAcc));

    // ---- resign flow
    richClinic(); wire();
    for (let i = 0; i < 30; i++) P.spawnPatient(state, 'elder');
    for (let t = 0; t < 200; t++) step(1, true);
    const busyPt = state.staff.filter(s => s.role === 'pt' && s.task && s.task.treatmentId !== '__chat')[0] || state.staff.filter(s => s.role === 'pt')[0];
    busyPt.morale = 5;
    const cand = S.resignCandidate(state);
    check('resign: lowest-morale licensed staff (role not left empty) is the candidate', cand && cand.id === busyPt.id);
    const poolN = state.hirePool.length;
    const staffN = state.staff.length;
    const gone = S.resignStaff(state, busyPt.id);
    check('resign: staff removed, replacement added to the hire pool, event emitted', gone && state.staff.length === staffN - 1 && !state.staff.some(s => s.id === busyPt.id) && state.hirePool.length >= Math.min(poolN + 1, S.MORALE.POOL_MAX) && state.hirePool.some(c => c.role === 'pt'));
    check('resign: no object, rest room or task still points at them', state.objects.every(o => o.staffId !== busyPt.id) && state.staff.every(s => s.restObj == null || state.objects.some(o => o.id === s.restObj)));
    for (let t = 0; t < MIN_PER_WEEK * 2; t++) step(1, true);
    check('resign: patients who were with them are released, sim stays valid (no dangling staffId)', state.patients.every(p => !p.staffId || state.staff.some(s => s.id === p.staffId)) && invariants().length === 0, invariants().join(';'));
    check('resign: lone staff of a role cannot resign (candidate rule + effect falls back to -15 morale)', (() => {
      richClinic(); state.staff = state.staff.filter(s => s.role !== 'st' || s.id === state.staff.find(q => q.role === 'st').id);
      const only = state.staff.find(s => s.role === 'st'); only.morale = 3;
      const r = S.resignRole(state, 'st', 1);
      return S.resignCandidate(state) === null && !r.left && r.hit && S.moraleOf(only) === 0 && state.staff.includes(only);
    })());
    // weekly roll
    richClinic(); Ev.EVENT_TUNE.CHANCE = 0; state.events.cooldowns = {};
    for (const s of state.staff) s.morale = 80; state.staff.find(s => s.role === 'pt').morale = 10;
    let opened = null; const offO = bus.on('event:show', e => { if (!opened) opened = e.event.id; });
    let weeks = 0; for (; weeks < 400 && !state.events.pendingDilemma; weeks++) { state.events.cooldowns = {}; for (const s of state.staff.filter(q => q.role === 'pt')) { if (s.morale > 15) s.morale = 15; } state.staff.find(s => s.role === 'pt').morale = 10; bus.emit('week:start', {}); }
    offO();
    check(`resign: a demoralised PT eventually triggers the 治療師遞出辭呈 decision (~8%/week; took ${weeks}w)`, opened === 'pt_resign' && weeks > 1, String(opened));
    const before = state.staff.length; Ev.resolveDilemma(state, pool.find(d => d.id === 'pt_resign').choices.findIndex(c => c.effects && c.effects.resign));
    check('resign: choosing 放行 removes exactly one PT and keeps at least one', state.staff.length === before - 1 && state.staff.filter(s => s.role === 'pt').length >= 1);
    richClinic(); Ev.EVENT_TUNE.CHANCE = 0; state.events.cooldowns = {};
    for (const s of state.staff) s.morale = 80; state.staff.find(s => s.role === 'ot').morale = 10;
    opened = null; const offO2 = bus.on('event:show', e => { if (!opened) opened = e.event.id; });
    for (let w2 = 0; w2 < 400 && !state.events.pendingDilemma; w2++) { state.staff.find(s => s.role === 'ot').morale = 10; bus.emit('week:start', {}); }
    offO2();
    check('resign: a non-PT role gets the generic resignation decision (加薪 / 放行)', opened === 'staff_resign' && state.events.pendingDilemma.choices.length === 2, String(opened));
    Ev.resolveDilemma(state, 0);
    check('resign: 加薪慰留 raises morale of that role', S.moraleOf(state.staff.find(s => s.role === 'ot')) > 10);
    restoreTune();
    // stamina effect at the start of a day survives the overnight regeneration
    richClinic(); wire(); state.time.clock = K.OPEN_MIN;
    for (const s of state.staff) s.stamina = 40;
    Ev.applyEffects(state, { stamina: { role: 'pt', delta: -20 } });
    check('stamina effect at day start is deferred (carry) instead of washed out by overnight regen', state.staff.filter(s => s.role === 'pt').every(s => s.staminaCarry === -20 && s.stamina === 40));
    S.updateStaff(state, 0.5); S.updateStaff(state, 1);
    const ptS = state.staff.find(s => s.role === 'pt'), drS = state.staff.find(s => s.role === 'doctor');
    check('stamina effect: applied after the overnight regen (pt ends 20 lower than a doctor)', near(drS.stamina - ptS.stamina, 20, 2) && ptS.staminaCarry === undefined, `${drS.stamina} ${ptS.stamina}`);
  }

  // ---------------- I. M3 NHI risk / M7 review score ----------------
  {
    richClinic();
    check('risk: starts at 0 and review at 4.0', Eco.riskOf(state) === 0 && Eco.reviewOf(state) === 4);
    const cap = Eco.nhiCap(state);
    check('risk: monthly input is 0 well under the cap, grows past it', Eco.monthlyRiskDelta(state, cap * 0.5) === 0 && Eco.monthlyRiskDelta(state, cap * 1.2) > 5 && Eco.monthlyRiskDelta(state, cap * 5) === Eco.RISK_TUNE.MONTH_CAP);
    state.history.push({ nhiPoints: cap * 0.5, year: 2, month: 1, patients: 10, satisfaction: 60 });
    check('risk: fast month-on-month growth adds risk', Eco.monthlyRiskDelta(state, cap * 0.85) > 0);
    state.nhi.nhiN = 100; state.nhi.complexN = 90;
    check('risk: a high share of complex treatments adds risk', Eco.monthlyRiskDelta(state, cap * 0.3) > 0);
    state.nhi.nhiN = 0; state.nhi.complexN = 0; state.history = [];
    state.nhi.monthPoints = cap * 1.3; state.nhi.risk = 10;
    const rec = Eco.settleMonth(state);
    check('risk: settleMonth applies the monthly input and records it', Eco.riskOf(state) > 10 && rec.risk === Math.round(Eco.riskOf(state) * 10) / 10 && state.history[state.history.length - 1].risk === rec.risk);
    state.nhi.risk = 5; bus.emit('week:end', {}); bus.emit('week:end', {});
    check('risk: decays 1 per week (never below 0)', Eco.riskOf(state) === 3 && (state.nhi.risk = 0, bus.emit('week:end', {}), Eco.riskOf(state) === 0));
    // effect on events
    const aud = pool.find(d => d.id === 'nhi_audit');
    state.nhi.risk = 70; check('risk: > 60 doubles the weight of nhi events (nhi_audit)', near(Ev.eventWeight(state, aud), aud.weight * 2));
    // effect on the yearly inspection
    richClinic();
    state.nhi.risk = 0; const f0 = Ins.evaluateRules(state, state.time.year).find(r => r.id === 'nhi_abuse').frac;
    state.nhi.risk = 100; const f1 = Ins.evaluateRules(state, state.time.year).find(r => r.id === 'nhi_abuse').frac;
    check('risk: high risk lowers the annual 健保署 nhi_abuse score', f1 < f0 - 0.3 && f0 === 1, `${f0} -> ${f1}`);
    // M7 review score
    richClinic();
    state.stats.satSum = 80 * 50; state.stats.satN = 50; state.nhi.monthPoints = 0; Eco.settleMonth(state);
    check('review: average satisfaction > 70 -> +0.05', near(state.reviewScore, 4.05), String(state.reviewScore));
    state.stats.satSum = 40 * 50; state.stats.satN = 50; Eco.settleMonth(state);
    check('review: average satisfaction < 45 -> -0.1', near(state.reviewScore, 3.95), String(state.reviewScore));
    state.stats.satSum = 60 * 50; state.stats.satN = 50; Eco.settleMonth(state);
    check('review: satisfaction 45..70 leaves it unchanged', near(state.reviewScore, 3.95));
    state.reviewScore = 5; Eco.addReview(state, 1); const hi = state.reviewScore; state.reviewScore = 1; Eco.addReview(state, -1);
    check('review: clamped to 1..5', hi === 5 && state.reviewScore === 1);
    state.reviewScore = 4; const a4 = P.expectedArrivalsPerWeek(state); state.reviewScore = 5; const a5 = P.expectedArrivalsPerWeek(state); state.reviewScore = 3; const a3 = P.expectedArrivalsPerWeek(state);
    check('review: arrivals x (1 + (score-4)*0.1): every 0.1 = 1%', near(a5 / a4, 1.1, 1e-9) && near(a3 / a4, 0.9, 1e-9));
  }

  // ---------------- J. result summaries are readable ----------------
  {
    richClinic(); state.time.clock = 600;
    const chips = Ev.applyEffectsDetailed(state, { wear: { target: 'all', delta: 10 }, risk: -10, morale: { delta: -3 }, stamina: { role: 'pt', delta: -5 }, reviewScore: -0.2, maintenance: 8, breakdown: 'tens', repair: 'broken' });
    const txt = chips.map(c => c.text);
    check('summaries: 設備耗損 +10 / 審查風險 −10 / 士氣 −3 / 體力 / 網路評價 −0.2 / 保養合約 / 故障 / 修復', txt.includes('設備耗損 +10') && txt.includes('審查風險 −10') && txt.includes('士氣 −3') && txt.some(t => t.includes('體力 −5')) && txt.includes('網路評價 −0.2') && txt.some(t => t.includes('保養合約 8 週')) && txt.some(t => t.includes('故障')) && txt.includes('故障設備已修復'), txt.join(' | '));
    check('summaries: good/bad flags follow the sign (wear up = bad, risk down = good)', chips.find(c => c.text === '設備耗損 +10').good === false && chips.find(c => c.text === '審查風險 −10').good === true);
    check('applyEffects (legacy) still returns plain strings', Ev.applyEffects(state, { money: 1000, reputation: 2 }).every(t => typeof t === 'string'));
  }
  feature('Events: pool of RANDOM_EVENTS + EXT_A + EXT_B, cond/weights/cooldown/big cap/follow-ups', 'works', `${Ev.eventPool().length} events forced x all choices`);
  feature('Equipment wear / breakdown / repair / maintenance (M2)', 'works', 'wear, auto-breakdown event, 維修/保養/合約');
  feature('Staff morale + resignation (M4), NHI risk (M3), review score (M7), buffs (M5/M6)', 'works', 'weekly/monthly updates, save round-trip');
}
const MULT_FLOOR = { spawnMult: 0.1, patience: 0.1, slipRisk: 0.1, walkSpeed: 0.1, nhiTurnover: 0.1, selfPayPrice: 0.1, researchGain: 0.1, staffStamina: 0.1, rentMult: 0.1, wageMult: 0.1 };

// =====================================================================================================
if (want('features')) featuresSection();
if (want('edge')) edgeSection();
if (want('save')) saveSection();
if (want('achievements')) achievementsSection();
if (want('events')) eventsSection();
if (want('longrun')) longrunSection();

if (FEATURES.length) {
  section('Feature conformance');
  for (const [n, s, e] of FEATURES) console.log(`  ${s.padEnd(8)} ${n}  --  ${e}`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
