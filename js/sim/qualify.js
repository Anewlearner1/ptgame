// Qualification rules: which staff role operates which facility (docs/ARCHITECTURE.md, 「設施人員資格」).
//   * a station hosts treatments (buildables.js stationFor); every treatment lists the roles that may run it (staffRole, ANY-of)
//   * machines (attend 'setup') need a qualified staff member only for the first `setupMin` minutes, manual / room treatments
//     (attend 'full') for the whole session - see patients.js
//   * an object is UNSTAFFED when no staff member on the payroll has any role that qualifies for ANY treatment it hosts;
//     a room that is only partly covered (e.g. a heatbox with a PT but no nurse) is fine
// Pure functions of `state` + static data; results are cached and invalidated by bus events (and a cheap signature check, so
// tests that mutate state.staff / state.objects directly stay correct).
import { bus } from '../core/bus.js';
import { ROLES, ROLE_LABELS } from '../core/constants.js';
import { BUILDABLES } from '../data/buildables.js';
import { TREATMENTS } from '../data/treatments.js';

// reception is not a treatment station but still wants a nurse (patients register on their own, slowly, without one)
const EXTRA_ROLES = { reception: ['nurse'] };
// short names for chips / toasts (ROLE_LABELS.nurse is the long 「櫃檯護理師/行政」)
const SHORT = { doctor: '醫師', pt: '物理治療師', ot: '職能治療師', st: '語言治療師', nurse: '護理師' };

export function roleLabel(role) { return ROLE_LABELS[role] || role; }
export function roleShort(role) { return SHORT[role] || roleLabel(role); }

const hostedMemo = new Map();
// treatment ids a building can host (buildables.js stationFor, plus treatments.js objects)
export function treatmentsHostedBy(defId) {
  let v = hostedMemo.get(defId);
  if (v) return v;
  const def = BUILDABLES[defId];
  const set = new Set((def && def.stationFor) || []);
  for (const T of Object.values(TREATMENTS)) if (T.objects && T.objects.includes(defId)) set.add(T.id);
  v = [...set].filter(id => TREATMENTS[id]);
  hostedMemo.set(defId, v);
  return v;
}

const rolesMemo = new Map();
// roles that can operate a building (union over the treatments it hosts; 'nurse' for reception), in first-seen order
export function requiredRolesFor(defId) {
  let v = rolesMemo.get(defId);
  if (v) return v;
  v = [];
  for (const tid of treatmentsHostedBy(defId)) for (const r of (TREATMENTS[tid].staffRole || [])) if (!v.includes(r)) v.push(r);
  for (const r of (EXTRA_ROLES[defId] || [])) if (!v.includes(r)) v.push(r);
  rolesMemo.set(defId, v);
  return v;
}

// per-role list of what the role operates: [{defId, name, treatments:[name], setupOnly}] (for tooltips)
export function operatesFor(role) {
  const out = [];
  for (const id of Object.keys(BUILDABLES)) {
    if (!requiredRolesFor(id).includes(role)) continue;
    const ts = treatmentsHostedBy(id).filter(t => (TREATMENTS[t].staffRole || []).includes(role));
    out.push({ defId: id, name: BUILDABLES[id].name, treatments: ts.map(t => TREATMENTS[t].name), setupOnly: ts.length > 0 && ts.every(t => attendOf(TREATMENTS[t]) === 'setup') });
  }
  return out;
}

// ---- staffing facts about a treatment ----
export function attendOf(T) { return T && T.attend === 'setup' ? 'setup' : 'full'; }
// minutes a staff member is tied up per session (setup: setupMin, otherwise the whole nominal duration)
export function attendMinutes(T) { return attendOf(T) === 'setup' ? Math.max(1, T.setupMin || 5) : T.duration; }
// stamina one session costs the staff member: full = staminaCost, setup = staminaCost x setupMin/duration (at least 0.5)
export function attendStamina(T) {
  if (!T) return 0;
  if (attendOf(T) !== 'setup') return T.staminaCost || 0;
  return Math.max(0.5, (T.staminaCost || 0) * attendMinutes(T) / Math.max(1, T.duration));
}
// stamina drained per working minute while attending `T`
export function attendRate(T) {
  if (!T) return 0;
  return attendOf(T) === 'setup' ? attendStamina(T) / attendMinutes(T) : (T.staminaCost || 0) / Math.max(1, T.duration);
}

// ---- cache ----
let ver = 0;
let cache = null;
for (const ev of ['staff:changed', 'map:changed', 'state:loaded', 'week:start']) bus.on(ev, () => { ver++; });
export function invalidateQualify() { ver++; }

function signature(state) {
  const st = state.staff || [], ob = state.objects || [];
  let h = st.length * 7919 + ob.length;
  for (let i = 0; i < st.length; i++) h = (h * 31 + ROLES.indexOf(st[i].role) + 2) | 0;
  return h;
}

function build(state, sig) {
  const roles = new Set();
  for (const s of state.staff || []) roles.add(s.role);
  const unst = new Set();
  const miss = new Map();
  for (const o of state.objects || []) {
    const req = requiredRolesFor(o.defId);
    if (!req.length || req.some(r => roles.has(r))) continue;
    unst.add(o.id);
    for (const r of req) { if (!miss.has(r)) miss.set(r, []); miss.get(r).push(o.id); }
  }
  const missing = [];
  for (const r of ROLES) if (miss.has(r)) missing.push({ role: r, objects: miss.get(r), label: roleShort(r) });
  cache = { state, ver, sig, roles, unst, missing };
  return cache;
}
function get(state) {
  const sig = signature(state);
  if (cache && cache.state === state && cache.ver === ver && cache.sig === sig) return cache;
  return build(state, sig);
}

// roles on the payroll (Set)
export function payrollRoles(state) { return get(state).roles; }
export function hasRole(state, role) { return get(state).roles.has(role); }
// Set of object ids that cannot be operated right now (shared set: do not mutate)
export function unstaffedIds(state) { return get(state).unst; }
export function isUnstaffed(state, obj) { return !!obj && get(state).unst.has(obj.id); }
// [{role, objects:[ids], label}] roles the clinic lacks for at least one built facility
export function missingRoles(state) { return get(state).missing; }
export function isRoleMissing(state, role) { return get(state).missing.some(m => m.role === role); }
// can this treatment be run by anybody on the payroll?
export function treatmentStaffed(state, tid) {
  const T = TREATMENTS[tid];
  if (!T) return false;
  if (!T.staffRole || !T.staffRole.length) return true;
  const roles = get(state).roles;
  return T.staffRole.some(r => roles.has(r));
}
// chip model for a building: [{role, label, ok}] (ok = that role is on the payroll)
export function roleChips(state, defId) {
  const roles = state ? get(state).roles : new Set();
  return requiredRolesFor(defId).map(r => ({ role: r, label: roleShort(r), ok: roles.has(r) }));
}
// 「需要：物理治療師／護理師」 (any one of them is enough) or '' for buildings that need nobody
export function requirementText(defId) {
  const r = requiredRolesFor(defId);
  return r.length ? '需要：' + r.map(roleShort).join('／') : '';
}

// toast once per role per session when a freshly placed facility cannot be operated
const toasted = new Set();
export function toastIfUnstaffed(state, obj) {
  if (!obj || !isUnstaffed(state, obj)) return false;
  const req = requiredRolesFor(obj.defId);
  if (!req.some(r => !toasted.has(r))) return false;
  for (const r of req) toasted.add(r);
  bus.emit('toast', { text: `尚未僱用${req.map(roleShort).join('或')}，這台設備無法運作`, kind: 'bad' });
  return true;
}
export function resetQualifyToasts() { toasted.clear(); }
