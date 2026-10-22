// Mood logic for the art-style faces (pure functions, no DOM; the only state is two tiny in-memory maps).
//
// STAFF  atlas: face.<role>.{normal,tired,happy}  roles doctor / nurse / pt / ot / st (pharmacist + tech exist in the atlas but are
//        not game roles, so they are not mapped here).
// PATIENT atlas: expr.<type>.{0..3} = four opaque tiles per patient type = FOUR distinct looks for FIVE keys.
//        VERIFIED BY EYE (each tile viewed at 4x, see tools/artui.mjs for the table pinned as a test):
//          type    tile0                    tile1                    tile2                    tile3
//          elder   flat mouth, blue sweat   neutral dot mouth        eyes shut, content smile open-mouth laugh, red sparks
//          office  red anger swirl + drop   neutral, blue notes      mild smile + "?"         open smile
//          kid     big grin, orange sparks  small smile, blue marks  CRYING (tears)           open-mouth happy
//          sports  tiny smile, plain        flat mouth, blue sweat   smile + blue sweat drop  big grin, red sparks
//        => tier 0 (angry / in pain), 1 (neutral), 2 (content), 3 (delighted):
//          elder  [0,1,2,3]   office [0,1,2,3]   kid [2,1,0,3]   sports [1,0,2,3]
//        (the earlier guess elder/kid [2,0,1,3] was wrong: elder tile2 is the content face, kid tile0 is the content grin.)
//        'angry' and 'pain' share the tier-0 tile (the sheet has only one unhappy look per character); they differ in the label.

export const STAFF_FACE_ROLES = ['doctor', 'nurse', 'pt', 'ot', 'st'];
export const STAFF_MOODS = ['normal', 'tired', 'happy'];

export const MOOD_TH = {
  TIRED_STAMINA: 0.30,       // stamina / staminaMax below this -> tired
  TIRED_MORALE: 35,          // morale below this -> tired
  HAPPY_MORALE: 75,          // morale at/above this (and stamina >= HAPPY_STAMINA, not on a heavy task) -> happy
  HAPPY_STAMINA: 0.5,
  HEAVY_STAMINA: 0.65,       // 'heavy task' = working while stamina is under this share
  GLOW_SAT: 65,              // a treated patient this satisfied makes the therapist happy ...
  GLOW_MIN: 20,              // ... for this many game minutes
  HOLD_MIN: 10,              // hysteresis: a mood is kept this long before it may change (tired always wins at once)
  SLIP_MIN: 30,              // a patient slip counts as 'recent' (pain face) for this many game minutes
};

// monotonic game clock in minutes (state.time.clock itself restarts every week)
export function gameMinutes(state) {
  const t = (state && state.time) || {};
  const w = (((t.year || 1) - 1) * 12 + ((t.month || 1) - 1)) * 4 + ((t.week || 1) - 1);
  return w * 2000 + (t.clock || 0);
}

const mem = new Map();        // staffId -> {mood, since}
const glow = new Map();       // staffId -> game minute until which a satisfied patient keeps them happy
const slips = new Map();      // patientId -> game minute of the last slip
export function resetMoods() { mem.clear(); glow.clear(); slips.clear(); }

export function noteTreatment(staffId, patientSat, now) { if (staffId != null && patientSat >= MOOD_TH.GLOW_SAT) glow.set(staffId, now + MOOD_TH.GLOW_MIN); }
export function noteSlip(patientId, now) { if (patientId != null) slips.set(patientId, now); }

// Subscribe once (bus + a () => state getter); keeps the maps small.
let hooked = false;
export function initMoods(bus, getState) {
  if (hooked) return;
  hooked = true;
  bus.on('treatment:done', p => { try { const st = getState(); if (p && p.patient) noteTreatment(p.staffId, p.patient.satisfaction, gameMinutes(st)); } catch (e) { /* ignore */ } });
  bus.on('patient:slip', p => { try { if (p && p.patient) noteSlip(p.patient.id, gameMinutes(getState())); } catch (e) { /* ignore */ } });
  bus.on('state:loaded', () => resetMoods());
  bus.on('staff:resigned', p => { if (p) { mem.delete(p.id); glow.delete(p.id); } });
}

function rawStaffMood(s, now) {
  const max = s.staminaMax || 100;
  const ratio = typeof s.stamina === 'number' ? s.stamina / max : 1;
  const morale = typeof s.morale === 'number' ? s.morale : 70;
  if (ratio < MOOD_TH.TIRED_STAMINA || morale < MOOD_TH.TIRED_MORALE || s.tired || s.wantRest) return 'tired';
  const heavy = s.state === 'working' && ratio < MOOD_TH.HEAVY_STAMINA;
  if (morale >= MOOD_TH.HAPPY_MORALE && ratio >= MOOD_TH.HAPPY_STAMINA && !heavy) return 'happy';
  if ((glow.get(s.id) || 0) > now && ratio >= MOOD_TH.TIRED_STAMINA) return 'happy';
  return 'normal';
}

// staffMood(staff, now) -> 'normal' | 'tired' | 'happy'.  `now` = gameMinutes(state) (omit in unit tests: then no hysteresis clock, 0).
// With hysteresis: after a change the mood holds HOLD_MIN game minutes unless the new mood is 'tired'.
export function staffMood(s, now = 0) {
  if (!s) return 'normal';
  const raw = rawStaffMood(s, now);
  const m = mem.get(s.id);
  if (!m) { mem.set(s.id, { mood: raw, since: now }); return raw; }
  if (raw === m.mood) return m.mood;
  const age = now - m.since;
  if (raw === 'tired' || age >= MOOD_TH.HOLD_MIN || age < 0) { m.mood = raw; m.since = now; return raw; }
  return m.mood;
}

export function staffFaceName(role, mood) {
  if (!STAFF_FACE_ROLES.includes(role)) return null;
  return `face.${role}.${STAFF_MOODS.includes(mood) ? mood : 'normal'}`;
}

// Plain-Chinese hint beside the morale bar.
export function staffMoodHint(s, mood) {
  if (!s) return '';
  const max = s.staminaMax || 100;
  const lowStam = typeof s.stamina === 'number' && s.stamina / max < MOOD_TH.TIRED_STAMINA;
  const morale = typeof s.morale === 'number' ? s.morale : 70;
  if (mood === 'tired') return lowStam || s.tired || s.wantRest ? '看起來很累' : morale < 25 ? '想離職' : '心情低落';
  if (mood === 'happy') return '心情不錯';
  return '狀態平穩';
}

// ----------------------------------------------------------------------------------------------------------- patients
export const PATIENT_TILE_ORDER = { elder: [0, 1, 2, 3], office: [0, 1, 2, 3], kid: [2, 1, 0, 3], sports: [1, 0, 2, 3] };
export const PATIENT_MOOD_LABELS = { angry: '焦躁', pain: '痛', neutral: '普通', content: '滿意', delighted: '超開心' };
const KEY_OF_TIER = ['angry', 'neutral', 'content', 'delighted'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// patientExprIndex(type, tier) -> the expr.<type>.<n> index for a mood tier 0..3 (null for an unknown type)
export function patientExprIndex(type, tier) {
  const o = PATIENT_TILE_ORDER[type];
  return o ? o[clamp(tier | 0, 0, 3)] : null;
}
export function patientExprName(type, tier) {
  const i = patientExprIndex(type, tier);
  return i == null ? null : `expr.${type}.${i}`;
}

// patientMood(p, now, cureNeeded) -> {tier 0..3, key, reason}. Uses satisfaction first, then patience, wait time, recent slip, recovery and stage.
export function patientMood(p, now = 0, cureNeeded = 0) {
  if (!p) return { tier: 1, key: 'neutral', reason: '' };
  const sat = typeof p.satisfaction === 'number' ? p.satisfaction : 60;
  const pmax = p.patienceMax || 100;
  const pat = typeof p.patience === 'number' ? p.patience / pmax : 1;
  const waited = p.waitedMin || 0;
  const flags = p.flags || {};
  // leaving: the outcome decides
  if (p.stage === 'leaving' || p.stage === 'gone') {
    if (p.reason === 'angry') return { tier: 0, key: 'angry', reason: '等太久，氣呼呼地離開' };
    if (p.cured) return { tier: 3, key: 'delighted', reason: '康復了，開心離院' };
    if (sat >= 78) return { tier: 3, key: 'delighted', reason: '很滿意，開心離院' };
  }
  // pain: a fresh slip (or any slip while already unhappy)
  const slipAt = slips.get(p.id);
  const recentSlip = slipAt != null && now - slipAt >= 0 && now - slipAt < MOOD_TH.SLIP_MIN;
  if (recentSlip || (flags.slipped && sat < 45)) return { tier: 0, key: 'pain', reason: '剛剛滑倒，很痛' };
  // impatience / anger
  if (pat < 0.18) return { tier: 0, key: 'angry', reason: '快沒耐心了' };
  // effective satisfaction: waiting long drags it down, being treated lifts it a little
  let eff = sat;
  if (waited > 90) eff -= 15; else if (waited > 45) eff -= 8;
  if (flags.slipped) eff -= 5;
  if (p.stage === 'treating') eff += 4;
  let tier = eff < 30 ? 0 : eff < 55 ? 1 : eff < 78 ? 2 : 3;
  let reason = ['很不滿意', '心情普通', '還算滿意', '非常滿意'][tier];
  if (pat < 0.35 && tier > 1) { tier = 1; reason = '等得有點不耐煩'; }
  // low recovery while hurting: the pain face instead of the angry one
  const need = cureNeeded || p.cureNeeded || 0;
  if (tier === 0 && need > 0 && (p.hp || 0) / need < 0.25 && pat >= 0.35) return { tier: 0, key: 'pain', reason: '病痛還沒緩解' };
  if (tier === 0 && waited > 45) reason = '等太久了';
  return { tier, key: KEY_OF_TIER[tier], reason };
}

// ------------------------------------------------------------------------------- event / report outcome -> doctor face
// effects: the raw effects object of the chosen option (may be null); chips: [{text, good}] summary actually applied.
export function outcomeMood(effects, chips) {
  let good = 0, bad = 0;
  for (const c of chips || []) { if (c && c.good) good++; else if (c) bad++; }
  const fx = effects || {};
  let score = good - bad;
  const num = k => (typeof fx[k] === 'number' ? fx[k] : 0);
  if (!chips || !chips.length) {
    score += Math.sign(num('money')) + Math.sign(num('reputation')) + Math.sign(num('sat'));
  }
  // a clear drop in money / reputation / satisfaction outweighs small perks
  if (num('money') <= -100000 || num('reputation') <= -3 || num('sat') <= -6) score = Math.min(score, -1);
  return score > 0 ? 'happy' : score < 0 ? 'tired' : 'normal';
}
export function netMood(net) { return net > 0 ? 'happy' : net < 0 ? 'tired' : 'normal'; }
export function doctorFace(mood) { return staffFaceName('doctor', mood); }
