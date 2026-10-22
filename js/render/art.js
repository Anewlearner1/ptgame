// Sprite-atlas loader (S-L). The user's concept art (assets/art/atlas.png + atlas.json) replaces the procedural
// people / some equipment when loaded AND enabled; the procedural art stays as the fallback and as the "classic" style.
//
// API (stable, used by js/ui/* too):
//   loadArt()            -> Promise<boolean>   idempotent; resolves false on ANY failure (game keeps the old art); retried on the next call
//   artReady()           -> boolean            atlas loaded AND style == 'new'
//   artRect(name)        -> {x,y,w,h,ax,ay,facing,heightPx} | null   (null unless artReady())
//   artCanvas(name)      -> HTMLCanvasElement | null                  cached native-size cut-out (null unless artReady())
//   artFigure(name)      -> {y0,y1,x0,x1,h} | null   opaque bounding box of the cut-out (alpha > 40), cached; h = y1 - y0 + 1
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
const figs = new Map();   // name -> opaque bbox

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
      cuts.clear(); rects.clear(); urls.clear(); figs.clear();
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

export function artRect(name) {
  if (!artReady()) return null;
  let r = rects.get(name);
  if (r) return r;
  const s = manifest.sprites[name];
  if (!s) return null;
  const meta = manifest.meta || {};
  r = {
    x: s.x, y: s.y, w: s.w, h: s.h, ax: s.ax, ay: s.ay,
    facing: (meta.facing && meta.facing[name]) || 'front',
    heightPx: (meta.heightPx && meta.heightPx[name]) || s.h,
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
  const g = c.getContext('2d');
  g.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  c.ax = r.ax; c.ay = r.ay;
  cuts.set(name, c);
  return c;
}

// Opaque bounding box of a sprite (one getImageData per sprite, on a willReadFrequently scratch canvas so Chrome logs nothing).
// Used to scale people by their FIGURE height, not by the padded canvas height.
let scratch = null;
export function artFigure(name) {
  let f = figs.get(name);
  if (f) return f;
  const src = artCanvas(name);
  if (!src) return null;
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  scratch.canvas.width = src.width; scratch.canvas.height = src.height;
  scratch.clearRect(0, 0, src.width, src.height);
  scratch.drawImage(src, 0, 0);
  const d = scratch.getImageData(0, 0, src.width, src.height).data;
  let y0 = src.height, y1 = -1, x0 = src.width, x1 = -1;
  for (let y = 0, i = 3; y < src.height; y++) for (let x = 0; x < src.width; x++, i += 4) if (d[i] > 40) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  f = y1 < 0 ? { y0: 0, y1: src.height - 1, x0: 0, x1: src.width - 1, h: src.height } : { y0, y1, x0, x1, h: y1 - y0 + 1 };
  figs.set(name, f);
  return f;
}

// Staff portrait/sprite canvas for a role (native size, cached). 'st' is the real speech-therapist sheet sprite (155x301). null unless artReady().
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
