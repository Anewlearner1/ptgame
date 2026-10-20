// Toasts: bus 'toast' {text, kind}. Layer + keyframes come from style.css (.toast, 3s life).
import { bus } from '../core/bus.js';
import { h } from './dom.js';

let layer = null;
const MAX = 4;
let lastText = '', lastAt = 0, lastEl = null, lastCount = 1;

export function initToast() {
  layer = document.getElementById('toast-layer');
  bus.on('toast', showToast);
}

export function showToast(p) {
  if (!layer || !p || !p.text) return;
  const now = performance.now();
  // collapse identical bursts into one "xN" toast
  if (lastEl && lastEl.isConnected && p.text === lastText && now - lastAt < 1500) {
    lastCount++;
    lastEl.textContent = `${p.text} ×${lastCount}`;
    lastAt = now;
    return;
  }
  const kind = p.kind === 'good' || p.kind === 'bad' ? p.kind : 'info';
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, p.text);
  layer.appendChild(el);
  lastText = p.text; lastAt = now; lastEl = el; lastCount = 1;
  while (layer.children.length > MAX) layer.firstChild.remove();
  setTimeout(() => el.remove(), 3100);
}
