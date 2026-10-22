// Atlas-art drawing helpers for the renderer (S-L): people (patients / staff) and the equipment that has a clear match
// in the sheet. Everything here is a no-op / returns null when the atlas is not ready, so renderer.js falls back to the
// procedural sprites in sprites.js.
import { artReady, artCanvas, artRect } from './art.js';
import { bus } from '../core/bus.js';

// ───────────────────────── scale tables ─────────────────────────
// Target on-screen height (world px at zoom 1) of each family's base sprite; the other poses of the family reuse the same
// scale so they keep their relative size. (procedural adult = 40 px, so adults ≈ x1.1; staff a bit taller so the roles read.)
const FAMILY = {
  elder: ['patient.elder.stand', 40],
  office: ['patient.office.work', 44],
  kid: ['patient.kid.school', 38],
  sports: ['patient.sports.run', 44],
};
const STAFF_H = 46;

const _kCache = new Map();
function scaleOf(name) {
  let k = _kCache.get(name);
  if (k) return k;
  let base = null, th = 0;
  if (name.startsWith('staff.')) { base = name; th = STAFF_H; }
  else {
    const fam = FAMILY[name.split('.')[1]];
    if (fam) { base = fam[0]; th = fam[1]; }
  }
  const r = artRect(base || name);
  k = r && th ? th / r.h : 0.35;
  _kCache.set(name, k);
  return k;
}

// ───────────────────────── pre-scaled people cache ─────────────────────────
// Each sprite is scaled once to its on-screen device size (stepwise halving = box-ish filter, then one smooth resize), at a
// quantised device scale S = zoom * dpr (19% steps), so edges stay crisp at any zoom. Drawn with a small residual scale.
let S_cur = 1, lvl_cur = 0, Sq_cur = 1, lastS = 0, stable = 0, exact_cur = false, nEntries = 0;
let smoothQ = 'medium';        // resampling quality of the moving-zoom / tilted blits; renderer.js lowers it with the quality level
export function setArtQuality(q) { smoothQ = q; }
let baseE = 0, baseF = 0;      // translate of the world->device transform (the frame sets scale S + this translate)
export function setArtScale(S, e, f) {
  baseE = e || 0; baseF = f || 0;
  S = Math.max(0.05, S);
  // while the zoom moves (wheel / pinch) use 19%-step levels; once it has rested for a few frames switch to an exact-scale
  // set (1 device px per sprite px -> no resampling at draw time, pixel-aligned)
  stable = Math.abs(S - lastS) < 1e-4 ? Math.min(stable + 1, 100) : 0;
  lastS = S; S_cur = S;
  if (stable >= 6) { exact_cur = true; Sq_cur = S; lvl_cur = 10000 + Math.round(S * 1000); }
  else { exact_cur = false; lvl_cur = Math.round(Math.log2(S) * 4); Sq_cur = Math.pow(2, lvl_cur / 4); }
}
const _lv = new Map();     // name -> [4 variants (plain, sit, back, sit+back)] of Map(lvl -> entry)
export function clearArtCaches() { _lv.clear(); _kCache.clear(); _obj.clear(); nEntries = 0; }
bus.on('art:changed', clearArtCaches);

function resize(src, tw, th) {
  let cur = src;
  while (cur.width > tw * 2 || cur.height > th * 2) {
    const nw = Math.max(tw, Math.ceil(cur.width / 2)), nh = Math.max(th, Math.ceil(cur.height / 2));
    const c = document.createElement('canvas'); c.width = nw; c.height = nh;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh); cur = c;
  }
  const out = document.createElement('canvas'); out.width = tw; out.height = th;
  const g = out.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, tw, th);
  return out;
}

// walking away from the camera (-x / -y): the front-facing sprite is slightly darkened + desaturated to hint 'facing away'
function shadeBack(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = (d[i] + (l - d[i]) * 0.12) * 0.9; d[i + 1] = (d[i + 1] + (l - d[i + 1]) * 0.12) * 0.9; d[i + 2] = (d[i + 2] + (l - d[i + 2]) * 0.12) * 0.92;
  }
  g.putImageData(im, 0, 0);
}
const SIT_FADE = 0.34;     // share of the sprite height (from the feet up) that fades out when seated (legs vanish into the sofa)
function entryFor(name, sit, back) {
  let vs = _lv.get(name);
  if (!vs) { vs = [null, null, null, null]; _lv.set(name, vs); }
  const vi = (sit ? 1 : 0) | (back ? 2 : 0);
  let m = vs[vi];
  if (!m) { m = new Map(); vs[vi] = m; }
  let e = m.get(lvl_cur);
  if (e) return e;
  const src = artCanvas(name);
  if (!src) return null;
  const k = scaleOf(name), r = artRect(name);
  const tw = Math.max(2, Math.round(src.width * k * Sq_cur)), th = Math.max(2, Math.round(src.height * k * Sq_cur));
  const c = resize(src, tw, th);
  if (back) shadeBack(c);
  if (sit) {
    const g = c.getContext('2d');
    const y0 = Math.round(th * (1 - SIT_FADE));
    const gr = g.createLinearGradient(0, y0, 0, th * 0.97);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gr; g.fillRect(0, y0, tw, th - y0);
    g.globalCompositeOperation = 'source-over';
  }
  if (++nEntries > 600) {                      // bound memory (many rest-zoom levels)
    const keep = m; _lv.clear();
    const nv = [null, null, null, null]; nv[vi] = keep; _lv.set(name, nv); nEntries = 1;
  }
  e = { c, fc: null, dw: tw / Sq_cur, dh: th / Sq_cur, ax: r.ax * k, ay: r.ay * k, exact: exact_cur };
  m.set(lvl_cur, e);
  return e;
}

function mirror(c) {
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
  return o;
}

// Draw a person with its feet at world (x, y). flip = mirror about the feet; tilt in radians (about the feet).
// Returns the world y of the sprite's top edge (for bubbles / bars), or NaN when the sprite is missing.
export function drawArtPerson(g, name, x, y, flip, tilt, sit, back) {
  const e = entryFor(name, sit, back);
  if (!e) return NaN;
  const c = flip ? (e.fc || (e.fc = mirror(e.c))) : e.c;
  const ax = flip ? e.dw - e.ax : e.ax;
  if (!tilt) {
    if (!e.exact) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = smoothQ; }
    g.drawImage(c, Math.round((x - ax) * S_cur) / S_cur, Math.round((y - e.ay) * S_cur) / S_cur, e.dw, e.dh);
    if (!e.exact) g.imageSmoothingEnabled = false;
  } else {
    // translate + rotate on top of the frame's base transform; the base is put back with setTransform (no save/restore state churn)
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = smoothQ;
    g.translate(Math.round(x * S_cur) / S_cur, Math.round(y * S_cur) / S_cur);
    g.rotate(tilt);
    g.drawImage(c, -ax, -e.ay, e.dw, e.dh);
    g.setTransform(S_cur, 0, 0, S_cur, baseE, baseF);
    g.imageSmoothingEnabled = false;
  }
  return y - e.ay;
}
export function personHeight(name) { const e = entryFor(name, false); return e ? e.dh : 0; }

// ───────────────────────── sprite choice ─────────────────────────
const STAFF_SPRITE = { doctor: 'staff.doctor', nurse: 'staff.nurse', pt: 'staff.pt', ot: 'staff.ot', st: 'staff.st' };
export function staffSprite(role) { return STAFF_SPRITE[role] || null; }

// st = { moving, sit, wait (standing without a seat), targetDef }
export function patientSprite(p, st) {
  const stage = p.stage, id = p.id | 0;
  const treating = stage === 'treating';
  switch (p.type) {
    case 'elder':
      if (treating) return 'patient.elder.rehab';
      if (id % 3 === 0) return 'patient.elder.walk';
      return id & 1 ? 'patient.elder.cane' : 'patient.elder.stand';
    case 'office':
      if (treating) return 'patient.office.rehab';
      if (!st.sit && ((stage === 'waiting' && p.waitedMin > 22) || (p.patience != null && p.patience < 24))) return 'patient.office.backpain';
      return 'patient.office.work';
    case 'kid':
      if (treating) return 'patient.kid.rehab';
      if (st.wait && !st.moving) return 'patient.kid.play';
      if ((stage === 'arriving' || stage === 'leaving') && (id & 1)) return 'patient.kid.withparent';
      return 'patient.kid.school';
    case 'sports':
      if (treating) return 'patient.sports.stretch';   // patient.sports.injured carries its own mini bed: it doubles the real bed next to it (screenshots), so it stays unused
      return st.moving ? 'patient.sports.run' : 'patient.sports.train';
    default:
      return st.moving ? 'generic.walk_r' : 'generic.stand';
  }
}

// should the sprite be mirrored so that it faces the screen-space direction of `dir` (0:+x right-down 1:+y left-down 2:-x left-up 3:-y right-up)?
export function artFlip(name, dir, id) {
  const r = artRect(name);
  const f = r ? r.facing : 'front';
  if (f === 'right') return dir === 1 || dir === 2;
  if (f === 'left') return dir === 0 || dir === 3;
  return (id & 1) === 1;
}

// ───────────────────────── equipment ─────────────────────────
// def id -> [atlas sprite, max height (world px), width fit]. Anchored on the footprint, flipped for rot=1.
// Evaluated and NOT adopted (shape/meaning mismatch in screenshots): heatbox<->item.hotpack (red bean-bag vs a heater box),
// redcord<->item.parallel (gait bars, see-through frame), ball_pit<->item.ball (one ball vs a pit of balls).
const OBJ_MAP = {
  bed: ['item.bed', 70, 0.92],
  traction: ['item.traction', 62, 0.92],
  tens: ['item.tens', 38, 0.9],
  soft_mat: ['item.yoga', 40, 0.94],
  shockwave: ['item.ultrasound', 44, 0.9],
};
const _obj = new Map();
export function artObjectSprite(def, rot) {
  if (!artReady()) return null;
  const m = OBJ_MAP[def.id];
  if (!m) return null;
  const key = def.id + (rot ? ':1' : ':0');
  let s = _obj.get(key);
  if (s) return s;
  const src = artCanvas(m[0]);
  if (!src) return null;
  const fw = rot ? def.h : def.w, fh = rot ? def.w : def.h;
  const projW = (fw + fh) * 32;
  const k = Math.min(projW * m[2] / src.width, m[1] / src.height);
  const dw = src.width * k, dh = src.height * k;
  // native-resolution canvas (mirrored for rot=1); draws scale it to dw x dh with smoothing
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (rot) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(src, 0, 0);
  const cxo = (fw - fh) * 16;                         // footprint centre x relative to its top corner
  const cy = (fw + fh) * 8;                            // footprint centre y
  const bottom = cy + Math.min(dw * 0.25, (fw + fh) * 8) - 2;   // lowest point of the base diamond
  c.dw = dw; c.dh = dh; c.art = 1;
  c.ax = dw / 2 - cxo; c.ay = dh - bottom;
  _obj.set(key, c);
  return c;
}

// draw any object sprite (procedural canvases have no dw/dh)
export function blit(g, spr, x, y) {
  if (spr.lod) {            // concept_objects.js: master drawn at 2x, pre-scaled to the current zoom x DPR (same levels as the people)
    const c = spr.lod(S_cur, lvl_cur, exact_cur);
    if (c.ex) g.drawImage(c, Math.round(x * S_cur) / S_cur, Math.round(y * S_cur) / S_cur, c.width / S_cur, c.height / S_cur);
    else { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = smoothQ; g.drawImage(c, x, y, spr.dw, spr.dh); g.imageSmoothingEnabled = false; }
    return;
  }
  if (spr.art) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium'; g.drawImage(spr, x, y, spr.dw, spr.dh); g.imageSmoothingEnabled = false; }
  else g.drawImage(spr, x, y);
}
