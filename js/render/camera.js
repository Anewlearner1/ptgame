// Camera: pan with right/middle drag (or two-finger touch), cursor-anchored wheel zoom 0.5..2.5.
// ui.cam = {x, y, zoom}; x,y are the SCREEN-space (CSS px) position of world origin. Never consumes left clicks.
import { ui as globalUi, state as globalState } from '../core/state.js';
import { MAP_W, MAP_H, TILE_W, TILE_H } from '../core/constants.js';

// Touch (coarse pointer) devices may zoom further out so the wide iso lot fits a portrait phone width.
export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export let ZOOM_MIN = COARSE ? 0.3 : 0.4;       // live binding (ui.js imports it)
export const ZOOM_MAX = 2.5;

// Auto-fit bookkeeping: while the player has not moved/zoomed the camera by hand, window resizes and panel
// open/close re-fit the lot automatically (ui.js listens through onViewResize / camManual).
let manual = false;
export function camManual() { return manual; }
export function markCamManual() { manual = true; }
const resizeHooks = [];
export function onViewResize(fn) { resizeHooks.push(fn); }

let panned = false;     // true if the last right/middle press turned into a drag (suppresses "right-click cancels")
export function didPan() { return panned; }

export function viewSize(canvas) {
  const w = (canvas && canvas.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const h = (canvas && canvas.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 720);
  return { w, h };
}

// Keep the viewport centre inside the map's iso bounding box.
export function clampCam(cam, canvasOrSize) {
  const vs = canvasOrSize && canvasOrSize.w ? canvasOrSize : viewSize(canvasOrSize);
  cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom || 1));
  const z = cam.zoom;
  let cx = (vs.w / 2 - cam.x) / z;
  let cy = (vs.h / 2 - cam.y) / z;
  const minX = -MAP_H * TILE_W / 2, maxX = MAP_W * TILE_W / 2;
  const minY = 0, maxY = (MAP_W + MAP_H) * TILE_H / 2;
  cx = Math.min(maxX, Math.max(minX, cx));
  cy = Math.min(maxY, Math.max(minY, cy));
  cam.x = vs.w / 2 - cx * z;
  cam.y = vs.h / 2 - cy * z;
  keepLotReachable(cam, vs);
  return cam;
}

// World-space bounding box of the lot (walls + a little street), px at zoom 1.
export function lotBox(lot) {
  return {
    x0: (lot.x0 - (lot.y0 + lot.h)) * TILE_W / 2, x1: (lot.x0 + lot.w - lot.y0) * TILE_W / 2,
    y0: (lot.x0 + lot.y0) * TILE_H / 2 - 44, y1: (lot.x0 + lot.w + lot.y0 + lot.h) * TILE_H / 2 + 20,
  };
}
// The lot must never leave the screen entirely: keep >= MIN_SEEN px of its box inside the view on both axes.
function keepLotReachable(cam, vs) {
  const lot = globalState && globalState.lot;
  if (!lot) return;
  const b = lotBox(lot), z = cam.zoom;
  const seenX = Math.min(120, (b.x1 - b.x0) * z * 0.5, vs.w * 0.4), seenY = Math.min(80, (b.y1 - b.y0) * z * 0.5, vs.h * 0.4);
  // screen box [L,R]x[T,B]
  const L = cam.x + b.x0 * z, R = cam.x + b.x1 * z, T = cam.y + b.y0 * z, B = cam.y + b.y1 * z;
  if (R < seenX) cam.x += seenX - R; else if (L > vs.w - seenX) cam.x -= L - (vs.w - seenX);
  if (B < seenY) cam.y += seenY - B; else if (T > vs.h - seenY) cam.y -= T - (vs.h - seenY);
}

export function panBy(cam, dx, dy, canvas) {
  cam.x += dx; cam.y += dy;
  clampCam(cam, canvas);
}

export function zoomAt(cam, sx, sy, newZoom, canvas) {
  const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  const wx = (sx - cam.x) / cam.zoom;
  const wy = (sy - cam.y) / cam.zoom;
  cam.zoom = nz;
  cam.x = sx - wx * nz;
  cam.y = sy - wy * nz;
  clampCam(cam, canvas);
}

// Fit the lot into rect {x,y,w,h} (CSS px of the canvas not covered by topbar / bottom sheet / tab bar): zoom to the
// rect WIDTH (or height, whichever is tighter) and centre the lot box in the rect. Re-enables automatic refit.
let fitSize = null;     // canvas size the current ui.freeRect was computed for
export function fitLotInRect(state, canvas, rect, uiRef = globalUi) {
  const cam = uiRef.cam, vs = viewSize(canvas);
  manual = false;
  const usable = rect && rect.w >= 100 && rect.h >= 90;        // a degenerate rect (sheet covering everything) falls back to the full canvas
  const r = usable ? rect : { x: 0, y: 0, w: vs.w, h: vs.h };
  uiRef.freeRect = usable ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  fitSize = { w: vs.w, h: vs.h };
  const b = lotBox(state.lot);
  const bw = b.x1 - b.x0 + 40, bh = b.y1 - b.y0 + 56;      // margins: signboard / street
  let z = Math.min(r.w / bw, r.h / bh);
  z = Math.floor(z * 20) / 20;
  cam.zoom = Math.min(1.6, Math.max(ZOOM_MIN, z));
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2 + 12;
  cam.x = r.x + r.w / 2 - cx * cam.zoom;
  cam.y = r.y + r.h / 2 - cy * cam.zoom;
  clampCam(cam, vs);
  return cam;
}

// Re-enable automatic fitting and run the registered refit hooks (ui.js re-fits beside its panel); falls back to centerOnLot.
export function recenter(state, canvas, uiRef = globalUi) {
  manual = false;
  if (resizeHooks.length) { for (const f of resizeHooks) { try { f(); } catch (e) { console.error(e); } } }
  else centerOnLot(state, canvas, uiRef);
}

// Pan/zoom so the tiles `cells` [{x,y}] fill rect {x,y,w,h} (canvas CSS px; default ui.freeRect or the whole canvas) with a margin for
// object height + labels. Marks the camera as hand-placed so automatic re-fits leave it alone (recenter() brings auto-fit back).
export function focusTiles(state, canvas, cells, rect, uiRef = globalUi) {
  if (!cells || !cells.length) return recenter(state, canvas, uiRef);
  const cam = uiRef.cam, vs = viewSize(canvas);
  const usable = rect && rect.w >= 100 && rect.h >= 90;
  const r = usable ? rect : { x: 0, y: 0, w: vs.w, h: vs.h };
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const c of cells) {
    for (const [gx, gy] of [[c.x, c.y], [c.x + 1, c.y], [c.x, c.y + 1], [c.x + 1, c.y + 1]]) {
      const wx = (gx - gy) * TILE_W / 2, wy = (gx + gy) * TILE_H / 2;
      if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
    }
  }
  y0 -= 56;                                   // tall objects + the label pill above the zone
  const bw = x1 - x0 + 60, bh = y1 - y0 + 30;
  const z = Math.floor(Math.min(r.w / bw, r.h / bh) * 20) / 20;
  cam.zoom = Math.min(1.5, Math.max(ZOOM_MIN, z));
  cam.x = r.x + r.w / 2 - (x0 + x1) / 2 * cam.zoom;
  cam.y = r.y + r.h / 2 - (y0 + y1) / 2 * cam.zoom;
  manual = true;
  clampCam(cam, vs);
  return cam;
}

export function centerOnLot(state, canvas, uiRef = globalUi) {
  const cam = uiRef.cam;
  manual = false;
  const { w, h } = viewSize(canvas);
  // honour the UI layer's free rect only while it still matches the canvas it was computed for (it re-supplies it on resize)
  const fr = uiRef.freeRect && fitSize && Math.abs(fitSize.w - w) < 1 && Math.abs(fitSize.h - h) < 1 ? uiRef.freeRect : null;
  if (fr || (COARSE && h > w)) return fitLotInRect(state, canvas, fr, uiRef);
  const l = state.lot;
  const gx = l.x0 + l.w / 2, gy = l.y0 + l.h / 2;
  // fit the lot (diamond + wall height + a margin for the street) into ~85% of the view
  const needW = (l.w + l.h) * TILE_W / 2 + 160;
  const needH = (l.w + l.h) * TILE_H / 2 + 260;
  let z = Math.min(w / needW, h / needH);
  z = Math.round(z * 20) / 20;
  cam.zoom = Math.min(1.6, Math.max(COARSE ? ZOOM_MIN : 0.6, z));
  const wx = (gx - gy) * TILE_W / 2;
  const wy = (gx + gy) * TILE_H / 2 + 40;     // bias downward so street is visible
  cam.x = w / 2 - wx * cam.zoom;
  cam.y = h / 2 - wy * cam.zoom;
  clampCam(cam, { w, h });
}

export function initCamera(canvas, uiRef = globalUi) {
  const cam = uiRef.cam;
  let drag = null;                // {id, lx, ly, moved}  (mouse right/middle drag; touch gestures live in input.js)

  const rect = () => canvas.getBoundingClientRect();

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    if (e.button === 1 || e.button === 2) {
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY };
      panned = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      drag.lx = e.clientX; drag.ly = e.clientY;
      if (!panned && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { panned = true; manual = true; }
      cam.x += dx; cam.y += dy;
      clampCam(cam, canvas);
    }
  });

  const end = e => {
    if (drag && drag.id === e.pointerId) {
      drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', e => {
    if (e.altKey) return;       // Alt+wheel rotates (input.js)
    e.preventDefault();
    manual = true;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 100;
    const r = rect();
    zoomAt(cam, e.clientX - r.left, e.clientY - r.top, cam.zoom * Math.exp(-dy * 0.0016), canvas);
  }, { passive: false });

  // viewport changes: window resize, orientation change, visualViewport (mobile URL bar show/hide), canvas box changes.
  // While the camera is automatic the hooks (ui.js) re-fit the lot; otherwise it is only clamped.
  let raf = 0, lastW = -1, lastH = -1, settle = 0;
  const refit = () => {
    raf = 0;
    const vs = viewSize(canvas);
    lastW = vs.w; lastH = vs.h;
    clampCam(cam, canvas);
    if (resizeHooks.length) { for (const f of resizeHooks) { try { f(); } catch (e) { console.error(e); } } }
    else if (!manual) centerOnLot(globalState, canvas, uiRef);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(refit); };
  window.addEventListener('resize', () => { refit(); });
  window.addEventListener('orientationchange', () => { schedule(); clearTimeout(settle); settle = setTimeout(schedule, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const vs = viewSize(canvas);
      if (lastW < 0) { lastW = vs.w; lastH = vs.h; return; }
      if (Math.abs(vs.w - lastW) > 0.5 || Math.abs(vs.h - lastH) > 0.5) schedule();
    }).observe(canvas);
  }
}
