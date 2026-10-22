// DOM-side use of the concept-art atlas (js/render/art.js): CSS-background sprites for panels / modals / cards.
// Everything here degrades to what the UI showed before the art existed (emoji / text) when the atlas is
// not loaded, the player chose the classic style, or a sprite name is missing. Sizes are reserved up-front
// (fixed box, sprite fitted inside) so nothing shifts when the atlas finishes loading.
import { bus } from '../core/bus.js';
import { loadArt, artReady, artRect, artUrl, artEnabled, artStaffUrl } from '../render/art.js';
import { conceptThumb } from '../render/concept_objects.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { patientMood, patientExprName, staffFaceName, PATIENT_MOOD_LABELS } from './moods.js';

let loadState = 'pending';     // 'pending' | 'ok' | 'fail'  (fail => the atlas could not be fetched: stop reserving space)
let atlasW = 1024, atlasH = 1024;
const live = new Set();        // WeakRef<HTMLElement> of every art element ever made (pruned on repaint)
let hooked = false;
let urlSet = false;

function setUrlVar() {
  if (urlSet) return;
  urlSet = true;
  try { document.documentElement.style.setProperty('--art-url', `url("${artUrl()}")`); } catch (e) { /* ignore */ }
}

// Call once at UI init: loads the atlas and repaints every art element when the load / toggle settles.
export function initArtDom() {
  if (hooked) return;
  hooked = true;
  setUrlVar();
  bus.on('art:changed', () => { repaintAll(); });
  loadArt().then(ok => {
    loadState = ok ? 'ok' : 'fail';
    if (!ok) { repaintAll(); return; }
    // learn the real atlas size (the manifest stays private to render/art.js); the PNG is already cached
    const im = new Image();
    im.onload = () => { atlasW = im.naturalWidth || atlasW; atlasH = im.naturalHeight || atlasH; repaintAll(); };
    im.onerror = () => repaintAll();
    im.src = artUrl();
    bus.emit('art:changed', { enabled: artEnabled(), ready: artReady() });
  }).catch(() => { loadState = 'fail'; repaintAll(); });
}

export function artOn() { return artReady(); }

function repaintAll() {
  for (const ref of live) {
    const el = ref.deref();
    if (!el) { live.delete(ref); continue; }
    el._repaint();
  }
}

function px(v) { return typeof v === 'number' ? v + 'px' : v; }

// ---- icon / thumbnail element ---------------------------------------------------------------------------------
// artEl(name, {height, width, title, cls, fallback, offCls, fbBg, fbColor})
//  - box = width x height (width defaults to height); the sprite is fitted inside it, aspect kept, centred.
//  - fallback: string | Node shown in the same box when art is off / missing (omit => the element hides itself).
//  - el.setArt(name) swaps the sprite later (e.g. a patient's mood tile).
export function artEl(name, o = {}) {
  setUrlVar();
  const h = o.height || o.size || 32, w = o.width || o.size || h;
  const el = document.createElement('span');
  el.className = 'u-art' + (o.cls ? ' ' + o.cls : '');
  el.style.setProperty('--aw', px(w)); el.style.setProperty('--ah', px(h));
  el.style.setProperty('--AW', atlasW); el.style.setProperty('--AH', atlasH);
  const img = document.createElement('i');
  const fb = document.createElement('b');
  fb.className = 'u-art-fb' + (o.fbCls ? ' ' + o.fbCls : '');
  if (o.fbBg) fb.style.background = o.fbBg;
  if (o.fbColor) fb.style.color = o.fbColor;
  if (o.fallback instanceof Node) fb.appendChild(o.fallback); else if (o.fallback != null) fb.textContent = String(o.fallback);
  el.append(img, fb);
  if (o.fbSize) el.style.setProperty('--fbs', px(o.fbSize));
  if (o.title) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', o.title); }
  if (o.tip) el.dataset.tip = o.tip;
  el._art = { name, o, img, fb, hasFb: o.fallback != null };
  el.setArt = n => { if (el._art.name !== n) { el._art.name = n; paint(el); } };
  el._repaint = () => paint(el);
  live.add(new WeakRef(el));
  paint(el);
  return el;
}

function paint(el) {
  const a = el._art, o = a.o;
  const r = a.name ? artRect(a.name) : null;
  el.style.setProperty('--AW', atlasW); el.style.setProperty('--AH', atlasH);
  let state;
  if (r) {
    state = 'on';
    const s = a.img.style;
    s.setProperty('--sw', r.w); s.setProperty('--sh', r.h); s.setProperty('--sx', r.x); s.setProperty('--sy', r.y);
    // palette-swapped virtual sprite (staff.st): not in the atlas image, so paint it from its own data: URL (whole image = the sprite)
    const own = a.name === 'staff.st' ? artStaffUrl('st') : null;
    if (own) { s.backgroundImage = `url("${own}")`; s.setProperty('--AW', r.w); s.setProperty('--AH', r.h); s.setProperty('--sx', 0); s.setProperty('--sy', 0); }
    else if (s.backgroundImage) { s.removeProperty('background-image'); s.removeProperty('--AW'); s.removeProperty('--AH'); }
  } else if (a.hasFb) state = 'off';
  else if (loadState === 'pending' && artEnabled() && !o.noReserve) state = 'wait';
  else state = 'none';
  if (a.state === state) return;
  a.state = state;
  el.dataset.art = state;
  el.hidden = state === 'none';
}

// ---- concept-style object thumbnail (render/concept_objects.js conceptThumb) --------------------------------------
// thumbEl(defId, {width, height, fallback})  -> <span class="u-thumb"> wrapping `fallback` (the old glyph node).
//  - classic style / no concept drawing for this id (floors): the wrapper is display:contents, so the DOM looks exactly as before.
//  - concept style: a <canvas> with the concept-style object replaces the glyph (css: html.style-concept .u-thumb[data-ct="1"]).
//  - el.setDef(id) swaps the object later (build tray). Repainted on 'art:changed' like every other art element.
export function thumbEl(defId, o = {}) {
  const el = document.createElement('span');
  el.className = 'u-thumb';
  const w = o.width || 52, h = o.height || 44;
  el.style.setProperty('--tw', w + 'px'); el.style.setProperty('--th', h + 'px');
  if (o.fallback instanceof Node) el.appendChild(o.fallback);
  el._th = { id: defId, w, h, cv: null, cvId: null };
  el.setDef = id => { if (el._th.id !== id) { el._th.id = id; paintThumb(el); } };
  el._repaint = () => paintThumb(el);
  live.add(new WeakRef(el));
  paintThumb(el);
  return el;
}
function paintThumb(el) {
  const t = el._th;
  let on = false;
  if (artEnabled() && t.id) {
    if (t.cvId !== t.id) {
      t.cvId = t.id;
      let src = null;
      try { src = conceptThumb(t.id, t.w, t.h, Math.min(3, window.devicePixelRatio || 1)); } catch (e) { src = null; }
      if (t.cv) { t.cv.remove(); t.cv = null; }
      if (src && src.width) {
        const cv = document.createElement('canvas');
        cv.width = src.width; cv.height = src.height;
        cv.getContext('2d').drawImage(src, 0, 0);
        cv.setAttribute('aria-hidden', 'true');
        el.appendChild(cv); t.cv = cv;
      }
    }
    on = !!t.cv;
  }
  const v = on ? '1' : '0';
  if (el.dataset.ct !== v) el.dataset.ct = v;
}

// ---- wide banner (scene.clinic): fills the width of its container, aspect from the sprite -----------------------
// Hidden when art is unavailable. `maxVh` caps its height relative to the viewport (default 36dvh).
export function artBanner(name, o = {}) {
  setUrlVar();
  const el = document.createElement('div');
  el.className = 'u-banner' + (o.cls ? ' ' + o.cls : '');
  el.setAttribute('role', 'img');
  if (o.title) el.setAttribute('aria-label', o.title);
  if (o.maxVh) el.style.setProperty('--bn-vh', o.maxVh + 'dvh');
  el._art = { name, o, state: null };
  el._repaint = () => paintBanner(el);
  live.add(new WeakRef(el));
  paintBanner(el);
  return el;
}
function paintBanner(el) {
  const a = el._art;
  const r = artRect(a.name);
  const state = r ? 'on' : (loadState === 'pending' && artEnabled() ? 'wait' : 'none');
  if (r) {
    el.style.setProperty('--bw', r.w); el.style.setProperty('--bh', r.h);
    el.style.backgroundSize = `${(atlasW / r.w * 100).toFixed(3)}% auto`;
    el.style.backgroundPosition = `${(r.x / Math.max(1, atlasW - r.w) * 100).toFixed(3)}% ${(r.y / Math.max(1, atlasH - r.h) * 100).toFixed(3)}%`;
  }
  if (a.state === state && r) return;
  a.state = state;
  el.dataset.art = state;
  el.hidden = state === 'none';
}

// ---- sprite / mood tables used by the panels ------------------------------------------------------------------
export const STAFF_SPRITE = { doctor: 'staff.doctor', nurse: 'staff.nurse', pt: 'staff.pt', ot: 'staff.ot', st: 'staff.st', tech: 'staff.tech' };
export const PATIENT_SPRITE = { elder: 'patient.elder.stand', office: 'patient.office.work', kid: 'patient.kid.school', sports: 'patient.sports.run' };
// expr.<type>.{0..3} tile per mood tier: the verified per-type order lives in moods.js (PATIENT_TILE_ORDER).
export function moodTier(sat, patience) {
  if (patience != null && patience < 18) return 0;
  return sat < 30 ? 0 : sat < 55 ? 1 : sat < 78 ? 2 : 3;
}
export function moodSprite(type, sat, patience) { return patientExprName(type, moodTier(sat, patience)); }
// full patient mood (see moods.js patientMood) -> {name: expr tile, label, mood}
export function patientMoodArt(p, now) {
  const P = PATIENT_TYPES[p.type];
  const mood = patientMood(p, now, P && P.cureNeeded);
  return { name: patientExprName(p.type, mood.tier), label: PATIENT_MOOD_LABELS[mood.key], mood };
}
// mood bust of a staff member (face.<role>.<mood>) in a fixed box; falls back to the role emoji like the old thumbnail did.
// el.setMood(mood) swaps the face (no row rebuild).
export function staffBust(role, mood, o = {}) {
  const el = artEl(staffFaceName(role, mood), { height: o.height || 48, width: o.width || o.height || 48, fallback: o.fallback, fbSize: o.fbSize, cls: 'u-bust' + (o.cls ? ' ' + o.cls : ''), title: o.title });
  el.setMood = m => el.setArt(staffFaceName(role, m));
  return el;
}
// BUILDABLES id -> item sprite (only the pieces whose concept art is an unmistakable match)
export const ITEM_SPRITE = { bed: 'item.bed', traction: 'item.traction', tens: 'item.tens', soft_mat: 'item.yoga', shockwave: 'item.ultrasound' };
export function itemSprite(defId) { return ITEM_SPRITE[defId] || null; }
export const ROLE_ICON = { inquiry: 'role.inquiry', therapy: 'role.therapy', assess: 'role.assess', educate: 'role.educate', equip: 'role.equip', record: 'role.record' };
// What a staff member is doing right now -> role.* sprite name (null when idle / walking / resting)
export function staffTaskIcon(s, treatments) {
  if (!s || !s.task || s.state === 'resting') return null;
  const id = s.task.treatmentId;
  if (id === '__chat') return 'role.educate';
  if (id === '__register') return 'role.record';
  if (id === 'exam') return 'role.inquiry';
  if (id === 'us') return 'role.assess';
  const T = treatments && treatments[id];
  if (T && T.points && T.points.device >= 2) return 'role.equip';
  return 'role.therapy';
}
