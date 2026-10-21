// Balance harness for the event engine (docs/EVENTS_EXT.md): 5-year headless runs, prints decision frequency, big events per month,
// the direct money effect of events per year (% of income), maintenance spending, morale / breakdown counts and staff utilisation.
// usage: node tools/bal_events.mjs policy=starter|good|expert months=60 seed=1 ev=rand|greedy [evchance=0.3] [maint=0] [quiet=1]
//   ev=rand: random affordable option (pessimistic), ev=greedy: scores money / reputation / risk (sensible player); maint=0 disables the
//   owner who repairs / services machines; evchance=0 shows the no-random-event baseline (patient dilemmas only).
// (derived from the QA-1 balance harness)
// policies: bad | starter | good | spam (cheap NHI only, big) | expert (good + research + self-pay + expansion)
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../js/', import.meta.url));
class LS { constructor(){this.m=new Map();} get length(){return this.m.size;} key(i){return [...this.m.keys()][i];} getItem(k){return this.m.has(k)?this.m.get(k):null;} setItem(k,v){this.m.set(k,String(v));} removeItem(k){this.m.delete(k);} }
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
const EQ = await import(R + 'sim/equipment.js');
const S = await import(R + 'sim/staff.js');
const { TREATMENTS } = await import(R + 'data/treatments.js');
const { BUILDABLES } = await import(R + 'data/buildables.js');
const { LOTS } = await import(R + 'data/lots.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const POLICY = args.policy || 'good';
const MONTHS = +(args.months || 24);
const EVMODE = args.ev || 'rand';
const EVLOG = [];
const QUIET = !!args.quiet; args.go = args.go ?? "1";
const seed0 = +(args.seed || 1);
let seed = seed0;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
if (args.evchance !== undefined) Ev.EVENT_TUNE.CHANCE = +args.evchance;
if (args.evgap !== undefined) Ev.EVENT_TUNE.MIN_GAP = +args.evgap;
if (args.tune) for (const kv of args.tune.split(',')) { const [k, v] = kv.split(':'); if (k in P.TUNE) P.TUNE[k] = +v; else if (k in S.TUNE) S.TUNE[k] = +v; else if (k.startsWith('data.')) {} else console.log('unknown tune', k); }
const NTD_PER_PT = Eco.PATIENT_WEIGHT;

function refresh() { rebuildOccupancy(state); recomputeZones(state); recomputeMods(state); ui.dirtyOcc = false; }
Eco.initEconomy(); Ev.initEvents(); Res.initResearch(); Ins.initInspection();
bus.on('mods:dirty', () => recomputeMods(state));
bus.on('map:changed', () => { ui.dirtyOcc = true; });
bus.on('week:end', () => P.closeUp(state));
bus.on('month:start', () => S.refreshPool(state));
bus.on('toast', () => {});
B.seedStarterClinic(state);
S.refreshPool(state);
refresh();

// ---------- player helpers ----------
function buy(defId, x, y, rot = 0) { const o = B.placeObject(state, defId, x, y, rot); if (o) refresh(); else if (!QUIET && args.dbg) console.log('buy fail', defId, x, y, B.canPlace(state, defId, x, y, rot).reason); return !!o; }
function autoBuy(defId, nearX = 15, nearY = 14) {
  // "pack" placement: fill the lot from the top-left, keep a 2-wide central corridor (x=14,15) and the bottom 4 rows free
  const def = BUILDABLES[defId]; if (!def || state.money < def.cost) return false;
  const L = state.lot; const c = [];
  const waiting = ['sofa', 'plant', 'water', 'tv', 'sign'].includes(defId);
  const yMax = L.y0 + L.h - 5;
  for (let rot = 0; rot < (def.w === def.h ? 1 : 2); rot++) for (let y = L.y0; y < L.y0 + L.h; y++) for (let x = L.x0; x < L.x0 + L.w; x++) {
    const w = rot ? def.h : def.w, h = rot ? def.w : def.h;
    if (!waiting) { if (y + h - 1 > yMax) continue; let bad = false; for (let dx = 0; dx < w; dx++) { const cx = x + dx; if (cx === 14 || cx === 15) bad = true; } if (bad) continue; }
    else if (y + h - 1 < yMax + 1) continue;
    c.push({ x, y, rot, d: waiting ? Math.abs(x - 12) + Math.abs(y - 17) : (y - L.y0) * 3 + x * 0.1 + rot * 0.5 });
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
function startResearch(ids) { for (const id of ids) { if (Res.isDone(state, id)) continue; if (Res.canStart(state, id).ok) { Res.start(state, id); return; } } }

// ---------- initial layouts ----------
if (POLICY === 'bad') {
  // no seats / no plant, reception shoved to the far corner, no nurse => long walks, no waiting seats
  state.objects = state.objects.filter(o => !['sofa', 'plant', 'reception'].includes(o.defId));
  refresh();
  buy('reception', 10, 10);
}
if (POLICY === 'good' || POLICY === 'expert') {
  buy('traction', 20, 12); buy('bed', 17, 14); buy('rest_room', 20, 10);
  buy('sofa', 12, 17); buy('tv', 10, 17); buy('water', 14, 18);
  hireRole('pt');
  for (let x = 10; x < 14; x++) B.paintFloor(state, 'ramp', x, 19);
}
if (POLICY === 'spam') {
  state.money = 6e6;
  for (let i = 0; i < 6; i++) { autoBuy('heatbox', 17, 11); autoBuy('tens', 19, 11); }
  autoBuy('traction'); autoBuy('traction'); autoBuy('sofa', 12, 17); autoBuy('sofa', 12, 16); autoBuy('rest_room');
  hireRole('nurse'); hireRole('pt'); hireRole('pt');
  const SL = +(args.lot || 1); state.lotLevel = SL; state.lot = { ...LOTS[SL].lot }; state.door = { ...LOTS[SL].door }; state.reputation = +(args.rep || 150);
  refresh();
}
if (POLICY.startsWith('full')) {
  // steady-state probe: everything researched, rich L1/L2 clinic with all self-pay stations. args: rep=
  const L = +POLICY.slice(4);
  state.money = 9e6; state.reputation = +(args.rep || 200);
  state.research.done = Object.keys((await import(R + 'data/research.js')).RESEARCH);
  state.lotLevel = L; state.lot = { ...LOTS[L].lot }; state.door = { ...LOTS[L].door }; state.time.year = L + 1;
  refresh();
  state.objects = []; state.staff = []; // hand-designed L1 layout (x9..22,y8..19)
  const lay = [['reception',16,17],['sofa',10,17],['sofa',12,17],['sofa',10,15],['tv',12,15],['water',14,17],['plant',9,19],['plant',13,19],['plant',14,15],
    ['exam_room',9,8],['exam_room',11,8],['manual_room',14,8],['laser_room',16,8],['redcord',18,8],['shockwave',13,10],['coffee',12,10],['prp_dummy',0,0],
    ['heatbox',10,12],['heatbox',11,12],['heatbox',12,12],['tens',13,12],['tens',14,12],['tens',15,12],['traction',16,12],['traction',17,12],['bed',19,12],['bed',20,12],['bed',21,12],
    ['rest_room',21,16],['ir_lamp',18,15]];
  for (const [d,x,y] of lay) if (BUILDABLES[d]) { const o = B.placeObject(state, d, x, y, 0); if (!o && args.dbg) console.log('layout fail', d, x, y, B.canPlace(state, d, x, y, 0).reason); }
  refresh();
  if (L >= 2) for (const d of ['exam_room','manual_room','laser_room','shockwave','shockwave','heatbox','heatbox','heatbox','tens','tens','bed','bed','sofa','sofa','redcord']) autoBuy(d, 15, 9);
  if (L >= 3) for (const d of ['exam_room','exam_room','manual_room','laser_room','shockwave','heatbox','heatbox','tens','tens','tens','bed','bed','bed','sofa','sofa','redcord','traction','traction']) autoBuy(d, 15, 9);
  if (args.recs) for (const rp of args.recs.split(';')) { const [rx, ry] = rp.split(',').map(Number); const o = B.placeObject(state, 'reception', rx, ry, 0); if (!o) console.log('recs fail', rp, B.canPlace(state, 'reception', rx, ry, 0).reason); }
  if (args.extra) for (const d of ['reception','reception','sofa','sofa','sofa','sofa','plant','plant','tv','water','heatbox','heatbox','tens','tens','traction','bed','ir_lamp','exam_room','shockwave','manual_room']) autoBuy(d, 15, 9);
  for (let k = 0; k < 30; k++) { for (const r of ['pt','doctor','nurse']) { if (rcount(r) < ({pt:+(args.pt||(L>=3?9:L>=2?6:4)),doctor:(L>=3?4:L>=2?3:2),nurse:+(args.nurse||(L>=3?4:2))})[r]) { S.refreshPool(state); hireRole(r); } } }
}
refresh();

// ---------- weekly player policy ----------
const RESEARCH_ORDER = ['rs_ultrasound', 'rs_heat', 'rs_queue', 'rs_admin', 'rs_evidence', 'rs_edu', 'rs_maint', 'rs_manual', 'rs_shockwave', 'rs_rep',
  'rs_selfpay', 'rs_redcord', 'rs_insole', 'rs_laser', 'rs_prp', 'rs_ot', 'rs_staffing', 'rs_geriatric', 'rs_insurance', 'rs_sports_med', 'rs_expand', 'rs_st', 'rs_pediatric',
  'rs_gait', 'rs_chronic', 'rs_brand'];
const researchTimeline = [];
bus.on('research:done', (e) => researchTimeline.push(`${state.time.year}.${state.time.month}:${e.id}`));
const RESERVE = 250000;
function expertWeek() {
  startResearch(RESEARCH_ORDER);
  const ex = Ins.canExpand(state);
  const failing = (ex.checks || []).filter(c => !c.ok);
  const onlyMoney = ex.target && failing.length === 1 && failing[0].label.startsWith('資金');
  if (ex.ok && state.money - ex.cost > RESERVE + 150000 && state.staff.length >= 5) { Ins.expand(state); refresh(); return; }
  const saving = onlyMoney;   // close to affording expansion: stop buying
  const reserve = RESERVE + (saving ? ex.cost : 0);
  const afford = (cost) => state.money - cost >= reserve;
  const L = state.lotLevel;
  const want = [
    ['obj', 'shockwave', () => Res.isDone(state, 'rs_shockwave') && count('shockwave') + count('shockwave_room') < 1],
    ['obj', 'manual_room', () => Res.isDone(state, 'rs_manual') && count('manual_room') < 1],
    ['obj', 'coffee', () => count('shockwave') && count('manual_room') && count('coffee') < 1],
    ['hire', 'pt', () => rcount('pt') < 3 && (count('shockwave') + count('manual_room') >= 1)],
    ['obj', 'redcord', () => Res.isDone(state, 'rs_redcord') && count('redcord') < 1],
    ['obj', 'laser_room', () => Res.isDone(state, 'rs_laser') && count('laser_room') < 1],
    ['hire', 'pt', () => rcount('pt') < 4 && count('laser_room') + count('redcord') >= 1],
    ['hire', 'nurse', () => rcount('nurse') < 2 && L >= 1],
    ['hire', 'doctor', () => rcount('doctor') < 1 + Math.min(2, L) && L >= 1],
    ['obj', 'exam_room', () => count('exam_room') < 1 + L],
    ['obj', 'sofa', () => count('sofa') < 2 + L * 2],
    ['obj', 'heatbox', () => count('heatbox') < 3 + L * 2],
    ['obj', 'traction', () => count('traction') < 1 + L],
    ['obj', 'tens', () => count('tens') < 2 + L * 2],
    ['obj', 'ir_lamp', () => L >= 1 && count('ir_lamp') < L],
    ['obj', 'bed', () => count('bed') < 2 + L],
    ['hire', 'pt', () => L >= 1 && rcount('pt') < 3 + 2 * L],
    ['hire', 'ot', () => L >= 2 && rcount('ot') < 1],
    ['obj', 'shockwave', () => L >= 1 && Res.isDone(state, 'rs_shockwave') && count('shockwave') < 2],
    ['obj', 'manual_room', () => L >= 1 && Res.isDone(state, 'rs_manual') && count('manual_room') < 2],
    ['obj', 'laser_room', () => L >= 2 && count('laser_room') < 2],
    ['obj', 'water', () => count('water') < 1],
    ['obj', 'plant', () => count('plant') < 2 + L],
  ];
  for (const [kind, what, cond] of want) {
    if (!cond()) continue;
    if (kind === 'obj') { const d = BUILDABLES[what]; if (afford(d.cost) && autoBuy(what, 15, 13)) return; }
    else if (kind === 'hire') { if (state.money > RESERVE + 100000 && hireRole(what)) return; }
  }
}

// ---------- metrics ----------
const T = { cnt: {}, rev: {} };
const monthRows = [];
let mTreat = {};
bus.on('treatment:done', (e) => {
  const pv = Eco.getPointValue(state);
  const W = Eco.patientWeight(state);
  const rev = (e.nhiPoints || 0) * pv * W + ((e.selfPay || 0) + (e.copay || 0)) * W;
  mTreat[e.treatmentId] = mTreat[e.treatmentId] || { n: 0, rev: 0 };
  mTreat[e.treatmentId].n++; mTreat[e.treatmentId].rev += rev;
});
let pointGain = { medical: 0, device: 0, service: 0 };
const settle = [];
bus.on('nhi:settled', (r) => { settle.push({ ...r, rep: Math.round(state.reputation), staff: state.staff.length, objs: state.objects.length, lot: state.lotLevel }); });
const reasons = {}; const angryCtx = {}; bus.on('patient:left', (e) => { reasons[e.reason] = (reasons[e.reason] || 0) + 1; if (e.reason === 'angry' || e.satisfaction < 35) { const p = e.patient; const k = p.type + '|treated' + p.treated + '|plan' + p.planIdx + '/' + p.plan.length + '|' + (e.reason); angryCtx[k] = (angryCtx[k] || 0) + 1; } });
let gameOver = false; let evCount = 0;
bus.on('game:over', () => { gameOver = true; });
let maintSpent = 0, repairs = 0, services = 0, nResign = 0, nBroke = 0, minMorale = 100;
bus.on('staff:resigned', () => nResign++); bus.on('equipment:broken', () => nBroke++); bus.on('week:start', () => { for (const q of state.staff) minMorale = Math.min(minMorale, S.moraleOf(q)); });
bus.on('week:start', () => {
  if (args.maint === '0') return;
  // a competent owner: fix what is broken, service what is getting old (when there is cash)
  for (const o of state.objects) {
    if (o.broken && state.money > 80000) { const r = EQ.repairObject(state, o.id); if (r.ok) { maintSpent += r.cost; repairs++; } }
    else if (!o.broken && EQ.isWearable(o.defId) && EQ.wearOf(o) >= 65 && state.money > 300000) { const r = EQ.serviceObject(state, o.id); if (r.ok) { maintSpent += r.cost; services++; } }
  }
});
bus.on('week:start', () => { if (POLICY === 'good' && rcount('pt') < 2) hireRole('pt'); if (POLICY === 'expert') { if (rcount('pt') < 2) hireRole('pt'); expertWeek(); } });

const fmt = (n) => (Math.round(n / 1000)).toString().padStart(5) + 'k';
let headerPrinted = false;
function printRow(r) {
  if (QUIET) return;
  if (!headerPrinted) { console.log(`policy=${POLICY} seed=${seed0}`); console.log(' Y.M    inc  nhi  self   exp   net  opnet mrg  money   pat sat  rep   pv   pts(m/d/s)  stf objs lot'); headerPrinted = true; }
  console.log(`${r.y}.${String(r.m).padStart(2)} ${fmt(r.income)}${fmt(r.nhiIncome)}${fmt(r.selfIncome)}${fmt(r.expense)}${fmt(r.net)}${fmt(r.opnet)} ${(r.margin * 100).toFixed(0).padStart(4)}% ${fmt(r.money)} ${String(r.patients).padStart(4)} ${String(r.sat).padStart(3)} ${String(r.rep).padStart(4)} ${r.pv.toFixed(2)} ${r.pts} ${String(r.staff).padStart(3)} ${String(r.objs).padStart(4)} ${r.lot}`);
}

const UT = {}; let utWeek = {};
bus.on('week:end', () => { for (const q of state.staff) { const u = (utWeek[q.id] || 0) / 720; const k = q.role; (UT[k] = UT[k] || []).push(u); } utWeek = {}; });
let mi = 0;
const t0 = Date.now();
while (state.history.length < MONTHS && (!gameOver || args.go)) {
  if (state.events.pendingDilemma) {
    const pd = state.events.pendingDilemma;
    const aff = pd.choices.map((c, i) => i).filter(i => Ev.choiceAffordable(state, pd.choices[i]));
    const pool = aff.length ? aff : pd.choices.map((c, i) => i);
    const val = (f) => { f = f || {}; return (f.money || 0) / 1000 + (f.reputation || 0) * 8 + (f.sat || 0) * 2 - (f.nhiPenalty || 0) / 10 + (f.risk ? -f.risk * 2 : 0) + (f.breakdown ? -20 : 0) + ((f.wear && f.wear.delta) ? -f.wear.delta * 0.3 : 0); };
    const score = (c) => c.chance ? c.chance.p * val(c.chance.win.effects) + (1 - c.chance.p) * val(c.chance.lose.effects) : val(c.effects);
    let bi = pool[0], bs = -1e18;
    if (EVMODE === 'rand') bi = pool[Math.floor(Math.random() * pool.length)];
    else for (const i of pool) { const sc = score(pd.choices[i]); if (sc > bs) { bs = sc; bi = i; } }
    const m0 = state.money, w0 = state.time.week + state.time.month * 4 + state.time.year * 48;
    const kind = pd.kind, big = !!(Ev.eventById(pd.id) || {}).big, id = pd.id;
    evCount++; let out = null; try { out = Ev.resolveDilemma(state, bi); } catch (e) { console.log('resolve error', e); }
    state.events.pendingDilemma = null; state.time.paused = false;
    const row = { y: state.time.year, m: state.time.month, w: state.time.week, kind: kind === 'dilemma' ? 'dilemma' : 'event', id, big, dm: state.money - m0, abs: (state.time.year - 1) * 48 + (state.time.month - 1) * 4 + state.time.week };
    EVLOG.push(row);
  }
  const pt0 = { ...state.points };
  advanceClock(state, 1.0);
  S.updateStaff(state, 1.0);
  P.updatePatients(state, 1.0);
  for (const q of state.staff) if (q.state === 'working') utWeek[q.id] = (utWeek[q.id] || 0) + 1;
  if (args.dq && state.history.length===+args.dq && state.time.week===2 && Math.round(state.time.clock)%20===0) { const recs=state.objects.filter(o=>o.defId==='reception'); console.log(Math.round(state.time.clock/60*10)/10, 'q', state.queue.length, 'recs', recs.map(o=>(o.busy?'B':'f')+(o.usedBy||'')).join(','), 'nurses', state.staff.filter(s=>s.role==='nurse').map(s=>s.state+(s.task?'T'+s.task.treatmentId:'')+Math.round(s.stamina)+'@'+Math.floor(s.x)+','+Math.floor(s.y)).join(' '), 'regs', state.patients.filter(p=>p.stage==='registering').length, 'RECS', recs.map(o=>o.x+','+o.y).join(';'), 'PR', state.patients.filter(p=>p.targetObj&&(p.stage==='to_reception'||p.stage==='registering')).map(p=>p.id+(p.pre?'p':'a')+p.stage[0]+(p.staffId?'N':'-')+(p.selfReg?'S':'')+'@'+Math.floor(p.x)+','+Math.floor(p.y)+'>'+(p.stand?p.stand.x+','+p.stand.y:'')+'L'+p.path.length).join(' '), 'walkR', state.patients.filter(p=>p.stage==='to_reception'&&p.targetObj).map(p=>Math.round(p.stT||0)+'/'+p.path.length).join(' '), 'qt', state.patients.filter(p=>p.stage==='to_reception'&&!p.targetObj).map(p=>Math.round(p.qT)).join(' ')); }
  if (args.tl && state.history.length===+args.tl && state.time.week===2 && state.time.clock>=+args.t0 && state.time.clock<+args.t1) { const rec=state.objects.find(o=>o.defId==='reception'); const ps=state.patients.filter(p=>p.targetObj===rec.id&&(p.stage==='to_reception'||p.stage==='registering')); console.log(Math.round(state.time.clock), 'rec', rec.busy?'B'+rec.usedBy:'f', ps.map(p=>p.id+(p.pre?'p':'a')+p.stage[0]+(p.staffId?'N'+p.staffId:'-')+'@'+p.x.toFixed(1)+','+p.y.toFixed(1)+'>'+(p.stand?p.stand.x+','+p.stand.y:'')+'L'+p.path.length+(p.remaining?'r'+p.remaining.toFixed(1):'')).join(' '), '| nurses', state.staff.filter(s=>s.role==='nurse').map(s=>s.id+s.state[0]+(s.task?'T'+s.task.patientId:'')+'@'+s.x.toFixed(1)+','+s.y.toFixed(1)+'>'+(s.stand?s.stand.x+','+s.stand.y:'')+'L'+s.path.length).join(' ')); }
  if (args.diag) { const SD = globalThis.__S = globalThis.__S || {}; for (const q of state.staff) { const k = q.role; const o = SD[k] = SD[k] || { n: 0, rest: 0, work: 0, low: 0, min: 999, tired: 0 }; o.n++; if (q.state === 'resting') o.rest++; else if (q.state === 'working') o.work++; if (q.stamina < q.staminaMax * 0.3) o.low++; if (q.tired) o.tired++; o.min = Math.min(o.min, Math.round(q.stamina)); } }
  if (args.diag) { const R = globalThis.__R = globalThis.__R || { t: new Map(), done: [] }; for (const p of state.patients) { if (p.stage === 'to_reception') R.t.set(p.id, (R.t.get(p.id)||0)+1); else if (R.t.has(p.id) && (p.stage === 'registering' || p.stage === 'waiting' || p.stage === 'to_station' || p.stage==='treating')) { R.done.push(R.t.get(p.id)); R.t.delete(p.id); } } }
  if (args.diag) for (const p of state.patients) { const k = p.stage + (p.stage==='to_reception' ? (p.targetObj?'+walk':'+queue') : p.stage==='waiting' ? ':'+(p.plan[p.planIdx]||'-') : ''); globalThis.__D = globalThis.__D || {}; globalThis.__D[k] = (globalThis.__D[k]||0)+1; }
  if (ui.dirtyOcc) refresh();
  for (const k of ['medical', 'device', 'service']) { const d = state.points[k] - pt0[k]; if (d > 0) pointGain[k] += d; }
  if (args.trace && state.history.length >= +args.trace && Math.round(state.time.clock) % 60 === 0 && state.time.week === 2) { const st = {}; for (const p of state.patients) { const k = p.stage + (p.stage==='waiting'?':'+(p.plan[p.planIdx]||'-'):''); st[k] = (st[k]||0)+1; } console.log(Math.round(state.time.clock/60)+'h', state.patients.length, JSON.stringify(st), 'staff', state.staff.map(s=>s.role[0]+s.state[0]+Math.round(s.stamina)).join(' ')); }
  if (state.history.length > mi) {
    const h = state.history[state.history.length - 1];
    const s = settle[settle.length - 1];
    monthRows.push({ y: h.year, m: h.month, income: h.income, nhiIncome: s.nhiIncome, selfIncome: s.selfIncome, expense: h.expense, net: h.net, opnet: s.income - s.salary - s.rent - s.maintain, margin: h.income ? h.net / h.income : 0, money: h.money, patients: h.patients, sat: Math.round(h.satisfaction), rep: h.reputation, pv: h.pointValue, pts: `${Math.round(pointGain.medical)}/${Math.round(pointGain.device)}/${Math.round(pointGain.service)}`.padEnd(11), staff: s.staff, objs: s.objs, lot: s.lot });
    printRow(monthRows[monthRows.length - 1]);
    pointGain = { medical: 0, device: 0, service: 0 };
    mi = state.history.length;
    for (const [id, v] of Object.entries(mTreat)) { T.cnt[id] = (T.cnt[id] || 0) + v.n; T.rev[id] = (T.rev[id] || 0) + v.rev; }
    mTreat = {};
  }
}
if (!QUIET) {
  console.log('treat totals id:count/avgRevNT$/rev per treatment-min');
  console.log(Object.keys(T.cnt).map(id => `${id}:${T.cnt[id]}/${Math.round(T.rev[id] / T.cnt[id])}/${(T.rev[id] / T.cnt[id] / TREATMENTS[id].duration).toFixed(0)}`).join('  '));
  console.log('events/dilemmas resolved', evCount);
  console.log('leave reasons', JSON.stringify(reasons), 'debug', JSON.stringify(P.debug));
  console.log('inspections', JSON.stringify((state.inspections.log||[]).map(x=>[x.year,x.pass,x.score,x.rewardOrFine]))); if (state.inspections.lastYearResult) console.log(state.inspections.lastYearResult.notes.join('\n'));
  console.log('research:', researchTimeline.join(' '));
  console.log('gameOver', gameOver, 'ms', Date.now() - t0, 'objs', state.objects.map(o => o.defId).join(','));
}
if (args.diag) { console.log('ANGRY', JSON.stringify(angryCtx)); const D = globalThis.__D||{}; console.log('DIAG patient-min by substage:', Object.entries(D).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(' ')); { const d = (globalThis.__R||{done:[]}).done.sort((a,b)=>a-b); console.log('REGWAIT n', d.length, 'mean', Math.round(d.reduce((a,b)=>a+b,0)/Math.max(1,d.length)), 'p50', d[d.length>>1], 'p90', d[Math.floor(d.length*0.9)]); }
console.log('STAFF', JSON.stringify(globalThis.__S));
console.log('stamina', state.staff.map(s=>s.role+Math.round(s.stamina)).join(' ')); }
const fin = monthRows;
const avg = (a, f) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0;
const y1 = fin.slice(9, 12), m34 = fin.slice(2, 4);
console.log(`SUMMARY ${POLICY} seed${seed0}: m1 net ${Math.round(((fin[0] || {}).net || 0) / 1000)}k | m3-4 margin ${(avg(m34, x => x.margin) * 100).toFixed(0)}% net ${Math.round(avg(m34, x => x.net) / 1000)}k | m10-12 net ${Math.round(avg(y1, x => x.opnet) / 1000)}k rep ${y1.length ? y1[y1.length - 1].rep : '-'} | final money ${Math.round(state.money / 1000)}k rep ${Math.round(state.reputation)} months ${fin.length}`);

// ---- event stats ----
{
  const weeks = (state.time.year - 1) * 48 + (state.time.month - 1) * 4 + state.time.week - 1;
  const dec = EVLOG.length, ev = EVLOG.filter(r => r.kind === 'event').length, dil = dec - ev;
  const byMonth = {}; let maxBig = 0;
  for (const r of EVLOG) if (r.big) { const k = r.y * 12 + r.m; byMonth[k] = (byMonth[k] || 0) + 1; maxBig = Math.max(maxBig, byMonth[k]); }
  const years = Math.ceil(fin.length / 12);
  const perYear = [];
  for (let y = 1; y <= years; y++) {
    const inc = fin.filter(r => r.y === y).reduce((a, r) => a + r.income, 0);
    const net = EVLOG.filter(r => r.y === y).reduce((a, r) => a + r.dm, 0);
    perYear.push(`Y${y}: ${Math.round(net / 1000)}k (${inc ? (net / inc * 100).toFixed(1) : '-'}% of income ${Math.round(inc / 1000)}k)`);
  }
  const gaps = []; for (let i = 1; i < EVLOG.length; i++) gaps.push(EVLOG[i].abs - EVLOG[i - 1].abs);
  const first = EVLOG.length ? EVLOG[0].abs : 0;
  console.log(`EVENTS ${POLICY}/${EVMODE}: ${dec} decisions in ${weeks}w (events ${ev}, dilemmas ${dil}) => 1 per ${(weeks / Math.max(1, dec)).toFixed(2)}w, max big/month ${maxBig}, first at week ${first}`);
  console.log('  net event money per year:', perYear.join(' | '));
  const ids = {}; for (const r of EVLOG) ids[r.id] = (ids[r.id] || 0) + 1;
  if (args.ids) console.log('  ids', JSON.stringify(ids));
  const early = fin.slice(0, 4).map(r => Math.round(r.net / 1000) + 'k').join(' ');
  console.log(`  morale: min ${Math.round(minMorale)} resigned ${nResign} | breakdowns ${nBroke} | final morale ${state.staff.map(q => q.role + Math.round(S.moraleOf(q))).join(' ')}`);
  console.log(`  maintenance: ${repairs} repairs + ${services} services = ${Math.round(maintSpent / 1000)}k over ${years}y`);
  console.log('  months1-4 net:', early, '| wearBroken', state.objects.filter(o => o.broken).length, 'staff', state.staff.length, 'risk', Math.round(state.nhi.risk || 0), 'review', state.reviewScore);
}

{ const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)]; console.log('UTIL', Object.entries(UT).map(([r, a]) => `${r}: avg ${(a.reduce((x, y) => x + y, 0) / a.length * 100).toFixed(0)}% p90 ${(q(a, 0.9) * 100).toFixed(0)}% max ${(Math.max(...a) * 100).toFixed(0)}%`).join(' | ')); }
