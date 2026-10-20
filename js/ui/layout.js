// Responsive layout state shared by the ui modules.
//   portrait : phone / tablet held upright (w <= 900, h > w)  -> bottom tab bar + bottom sheets (the PRIMARY phone layout)
//   compact  : short landscape (h <= 520)                      -> slim icon rail + right-side drawer
//   desktop  : everything else (floating sidebar + left panel, unchanged)
// Classes are mirrored onto <html> (lay-portrait / lay-compact / lay-desktop, lay-mobile, touch) for css/mobile.css.
import { bus } from '../core/bus.js';

export const layout = {
  mode: 'desktop', portrait: false, compact: false, mobile: false, touch: false, noHover: false,
  bmode: 'full',        // build panel presentation on mobile: 'full' | 'tray' (portrait) | 'strip' (landscape) | 'chip' (landscape, collapsed)
  sheetFrac: 0.55,      // portrait bottom-sheet height as a fraction of the stage
};

const root = document.documentElement;
let started = false;

export function computeLayout() {
  const w = window.innerWidth, h = window.innerHeight;
  const portrait = h > w && w <= 900;
  const compact = !portrait && h <= 520;
  const mode = portrait ? 'portrait' : compact ? 'compact' : 'desktop';
  const touch = matchMedia('(pointer: coarse)').matches;
  const noHover = matchMedia('(hover: none)').matches;
  const changed = mode !== layout.mode || touch !== layout.touch;
  layout.mode = mode; layout.portrait = portrait; layout.compact = compact; layout.mobile = portrait || compact;
  layout.touch = touch; layout.noHover = noHover;
  root.classList.toggle('lay-portrait', portrait);
  root.classList.toggle('lay-compact', compact);
  root.classList.toggle('lay-desktop', mode === 'desktop');
  root.classList.toggle('lay-mobile', portrait || compact);
  root.classList.toggle('touch', touch);
  root.classList.toggle('no-hover', noHover);
  return changed;
}

export function initLayout() {
  if (started) return;
  started = true;
  computeLayout();
  const on = () => { if (computeLayout()) bus.emit('layout:changed', { mode: layout.mode }); };
  window.addEventListener('resize', on);
  window.addEventListener('orientationchange', on);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', on);
  try { matchMedia('(pointer: coarse)').addEventListener('change', on); } catch (e) { /* old Safari */ }
}

// ---- build panel presentation (mobile) ----
export function setBMode(m) {
  if (layout.bmode === m) return;
  layout.bmode = m;
  bus.emit('ui:bmode', { bmode: m });
}
