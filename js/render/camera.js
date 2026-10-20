// Camera: pan with right/middle drag (or two-finger touch), cursor-anchored wheel zoom 0.5..2.5.
// ui.cam = {x, y, zoom}; x,y are the SCREEN-space (CSS px) position of world origin. Never consumes left clicks.
import { ui as globalUi } from '../core/state.js';
import { MAP_W, MAP_H, TILE_W, TILE_H } from '../core/constants.js';

export const ZOOM_MIN = 0.4;
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
  return cam;
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

export function centerOnLot(state, canvas, uiRef = globalUi) {
  const cam = uiRef.cam;
  manual = false;
  const { w, h } = viewSize(canvas);
  const l = state.lot;
  const gx = l.x0 + l.w / 2, gy = l.y0 + l.h / 2;
  // fit the lot (diamond + wall height + a margin for the street) into ~85% of the view
  const needW = (l.w + l.h) * TILE_W / 2 + 160;
  const needH = (l.w + l.h) * TILE_H / 2 + 260;
  let z = Math.min(w / needW, h / needH);
  z = Math.round(z * 20) / 20;
  cam.zoom = Math.min(1.6, Math.max(0.6, z));
  const wx = (gx - gy) * TILE_W / 2;
  const wy = (gx + gy) * TILE_H / 2 + 40;     // bias downward so street is visible
  cam.x = w / 2 - wx * cam.zoom;
  cam.y = h / 2 - wy * cam.zoom;
  clampCam(cam, { w, h });
}

export function initCamera(canvas, uiRef = globalUi) {
  const cam = uiRef.cam;
  const pointers = new Map();     // touch pointers for pinch
  let drag = null;                // {id, lx, ly, moved}
  let pinch = null;               // {dist, cx, cy}

  const rect = () => canvas.getBoundingClientRect();

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        panned = true;
      }
      return;
    }
    if (e.button === 1 || e.button === 2) {
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY };
      panned = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const r = rect();
        manual = true;
        cam.x += cx - pinch.cx; cam.y += cy - pinch.cy;
        if (pinch.dist > 0) zoomAt(cam, cx - r.left, cy - r.top, cam.zoom * dist / pinch.dist, canvas);
        else clampCam(cam, canvas);
        pinch.dist = dist; pinch.cx = cx; pinch.cy = cy;
      }
      return;
    }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      drag.lx = e.clientX; drag.ly = e.clientY;
      if (!panned && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { panned = true; manual = true; }
      cam.x += dx; cam.y += dy;
      clampCam(cam, canvas);
    }
  });

  const end = e => {
    if (e.pointerType === 'touch') {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      return;
    }
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

  window.addEventListener('resize', () => {
    clampCam(cam, canvas);
    for (const f of resizeHooks) { try { f(); } catch (e) { console.error(e); } }
  });
}
