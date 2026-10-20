// Canvas 2D isometric renderer (S-C). See docs/ARCHITECTURE.md §4/§5.
// World space = px at zoom 1. Frame = static layer (ground, floors, walls, scenery; cached) + depth-sorted objects/agents
// + overlays. Hot loops use pooled typed arrays (no per-frame allocation).
import { MAP_W, MAP_H, TILE_W, TILE_H } from '../core/constants.js';
import { BUILDABLES } from '../data/buildables.js';
import * as SYN from '../data/synergies.js';
import { sizeOf } from '../core/grid.js';
import { isoX, isoY, placementOrigin, hooks } from './iso.js';
import {
  getObjectSprite, getFloorSprite, getGroundSprite, getPersonSprite, getIconSprite, getShadowSprite,
  getCarSprite, CAR_VARIANTS, warmSprites, spriteHit,
} from './sprites.js';

const HW = TILE_W / 2, HH = TILE_H / 2;
const LX = 1100, LY = 240;                               // layer origin offset (world -> layer px)
const LAYER_W = 2 * LX, LAYER_H = LY + (MAP_W + MAP_H) * HH + 80;
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';

let canvas = null, ctx = null;
const view = { w: 0, h: 0, dpr: 1 };
let layer = null, layerCtx = null, layerSig = '';

// ───────────────────────── init / resize ─────────────────────────
export function initRenderer(cv) {
  canvas = cv;
  ctx = canvas.getContext('2d', { alpha: false });
  canvas.style.imageRendering = 'pixelated';
  layer = document.createElement('canvas');
  layer.width = LAYER_W; layer.height = LAYER_H;
  layerCtx = layer.getContext('2d');
  layerCtx.imageSmoothingEnabled = false;
  warmSprites();
  ensureSize();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => ensureSize()).observe(canvas);
  window.addEventListener('resize', ensureSize);
}

function ensureSize() {
  if (!canvas) return false;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  if (w !== view.w || h !== view.h || dpr !== view.dpr) {
    view.w = w; view.h = h; view.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    bubbleCache.clear();
  }
  return true;
}

// ───────────────────────── static layer ─────────────────────────
function groundKind(gx, gy, lot, door, state) {
  const inL = gx >= lot.x0 && gy >= lot.y0 && gx < lot.x0 + lot.w && gy < lot.y0 + lot.h;
  if (inL) {
    return ((gx + gy) & 1) ? 'lot2' : 'lot';   // painted floors are drawn per frame (cheap, no layer rebuilds)
  }
  const dy = gy - door.y;
  if (dy === 0 && gx === door.x) return 'doormat';
  if (dy === 0 || dy === 1 || dy === 7) return 'sidewalk';
  if (dy >= 2 && dy <= 6) {
    if (dy === 4) return (gx >= door.x - 1 && gx <= door.x + 1) ? 'crosswalk' : 'asphalt_dash';
    if (gx >= door.x - 1 && gx <= door.x + 1) return 'crosswalk';
    return 'asphalt';
  }
  if (gx === lot.x0 - 1 || gx === lot.x0 + lot.w || gy === lot.y0 - 1) {
    if (gy < door.y) return 'sidewalk';
  }
  return ((gx * 7 + gy * 13) & 3) === 0 ? 'grass2' : 'grass';
}

function hashN(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function drawAt(g, spr, gx, gy) {
  g.drawImage(spr, Math.round(LX + isoX(gx, gy) - spr.ax), Math.round(LY + isoY(gx, gy) - spr.ay));
}

function layerSignature(state) {
  const l = state.lot, d = state.door;
  let s = l.x0 + ',' + l.y0 + ',' + l.w + ',' + l.h + '|' + d.x + ',' + d.y + '|' + state.clinicName;
  return s;
}

function buildLayer(state) {
  const g = layerCtx;
  const lot = state.lot, door = state.door;
  g.clearRect(0, 0, LAYER_W, LAYER_H);
  // island slab
  const T = (gx, gy) => [LX + isoX(gx, gy), LY + isoY(gx, gy)];
  const L = T(0, MAP_H), B = T(MAP_W, MAP_H), Rr = T(MAP_W, 0);
  const SL = 26;
  g.fillStyle = '#6b5a4a';
  g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(B[0], B[1]); g.lineTo(B[0], B[1] + SL); g.lineTo(L[0], L[1] + SL); g.closePath(); g.fill();
  g.fillStyle = '#54463a';
  g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(Rr[0], Rr[1]); g.lineTo(Rr[0], Rr[1] + SL); g.lineTo(B[0], B[1] + SL); g.closePath(); g.fill();
  g.fillStyle = '#7a8a5a';
  g.fillRect(L[0], L[1] + 1, B[0] - L[0], 4);
  // ground tiles
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const k = groundKind(gx, gy, lot, door, state);
      drawAt(g, BUILDABLES[k] && BUILDABLES[k].layer === 'floor' ? getFloorSprite(k) : getGroundSprite(k), gx, gy);
    }
  }
  // scenery / walls, depth sorted
  const items = [];
  const add = (kind, gx, gy, key) => items.push({ kind, gx, gy, key: key != null ? key : gx + gy });
  // neighbouring buildings (back + sides)
  for (let gx = 0; gx < MAP_W; gx += 3) add('bldg' + Math.floor(hashN(gx, 1) * 4), gx, 1, gx + 1 + 3);
  for (let gy = 4; gy < door.y - 2; gy += 3) {
    if (lot.x0 > 4) add('bldg' + Math.floor(hashN(0, gy) * 4), 0, gy, gy + 3);
    if (lot.x0 + lot.w < MAP_W - 4 && gy < lot.y0 + 3) add('bldg' + Math.floor(hashN(40, gy) * 4), MAP_W - 3, gy, MAP_W - 3 + gy + 3);
  }
  // trees / bushes / lamps / benches on grass + sidewalks
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const inL = gx >= lot.x0 - 1 && gx <= lot.x0 + lot.w && gy >= lot.y0 - 1 && gy <= lot.y0 + lot.h;
      if (inL) continue;
      const k = groundKind(gx, gy, lot, door, state);
      const r = hashN(gx + 100, gy + 7);
      if ((k === 'grass' || k === 'grass2') && gy > 3 && gx > 2 && gx < MAP_W - 3) {
        if (r < 0.08) add(r < 0.03 ? 'tree2' : 'tree', gx, gy);
        else if (r < 0.14) add('bush', gx, gy);
      }
      if (gy > door.y + 7 && gy < MAP_H && k.startsWith('grass')) { if (r < 0.16) add(r < 0.05 ? 'tree2' : 'tree', gx, gy); }
      if (gy === door.y + 1 && gx % 6 === 1 && Math.abs(gx - door.x) > 2) add('lamp', gx, gy);
      if (gy === door.y && (gx === door.x - 2 || gx === door.x + 2)) add('planter', gx, gy);
      if (gy === door.y + 7 && gx % 6 === 4) add('lamp', gx, gy);
    }
  }
  // clinic walls
  const x0 = lot.x0, y0 = lot.y0, x1 = lot.x0 + lot.w, y1 = lot.y0 + lot.h;
  add('wallCorner', x0, y0, x0 + y0 + 0.5);
  for (let i = 0; i < lot.h; i++) add((i % 3 === 1) ? 'wallL_win' : 'wallL', x0, y0 + i, x0 + y0 + i + 0.2);
  for (let i = 0; i < lot.w; i++) add((i % 3 === 1) ? 'wallR_win' : 'wallR', x0 + i, y0, x0 + y0 + i + 0.2);
  add('wallCorner', x1, y0, x1 + y0 + 0.5);
  add('wallCorner', x0, y1, x0 + y1 + 0.5);
  for (let i = 0; i < lot.w; i++) {
    if (x0 + i === door.x) add('doorFrame', x0 + i, y1, x0 + i + y1 + 0.3);
    else add('lowFront', x0 + i, y1, x0 + i + y1 + 0.3);
  }
  for (let i = 0; i < lot.h; i++) add('lowSide', x1, y0 + i, x1 + y0 + i + 0.3);
  add('lowCorner', x1, y1, x1 + y1 + 0.5);
  items.sort((a, b) => a.key - b.key);
  for (const it of items) drawAt(g, getGroundSprite(it.kind), it.gx, it.gy);

  // clinic signboard on the back-right wall (plane y = y0)
  const cx = x0 + lot.w / 2 - 0.5;
  const sx = LX + isoX(cx - 2, y0), sy = LY + isoY(cx - 2, y0) - 44;
  g.save();
  g.setTransform(1, 0.5, 0, 1, sx, sy);
  const pw = 4 * HW, ph = 17;
  g.fillStyle = '#1d6f6a'; g.fillRect(-2, -2, pw + 4, ph + 4);
  g.fillStyle = '#2fa39b'; g.fillRect(0, 0, pw, ph);
  g.fillStyle = '#e8f7f5'; g.fillRect(0, ph - 3, pw, 3);
  g.fillStyle = '#ffffff'; g.font = '700 14px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(state.clinicName || '復健科診所').slice(0, 12), pw / 2, ph / 2 - 1);
  g.restore();
}

// ───────────────────────── object cache (sorted records) ─────────────────────────
const recs = [];                         // sorted draw order
const flatRecs = [];                     // non-blocking flat objects (drawn before everything else)
const tileRec = new Int16Array(MAP_W * MAP_H);
const recById = new Map();
let objSig = '';

function mustPrecede(a, b) {
  return (a.x1 <= b.x0 && !(b.y1 <= a.y0)) || (a.y1 <= b.y0 && !(b.x1 <= a.x0));
}

function rebuildRecs(state) {
  const list = [];
  flatRecs.length = 0; recById.clear();
  for (const o of state.objects) {
    const def = BUILDABLES[o.defId];
    if (!def) continue;
    const rot = o.rot ? 1 : 0;
    const spr = getObjectSprite(o.defId, rot);
    const { w, h } = sizeOf(def, rot);
    const rec = { obj: o, def, spr, x0: o.x, y0: o.y, x1: o.x + w, y1: o.y + h, w, h, px: Math.round(isoX(o.x, o.y) - spr.ax), py: Math.round(isoY(o.x, o.y) - spr.ay), idx: 0, state: 0 };
    recById.set(o.id, rec);
    if (def.blocks === false) flatRecs.push(rec); else list.push(rec);
  }
  list.sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0));
  // topological order (DFS)
  const n = list.length, mark = new Uint8Array(n);
  recs.length = 0;
  const visit = (i) => {
    if (mark[i]) return;
    mark[i] = 1;
    for (let j = 0; j < n; j++) if (j !== i && !mark[j] && mustPrecede(list[j], list[i])) visit(j);
    mark[i] = 2;
    recs.push(list[i]);
  };
  for (let i = 0; i < n; i++) visit(i);
  flatRecs.sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0));
  tileRec.fill(-1);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]; r.idx = i;
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) tileRec[y * MAP_W + x] = i;
  }
}

function objSignature(state) {
  let h = state.objects.length * 7919;
  for (const o of state.objects) h = (h * 31 + o.id * 131 + o.x * 17 + o.y * 5 + (o.rot ? 3 : 0) + o.defId.length) | 0;
  return h;
}

// ───────────────────────── pooled entity list ─────────────────────────
const MAXE = 600;
const eRef = new Array(MAXE).fill(null);
const eKind = new Uint8Array(MAXE);      // 1 patient, 2 staff, 3 car
const eX = new Float32Array(MAXE), eY = new Float32Array(MAXE);
const eKey = new Float64Array(MAXE);
let eN = 0;
const carList = [];                      // persistent car pseudo-entities
const faceMap = new Map();               // id -> last facing dir
const taskMax = new Map();               // fallback progress tracking

function slotFor(x, y) {
  const tx = x | 0, ty = y | 0;
  if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H) {
    const t = tileRec[ty * MAP_W + tx];
    if (t >= 0) return t + 1;
  }
  const ax0 = x - 0.25, ax1 = x + 0.25, ay0 = y - 0.25, ay1 = y + 0.25;
  let s = 0;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if ((r.x1 <= ax0 && !(ay1 <= r.y0)) || (r.y1 <= ay0 && !(ax1 <= r.x0))) s = i + 1;
  }
  return s;
}

function addEnt(kind, ref, x, y) {
  if (eN >= MAXE) return;
  eRef[eN] = ref; eKind[eN] = kind; eX[eN] = x; eY[eN] = y;
  eKey[eN] = slotFor(x, y) * 1e8 + (((x + y) * 100) | 0) * 1000 + eN;
  eN++;
}

// ───────────────────────── bubbles & labels (screen space, device-res canvases) ─────────────────────────
const bubbleCache = new Map();
function getBubble(text, kind) {
  const key = kind + '|' + text;
  let c = bubbleCache.get(key);
  if (c) return c;
  const d = view.dpr;
  const g0 = document.createElement('canvas').getContext('2d');
  const fs = kind === 'tag' ? 11 : 12;
  g0.font = (kind === 'tag' ? '700 ' : '') + fs + 'px ' + FONT;
  const tw = Math.ceil(g0.measureText(text).width);
  const padX = 7, h = fs + 10, w = tw + padX * 2, tail = kind === 'tag' ? 0 : 5;
  c = document.createElement('canvas');
  c.width = Math.ceil(w * d) + 2; c.height = Math.ceil((h + tail) * d) + 2;
  const g = c.getContext('2d');
  g.scale(d, d);
  g.font = (kind === 'tag' ? '700 ' : '') + fs + 'px ' + FONT;
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
  const fill = kind === 'tag' ? '#243b4a' : kind === 'zone' ? 'rgba(255,248,214,0.96)' : '#ffffff';
  const stroke = kind === 'tag' ? '#9fe0d8' : kind === 'zone' ? '#d9a21b' : '#2a2233';
  g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = 1.5;
  rr(0.75, 0.75, w - 1.5, h - 1.5, 5); g.fill(); g.stroke();
  if (tail) {
    g.beginPath(); g.moveTo(w / 2 - 4, h - 1); g.lineTo(w / 2, h + tail); g.lineTo(w / 2 + 4, h - 1); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); g.moveTo(w / 2 - 4, h - 0.75); g.lineTo(w / 2, h + tail - 0.5); g.lineTo(w / 2 + 4, h - 0.75); g.strokeStyle = stroke; g.stroke();
    g.fillStyle = fill; g.fillRect(w / 2 - 3, h - 2, 6, 3);
  }
  g.fillStyle = kind === 'tag' ? '#ffffff' : '#2a2233';
  g.fillText(text, w / 2, h / 2 + 0.5);
  c.cw = w; c.ch = h + tail;
  if (bubbleCache.size > 300) bubbleCache.clear();
  bubbleCache.set(key, c);
  return c;
}

const OVMAX = 160;
const ovCanvas = new Array(OVMAX), ovX = new Float32Array(OVMAX), ovY = new Float32Array(OVMAX), ovA = new Float32Array(OVMAX);
let ovN = 0;
function addOverlay(c, wx, wy, a) {   // world coords (anchor = bottom centre of bubble)
  if (ovN >= OVMAX) return;
  ovCanvas[ovN] = c; ovX[ovN] = wx; ovY[ovN] = wy; ovA[ovN] = a; ovN++;
}

// ───────────────────────── helpers ─────────────────────────
function dirTo(dx, dy, fallback) {
  if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 0 : 2;
  return dy > 0 ? 1 : 3;
}

function fillTile(g, x, y, col) {
  const X = isoX(x, y), Y = isoY(x, y);
  g.fillStyle = col;
  g.beginPath(); g.moveTo(X, Y); g.lineTo(X + HW, Y + HH); g.lineTo(X, Y + TILE_H); g.lineTo(X - HW, Y + HH); g.closePath(); g.fill();
}
function rectPath(g, x, y, w, h) {
  g.beginPath();
  g.moveTo(isoX(x, y), isoY(x, y)); g.lineTo(isoX(x + w, y), isoY(x + w, y)); g.lineTo(isoX(x + w, y + h), isoY(x + w, y + h)); g.lineTo(isoX(x, y + h), isoY(x, y + h)); g.closePath();
}

// ───────────────────────── agents ─────────────────────────
const SEAT_LIFT = 10;
const BAR_W = 26;

function drawBar(g, wx, wy, pct, col) {
  const x = Math.round(wx - BAR_W / 2), y = Math.round(wy);
  g.fillStyle = '#2a2233'; g.fillRect(x - 1, y - 1, BAR_W + 2, 6);
  g.fillStyle = '#e8e2d0'; g.fillRect(x, y, BAR_W, 4);
  g.fillStyle = col; g.fillRect(x, y, Math.max(1, Math.round(BAR_W * pct)), 4);
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x, y, Math.max(1, Math.round(BAR_W * pct)), 1);
}

function progressOf(a) {
  const tot = a.total, rem = a.remaining;
  if (tot > 0 && rem >= 0) return Math.max(0, Math.min(1, 1 - rem / tot));
  return -1;
}

function drawPatient(g, p, now, ui) {
  const stage = p.stage;
  const path = p.path;
  const moving = path && path.length > 0;
  let x = p.x, y = p.y, dir = faceMap.get(p.id);
  if (dir === undefined) dir = 1;
  let pose = 'walk', frame = 0, lift = 0;
  if (moving) {
    dir = dirTo(path[0].x + 0.5 - x, path[0].y + 0.5 - y, dir);
    frame = ((now / 120) | 0) + p.id;
  } else {
    pose = 'stand';
    if (p.seat && (stage === 'waiting' || stage === 'to_station')) {
      const sx = p.seat.x + 0.5, sy = p.seat.y + 0.5;
      if (Math.abs(sx - x) < 0.4 && Math.abs(sy - y) < 0.4) {
        pose = 'sit'; lift = SEAT_LIFT; x = sx; y = sy;
        const r = recById.get(p.seat.objId);
        dir = r && r.obj.rot ? 0 : 1;
        frame = 0;
      }
    }
    if ((stage === 'treating' || stage === 'registering') && p.targetObj != null) {
      const r = recById.get(p.targetObj);
      if (r) dir = dirTo((r.x0 + r.x1) / 2 - x, (r.y0 + r.y1) / 2 - y, dir);
    }
  }
  faceMap.set(p.id, dir);
  const spr = getPersonSprite(p.type, dir, frame, { pose, variant: p.id & 3 });
  const wx = isoX(x, y), wy = isoY(x, y) - lift;
  const sh = getShadowSprite();
  g.drawImage(sh, Math.round(wx - sh.ax), Math.round(isoY(x, y) - sh.ay));
  const bob = (!moving && pose === 'stand') ? ((Math.sin(now / 420 + p.id) > 0.7) ? -1 : 0) : 0;
  g.drawImage(spr, Math.round(wx - spr.ax), Math.round(wy - spr.ay + bob));
  const top = wy - spr.ay + bob;
  // overhead: bubble > progress bar > status icon
  if (p.bubble && p.bubble.text) {
    addOverlay(getBubble(p.bubble.text, 'say'), wx, top - 2, 1);
  } else if ((stage === 'treating' || stage === 'registering')) {
    const pr = progressOf(p);
    if (pr >= 0) drawBar(g, wx, top - 8, pr, stage === 'treating' ? '#4cc86a' : '#5aa8e8');
    else drawBar(g, wx, top - 8, ((now / 1500) % 1), '#4cc86a');
  } else {
    let icon = null;
    const sat = p.satisfaction, pat = p.patience;
    if (stage === 'leaving' && sat != null) icon = sat >= 70 ? (p.cured ? 'star' : 'heart') : sat < 35 ? 'anger' : null;
    else if (p.flags && p.flags.slipped) icon = 'warn';
    else if (pat != null && pat < 22) icon = 'anger';
    else if (stage === 'waiting' && p.waitedMin > 25) icon = 'sleep';
    if (icon) { const ic = getIconSprite(icon); g.drawImage(ic, Math.round(wx - ic.ax), Math.round(top - ic.height - 1 + Math.sin(now / 260 + p.id) * 1.5)); }
  }
  if (ui.selected && ui.selected.type === 'patient' && ui.selected.id === p.id) selRing(g, x, y, now);
}

function drawStaff(g, s, now, ui) {
  const path = s.path;
  const moving = path && path.length > 0;
  let x = s.x, y = s.y, dir = faceMap.get(s.id);
  if (dir === undefined) dir = 1;
  let pose = 'stand', frame = 0;
  if (moving) { pose = 'walk'; dir = dirTo(path[0].x + 0.5 - x, path[0].y + 0.5 - y, dir); frame = ((now / 120) | 0) + s.id; }
  else if (s.state === 'working' && s.task) {
    pose = 'work'; frame = (now / 260) | 0;
    let tx = null, ty = null;
    if (s.task.objId != null) { const r = recById.get(s.task.objId); if (r) { tx = (r.x0 + r.x1) / 2; ty = (r.y0 + r.y1) / 2; } }
    if (tx != null) dir = dirTo(tx - x, ty - y, dir);
  }
  faceMap.set(s.id, dir);
  const spr = getPersonSprite(s.role, dir, frame, { pose, variant: s.id & 7 });
  const wx = isoX(x, y), wy = isoY(x, y);
  const sh = getShadowSprite();
  g.drawImage(sh, Math.round(wx - sh.ax), Math.round(wy - sh.ay));
  const bob = (!moving && pose === 'stand') ? ((Math.sin(now / 500 + s.id * 2) > 0.75) ? -1 : 0) : 0;
  g.drawImage(spr, Math.round(wx - spr.ax), Math.round(wy - spr.ay + bob));
  const top = wy - spr.ay + bob;
  if (s.bubble && s.bubble.text) addOverlay(getBubble(s.bubble.text, 'say'), wx, top - 2, 1);
  else if (s.state === 'working' && s.task && s.task.total > 0) {
    // staff bar is shown on the patient; add a small role marker when exhausted
  } else if (s.stamina != null && s.staminaMax && s.stamina < s.staminaMax * 0.18) {
    const ic = getIconSprite(s.state === 'resting' ? 'sleep' : 'sweat'); g.drawImage(ic, Math.round(wx - ic.ax), Math.round(top - ic.height - 1));
  } else if (s.state === 'resting') {
    const ic = getIconSprite('sleep'); g.drawImage(ic, Math.round(wx - ic.ax), Math.round(top - ic.height - 1 + Math.sin(now / 300) * 1.5));
  }
  if (ui.selected && ui.selected.type === 'staff' && ui.selected.id === s.id) selRing(g, x, y, now);
}

function drawCar(g, c) {
  const spr = getCarSprite(c.v, c.dir);
  g.drawImage(spr, Math.round(isoX(c.x - 1, c.y - 0.5) - spr.ax), Math.round(isoY(c.x - 1, c.y - 0.5) - spr.ay));
}

function selRing(g, x, y, now) {
  const X = isoX(x, y), Y = isoY(x, y);
  const pulse = 1 + Math.sin(now / 180) * 0.08;
  g.lineWidth = 2;
  g.strokeStyle = '#2a2233'; g.beginPath(); g.ellipse(X, Y, 17 * pulse, 8.5 * pulse, 0, 0, 6.2832); g.stroke();
  g.strokeStyle = '#ffe14d'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(X, Y, 16 * pulse, 8 * pulse, 0, 0, 6.2832); g.stroke();
}

// ───────────────────────── zones ─────────────────────────
const ZONE_COL = { golden3: '255,200,60', premium: '190,120,255', kidpark: '90,220,130' };
const zoneCache = new Map();    // zone id -> {sig, path, cx, cy, label}
function zoneGeom(z) {
  const cells = z.cells || [];
  let sig = cells.length * 131;
  for (let i = 0; i < cells.length; i++) { const c = cells[i]; const cx = c.x != null ? c.x : c[0], cy = c.y != null ? c.y : c[1]; sig = (sig * 31 + cx * 64 + cy) | 0; }
  const key = z.id + ':' + (z.objectIds ? z.objectIds[0] : '');
  let e = zoneCache.get(key);
  if (e && e.sig === sig) return e;
  const set = new Set();
  let sx = 0, sy = 0;
  for (const c of cells) { const cx = c.x != null ? c.x : c[0], cy = c.y != null ? c.y : c[1]; set.add(cx + ',' + cy); sx += cx + 0.5; sy += cy + 0.5; }
  const path = new Path2D(), fillP = new Path2D();
  const P = (x, y) => [isoX(x, y), isoY(x, y)];
  const edge = (ax, ay, bx, by) => { const a = P(ax, ay), b = P(bx, by); path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]); };
  for (const k of set) {
    const [cx, cy] = k.split(',').map(Number);
    const a = P(cx, cy), b = P(cx + 1, cy), c = P(cx + 1, cy + 1), d = P(cx, cy + 1);
    fillP.moveTo(a[0], a[1]); fillP.lineTo(b[0], b[1]); fillP.lineTo(c[0], c[1]); fillP.lineTo(d[0], d[1]); fillP.closePath();
    if (!set.has(cx + ',' + (cy - 1))) edge(cx, cy, cx + 1, cy);
    if (!set.has((cx + 1) + ',' + cy)) edge(cx + 1, cy, cx + 1, cy + 1);
    if (!set.has(cx + ',' + (cy + 1))) edge(cx, cy + 1, cx + 1, cy + 1);
    if (!set.has((cx - 1) + ',' + cy)) edge(cx, cy, cx, cy + 1);
  }
  const n = Math.max(1, set.size);
  let name = z.name, icon = z.icon;
  if (!name && SYN.SYNERGIES) { const s = SYN.SYNERGIES.find(q => q.id === z.id); if (s) { name = s.name; icon = icon || s.icon; } }
  e = { sig, path, fillP, cx: isoX(sx / n, sy / n), cy: isoY(sx / n, sy / n), label: (icon ? icon + ' ' : '') + (name || z.id) };
  zoneCache.set(key, e);
  return e;
}

// ───────────────────────── lot grid ─────────────────────────
let gridPath = null, gridSig = '';
function getGridPath(lot) {
  const sig = lot.x0 + ',' + lot.y0 + ',' + lot.w + ',' + lot.h;
  if (sig !== gridSig) {
    gridSig = sig; gridPath = new Path2D();
    for (let i = 0; i <= lot.w; i++) { gridPath.moveTo(isoX(lot.x0 + i, lot.y0), isoY(lot.x0 + i, lot.y0)); gridPath.lineTo(isoX(lot.x0 + i, lot.y0 + lot.h), isoY(lot.x0 + i, lot.y0 + lot.h)); }
    for (let j = 0; j <= lot.h; j++) { gridPath.moveTo(isoX(lot.x0, lot.y0 + j), isoY(lot.x0, lot.y0 + j)); gridPath.lineTo(isoX(lot.x0 + lot.w, lot.y0 + j), isoY(lot.x0 + lot.w, lot.y0 + j)); }
  }
  return gridPath;
}

// ───────────────────────── frame ─────────────────────────
const tint = { on: false, x: 0, y: 0, w: 0, h: 0, col: '' };
let lastNow = 0, carClock = 0, hoverTick = 0;
const BG = '#1f2e3a';
const DAY_KEYS = [[0, 255, 232, 200], [0.1, 255, 250, 240], [0.22, 255, 255, 255], [0.62, 255, 255, 255], [0.8, 255, 214, 168], [0.92, 196, 170, 206], [1, 128, 132, 196]];

export function render(state, ui, now) {
  if (!ctx || !ensureSize()) return;
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  const speed = state.time && !state.time.paused ? state.time.speed : 0;
  carClock += dt * (speed > 0 ? 1 : 0);

  // static layer rebuild when needed
  const sig = layerSignature(state);
  if (sig !== layerSig || !layer._built) { layerSig = sig; buildLayer(state); layer._built = true; }
  const osig = objSignature(state);
  if (String(osig) !== objSig) { objSig = String(osig); rebuildRecs(state); }
  if (hooks.refreshHover && ui.tool && ui.tool.mode !== 'none' && now - hoverTick > 160) { hoverTick = now; hooks.refreshHover(); }

  const cam = ui.cam, z = cam.zoom, dpr = view.dpr, S = z * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(S, 0, 0, S, Math.round(cam.x * dpr), Math.round(cam.y * dpr));
  const vx0 = -cam.x / z, vy0 = -cam.y / z, vx1 = vx0 + view.w / z, vy1 = vy0 + view.h / z;

  // static layer (visible part only)
  {
    let sx = Math.max(0, Math.floor(vx0 + LX)), sy = Math.max(0, Math.floor(vy0 + LY));
    let ex = Math.min(LAYER_W, Math.ceil(vx1 + LX)), ey = Math.min(LAYER_H, Math.ceil(vy1 + LY));
    if (ex > sx && ey > sy) ctx.drawImage(layer, sx, sy, ex - sx, ey - sy, sx - LX, sy - LY, ex - sx, ey - sy);
  }

  const lot = state.lot;
  // painted floors
  for (let y = lot.y0; y < lot.y0 + lot.h; y++) {
    const row = state.map.floor[y];
    if (!row) continue;
    for (let x = lot.x0; x < lot.x0 + lot.w; x++) {
      const id = row[x];
      if (id) { const fs = getFloorSprite(id); ctx.drawImage(fs, isoX(x, y) - 32, isoY(x, y)); }
    }
  }
  const tool = ui.tool || { mode: 'none' };
  const hov = ui.hover || { x: -1, y: -1 };
  const tNow = now / 1000;

  // grid
  if (ui.showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1;
    ctx.stroke(getGridPath(lot));
  }

  // zone glow
  const zones = state.zones;
  if (zones && zones.length) {
    const pulse = 0.55 + 0.25 * Math.sin(tNow * 2.4);
    for (const zn of zones) {
      const e = zoneGeom(zn);
      const col = ZONE_COL[zn.id] || '255,220,120';
      ctx.fillStyle = 'rgba(' + col + ',' + (0.10 + 0.06 * pulse) + ')'; ctx.fill(e.fillP);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.18 * pulse) + ')'; ctx.lineWidth = 9; ctx.stroke(e.path);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.55 + 0.3 * pulse) + ')'; ctx.lineWidth = 2.5; ctx.stroke(e.path);
    }
  }

  // hover tile / tool footprint (ground level)
  let ghostRec = null, ghostO = null;
  const hx = hov.x, hy = hov.y;
  const hasHover = hx >= 0 && hy >= 0 && hx < MAP_W && hy < MAP_H;
  if (hasHover) {
    if (tool.mode === 'place' && tool.defId && BUILDABLES[tool.defId]) {
      const def = BUILDABLES[tool.defId];
      const rot = tool.rot ? 1 : 0;
      const o = placementOrigin(def, rot, hx, hy);
      const { w, h } = sizeOf(def, rot);
      const ok = !!hov.valid;
      ctx.fillStyle = ok ? 'rgba(80,230,120,0.35)' : 'rgba(240,70,70,0.40)';
      rectPath(ctx, o.x, o.y, w, h); ctx.fill();
      ghostO = { def, rot, o, ok, w, h };
      tint.on = true; tint.x = o.x; tint.y = o.y; tint.w = w; tint.h = h; tint.col = ok ? 'rgba(80,230,120,0.18)' : 'rgba(240,70,70,0.22)';
    } else if (tool.mode === 'paint' && tool.defId) {
      fillTile(ctx, hx, hy, hov.valid ? 'rgba(80,230,120,0.45)' : 'rgba(240,70,70,0.45)');
    } else if (tool.mode === 'demolish') {
      const ti = tileRec[hy * MAP_W + hx];
      let hit = false;
      if (ti >= 0) { const r = recs[ti]; ctx.fillStyle = 'rgba(240,60,60,0.45)'; rectPath(ctx, r.x0, r.y0, r.w, r.h); ctx.fill(); hit = true; tint.on = true; tint.x = r.x0; tint.y = r.y0; tint.w = r.w; tint.h = r.h; tint.col = 'rgba(240,60,60,0.30)'; }
      else {
        for (const r of flatRecs) if (hx >= r.x0 && hx < r.x1 && hy >= r.y0 && hy < r.y1) { ctx.fillStyle = 'rgba(240,60,60,0.45)'; rectPath(ctx, r.x0, r.y0, r.w, r.h); ctx.fill(); hit = true; break; }
      }
      if (!hit) fillTile(ctx, hx, hy, state.map.floor[hy] && state.map.floor[hy][hx] ? 'rgba(240,60,60,0.45)' : 'rgba(255,255,255,0.12)');
    } else {
      fillTile(ctx, hx, hy, 'rgba(255,255,255,0.16)');
    }
    // outline of the hovered tile
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    const X = isoX(hx, hy), Y = isoY(hx, hy);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + HW, Y + HH); ctx.lineTo(X, Y + TILE_H); ctx.lineTo(X - HW, Y + HH); ctx.closePath(); ctx.stroke();
  }

  // selected object footprint
  const sel = ui.selected;
  if (sel && sel.type === 'object') {
    const r = recById.get(sel.id);
    if (r) {
      const pulse = 0.5 + 0.5 * Math.sin(tNow * 5);
      ctx.fillStyle = 'rgba(255,225,77,' + (0.18 + 0.12 * pulse) + ')'; rectPath(ctx, r.x0, r.y0, r.w, r.h); ctx.fill();
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // flat objects
  for (let i = 0; i < flatRecs.length; i++) {
    const r = flatRecs[i];
    ctx.drawImage(r.spr, r.px, r.py);
  }

  // ── entities ──
  eN = 0; ovN = 0;
  const pts = state.patients, sts = state.staff;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p.stage === 'gone') continue; let x = p.x, y = p.y; if (p.seat && p.stage === 'waiting' && Math.abs(p.seat.x + 0.5 - x) < 0.4 && Math.abs(p.seat.y + 0.5 - y) < 0.4) { x = p.seat.x + 0.5; y = p.seat.y + 0.5; } addEnt(1, p, x, y); }
  for (let i = 0; i < sts.length; i++) addEnt(2, sts[i], sts[i].x, sts[i].y);
  if (!state.weather || state.weather.kind !== 'typhoon') updateCars(state, carClock);
  for (let i = 0; i < carList.length; i++) if (carList[i].on) addEnt(3, carList[i], carList[i].x, carList[i].y);
  const order = eKey.subarray(0, eN).sort();
  let ei = 0;
  const nR = recs.length;
  for (let si = 0; si <= nR; si++) {
    while (ei < eN) {
      const k = order[ei];
      if (Math.floor(k / 1e8) > si) break;
      const idx = k % 1000;
      ei++;
      const wx = isoX(eX[idx], eY[idx]), wy = isoY(eX[idx], eY[idx]);
      if (wx < vx0 - 80 || wx > vx1 + 80 || wy < vy0 - 40 || wy > vy1 + 140) continue;
      const kind = eKind[idx];
      if (kind === 1) drawPatient(ctx, eRef[idx], now, ui);
      else if (kind === 2) drawStaff(ctx, eRef[idx], now, ui);
      else drawCar(ctx, eRef[idx]);
    }
    if (si < nR) {
      const r = recs[si];
      ctx.drawImage(r.spr, r.px, r.py);
    }
  }

  if (tint.on) {
    // tool tint over the objects too, so a covered footprint is still readable
    ctx.fillStyle = tint.col; rectPath(ctx, tint.x, tint.y, tint.w, tint.h); ctx.fill();
    tint.on = false;
  }
  // ghost
  if (ghostO) {
    const spr = getObjectSprite(ghostO.def.id, ghostO.rot);
    ctx.globalAlpha = 0.62;
    ctx.drawImage(spr, Math.round(isoX(ghostO.o.x, ghostO.o.y) - spr.ax), Math.round(isoY(ghostO.o.x, ghostO.o.y) - spr.ay));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ghostO.ok ? '#5dff8a' : '#ff5a5a'; ctx.lineWidth = 2;
    rectPath(ctx, ghostO.o.x, ghostO.o.y, ghostO.w, ghostO.h); ctx.stroke();
  } else if (hasHover && tool.mode === 'place') { /* unknown def */ }
  if (hasHover && tool.mode === 'paint' && tool.defId) {
    const fs = getFloorSprite(tool.defId);
    ctx.globalAlpha = 0.6; ctx.drawImage(fs, Math.round(isoX(hx, hy) - fs.ax), Math.round(isoY(hx, hy) - fs.ay)); ctx.globalAlpha = 1;
  }
  if (hasHover && tool.mode === 'demolish') {
    const X = isoX(hx, hy), Y = isoY(hx, hy) + HH;
    ctx.strokeStyle = '#2a2233'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(X - 7, Y - 5); ctx.lineTo(X + 7, Y + 5); ctx.moveTo(X + 7, Y - 5); ctx.lineTo(X - 7, Y + 5); ctx.stroke();
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3; ctx.stroke();
  }

  // ── screen-space overlay ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < ovN; i++) {
    const c = ovCanvas[i];
    const sx = (ovX[i]) * z + cam.x, sy = (ovY[i]) * z + cam.y;
    ctx.drawImage(c, Math.round(sx - c.cw / 2) - 1, Math.round(sy - c.ch) - 1, c.width / dpr, c.height / dpr);
  }
  // zone labels
  if (zones && zones.length) {
    for (const zn of zones) {
      const e = zoneGeom(zn);
      const c = getBubble(e.label, 'zone');
      ctx.drawImage(c, Math.round(e.cx * z + cam.x - c.cw / 2) - 1, Math.round(e.cy * z + cam.y - 46 * z - c.ch) - 1, c.width / dpr, c.height / dpr);
    }
  }
  // selected name tag
  if (sel && (sel.type === 'patient' || sel.type === 'staff')) {
    const arr = sel.type === 'patient' ? pts : sts;
    for (let i = 0; i < arr.length; i++) if (arr[i].id === sel.id) {
      const a = arr[i];
      const c = getBubble(a.name || '', 'tag');
      ctx.drawImage(c, Math.round(isoX(a.x, a.y) * z + cam.x - c.cw / 2) - 1, Math.round(isoY(a.x, a.y) * z + cam.y + 6) - 1, c.width / dpr, c.height / dpr);
      break;
    }
  }

  drawAtmosphere(state, now, dpr);
}

// ───────────────────────── cars ─────────────────────────
function updateCars(state, t) {
  if (carList.length === 0) for (let i = 0; i < 4; i++) carList.push({ x: 0, y: 0, v: i, dir: 1, on: true });
  const dy = state.door.y;
  for (let i = 0; i < carList.length; i++) {
    const c = carList[i];
    const fwd = (i & 1) === 0;
    const speed = 2.1 + (i * 0.37) % 1;
    const span = MAP_W + 12;
    const p = ((t * speed + i * 11.3) % span);
    c.dir = fwd ? 1 : -1;
    c.x = fwd ? p - 5 : MAP_W + 5 - p;
    c.y = fwd ? dy + 5.5 : dy + 2.5 + (i > 1 ? 0 : 0);
    c.on = true;
  }
}

// ───────────────────────── weather + daylight ─────────────────────────
function drawAtmosphere(state, now, dpr) {
  const g = ctx, W = view.w, H = view.h;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // daylight tint
  const clock = state.time ? state.time.clock : 12 * 60;
  const t = Math.max(0, Math.min(1, (clock - 480) / 720));
  let k = 1;
  while (k < DAY_KEYS.length - 1 && DAY_KEYS[k][0] < t) k++;
  const a = DAY_KEYS[k - 1], b = DAY_KEYS[k];
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  let r = a[1] + (b[1] - a[1]) * f, gg = a[2] + (b[2] - a[2]) * f, bl = a[3] + (b[3] - a[3]) * f;
  const kind = state.weather ? state.weather.kind : 'sunny';
  if (kind === 'rain' || kind === 'meiyu') { r *= 0.82; gg *= 0.88; bl *= 0.97; }
  else if (kind === 'typhoon') { r *= 0.6; gg *= 0.66; bl *= 0.78; }
  else if (kind === 'cold') { r *= 0.86; gg *= 0.93; bl *= 1; }
  else if (kind === 'cloudy') { r *= 0.92; gg *= 0.94; bl *= 0.98; }
  else if (kind === 'hot') { r *= 1; gg *= 0.96; bl *= 0.86; }
  if (r < 250 || gg < 250 || bl < 250) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bl | 0) + ')';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
  const ts = now / 1000;
  if (kind === 'rain' || kind === 'meiyu' || kind === 'typhoon') {
    const heavy = kind === 'typhoon';
    const n = heavy ? 220 : 130, len = heavy ? 22 : 14, sl = heavy ? 0.55 : 0.18, sp = heavy ? 1500 : 900;
    g.strokeStyle = heavy ? 'rgba(210,225,255,0.55)' : 'rgba(200,225,255,0.6)'; g.lineWidth = 1.3;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const px = (i * 97.31 + ts * sp * sl) % (W + 60) - 30;
      const py = (i * 53.17 + ts * sp * (0.8 + (i % 5) * 0.08)) % (H + 40) - 20;
      g.moveTo(px, py); g.lineTo(px + len * sl, py + len);
    }
    g.stroke();
    if (heavy) {
      g.fillStyle = 'rgba(80,140,70,0.8)';
      for (let i = 0; i < 14; i++) { const px = ((i * 211 + ts * 520) % (W + 80)) - 40, py = (i * 71 + Math.sin(ts * 3 + i) * 30 + 40 * i) % H; g.fillRect(px, py, 5, 3); }
      const flash = Math.sin(ts * 0.7) * Math.sin(ts * 2.3);
      if (flash > 0.96) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, W, H); }
    }
  } else if (kind === 'cold') {
    g.fillStyle = 'rgba(150,190,255,0.10)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 40; i++) { const px = (i * 131.7 + Math.sin(ts * 0.6 + i) * 20) % W, py = (i * 61.3 + ts * 22 * (0.5 + (i % 4) * 0.2)) % H; g.fillRect(px, py, 2, 2); }
    const gr = g.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, 'rgba(220,235,255,0)'); gr.addColorStop(1, 'rgba(220,235,255,0.18)');
    g.fillStyle = gr; g.fillRect(0, H * 0.7, W, H * 0.3);
  } else if (kind === 'hot') {
    const gr = g.createRadialGradient(W * 0.9, 0, 10, W * 0.9, 0, Math.max(W, H) * 0.9);
    gr.addColorStop(0, 'rgba(255,240,170,0.35)'); gr.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 6; i++) { const y0 = H * 0.5 + i * 40 + Math.sin(ts * 2 + i) * 6; g.fillRect(0, y0, W, 8); }
  } else if (kind === 'cloudy') {
    g.fillStyle = 'rgba(200,210,225,0.08)'; g.fillRect(0, 0, W, H);
  }
  // vignette
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(10,15,30,0)'); vg.addColorStop(1, 'rgba(10,15,30,0.28)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

// ───────────────────────── picking (used by input.js) ─────────────────────────
// sx,sy = canvas CSS px. Returns {type:'patient'|'staff'|'object', id} | null
export function pickAt(state, ui, sx, sy) {
  const cam = ui.cam, z = cam.zoom;
  const wx = (sx - cam.x) / z, wy = (sy - cam.y) / z;
  let best = null, bestD = -1;
  const test = (a, type) => {
    let x = a.x, y = a.y;
    if (type === 'patient' && a.seat && Math.abs(a.seat.x + 0.5 - x) < 0.4 && Math.abs(a.seat.y + 0.5 - y) < 0.4) { x = a.seat.x + 0.5; y = a.seat.y + 0.5; }
    const ax = isoX(x, y), ay = isoY(x, y);
    if (Math.abs(wx - ax) <= 15 && wy >= ay - 46 && wy <= ay + 6) {
      const d = x + y;
      if (d > bestD) { bestD = d; best = { type, id: a.id }; }
    }
  };
  for (const p of state.patients) if (p.stage !== 'gone') test(p, 'patient');
  for (const s of state.staff) test(s, 'staff');
  if (best) return best;
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i];
    if (spriteHit(r.spr, Math.round(wx - r.px), Math.round(wy - r.py))) return { type: 'object', id: r.obj.id };
  }
  for (let i = flatRecs.length - 1; i >= 0; i--) {
    const r = flatRecs[i];
    if (spriteHit(r.spr, Math.round(wx - r.px), Math.round(wy - r.py))) return { type: 'object', id: r.obj.id };
  }
  return null;
}
