// Achievements (docs/ACHIEVEMENTS.md). Data lives in data/achievements.js; this module owns the unlock logic.
//
// Public API (names are a contract with the UI / renderer):
//   initAchievements() · evaluate(state, trigger, payload?) -> ids[] · evaluateAll(state) -> ids[]
//   listAchievements(state) -> [{def, unlocked, at, progress, goal, masked}] · progressOf(state, def) -> {progress, goal}
//   equipTitle(state, id|null) -> bool · setBadges(state, ids) -> bool
//   displayTitle(state) -> '〔特殊稱號〕聲譽稱號' (or just the reputation title) · specialTitle(state) -> bare equipped title text|''
//   badgeIcons(state) -> string[] (<= 4: auto milestone icon first, then the player's picked badges)
//   unlockedCount(state) · totalCount() · isUnlocked(state, id)
// Bus events emitted: 'toast', 'achievement:unlocked' {id}, 'achv:changed' {} (title / badges changed or something unlocked).
//
// ---- Interpretation table (ambiguous conditions -> what is implemented) ----
// Monthly/yearly "streak-like" counters only count when tracking covered the WHOLE period (counters.trackMonth /
// trackYear = index of the first fully-tracked month / year; null for periods that were already running when an old save was
// migrated), so a mid-period migration can never grant c_no_angry_month / c_zero_slip_year / c_pure_nhi for free.
// served (per week)     = unique patients that got >= 1 treatment:done in that week (counters.weekSeen).
// served (month / year) = patient:left with patient.treated > 0.
// angry leaver          = patient:left with reason 'angry' (patience ran out) or final satisfaction < 25.
// m_first_month         = history has >= 1 monthly settlement (checked on nhi:settled).
// m_pat_* / m_cured_*   = state.stats.patientsTotal / state.stats.cured (never reset by the economy).
// m_year3               = time.year >= 4.
// t_cold_week           = at week:end the week's weather.kind == 'cold' and elderThisWeek (type 'elder') >= 15.
// t_rain_safe           = week:end, weather.kind == 'rain' (rain + plumrain), served >= 12, slipThisWeek == 0.
// t_typhoon             = week:end, weather.kind == 'typhoon', served >= 5.
// t_temple / t_community_all = communityDone[id] counts startCommunity() successes (event 'community:started'); all 7 COMMUNITY ids.
// t_audit               = first inspection:result with pass.  t_audit_excellent = pass and score >= EXCELLENT_SCORE.
// t_audit_3             = auditPassStreak >= 3 (a failed inspection resets it).
// t_dilemma_*           = dilemma:resolved with kind 'dilemma' and trigger in painkiller/skip_doctor/overtreat/complain.
// t_selfpay_40          = at nhi:settled: selfIncome / (nhiIncome + selfIncome) >= 0.4 (the 'other' ledger is excluded, so achievement
//                         rewards / event money cannot distort it), needs nhiIncome + selfIncome > 0.
// t_board_3             = policy.boards.length >= 3.
// c_zone_*              = state.zones contains the synergy id (zones are recomputed by build.js before map:changed fires).
// c_zero_slip_year      = at year:end: fully tracked year, slipThisYear == 0 and servedThisYear >= 200.
// c_no_angry_month      = at nhi:settled: fully tracked month, angryThisMonth == 0 and servedThisMonth >= 20.
// c_full_house          = lot level >= 1 AND unique patients served this week >= ceil(0.9 * lot.maxPatientsPerWeek) (checked live, mid-week).
//                         (the starter lot's cap of 22 is reached too easily, so it needs the first expansion)
// c_pure_nhi            = at year:end of year 1: tracked since day 1, no self-pay ever, money >= counters.startMoney (money at the first
//                         event of the game = START_MONEY minus the starter-clinic charge).
// c_one_week_cure       = curedThisWeek (patient:left with cured) >= 10, checked live.
// h_coffee / h_plants   = count of 'coffee' >= 3 / 'plant' >= 10 objects currently placed.
// h_chat                = 50 completed patient:chat events with an 'elder' patient.
// h_comeback            = lowestMoneySeen < 50,000 (sampled at every event; seeded from history on load) and money >= 1,000,000.
// Rewards: ACHIEVEMENT_TIERS[tier] (+ def.reward.money / rep / points overrides); points go to def.reward.pointKey (tier 3 always
// 'service', default 'service'). If more than 5 unlock in one evaluateAll() a single summary toast replaces the individual ones.
import { bus } from '../core/bus.js';
import { state as singleton } from '../core/state.js';
import { ROLES, START_MONEY, POINT_KEYS } from '../core/constants.js';
import { earn, lotDef } from './economy.js';
import { EXCELLENT_SCORE } from './inspection.js';
import { ACHIEVEMENTS, ACHIEVEMENT_TIERS, BADGE_MILESTONES, MAX_BADGES } from '../data/achievements.js';
import { RESEARCH } from '../data/research.js';
import { COMMUNITY } from '../data/events.js';
import { TITLES } from '../data/texts.js';

export const SUMMARY_TOAST_THRESHOLD = 5;
export const DILEMMA_KINDS = ['painkiller', 'skip_doctor', 'overtreat', 'complain'];
const MAX_ICONS = 4;

const DEFS = new Map(ACHIEVEMENTS.map(d => [d.id, d]));
const monthIdx = (y, m) => y * 12 + (m - 1);

// ---------------- state ----------------
function freshCounters() {
  return {
    totalSelfPayMonth: 0, dilemmasDone: { painkiller: 0, skip_doctor: 0, overtreat: 0, complain: 0 }, communityDone: {}, auditPassStreak: 0, chatCount: 0,
    slipThisYear: 0, angryThisMonth: 0, servedThisMonth: 0, servedThisYear: 0,
    servedThisWeek: 0, curedThisWeek: 0, elderThisWeek: 0, slipThisWeek: 0, weekSeen: [],
    selfPayEver: false,
  };
}

// Makes sure state.achv exists with every field; safe to call any time.
export function ensure(state) {
  if (!state.achv || typeof state.achv !== 'object') state.achv = { unlocked: {}, counters: {}, title: null, badges: [] };
  const a = state.achv;
  if (!a.unlocked || typeof a.unlocked !== 'object') a.unlocked = {};
  if (!a.counters || typeof a.counters !== 'object') a.counters = {};
  if (!Array.isArray(a.badges)) a.badges = [];
  if (a.title === undefined) a.title = null;
  const c = a.counters, f = freshCounters();
  for (const k of Object.keys(f)) if (c[k] === undefined) c[k] = f[k];
  if (!c.dilemmasDone || typeof c.dilemmasDone !== 'object') c.dilemmasDone = {};
  for (const k of DILEMMA_KINDS) if (typeof c.dilemmasDone[k] !== 'number') c.dilemmasDone[k] = 0;
  if (!c.communityDone || typeof c.communityDone !== 'object') c.communityDone = {};
  if (!Array.isArray(c.weekSeen)) c.weekSeen = [];
  const t = state.time || { year: 1, month: 1, week: 1, clock: 480 };
  const periodStart = t.week === 1 && t.clock <= 481;   // right at the first tick of a week 1
  if (c.trackMonth === undefined) c.trackMonth = periodStart ? monthIdx(t.year, t.month) : null;
  if (c.trackYear === undefined) c.trackYear = periodStart && t.month === 1 ? t.year : null;
  if (typeof c.lowestMoneySeen !== 'number') {
    let low = state.money;
    for (const h of state.history || []) if (h && typeof h.money === 'number' && h.money < low) low = h.money;
    c.lowestMoneySeen = low;
  }
  if (c.selfPayEver === false && c.trackYear !== 1 && (state.ledger && state.ledger.income.self > 0)) c.selfPayEver = true;
  return a;
}

export function isUnlocked(state, id) { return !!(state.achv && state.achv.unlocked && state.achv.unlocked[id]); }
export function unlockedCount(state) { let n = 0; for (const d of ACHIEVEMENTS) if (isUnlocked(state, d.id)) n++; return n; }
export function totalCount() { return ACHIEVEMENTS.length; }

// ---------------- helpers for checks ----------------
const count = (state, defId) => (state.objects || []).reduce((n, o) => n + (o.defId === defId ? 1 : 0), 0);
const roleSet = (state) => new Set((state.staff || []).map(s => s.role));
const zoneOn = (state, id) => (state.zones || []).some(z => z.id === id);
const communityKinds = (state) => {
  const done = state.achv.counters.communityDone || {};
  return (COMMUNITY || []).filter(c => (done[c.id] || 0) > 0).length;
};
const dilemmaKinds = (state) => DILEMMA_KINDS.filter(k => (state.achv.counters.dilemmasDone[k] || 0) > 0).length;
const dilemmaTotal = (state) => DILEMMA_KINDS.reduce((s, k) => s + (state.achv.counters.dilemmasDone[k] || 0), 0);
const fullHouseNeed = (state) => Math.ceil(0.9 * ((lotDef(state).maxPatientsPerWeek) || 20));
const researchTotal = () => Object.keys(RESEARCH).length;
const cnt = (state) => state.achv.counters;

// Event groups
const STATE_EVENTS = ['load', 'week:end'];

// id -> { on: [triggers], check(state, ctx) -> bool, prog?(state) -> [value, goal] }
const R = {
  m_first_month: { on: ['nhi:settled', 'load'], check: (s) => (s.history || []).length >= 1 },
  m_cash_2m: { on: [...STATE_EVENTS, 'nhi:settled'], check: (s) => s.money >= 2000000 },
  m_cash_10m: { on: [...STATE_EVENTS, 'nhi:settled'], check: (s) => s.money >= 10000000 },
  m_pat_100: { on: [...STATE_EVENTS, 'patient:left'], check: (s) => s.stats.patientsTotal >= 100 },
  m_pat_1000: { on: [...STATE_EVENTS, 'patient:left'], check: (s) => s.stats.patientsTotal >= 1000 },
  m_pat_5000: { on: [...STATE_EVENTS, 'patient:left'], check: (s) => s.stats.patientsTotal >= 5000 },
  m_cured_100: { on: [...STATE_EVENTS, 'patient:left'], check: (s) => s.stats.cured >= 100 },
  m_rep_100: { on: [...STATE_EVENTS, 'patient:left', 'inspection:result'], check: (s) => s.reputation >= 100 },
  m_rep_250: { on: [...STATE_EVENTS, 'patient:left', 'inspection:result'], check: (s) => s.reputation >= 250 },
  m_rep_600: { on: [...STATE_EVENTS, 'patient:left', 'inspection:result'], check: (s) => s.reputation >= 600 },
  m_lot1: { on: ['load', 'lot:expanded'], check: (s) => s.lotLevel >= 1 },
  m_lot2: { on: ['load', 'lot:expanded'], check: (s) => s.lotLevel >= 2 },
  m_lot3: { on: ['load', 'lot:expanded'], check: (s) => s.lotLevel >= 3 },
  m_year3: { on: ['load', 'year:start', 'week:end'], check: (s) => s.time.year >= 4, prog: (s) => [Math.min(3, s.time.year - 1), 3] },
  m_five_roles: { on: [...STATE_EVENTS], check: (s) => { const r = roleSet(s); return ROLES.every(x => r.has(x)); },
    prog: (s) => { const r = roleSet(s); return [ROLES.filter(x => r.has(x)).length, ROLES.length]; } },
  m_research_all: { on: ['load', 'research:done', 'week:end'], check: (s) => (s.research.done || []).length >= researchTotal() && researchTotal() > 0 },

  t_cold_week: { on: ['week:end'], check: (s) => s.weather.kind === 'cold' && cnt(s).elderThisWeek >= 15 },
  t_rain_safe: { on: ['week:end'], check: (s) => s.weather.kind === 'rain' && cnt(s).servedThisWeek >= 12 && cnt(s).slipThisWeek === 0 },
  t_typhoon: { on: ['week:end'], check: (s) => s.weather.kind === 'typhoon' && cnt(s).servedThisWeek >= 5 },
  t_temple: { on: ['community:started'], check: (s) => (cnt(s).communityDone.temple_sarcopenia || 0) > 0 },
  t_community_all: { on: ['community:started', 'load'], check: (s) => (COMMUNITY || []).length > 0 && communityKinds(s) >= COMMUNITY.length },
  t_audit: { on: ['inspection:result'], check: (s, p) => !!(p ? p.pass : (s.inspections.lastYearResult && s.inspections.lastYearResult.pass)) },
  t_audit_excellent: { on: ['inspection:result'], check: (s, p) => { const r = p || s.inspections.lastYearResult; return !!(r && r.pass && r.score >= EXCELLENT_SCORE); } },
  t_audit_3: { on: ['inspection:result', 'load'], check: (s) => cnt(s).auditPassStreak >= 3, prog: (s) => [Math.min(3, cnt(s).auditPassStreak), 3] },
  t_dilemma_5: { on: ['dilemma:resolved'], check: (s) => dilemmaTotal(s) >= 5 },
  t_dilemma_all: { on: ['dilemma:resolved'], check: (s) => dilemmaKinds(s) >= DILEMMA_KINDS.length, prog: (s) => [dilemmaKinds(s), DILEMMA_KINDS.length] },
  t_selfpay_40: { on: ['nhi:settled'], check: (s, p) => {
    if (!p) return false;
    const self = Number(p.selfIncome) || 0, tot = (Number(p.nhiIncome) || 0) + self;
    return tot > 0 && self / tot >= 0.4;
  } },
  t_board_3: { on: ['mods:dirty', 'load', 'week:end'], check: (s) => (s.policy.boards || []).length >= 3, prog: (s) => [Math.min(3, (s.policy.boards || []).length), 3] },

  c_zone_golden: { on: ['map:changed', 'load', 'week:end'], check: (s) => zoneOn(s, 'golden3') },
  c_zone_premium: { on: ['map:changed', 'load', 'week:end'], check: (s) => zoneOn(s, 'premium') },
  c_zone_kidpark: { on: ['map:changed', 'load', 'week:end'], check: (s) => zoneOn(s, 'kidpark') },
  c_zone_all: { on: ['map:changed', 'load', 'week:end'], check: (s) => zoneOn(s, 'golden3') && zoneOn(s, 'premium') && zoneOn(s, 'kidpark'),
    prog: (s) => [['golden3', 'premium', 'kidpark'].filter(z => zoneOn(s, z)).length, 3] },
  c_zero_slip_year: { on: ['year:end'], check: (s, p) => {
    const y = p && p.year != null ? p.year : s.time.year;
    return cnt(s).trackYear === y && cnt(s).slipThisYear === 0 && cnt(s).servedThisYear >= 200;
  } },
  c_no_angry_month: { on: ['nhi:settled'], check: (s, p) => {
    if (!p) return false;
    return cnt(s).trackMonth === monthIdx(p.year, p.month) && cnt(s).angryThisMonth === 0 && cnt(s).servedThisMonth >= 20;
  } },
  c_full_house: { on: ['treatment:done', 'week:end'], check: (s) => (s.lotLevel || 0) >= 1 && cnt(s).servedThisWeek >= fullHouseNeed(s), prog: (s) => [Math.min(cnt(s).servedThisWeek, fullHouseNeed(s)), fullHouseNeed(s)] },
  c_pure_nhi: { on: ['year:end'], check: (s, p) => {
    const y = p && p.year != null ? p.year : s.time.year;
    const c = cnt(s), start = typeof c.startMoney === 'number' ? c.startMoney : START_MONEY;
    return y === 1 && c.trackYear === 1 && !c.selfPayEver && s.money >= start;
  } },
  c_one_week_cure: { on: ['patient:left'], check: (s) => cnt(s).curedThisWeek >= 10, prog: (s) => [Math.min(10, cnt(s).curedThisWeek), 10] },
  h_coffee: { on: ['map:changed', 'load', 'week:end'], check: (s) => count(s, 'coffee') >= 3, prog: (s) => [Math.min(3, count(s, 'coffee')), 3] },
  h_chat: { on: ['patient:chat'], check: (s) => cnt(s).chatCount >= 50 },
  h_comeback: { on: [...STATE_EVENTS, 'nhi:settled'], check: (s) => cnt(s).lowestMoneySeen < 50000 && s.money >= 1000000 },
  h_plants: { on: ['map:changed', 'load', 'week:end'], check: (s) => count(s, 'plant') >= 10, prog: (s) => [Math.min(10, count(s, 'plant')), 10] },
};

// trigger -> [id]
const BY_TRIGGER = new Map();
for (const [id, r] of Object.entries(R)) for (const t of r.on) { if (!BY_TRIGGER.has(t)) BY_TRIGGER.set(t, []); BY_TRIGGER.get(t).push(id); }

// ---------------- progress ----------------
const METRICS = {
  patientsTotal: (s) => s.stats.patientsTotal,
  cured: (s) => s.stats.cured,
  money: (s) => s.money,
  reputation: (s) => s.reputation,
  researchDone: (s) => (s.research.done || []).length,
  chatCount: (s) => cnt(s).chatCount,
  communityKinds: communityKinds,
  dilemmasDone: dilemmaTotal,
};

export function progressOf(state, def) {
  ensure(state);
  if (!def) return { progress: 0, goal: 0 };
  let v = 0, g = 0;
  try {
    if (def.metric && METRICS[def.metric] && Number(def.goal) > 0) { v = METRICS[def.metric](state); g = def.goal; }
    else if (R[def.id] && R[def.id].prog) { [v, g] = R[def.id].prog(state); }
  } catch (e) { v = 0; g = 0; }
  if (isUnlocked(state, def.id) && g > 0) v = g;
  v = Math.max(0, Math.min(g, Number.isFinite(v) ? v : 0));
  return { progress: v, goal: g };
}

// ---------------- unlock ----------------
function rewardOf(def) {
  const tier = ACHIEVEMENT_TIERS[def.tier] || ACHIEVEMENT_TIERS[1] || { money: 0, rep: 0, points: 0 };
  const ov = def.reward || {};
  const money = typeof ov.money === 'number' ? ov.money : (tier.money || 0);
  const rep = typeof ov.rep === 'number' ? ov.rep : (tier.rep || 0);
  const points = {};
  if (ov.points && typeof ov.points === 'object') {
    for (const k of POINT_KEYS) if (Number(ov.points[k]) > 0) points[k] = Number(ov.points[k]);
  } else {
    const key = def.tier === 3 ? 'service' : (POINT_KEYS.includes(ov.pointKey) ? ov.pointKey : 'service');
    const amt = typeof ov.points === 'number' ? ov.points : (tier.points || 0);
    if (amt > 0) points[key] = amt;
  }
  return { money, rep, points };
}
export function rewardFor(def) { return rewardOf(def); }

function unlock(state, def, collector) {
  const a = ensure(state);
  if (a.unlocked[def.id]) return false;
  a.unlocked[def.id] = { year: state.time.year, month: state.time.month, week: state.time.week };
  const r = rewardOf(def);
  if (r.money > 0) earn(state, r.money, 'other');
  for (const k of Object.keys(r.points)) state.points[k] = (state.points[k] || 0) + r.points[k];
  if (r.rep) state.reputation = Math.max(0, Math.min(1000, state.reputation + r.rep));
  if (collector) collector.push(def);
  else bus.emit('toast', { text: `🏆 成就解鎖：${def.name}`, kind: 'good' });
  bus.emit('achievement:unlocked', { id: def.id });
  bus.emit('achv:changed', {});
  return true;
}

function runChecks(state, ids, payload, collector) {
  const out = [];
  for (const id of ids) {
    const def = DEFS.get(id);
    if (!def || isUnlocked(state, id)) continue;
    let ok = false;
    try { ok = !!R[id].check(state, payload); } catch (e) { console.warn('[achv] check failed', id, e); }
    if (ok && unlock(state, def, collector)) out.push(id);
  }
  return out;
}

// Check the achievements related to one trigger (a bus event name, 'load' or 'week:end'). `payload` is the event payload.
export function evaluate(state, trigger, payload) {
  if (trigger && typeof trigger === 'object') { payload = trigger; trigger = trigger.event || trigger.type; }
  ensure(state);
  const ids = BY_TRIGGER.get(trigger);
  return ids ? runChecks(state, ids, payload, null) : [];
}

// After load: every state-derivable achievement. Pays normally; > SUMMARY_TOAST_THRESHOLD unlocks -> one summary toast.
export function evaluateAll(state) {
  const a = ensure(state);
  trackMoney(state);
  const got = [];
  const ids = Object.keys(R).filter(id => R[id].on.includes('load'));
  runChecks(state, ids, undefined, got);
  if (got.length > SUMMARY_TOAST_THRESHOLD) {
    bus.emit('toast', { text: `🏆 補算成就：一次解鎖 ${got.length} 項（${got.slice(0, 3).map(d => d.name).join('、')}…）`, kind: 'good' });
  } else {
    for (const d of got) bus.emit('toast', { text: `🏆 成就解鎖：${d.name}`, kind: 'good' });
  }
  return got.map(d => d.id);
}

// ---------------- list / equip ----------------
export function listAchievements(state) {
  ensure(state);
  return ACHIEVEMENTS.map(def => {
    const unlocked = isUnlocked(state, def.id);
    const at = unlocked ? { ...state.achv.unlocked[def.id] } : null;
    if (def.hidden && !unlocked) {
      const masked = { id: def.id, name: '？？？', desc: def.hint || '？？？', hint: def.hint || '', cat: def.cat, tier: def.tier, hidden: true, badge: '❔', reward: def.reward };
      return { def: masked, unlocked: false, at: null, progress: 0, goal: 0, masked: true };
    }
    const { progress, goal } = progressOf(state, def);
    return { def, unlocked, at, progress, goal, masked: false };
  });
}

export function equipTitle(state, id) {
  ensure(state);
  if (id == null || id === '') { state.achv.title = null; bus.emit('achv:changed', {}); return true; }
  const def = DEFS.get(id);
  if (!def || !def.title || !isUnlocked(state, id)) return false;
  state.achv.title = id;
  bus.emit('achv:changed', {});
  return true;
}

export function setBadges(state, ids) {
  ensure(state);
  if (!Array.isArray(ids) || ids.length > MAX_BADGES) return false;
  if (new Set(ids).size !== ids.length) return false;
  for (const id of ids) { const d = DEFS.get(id); if (!d || !d.badge || !isUnlocked(state, id)) return false; }
  state.achv.badges = [...ids];
  bus.emit('achv:changed', {});
  return true;
}

export function specialTitle(state) {
  const a = state.achv;
  if (!a || !a.title) return '';
  const d = DEFS.get(a.title);
  return d && d.title && isUnlocked(state, d.id) ? d.title : '';
}

export function reputationTitle(state) {
  let t = (TITLES && TITLES[0] && TITLES[0].title) || '';
  for (const x of TITLES || []) if (state.reputation >= x.minRep) t = x.title;
  return t;
}

export function displayTitle(state) {
  const sp = specialTitle(state), rt = reputationTitle(state);
  return sp ? `〔${sp}〕${rt}` : rt;
}

export function milestoneIcon(state) {
  const n = unlockedCount(state);
  let icon = null;
  for (const m of BADGE_MILESTONES) {
    const need = m.count === 'all' ? ACHIEVEMENTS.length : m.count;
    if (n >= need) icon = m.icon;
  }
  return icon;
}

export function badgeIcons(state) {
  ensure(state);
  const out = [];
  const m = milestoneIcon(state);
  if (m) out.push(m);
  for (const id of state.achv.badges) {
    const d = DEFS.get(id);
    if (d && d.badge && isUnlocked(state, id) && out.length < MAX_ICONS) out.push(d.badge);
  }
  return out;
}

// ---------------- event wiring ----------------
function trackMoney(state) {
  const c = ensure(state).counters;
  if (state.money < c.lowestMoneySeen) c.lowestMoneySeen = state.money;
}

// starting money for c_pure_nhi = money seen at the first event of a fully-tracked first year (after the starter clinic was bought)
function noteStart(state) {
  const c = state.achv.counters;
  if (c.trackYear === 1 && typeof c.startMoney !== 'number') c.startMoney = Math.min(START_MONEY, state.money);
}

let unsub = [];
export function initAchievements() {
  unsub.forEach(f => f());
  const S = () => singleton;
  const on = (evt, fn) => bus.on(evt, (p) => {
    const st = S();
    try { ensure(st); trackMoney(st); noteStart(st); fn(st, p || {}); evaluate(st, evt, p); } catch (e) { console.warn('[achv]', evt, e); }
  });
  unsub = [
    on('treatment:done', (s, p) => {
      const c = cnt(s), pat = p.patient;
      if (p.selfPay > 0) { c.totalSelfPayMonth += p.selfPay; c.selfPayEver = true; }
      if (pat && !c.weekSeen.includes(pat.id)) {
        c.weekSeen.push(pat.id); c.servedThisWeek++;
        if (pat.type === 'elder') c.elderThisWeek++;
      }
    }),
    on('patient:left', (s, p) => {
      const c = cnt(s), pat = p.patient || {};
      if ((pat.treated || 0) > 0) { c.servedThisMonth++; c.servedThisYear++; }
      if (p.reason === 'angry' || p.satisfaction < 25) c.angryThisMonth++;
      if (p.cured) c.curedThisWeek++;
    }),
    on('patient:slip', (s) => { cnt(s).slipThisWeek++; cnt(s).slipThisYear++; }),
    on('patient:chat', (s, p) => { if (p.patient && p.patient.type === 'elder') cnt(s).chatCount++; }),
    on('dilemma:resolved', (s, p) => {
      if (p.kind === 'dilemma' && DILEMMA_KINDS.includes(p.trigger)) cnt(s).dilemmasDone[p.trigger] = (cnt(s).dilemmasDone[p.trigger] || 0) + 1;
    }),
    on('community:started', (s, p) => { if (p.id) cnt(s).communityDone[p.id] = (cnt(s).communityDone[p.id] || 0) + 1; }),
    on('inspection:result', (s, p) => { cnt(s).auditPassStreak = p.pass ? cnt(s).auditPassStreak + 1 : 0; }),
    on('lot:expanded', () => {}),
    on('research:done', () => {}),
    on('map:changed', () => {}),
    on('mods:dirty', () => {}),
    on('year:start', () => {}),
    // week:end: weather achievements read this week's counters, then they reset
    bus.on('week:end', () => {
      const s = S();
      try {
        ensure(s); trackMoney(s);
        evaluate(s, 'week:end');
        const c = cnt(s);
        c.servedThisWeek = 0; c.curedThisWeek = 0; c.elderThisWeek = 0; c.slipThisWeek = 0; c.weekSeen = [];
      } catch (e) { console.warn('[achv] week:end', e); }
    }),
    // economy's own month:end handler (registered earlier) has already settled and emitted nhi:settled for this month
    bus.on('nhi:settled', (rec) => {
      const s = S();
      try {
        ensure(s); trackMoney(s);
        evaluate(s, 'nhi:settled', rec);
        const c = cnt(s);
        const y = rec && rec.year != null ? rec.year : s.time.year, m = rec && rec.month != null ? rec.month : s.time.month;
        c.angryThisMonth = 0; c.servedThisMonth = 0; c.totalSelfPayMonth = 0;
        c.trackMonth = monthIdx(y, m) + 1;
      } catch (e) { console.warn('[achv] nhi:settled', e); }
    }),
    bus.on('year:end', (p) => {
      const s = S();
      try {
        ensure(s); trackMoney(s);
        evaluate(s, 'year:end', p);
        const c = cnt(s);
        c.slipThisYear = 0; c.servedThisYear = 0;
        c.trackYear = (p && p.year != null ? p.year : s.time.year) + 1;
      } catch (e) { console.warn('[achv] year:end', e); }
    }),
    bus.on('state:loaded', () => {
      const s = S();
      try { ensure(s); evaluateAll(s); } catch (e) { console.warn('[achv] load', e); }
    }),
  ];
  ensure(singleton);
}
