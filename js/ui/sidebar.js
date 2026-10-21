// Sidebar: six icon buttons that toggle ui.panel.
import { h, setClass } from './dom.js';
import { artEl } from './artdom.js';
import { dual, icon } from './icons.js';

export const PANELS = [
  { id: 'build', label: '建造', ico: '🔨', key: 'B' },
  { id: 'operate', label: '運作', ico: '🔬', key: 'O' },
  { id: 'clinic', label: '診所', ico: '🏥', key: 'C' },
  { id: 'overview', label: '一覽', ico: '📋', key: 'V' },
  { id: 'map', label: '地圖', ico: '🗺', key: 'P' },
  { id: 'system', label: '系統', ico: '⚙', key: 'Y' },
];
// concept style: hand-drawn svg per panel (一覽 uses the atlas's role.educate clipboard, svg clipboard while the atlas is unavailable)
const SVG = { build: 'hammer', operate: 'flask', clinic: 'clinic', overview: 'clipboard', map: 'pin', system: 'gear' };
export function panelIcon(p, size = 28) {
  const node = p.id === 'overview' ? artEl('role.educate', { size, fallback: icon('clipboard'), cls: 'u-art-ico' }) : SVG[p.id];
  return dual(p.ico, node);
}
const btns = {};

export function initSidebar(ui, toggle) {
  const root = document.getElementById('sidebar');
  for (const p of PANELS) {
    const b = h('button', {
      class: 'sidebar-btn', type: 'button', tip: `${p.label}（${p.key}）`, 'aria-label': p.label, dataset: { p: p.id },
      onclick: () => toggle(p.id),
    }, h('span', { class: 'ico' }, panelIcon(p)), h('span', { class: 'lbl' }, p.label));
    btns[p.id] = b;
    root.appendChild(b);
  }
}

export function updateSidebar(ui) {
  for (const p of PANELS) {
    const on = ui.panel === p.id;
    setClass(btns[p.id], 'active', on);
    btns[p.id].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
