// Mouse / touch / keyboard input (S-C). Left click = tools, right/middle drag = camera (camera.js).
import { bus } from '../core/bus.js';
import { MAP_W, MAP_H } from '../core/constants.js';
import { BUILDABLES } from '../data/buildables.js';
import { canPlace, placeObject, paintFloor, removeAt } from '../sim/build.js';
import { objectAt } from '../core/grid.js';
import { tileAt, placementOrigin, hooks } from './iso.js';
import { pickAt } from './renderer.js';
import { didPan, panBy, zoomAt, markCamManual, recenter } from './camera.js';
import { T, hitBar, safeRect, targetBox, GHOST_OFFSET } from './touchui.js';

// Touch gestures (Pointer Events). One gesture object `g` at a time:
//  tap -> (pan | ghost | paint) by tool, bar (mini-bar button), pinch (2 fingers: zoom + pan), lp (long-press consumed), dead.
const TAP_SLOP = 10, PAINT_SLOP = 6, LONG_PRESS_MS = 500, DOUBLE_TAP_MS = 320, FINGER_R = 24;
const touches = new Map();     // pointerId -> {x,y} canvas CSS px
let g = null, lpTimer = 0, lastTap = null, shiftHeld = false, keepWritten = false;

let canvas = null, S = null, UI = null;
let lastPos = null;           // last pointer pos in canvas CSS px
let dragging = false, dragMode = null, lastTx = -1, lastTy = -1, toastedThisDrag = false;
let lastSpeed = 1;

function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

function posOf(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function validFor(tx, ty) {
  const tool = UI.tool;
  if (!inMap(tx, ty)) return false;
  try {
    if (tool.mode === 'place' && tool.defId) {
      const def = BUILDABLES[tool.defId];
      const o = placementOrigin(def, tool.rot || 0, tx, ty);
      UI.hover.ox = o.x; UI.hover.oy = o.y;
      return !!canPlace(S, tool.defId, o.x, o.y, tool.rot || 0).ok;
    }
    if (tool.mode === 'paint' && tool.defId) return !!canPlace(S, tool.defId, tx, ty, 0).ok;
    if (tool.mode === 'demolish') return !!objectAt(S, tx, ty) || !!(S.map.floor[ty] && S.map.floor[ty][tx]);
  } catch (err) { return false; }
  return true;
}

export function refreshHover() {
  if (!UI) return;
  if (T.touch) { touchHover(); return; }
  if (!lastPos) return;
  const t = tileAt(lastPos.x, lastPos.y, UI.cam);
  const h = UI.hover;
  if (!inMap(t.x, t.y)) { h.x = -1; h.y = -1; h.valid = false; return; }
  h.x = t.x; h.y = t.y;
  h.ox = t.x; h.oy = t.y;
  h.valid = validFor(t.x, t.y);
}

function toast(text) { bus.emit('toast', { text, kind: 'bad' }); }

function doPlace(e) {
  const tool = UI.tool;
  const h = UI.hover;
  if (h.x < 0 || !tool.defId) return;
  const def = BUILDABLES[tool.defId];
  if (!def) return;
  const o = placementOrigin(def, tool.rot || 0, h.x, h.y);
  const res = canPlace(S, tool.defId, o.x, o.y, tool.rot || 0);
  if (!res.ok) { toast(res.reason || '無法放置'); return; }
  const obj = placeObject(S, tool.defId, o.x, o.y, tool.rot || 0);
  if (obj && !(e && e.shiftKey) && !tool.keep) { tool.mode = 'none'; tool.defId = null; bus.emit('tool:changed', { mode: 'none' }); }
  refreshHover();
}

function applyAt(tx, ty) {
  const tool = UI.tool;
  if (!inMap(tx, ty)) return;
  if (dragMode === 'paint') {
    const res = canPlace(S, tool.defId, tx, ty, 0);
    if (!res.ok) { if (!toastedThisDrag && res.reason) { toastedThisDrag = true; toast(res.reason); } return; }
    paintFloor(S, tool.defId, tx, ty);
  } else if (dragMode === 'demolish') {
    removeAt(S, tx, ty);
  }
}

function applyLine(x0, y0, x1, y1) {
  // Bresenham between the last and current tile so fast drags leave no gaps
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (let i = 0; i < 200; i++) {
    applyAt(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function select(sel) {
  UI.selected = sel;
  bus.emit('select:changed', { selected: sel });
}

function onDown(e) {
  if (e.pointerType === 'touch') { touchDown(e); return; }
  if (e.button !== 0) return;
  T.touch = false; T.ctx = null;
  lastPos = posOf(e);
  refreshHover();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  act(e);
}

function act(e) {
  const tool = UI.tool, h = UI.hover;
  if (tool.mode === 'place') doPlace(e);
  else if (tool.mode === 'paint' || tool.mode === 'demolish') {
    dragging = true; dragMode = tool.mode; toastedThisDrag = false;
    lastTx = h.x; lastTy = h.y;
    if (h.x >= 0) applyAt(h.x, h.y);
    refreshHover();
  } else {
    const p = lastPos;
    select(pickAt(S, UI, p.x, p.y));
  }
}

function onMove(e) {
  if (e.pointerType === 'touch') { touchMove(e); return; }
  if (T.touch) { T.touch = false; T.ctx = null; }
  lastPos = posOf(e);
  const prevX = UI.hover.x, prevY = UI.hover.y;
  refreshHover();
  if (dragging && (e.buttons & 1)) {
    const h = UI.hover;
    if (h.x >= 0 && (h.x !== lastTx || h.y !== lastTy)) {
      if (lastTx < 0) applyAt(h.x, h.y); else applyLine(lastTx, lastTy, h.x, h.y);
      lastTx = h.x; lastTy = h.y;
      refreshHover();
    }
  }
}

function onUp(e) {
  if (e.pointerType === 'touch') { touchUp(e, false); return; }
  if (e.button === 0) dragging = false;
  if (e.button === 2 && !didPan() && UI.tool.mode !== 'none') { UI.tool.mode = 'none'; UI.tool.defId = null; refreshHover(); }
}


// ───────────────────────── touch ─────────────────────────
function size() { return { W: canvas.clientWidth, H: canvas.clientHeight }; }

// per-frame housekeeping (called from renderer via hooks.frame): tool changes, keep-tool flag, tap-hover timeout
let toolKey = '';
function frameTick(now) {
  if (!UI) return;
  const t = UI.tool;
  const key = t.mode + '|' + t.defId;
  if (key !== toolKey) {
    toolKey = key;
    T.ghostSet = false; T.demoTarget = null; T.tile = null; T.ctx = null;
    if (T.touch && t.mode !== 'none') { UI.hover.x = -1; UI.hover.y = -1; UI.hover.valid = false; }
  }
  if (t.mode !== 'none') {
    if (t.keep !== undefined && t.keep !== keepWritten && !shiftHeld) T.keepToggle = !!t.keep;   // someone else (UI layer) toggled it
    keepWritten = T.keepToggle || shiftHeld;
    t.keep = keepWritten;
  }
  if (T.touch && t.mode === 'none' && T.hoverUntil && now > T.hoverUntil) { T.hoverUntil = 0; T.tile = null; UI.hover.x = -1; UI.hover.y = -1; UI.hover.valid = false; }
}

function touchHover() {
  const h = UI.hover, t = T.tile;
  if (!t || !inMap(t.x, t.y) || (UI.tool.mode === 'place' && !T.ghostSet)) { h.x = -1; h.y = -1; h.valid = false; return; }
  h.x = t.x; h.y = t.y; h.ox = t.x; h.oy = t.y;
  h.valid = validFor(t.x, t.y);
}
function setTile(tx, ty) { T.tile = { x: tx, y: ty }; touchHover(); }

function setGhostFromFinger(x, y) {
  const r = safeRect(UI, canvas.clientWidth, canvas.clientHeight);
  const off = Math.max(0, Math.min(GHOST_OFFSET, y - (r.y + 24)));      // never lift the ghost out of the free area
  const t = tileAt(x, y - off, UI.cam);
  T.ghostSet = inMap(t.x, t.y);
  setTile(t.x, t.y);
}

function cancelLP() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } }

function resetTouch() {
  cancelLP(); touches.clear(); g = null; T.pressed = null; T.dragging = false; dragging = false;
}

function touchDown(e) {
  e.preventDefault();
  T.touch = true;
  const p = posOf(e);
  touches.set(e.pointerId, { x: p.x, y: p.y });
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (touches.size >= 2) { startPinch(); return; }
  const { W, H } = size();
  const b = hitBar(UI, W, H, p.x, p.y);
  if (b) { g = { kind: 'bar', id: b, pid: e.pointerId }; T.pressed = b; return; }
  if (T.ctx) T.ctx = null;
  g = { kind: 'tap', pid: e.pointerId, x0: p.x, y0: p.y, lx: p.x, ly: p.y, t0: performance.now(), moved: false };
  if (UI.tool.mode === 'none') {
    cancelLP();
    lpTimer = setTimeout(() => {
      lpTimer = 0;
      if (!g || g.kind !== 'tap' || g.moved || touches.size !== 1) return;
      const hit = pickAt(S, UI, g.x0, g.y0, FINGER_R);
      if (!hit || hit.type !== 'object') return;
      g.kind = 'lp';
      select(hit);
      const o = S.objects.find(q => q.id === hit.id);
      const r = canvas.getBoundingClientRect();
      T.hoverUntil = 0;
      try { navigator.vibrate && navigator.vibrate(15); } catch (_) { /* ignore */ }
      // UI layers render their own menu and mark the event `handled = true` (or set ui.contextUI); otherwise a built-in canvas chip is shown
      const ev = { id: hit.id, x: g.x0 + r.left, y: g.y0 + r.top, cx: g.x0, cy: g.y0, defId: o ? o.defId : null, handled: false };
      bus.emit('object:context', ev);
      if (o && !ev.handled && !UI.contextUI) T.ctx = { id: hit.id, x: o.x, y: o.y };
    }, LONG_PRESS_MS);
  }
}

let pinch = null;
function twoTouches() { const it = touches.values(); return [it.next().value, it.next().value]; }
function startPinch() {
  cancelLP(); T.dragging = false; dragging = false; T.pressed = null;
  const [a, b] = twoTouches();
  pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  g = { kind: 'pinch' };
  markCamManual();
}

function touchMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  e.preventDefault();
  const p = posOf(e);
  t.x = p.x; t.y = p.y;
  if (!g) return;
  if (g.kind === 'pinch') {
    if (touches.size < 2) return;
    const [a, b] = twoTouches();
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const cam = UI.cam;
    cam.x += mx - pinch.mx; cam.y += my - pinch.my;
    if (pinch.dist > 8 && d > 8) zoomAt(cam, mx, my, cam.zoom * d / pinch.dist, canvas);
    else panBy(cam, 0, 0, canvas);
    pinch.dist = d; pinch.mx = mx; pinch.my = my;
    return;
  }
  if (g.pid !== e.pointerId) return;
  if (g.kind === 'tap') {
    if (Math.hypot(p.x - g.x0, p.y - g.y0) <= (UI.tool.mode === 'paint' ? PAINT_SLOP : TAP_SLOP)) return;
    g.moved = true; cancelLP();
    const m = UI.tool.mode;
    if (m === 'place') { g.kind = 'ghost'; T.dragging = true; setGhostFromFinger(p.x, p.y); }
    else if (m === 'paint') {
      g.kind = 'paint'; dragging = true; dragMode = 'paint'; toastedThisDrag = false;
      const t0 = tileAt(g.x0, g.y0, UI.cam);
      lastTx = t0.x; lastTy = t0.y; applyAt(t0.x, t0.y);
      paintTo(p);
    } else { g.kind = 'pan'; markCamManual(); T.hoverUntil = 0; panBy(UI.cam, p.x - g.lx, p.y - g.ly, canvas); g.lx = p.x; g.ly = p.y; }
  } else if (g.kind === 'pan') {
    panBy(UI.cam, p.x - g.lx, p.y - g.ly, canvas); g.lx = p.x; g.ly = p.y;
  } else if (g.kind === 'ghost') {
    setGhostFromFinger(p.x, p.y);
  } else if (g.kind === 'paint') {
    paintTo(p);
  }
}
function paintTo(p) {
  const tt = tileAt(p.x, p.y, UI.cam);
  setTile(tt.x, tt.y);
  if (tt.x !== lastTx || tt.y !== lastTy) { applyLine(lastTx, lastTy, tt.x, tt.y); lastTx = tt.x; lastTy = tt.y; }
}

function touchUp(e, cancelled) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const p = posOf(e);
  touches.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  cancelLP();
  const gg = g;
  if (touches.size > 0) {
    // a finger of a multi-touch lifted: keep panning with the remaining one (never a tap / tool action)
    if (gg && gg.kind === 'pinch' && touches.size === 1) {
      const [id, q] = [...touches.entries()][0];
      g = { kind: 'pan', pid: id, lx: q.x, ly: q.y };
    } else if (gg && gg.pid === e.pointerId) g = { kind: 'dead' };
    return;
  }
  g = null; pinch = null; T.pressed = null; T.dragging = false; dragging = false;
  if (!gg || cancelled) return;
  const { W, H } = size();
  if (gg.kind === 'bar') { if (hitBar(UI, W, H, p.x, p.y) === gg.id) barAction(gg.id); return; }
  if (gg.kind === 'tap') touchTap(p);
  // ghost / paint / pan / lp / pinch / dead: nothing more to do on release
}

function touchTap(p) {
  const tool = UI.tool, now = performance.now();
  const tt = tileAt(p.x, p.y, UI.cam);
  if (tool.mode === 'none') {
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
      lastTap = null; recenter(S, canvas, UI); return;
    }
    lastTap = { t: now, x: p.x, y: p.y };
    select(pickAt(S, UI, p.x, p.y, FINGER_R));
    if (inMap(tt.x, tt.y)) { setTile(tt.x, tt.y); T.hoverUntil = now + 900; }
  } else if (tool.mode === 'place') {
    const box = targetBox(UI);
    if (T.ghostSet && UI.hover.valid && box && p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) { doPlace(null); return; }   // second tap on the ghost = place
    T.ghostSet = inMap(tt.x, tt.y);
    setTile(tt.x, tt.y);
  } else if (tool.mode === 'paint') {
    if (!inMap(tt.x, tt.y)) return;
    dragMode = 'paint'; toastedThisDrag = false; applyAt(tt.x, tt.y); dragMode = null;
    setTile(tt.x, tt.y);
  } else if (tool.mode === 'demolish') {
    if (!inMap(tt.x, tt.y)) return;
    // snap to the object's origin tile so the highlight covers the whole object
    const o = objectAt(S, tt.x, tt.y);
    T.demoTarget = { x: tt.x, y: tt.y };
    setTile(tt.x, tt.y);
    if (!o && !(S.map.floor[tt.y] && S.map.floor[tt.y][tt.x])) T.demoTarget = null;
  }
}

function endTool() {
  UI.tool.mode = 'none'; UI.tool.defId = null;
  T.ghostSet = false; T.demoTarget = null; T.tile = null;
  UI.hover.x = -1; UI.hover.y = -1; UI.hover.valid = false;
  bus.emit('tool:changed', { mode: 'none' });
}

function barAction(id) {
  const tool = UI.tool;
  if (T.ctx) {
    const c = T.ctx; T.ctx = null;
    if (id === 'demo') startDemolishObject(c.id);
    return;
  }
  if (id === 'cancel') { endTool(); return; }
  if (id === 'rot') { tool.rot = tool.rot ? 0 : 1; touchHover(); return; }
  if (id === 'keep') { T.keepToggle = !T.keepToggle; tool.keep = T.keepToggle || shiftHeld; keepWritten = tool.keep; return; }
  if (id === 'ok') {
    if (tool.mode === 'place') doPlace(null);
    else if (tool.mode === 'demolish' && T.demoTarget) {
      const d = T.demoTarget;
      removeAt(S, d.x, d.y);
      T.demoTarget = null;
      if (tool.keep) touchHover(); else endTool();
    }
  }
}

// Arm the demolish tool on a specific object (used by the built-in long-press chip; the UI layer may call it too).
export function startDemolishObject(id) {
  const o = S.objects.find(q => q.id === id);
  if (!o) return false;
  UI.tool = { mode: 'demolish', defId: null, rot: 0, cat: null, keep: false };
  toolKey = 'demolish|null';
  T.keepToggle = false;
  T.touch = true; T.ctx = null;
  T.demoTarget = { x: o.x, y: o.y };
  setTile(o.x, o.y);
  UI.selected = null; bus.emit('select:changed', { selected: null });
  bus.emit('tool:changed', { mode: 'demolish' });
  return true;
}

function editable(t) {
  if (!t) return false;
  const n = t.tagName;
  return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
}

function onKey(e) {
  if (e.key === 'Shift') shiftHeld = true;
  if (e.ctrlKey || e.metaKey || editable(e.target)) return;
  const k = e.key;
  if (k === 'r' || k === 'R') {
    if (UI.tool.mode === 'place') { UI.tool.rot = (UI.tool.rot ? 0 : 1); refreshHover(); }
  } else if (k === 'Escape') {
    bus.emit('ui:escape', {});
    if (UI.tool.mode !== 'none') { UI.tool.mode = 'none'; UI.tool.defId = null; refreshHover(); }
  } else if (k === 'g' || k === 'G') {
    UI.showGrid = !UI.showGrid;
  } else if (k === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    const cur = S.time.paused ? 0 : S.time.speed;
    if (cur === 0) bus.emit('speed:set', { speed: lastSpeed || 1 });
    else { lastSpeed = cur; bus.emit('speed:set', { speed: 0 }); }
  } else if (k === '1' || k === '2' || k === '3') {
    const sp = +k;
    lastSpeed = sp;
    bus.emit('speed:set', { speed: sp });
  }
}

export function initInput(cv, state, ui) {
  canvas = cv; S = state; UI = ui;
  hooks.refreshHover = refreshHover;
  hooks.frame = frameTick;
  canvas.style.touchAction = 'none';
  canvas.style.webkitTouchCallout = 'none';
  canvas.style.userSelect = 'none';
  // the page itself must never scroll / zoom / pull-to-refresh under the game
  try {
    document.documentElement.style.overscrollBehavior = 'none';
    document.documentElement.style.touchAction = 'manipulation';     // no double-tap zoom anywhere
    document.body.style.overscrollBehavior = 'none';
  } catch (_) { /* ignore */ }
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
  canvas.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  const onCancel = e => {
    if (e.pointerType === 'touch') { touchUp(e, true); if (!touches.size) resetTouch(); return; }
    dragging = false;
  };
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', e => { if (e.pointerType === 'touch' && touches.has(e.pointerId)) onCancel(e); });
  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'touch') return;
    if (!dragging) { UI.hover.x = -1; UI.hover.y = -1; UI.hover.valid = false; lastPos = null; }
  });
  canvas.addEventListener('wheel', e => {
    if (!e.altKey) return;
    e.preventDefault();
    if (UI.tool.mode === 'place') { UI.tool.rot = (UI.tool.rot ? 0 : 1); refreshHover(); }
  }, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.key === 'Shift') shiftHeld = false; });
  window.addEventListener('blur', () => { dragging = false; shiftHeld = false; resetTouch(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetTouch(); });
  window.addEventListener('pointerup', () => { dragging = false; });
  bus.on('map:changed', () => refreshHover());
  bus.on('speed:set', ({ speed }) => { if (speed > 0) lastSpeed = speed; });
}
