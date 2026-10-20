// Panel gestures on touch layouts.
//   portrait : bottom sheet. Drag the handle / title up (-> ~88%) or down (-> ~55%, further -> dismiss). Tap the handle to toggle.
//   compact  : right-side drawer. Swipe right anywhere on it (except horizontal scrollers) to close.
import { layout } from './layout.js';

export const SHEET_HALF = 0.55, SHEET_FULL = 0.88;
let panel, stage, side, hooks;
let drag = null;

export function initSheet(opts) {
  ({ panel, stage, hooks } = opts);
  side = document.getElementById('sidebar');
  panel.addEventListener('pointerdown', onDown);
  panel.addEventListener('pointermove', onMove);
  panel.addEventListener('pointerup', onUp);
  panel.addEventListener('pointercancel', onUp);
}

const tabH = () => (layout.portrait && side ? side.getBoundingClientRect().height : 0);
const stageH = () => stage.getBoundingClientRect().height;
const heightFor = frac => Math.round(frac * stageH() - tabH());

// Called after panel open/close, mode switches, viewport changes.
export function applySheet() {
  if (!panel) return;
  if (layout.portrait && layout.bmode !== 'tray') {
    panel.style.setProperty('--sheet-h', Math.max(140, heightFor(layout.sheetFrac)) + 'px');
  } else panel.style.removeProperty('--sheet-h');
  panel.style.transform = '';
  syncDock();
}
// px the bottom-anchored UI (tab bar + sheet/tray) occupies; the speed pill and selection card float above it
export function syncDock() {
  const sr = stage.getBoundingClientRect();
  let top = sr.bottom - tabH();
  if (!panel.hidden && layout.mobile) {
    const pr = panel.getBoundingClientRect();
    if (layout.portrait || layout.bmode === 'strip') top = Math.min(top, pr.top);
  }
  stage.style.setProperty('--dock-h', Math.round(sr.bottom - top) + 'px');
}

function excluded(t) { return !!(t.closest && t.closest('input[type="range"], textarea, select, canvas, .u-hscroll, .tabs, .u-buildgrid')); }

function onDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (layout.portrait && layout.bmode !== 'tray') {
    const t = e.target;
    if (!t.closest('.sheet-handle, .panel-title') || t.closest('.panel-close')) return;
    const h0 = panel.getBoundingClientRect().height;
    drag = { kind: 'sheet', id: e.pointerId, y0: e.clientY, h0, last: e.clientY, lastT: performance.now(), v: 0, moved: false };
    try { panel.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    panel.classList.add('dragging');
  } else if (layout.compact && layout.bmode !== 'strip' && e.pointerType !== 'mouse') {
    if (excluded(e.target) || e.target.closest('.panel-close')) return;
    drag = { kind: 'drawer', id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false, dead: false };
  }
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.kind === 'sheet') {
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    const maxH = heightFor(0.94), minH = 60;
    const hgt = Math.max(minH, Math.min(maxH, drag.h0 - dy));
    panel.style.setProperty('--sheet-h', hgt + 'px');
    const now = performance.now();
    if (now - drag.lastT > 16) { drag.v = (e.clientY - drag.last) / (now - drag.lastT); drag.last = e.clientY; drag.lastT = now; }
    syncDock();
  } else {
    if (drag.dead) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { drag.dead = true; return; }   // vertical scroll
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) { drag.moved = true; panel.classList.add('dragging'); try { panel.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
    }
    if (drag.moved) { drag.dx = Math.max(0, dx); panel.style.transform = `translateX(${drag.dx}px)`; }
  }
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  panel.classList.remove('dragging');
  try { panel.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (d.kind === 'sheet') {
    const cur = panel.getBoundingClientRect().height;
    const half = heightFor(SHEET_HALF), full = heightFor(SHEET_FULL);
    if (!d.moved) {                                  // tap on the handle: toggle half <-> full
      layout.sheetFrac = layout.sheetFrac > 0.7 ? SHEET_HALF : SHEET_FULL;
    } else if (e.type === 'pointercancel') {
      /* keep */
    } else if (cur < half * 0.6 || (d.v > 0.9 && cur < half)) {
      applySheet(); hooks.close(); return;
    } else {
      const goUp = d.v < -0.5 || (d.v <= 0.5 && Math.abs(cur - full) < Math.abs(cur - half));
      layout.sheetFrac = goUp ? SHEET_FULL : SHEET_HALF;
    }
    applySheet();
    hooks.refit();
  } else if (d.moved) {
    if (d.dx > 80 && e.type !== 'pointercancel') {
      panel.classList.add('closing');
      panel.style.transform = 'translateX(110%)';
      setTimeout(() => { panel.classList.remove('closing'); panel.style.transform = ''; hooks.close(); }, 160);
    } else {
      panel.classList.add('closing');
      panel.style.transform = '';
      setTimeout(() => panel.classList.remove('closing'), 180);
    }
  }
}
