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
      cuts.clear(); rects.clear();
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
  c.getContext('2d').drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  c.ax = r.ax; c.ay = r.ay;
  cuts.set(name, c);
  return c;
}

export function artUrl() { return PNG_URL; }
