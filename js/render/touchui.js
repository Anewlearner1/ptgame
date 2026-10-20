// Touch build UI drawn on the canvas (S-G): confirm / cancel / rotate / keep-tool mini-bar next to the ghost.
// Layout + drawing live here so input.js (hit-testing) and renderer.js (drawing) share exactly the same geometry.
// Everything is in canvas CSS px and stays inside the "free rect" (ui.freeRect from the UI layer, default = whole canvas),
// so the bar is never under a bottom sheet / tab bar / topbar.
import { BUILDABLES } from '../data/buildables.js';
import { sizeOf } from '../core/grid.js';
import { isoX, isoY } from './iso.js';

export const BTN = 44, GAP = 6;
export const GHOST_OFFSET = 40;     // px the ghost is lifted above the finger while dragging

// Shared touch state. `touch` = last input was a finger (nothing is drawn for mouse users).
export const T = {
  touch: false,
  ghostSet: false,        // place tool: ghost positioned by a tap/drag
  tile: null,             // {x,y} anchor tile of ghost / demolish target / hover
  demoTarget: null,       // demolish tool: {x,y} tile awaiting confirmation
  ctx: null,              // long-press context chip {id, x, y(tile)}
  pressed: null,          // id of the bar button currently held down
  dragging: false,        // finger is dragging the ghost (bar is faded and not hit-testable)
  keepToggle: false,
};

let safeCache = null, safeAt = 0;
// Region of the canvas that is not covered by UI chrome.
export function safeRect(ui, W, H) {
  const f = ui && ui.freeRect;
  if (f && f.w >= 100 && f.h >= 90) {
    const x = Math.max(0, f.x), y = Math.max(0, f.y);
    return { x, y, w: Math.min(W, f.x + f.w) - x, h: Math.min(H, f.y + f.h) - y };
  }
  const now = performance.now();
  if (!safeCache || now - safeAt > 300 || safeCache.W !== W || safeCache.H !== H) {
    safeAt = now;
    let left = 0;
    try {
      const sb = document.getElementById('sidebar');
      if (sb && sb.offsetParent !== null) {
        const r = sb.getBoundingClientRect(), cr = document.getElementById('game').getBoundingClientRect();
        if (r.width < W * 0.25 && r.height > r.width && r.left - cr.left < W * 0.2) left = Math.max(0, r.right - cr.left + 4);
      }
    } catch (_) { /* ignore */ }
    safeCache = { W, H, x: left, y: 0, w: W - left, h: H };
  }
  return safeCache;
}

function buttonsFor(ui) {
  const tool = ui.tool || { mode: 'none' };
  if (T.ctx) return [{ id: 'demo', glyph: '🗑', col: '#d64545' }, { id: 'close', glyph: '✖', col: '#5d6872' }];
  if (tool.mode === 'place') {
    const ok = T.ghostSet && ui.hover && ui.hover.x >= 0;
    return [{ id: 'ok', glyph: '✔', col: ok && ui.hover.valid ? '#27a862' : '#7b6a45', dis: !ok }, { id: 'cancel', glyph: '✖', col: '#d64545' },
      { id: 'rot', glyph: '⟳', col: '#3b82c4' }, { id: 'keep', glyph: '📌', col: tool.keep ? '#e0a82e' : '#4a5560', on: !!tool.keep }];
  }
  if (tool.mode === 'demolish') {
    return [{ id: 'ok', glyph: '✔', col: T.demoTarget ? '#27a862' : '#6a6f55', dis: !T.demoTarget }, { id: 'cancel', glyph: '✖', col: '#d64545' },
      { id: 'keep', glyph: '📌', col: tool.keep ? '#e0a82e' : '#4a5560', on: !!tool.keep }];
  }
  if (tool.mode === 'paint') {
    return [{ id: 'cancel', glyph: '✔', col: '#27a862', label: 'done' }, { id: 'keep', glyph: '📌', col: tool.keep ? '#e0a82e' : '#4a5560', on: !!tool.keep }];
  }
  return null;
}

// Screen box of what the bar attaches to (ghost sprite + footprint, or one tile), or null when nothing is targeted.
export function targetBox(ui) {
  const cam = ui.cam, z = cam.zoom, tool = ui.tool || {}, h = ui.hover;
  if (T.ctx) { const t = T.ctx; return tileBox(cam, t.x, t.y, 1, 1, 46); }
  if (tool.mode === 'place' && T.ghostSet && h && h.x >= 0 && BUILDABLES[tool.defId]) {
    const def = BUILDABLES[tool.defId], { w, h: hh } = sizeOf(def, tool.rot ? 1 : 0);
    return tileBox(cam, h.ox != null ? h.ox : h.x, h.oy != null ? h.oy : h.y, w, hh, def.height || 24);
  }
  if (tool.mode === 'demolish' && T.demoTarget) return tileBox(cam, T.demoTarget.x, T.demoTarget.y, 1, 1, 30);
  return null;
}
function tileBox(cam, ox, oy, w, h, height) {
  const z = cam.zoom;
  const cx = cam.x + isoX(ox + w / 2, oy + h / 2) * z;
  const hw = (w + h) * 16 * z;
  return { x0: cx - hw, x1: cx + hw, y0: cam.y + isoY(ox, oy) * z - height * z, y1: cam.y + isoY(ox + w, oy + h) * z, cx };
}

// Bar geometry: {x,y,w,h,btns:[{id,glyph,col,x,y,w,h,...}]} or null.
export function layoutBar(ui, W, H) {
  if (!T.touch) return null;
  const list = buttonsFor(ui);
  if (!list) return null;
  const n = list.length, w = n * BTN + (n - 1) * GAP, h = BTN;
  const r = safeRect(ui, W, H);
  const tb = targetBox(ui);
  let x, y;
  if (tb) {
    x = tb.cx - w / 2;
    y = tb.y0 - 10 - h;                                   // above the ghost (clear of the finger)
    if (y < r.y + 4) y = tb.y1 + 10;                       // no room above: below the footprint
  } else {
    x = r.x + r.w / 2 - w / 2; y = r.y + 8;                // docked, top centre of the free area
  }
  x = Math.max(r.x + 4, Math.min(r.x + r.w - w - 4, x));
  y = Math.max(r.y + 4, Math.min(r.y + r.h - h - 4, y));
  const btns = list.map((b, i) => Object.assign({ x: x + i * (BTN + GAP), y, w: BTN, h: BTN }, b));
  return { x, y, w, h, btns, docked: !tb };
}

export function hitBar(ui, W, H, px, py) {
  if (T.dragging) return null;
  const bar = layoutBar(ui, W, H);
  if (!bar) return null;
  for (const b of bar.btns) if (px >= b.x - 2 && px <= b.x + b.w + 2 && py >= b.y - 2 && py <= b.y + b.h + 2) return b.id;
  return null;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}

// Called by renderer.js with the context in CSS-px space (setTransform(dpr...)).
export function drawTouchOverlay(g, ui, W, H) {
  const bar = layoutBar(ui, W, H);
  if (!bar) return;
  g.save();
  g.globalAlpha = T.dragging ? 0.35 : 1;
  rr(g, bar.x - 4, bar.y - 4, bar.w + 8, bar.h + 8, 12);
  g.fillStyle = 'rgba(20,28,34,0.82)'; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const b of bar.btns) {
    rr(g, b.x, b.y, b.w, b.h, 9);
    g.fillStyle = b.col; g.globalAlpha = (T.dragging ? 0.35 : 1) * (b.dis ? 0.6 : 1); g.fill();
    if (T.pressed === b.id) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(); }
    g.globalAlpha = T.dragging ? 0.35 : 1;
    if (b.on) { g.lineWidth = 2.5; g.strokeStyle = '#fff4b0'; g.stroke(); }
    g.fillStyle = '#fff';
    g.font = (b.glyph === '📌' || b.glyph === '🗑' ? '20px' : 'bold 24px') + ' sans-serif';
    g.fillText(b.glyph, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }
  g.restore();
}
