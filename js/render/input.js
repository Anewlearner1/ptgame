// Mouse / touch / keyboard input (S-C). Left click = tools, right/middle drag = camera (camera.js).
import { bus } from '../core/bus.js';
import { MAP_W, MAP_H } from '../core/constants.js';
import { BUILDABLES } from '../data/buildables.js';
import { canPlace, placeObject, paintFloor, removeAt } from '../sim/build.js';
import { objectAt } from '../core/grid.js';
import { tileAt, placementOrigin, hooks } from './iso.js';
import { pickAt } from './renderer.js';
import { didPan, panBy, markCamManual } from './camera.js';

let canvas = null, S = null, UI = null;
let lastPos = null;           // last pointer pos in canvas CSS px
let dragging = false, dragMode = null, lastTx = -1, lastTy = -1, toastedThisDrag = false;
let lastSpeed = 1;
let touchPan = null;

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
  if (!lastPos || !UI) return;
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
  if (obj && !(e && e.shiftKey)) { tool.mode = 'none'; tool.defId = null; }
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
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  if (e.button !== 0) return;
  lastPos = posOf(e);
  refreshHover();
  const tool = UI.tool;
  if (e.pointerType === 'touch') { touchPan = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; return; }
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
  if (e.pointerType === 'touch') {
    if (touchPan && touchPan.id === e.pointerId) {
      const dx = e.clientX - touchPan.x, dy = e.clientY - touchPan.y;
      if (!touchPan.moved && Math.hypot(dx, dy) > 10) touchPan.moved = true;
      if (touchPan.moved && !dragging) { markCamManual(); panBy(UI.cam, dx, dy, canvas); touchPan.x = e.clientX; touchPan.y = e.clientY; }
    }
    return;
  }
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
  if (e.pointerType === 'touch') {
    if (touchPan && touchPan.id === e.pointerId) {
      if (!touchPan.moved && !didPan()) act(e);
      touchPan = null;
    }
    dragging = false;
    return;
  }
  if (e.button === 0) dragging = false;
  if (e.button === 2 && !didPan() && UI.tool.mode !== 'none') { UI.tool.mode = 'none'; UI.tool.defId = null; refreshHover(); }
}

function editable(t) {
  if (!t) return false;
  const n = t.tagName;
  return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
}

function onKey(e) {
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
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { dragging = false; touchPan = null; });
  canvas.addEventListener('pointerleave', () => { if (!dragging) { UI.hover.x = -1; UI.hover.y = -1; UI.hover.valid = false; lastPos = null; } });
  canvas.addEventListener('wheel', e => {
    if (!e.altKey) return;
    e.preventDefault();
    if (UI.tool.mode === 'place') { UI.tool.rot = (UI.tool.rot ? 0 : 1); refreshHover(); }
  }, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', () => { dragging = false; });
  window.addEventListener('pointerup', () => { dragging = false; });
  bus.on('map:changed', () => refreshHover());
  bus.on('speed:set', ({ speed }) => { if (speed > 0) lastSpeed = speed; });
}
