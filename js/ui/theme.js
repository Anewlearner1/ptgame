// Interface style switch: html.style-concept is on while the art style is 'new' (render/art.js artEnabled()).
// index.html's inline script sets the class (and the theme-color meta) before first paint from localStorage 'ptgame.art';
// this module keeps both in sync when the player toggles the style (bus 'art:changed').
import { bus } from '../core/bus.js';
import { artEnabled } from '../render/art.js';

export const THEME_CONCEPT = '#1e365a';
let started = false, classicColor = '#1d5c57';

export function applyTheme() {
  const on = artEnabled();
  const root = document.documentElement;
  if (root.classList.contains('style-concept') !== on) root.classList.toggle('style-concept', on);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    if (!meta.dataset.classic) meta.dataset.classic = classicColor;
    const c = on ? THEME_CONCEPT : meta.dataset.classic;
    if (meta.getAttribute('content') !== c) meta.setAttribute('content', c);
  }
}

export function initTheme() {
  if (started) return;
  started = true;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.dataset.classic) classicColor = meta.dataset.classic;
  applyTheme();
  bus.on('art:changed', applyTheme);
}
