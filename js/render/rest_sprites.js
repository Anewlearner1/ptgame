// Image sprites for the restaurant (cut from assets/ref/restaurant_sheet.png by tools/cut_restaurant_sheet.py -> assets/rest/).
// Loaded in the background; until (and unless) it resolves, every function here returns null and the procedural art
// (sprites.js / concept_objects.js) is used. A single failed image only drops that sprite. The mapping buildable id -> sprite
// is documented in docs/RESTAURANT_SPRITES.md.
//
// API (all return null when the images are not loaded, the player chose the classic style, or there is no sprite for it):
//   loadRestArt()                      -> Promise<boolean>  idempotent, never rejects; emits bus 'rest:art' once when the images are in
//   restObjectSprite(defId, rot)       -> canvas  {art:1, dw, dh, ax, ay}  same contract as the atlas objects (blit() / spriteHit())
//   restPersonSprite(kind, dir, frame, {pose, variant}) -> canvas {dw, dh, ax, ay}  drawn at dw x dh (renderer: drawSpr)
//   restIconSprite(name)               -> canvas (drawn 1:1)   coin / speech bubble replace the money / question status icons
//   restFoodIcon(dishId)               -> canvas {dw, dh}      small dish icon shown above a guest who is being served
//   restThumb(defId, maxW, maxH, dpr)  -> canvas               DOM thumbnails (build tray / selection card)
//   restScene(name)                    -> {url, w, h}         banner picture for artdom.artBanner (scene.clinic -> storefront)
import { bus } from '../core/bus.js';
import { BUILDABLES } from '../data/buildables.js';
import { artEnabled } from './art.js';

const MANIFEST_URL = new URL('../../assets/rest/manifest.json', import.meta.url).href;
const ROOT_URL = new URL('../../', import.meta.url).href;

let manifest = null;
const imgs = new Map();          // sprite name -> decoded HTMLImageElement
let loading = null;
let ready = false;

function decode(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth ? im : null);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

export function loadRestArt() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error('manifest ' + res.status);
      const m = await res.json();
      if (!m || !m.sprites) throw new Error('bad manifest');
      manifest = m;
      const names = Object.keys(m.sprites);
      const list = await Promise.all(names.map(n => decode(ROOT_URL + m.sprites[n].file)));
      names.forEach((n, i) => { if (list[i]) imgs.set(n, list[i]); });
      if (!imgs.size) throw new Error('no images');
      ready = true;
      cache.clear();
      bus.emit('rest:art', { ready: true });
      return true;
    } catch (e) {
      manifest = null; ready = false; loading = null;      // allow a retry on a later call
      return false;
    }
  })();
  return loading;
}

const on = () => ready && artEnabled();
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const cache = new Map();

// ───────────────────────── placeable objects ─────────────────────────
// def id -> [sprite, max height (world px), width as a share of the projected footprint width ((w+h)*32)]
// No entry = procedural fallback (tv, rest_room, play_area, kids_mat, floors).
const OBJ = {
  bench:        ['furniture/bench_red', 34, 0.8],
  water:        ['furniture/sink', 44, 0.6],
  plant:        ['furniture/plant_pot', 54, 0.6],
  sign:         ['furniture/chalk_stand', 48, 0.5],
  reception:    ['comp/reception_set', 66, 0.8],
  table2:       ['comp/table2_set', 50, 0.95],
  table4:       ['comp/table4_set', 62, 0.85],
  chef_range:   ['kitchen/gas_stove', 54, 0.7],
  noodle_stove: ['kitchen/big_pot', 48, 0.8],
  braise_pot:   ['kitchen/steamer', 50, 0.7],
  griddle:      ['kitchen/gas_stove', 40, 0.85],
  fryer:        ['furniture/kitchen_unit', 64, 0.6],
  teppan:       ['furniture/prep_table', 46, 0.75],
  cold_case:    ['kitchen/fridge', 62, 0.65],
  soup_pot:     ['kitchen/big_pot', 48, 0.8],
  drink_bar:    ['furniture/display_stand', 52, 0.8],
  ice_shop:     ['furniture/ice_tub', 42, 0.6],
  chef_table:   ['furniture/counter', 68, 0.7],
  wok_range:    ['kitchen/gas_stove', 64, 0.7],
  hotpot_table: ['furniture/table', 60, 0.55],
  bbq_grill:    ['furniture/food_stall', 66, 0.5],
  dessert_bar:  ['furniture/counter', 52, 0.65],
  bar_counter:  ['furniture/counter', 60, 0.7],
  coffee:       ['kitchen/tableware', 44, 0.7],
  bookshelf:    ['furniture/wall_shelf', 52, 0.7],
};

export function hasRestObject(defId) { return !!OBJ[defId]; }

export function restObjectSprite(defId, rot) {
  if (!on()) return null;
  const m = OBJ[defId], def = BUILDABLES[defId];
  if (!m || !def) return null;
  const key = 'o:' + defId + (rot ? ':1' : ':0');
  let s = cache.get(key);
  if (s !== undefined) return s;
  const im = imgs.get(m[0]);
  if (!im) { cache.set(key, null); return null; }
  const fw = rot ? def.h : def.w, fh = rot ? def.w : def.h;
  const nw = im.naturalWidth, nh = im.naturalHeight;
  const k = Math.min((fw + fh) * 32 * m[2] / nw, m[1] / nh);
  const dw = nw * k, dhImg = nh * k;
  const padB = Math.ceil(6 / k);                         // room for the soft ground shadow below the sprite
  const c = mk(nw, nh + padB), g = c.getContext('2d');
  g.fillStyle = 'rgba(20,17,27,0.12)';
  for (const f of [1, 0.75]) { g.beginPath(); g.ellipse(nw / 2, nh - 2 / k, nw * 0.46 * f, nw * 0.14 * f, 0, 0, 6.2832); g.fill(); }
  if (rot) { g.translate(nw, 0); g.scale(-1, 1); }
  g.drawImage(im, 0, 0);
  const cxo = (fw - fh) * 16, cy = (fw + fh) * 8;        // footprint centre relative to its top corner
  const bottom = cy + Math.min(dw * 0.25, (fw + fh) * 8) - 2;
  c.art = 1; c.dw = dw; c.dh = (nh + padB) * k;
  c.ax = dw / 2 - cxo; c.ay = dhImg - bottom;
  cache.set(key, c);
  return c;
}

// DOM thumbnail of a placeable (image only, no shadow); null when this def has no image sprite
export function restThumb(defId, maxW = 52, maxH = 44, dpr = 1) {
  if (!on()) return null;
  const m = OBJ[defId], im = m && imgs.get(m[0]);
  if (!im) return null;
  const k = Math.min(maxW * dpr / im.naturalWidth, maxH * dpr / im.naturalHeight);
  const c = mk(im.naturalWidth * k, im.naturalHeight * k), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, c.width, c.height);
  return c;
}

// ───────────────────────── people ─────────────────────────
const PERSON_H = 46;           // on-screen height of a standing person (world px at zoom 1)
const PERSON_K = PERSON_H / 76; // all people share one scale (native figures are 73-81 px tall) so the elder stays taller than the kids
const CUST = {
  elder: ['people/cust_elder'],
  office: ['people/cust_boy', 'people/cust_green'],
  student: ['people/cust_cap', 'people/cust_bag'],
  family: ['people/cust_girl', 'people/cust_dress'],
};
const STAFF_ROLES = new Set(['chef', 'cook', 'barista', 'server', 'cashier']);
const POSE_SIT = 1;

export function restPersonSprite(kind, dir, frame, opts) {
  if (!on()) return null;
  const o = opts || {};
  const d = ((dir | 0) % 4 + 4) % 4;                     // 0 +x (down-right), 1 +y (down-left), 2 -x (up-left), 3 -y (up-right)
  let name, flip;
  if (STAFF_ROLES.has(kind)) {
    const back = d >= 2;
    name = 'staff/' + kind + (back ? '_back' : '_front');
    flip = d === 1 || d === 2;
  } else {
    const list = CUST[kind];
    if (!list) return null;
    name = list[(o.variant | 0) % list.length];
    flip = d === 1 || d === 2;                           // the sheet only has front views: mirror for the left-facing directions
  }
  const sit = o.pose === 'sit';
  const bounce = o.pose === 'walk' && ((frame | 0) & 1) ? 1 : 0;
  const key = `p:${name}:${flip ? 1 : 0}:${sit ? 's' : bounce}`;
  let s = cache.get(key);
  if (s !== undefined) return s;
  const im = imgs.get(name);
  if (!im) { cache.set(key, null); return null; }
  const nw = im.naturalWidth, nh = im.naturalHeight;
  const cropH = sit ? Math.round(nh * 0.74) : nh;        // seated: the legs vanish behind the table / stool
  const c = mk(nw, cropH), g = c.getContext('2d');
  if (flip) { g.translate(nw, 0); g.scale(-1, 1); }
  g.drawImage(im, 0, 0, nw, cropH, 0, 0, nw, cropH);
  c.dw = nw * PERSON_K; c.dh = cropH * PERSON_K;
  c.ax = c.dw / 2;
  c.ay = sit ? c.dh + 2 : c.dh + (bounce ? 1.5 : 0);
  cache.set(key, c);
  return c;
}

// ───────────────────────── DOM banner scenes ─────────────────────────
// atlas scene name (artdom.artBanner) -> opaque picture cut from the sheet
const SCENES = { 'scene.clinic': 'scene/storefront' };
export function restScene(name) {
  if (!on()) return null;
  const im = SCENES[name] && imgs.get(SCENES[name]);
  return im ? { url: im.src, w: im.naturalWidth, h: im.naturalHeight } : null;
}

// ───────────────────────── small icons ─────────────────────────
const ICON_MAP = { money: ['icons/coin', 17], question: ['icons/speech', 18] };
export function restIconSprite(name) {
  if (!on()) return null;
  const m = ICON_MAP[name];
  if (!m) return null;
  const key = 'i:' + name;
  let s = cache.get(key);
  if (s !== undefined) return s;
  const im = imgs.get(m[0]);
  if (!im) { cache.set(key, null); return null; }
  const k = m[1] / im.naturalHeight;
  s = mk(im.naturalWidth * k, m[1]);
  const g = s.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, s.width, s.height);
  s.ax = s.width / 2; s.dw = s.width; s.dh = s.height;
  cache.set(key, s);
  return s;
}

// dish id (data/treatments.js) -> food sprite
const FOOD = {
  main: 'chicken_rice', noodle: 'mianxian', rice: 'lurou_rice', dumpling: 'meatball', fried: 'chicken_cutlet', teppan: 'braised_plate',
  side: 'braised_egg', soup: 'oyster_soup', drink: 'pearl_tea', ice: 'aiyu', dine: 'stinky_tofu',
  steak: 'tofu_dry', seafood: 'oyster_omelet', hotpot: 'greens', bbq: 'braised_plate', dessert: 'fruit_tea', beer: 'wintermelon_tea',
};
export function restFoodIcon(dishId) {
  if (!on()) return null;
  const n = FOOD[dishId];
  if (!n) return null;
  const key = 'f:' + dishId;
  let s = cache.get(key);
  if (s !== undefined) return s;
  const im = imgs.get('food/' + n);
  if (!im) { cache.set(key, null); return null; }
  const H = 15, k = Math.min(H / im.naturalHeight, 20 / im.naturalWidth);
  s = mk(im.naturalWidth, im.naturalHeight);
  s.getContext('2d').drawImage(im, 0, 0);
  s.dw = im.naturalWidth * k; s.dh = im.naturalHeight * k;
  cache.set(key, s);
  return s;
}

// draw a sprite made here (people, food) at its dw x dh with smoothing, leaving the context as it was found
export function drawSpr(g, spr, x, y) {
  if (!spr.dw) { g.drawImage(spr, x, y); return; }
  const prev = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
  g.drawImage(spr, x, y, spr.dw, spr.dh);
  g.imageSmoothingEnabled = prev;
}
