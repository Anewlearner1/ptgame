// DOM-side use of the concept-art atlas (js/render/art.js): CSS-background sprites for panels / modals / cards.
// Everything here degrades to what the UI showed before the art existed (emoji / text) when the atlas is
// not loaded, the player chose the classic style, or a sprite name is missing. Sizes are reserved up-front
// (fixed box, sprite fitted inside) so nothing shifts when the atlas finishes loading.
import { bus } from '../core/bus.js';
import { loadArt, artReady, artRect, artUrl, artEnabled } from '../render/art.js';

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
  } else if (a.hasFb) state = 'off';
  else if (loadState === 'pending' && artEnabled() && !o.noReserve) state = 'wait';
  else state = 'none';
  if (a.state === state) return;
  a.state = state;
  el.dataset.art = state;
  el.hidden = state === 'none';
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
export const STAFF_SPRITE = { doctor: 'staff.doctor', nurse: 'staff.nurse', pt: 'staff.pt', ot: 'staff.ot', st: 'staff.pharmacist', tech: 'staff.tech' };
export const PATIENT_SPRITE = { elder: 'patient.elder.stand', office: 'patient.office.work', kid: 'patient.kid.school', sports: 'patient.sports.run' };
// expr.<type>.{0..3} tile per mood tier [angry/in-pain, neutral, content, delighted] (judged from the sheet; the tiles are not
// in the same order for every character)
const MOOD_TILES = { elder: [2, 0, 1, 3], office: [0, 1, 2, 3], kid: [2, 0, 1, 3], sports: [0, 1, 2, 3] };
export function moodTier(sat, patience) {
  if (patience != null && patience < 18) return 0;
  return sat < 30 ? 0 : sat < 55 ? 1 : sat < 78 ? 2 : 3;
}
export function moodSprite(type, sat, patience) {
  const tiles = MOOD_TILES[type];
  if (!tiles) return null;
  return `expr.${type}.${tiles[moodTier(sat, patience)]}`;
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
