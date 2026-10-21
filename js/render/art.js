// Sprite-atlas loader (S-L). The user's concept art (assets/art/atlas.png + atlas.json) replaces the procedural
// people / some equipment when loaded AND enabled; the procedural art stays as the fallback and as the "classic" style.
//
// API (stable, used by js/ui/* too):
//   loadArt()            -> Promise<boolean>   idempotent; resolves false on ANY failure (game keeps the old art); retried on the next call
//   artReady()           -> boolean            atlas loaded AND style == 'new'
//   artRect(name)        -> {x,y,w,h,ax,ay,facing,heightPx} | null   (null unless artReady())
//   artCanvas(name)      -> HTMLCanvasElement | null                  cached native-size cut-out (null unless artReady())
//   artUrl()             -> string             absolute URL of atlas.png (for DOM CSS backgrounds; valid even before load)
//   artEnabled() / setArtEnabled(on)           persisted in localStorage 'ptgame.art' ('classic' | 'new', default 'new')
// Bus events: 'art:changed' {enabled, ready} on toggle AND when the atlas finishes loading (so UIs can re-render).
import { bus } from '../core/bus.js';

const KEY = 'ptgame.art';
const JSON_URL = new URL('../../assets/art/atlas.json', import.meta.url).href;
const PNG_URL = new URL('../../assets/art/atlas.png', import.meta.url).href;

let manifest = null;      // parsed atlas.json
let image = null;         // decoded atlas image (ImageBitmap / HTMLImageElement)
let loading = null;       // in-flight / settled promise
let enabled = readPref();
const cuts = new Map();   // name -> canvas
const rects = new Map();  // name -> rect object

function readPref() {
  try { return localStorage.getItem(KEY) !== 'classic'; } catch (_) { return true; }
}

function decode(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('atlas image failed'));
    im.src = url;
  });
}

export function loadArt() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(JSON_URL);
      if (!res.ok) throw new Error('atlas.json ' + res.status);
      const m = await res.json();
      if (!m || !m.sprites) throw new Error('bad atlas.json');
      const im = await decode(PNG_URL);
      if (!im.naturalWidth) throw new Error('empty atlas');
      manifest = m; image = im;
      cuts.clear(); rects.clear(); urls.clear();
      bus.emit('art:changed', { enabled, ready: artReady() });
      return true;
    } catch (e) {
      manifest = null; image = null;
      loading = null;            // allow a retry on a later call
      return false;
    }
  })();
  return loading;
}

export function artEnabled() { return enabled; }

export function setArtEnabled(on) {
  on = !!on;
  try { localStorage.setItem(KEY, on ? 'new' : 'classic'); } catch (_) { /* private mode */ }
  if (on === enabled) return;
  enabled = on;
  bus.emit('art:changed', { enabled, ready: artReady() });
}

export function artReady() { return !!(manifest && image && enabled); }

// Virtual sprites derived from atlas ones by a palette swap (the sheet has no speech-therapist): 'staff.st' = staff.pharmacist with a
// lavender coat + purple scrubs (#5a5aa2 family). artRect/artCanvas treat them like any atlas sprite.
const DERIVED = { 'staff.st': 'staff.pharmacist' };

export function artRect(name) {
  if (!artReady()) return null;
  let r = rects.get(name);
  if (r) return r;
  const s = manifest.sprites[DERIVED[name] || name];
  if (!s) return null;
  const meta = manifest.meta || {};
  r = {
    x: s.x, y: s.y, w: s.w, h: s.h, ax: s.ax, ay: s.ay,
    facing: (meta.facing && meta.facing[DERIVED[name] || name]) || 'front',
    heightPx: (meta.heightPx && meta.heightPx[DERIVED[name] || name]) || s.h,
  };
  rects.set(name, r);
  return r;
}

export function artCanvas(name) {
  const r = artRect(name);
  if (!r) return null;
  let c = cuts.get(name);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  const g = c.getContext('2d', DERIVED[name] ? { willReadFrequently: true } : undefined);
  g.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (DERIVED[name]) swapPurple(g, r.w, r.h);
  c.ax = r.ax; c.ay = r.ay;
  cuts.set(name, c);
  return c;
}

// grey/white coat -> lavender, saturated blue (scrubs shirt) -> violet; skin, hair, outline and tablet untouched
function swapPurple(g, w, h) {
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), df = mx - mn;
    if (df < 38 && mx > 150) {                       // white coat (lit + shaded)
      const l = mx / 255, k = 0.55 + 0.45 * l;
      d[i] = 204 * k; d[i + 1] = 199 * k; d[i + 2] = 247 * k;
    } else if (df > 0 && mx > 0 && df / mx > 0.28) {   // saturated blue -> violet (hue +38 deg, a little less saturated)
      let hh;
      if (mx === r) hh = ((gg - b) / df + 6) % 6; else if (mx === gg) hh = (b - r) / df + 2; else hh = (r - gg) / df + 4;
      hh *= 60;
      if (hh > 185 && hh < 260) {
        hh = (hh + 38) % 360;
        const s = Math.min(1, (df / mx) * 0.8), v = mx / 255, c2 = v * s, x2 = c2 * (1 - Math.abs(((hh / 60) % 2) - 1)), m2 = v - c2;
        let rr = 0, g2 = 0, bb = 0;
        if (hh < 60) { rr = c2; g2 = x2; } else if (hh < 120) { rr = x2; g2 = c2; } else if (hh < 180) { g2 = c2; bb = x2; } else if (hh < 240) { g2 = x2; bb = c2; } else if (hh < 300) { rr = x2; bb = c2; } else { rr = c2; bb = x2; }
        d[i] = (rr + m2) * 255; d[i + 1] = (g2 + m2) * 255; d[i + 2] = (bb + m2) * 255;
      }
    }
  }
  g.putImageData(im, 0, 0);
}

// Staff portrait/sprite canvas for a role (native size, cached). 'st' is the palette-swapped one. null unless artReady().
const STAFF_NAME = { doctor: 'staff.doctor', nurse: 'staff.nurse', pt: 'staff.pt', ot: 'staff.ot', st: 'staff.st', tech: 'staff.tech' };
export function artStaffCanvas(role) { const n = STAFF_NAME[role]; return n ? artCanvas(n) : null; }
const urls = new Map();
// same sprite as a data: URL (for DOM <img>/CSS backgrounds); null unless artReady()
export function artStaffUrl(role) {
  const c = artStaffCanvas(role);
  if (!c) return null;
  let u = urls.get(role);
  if (!u) { u = c.toDataURL('image/png'); urls.set(role, u); }
  return u;
}

export function artUrl() { return PNG_URL; }
