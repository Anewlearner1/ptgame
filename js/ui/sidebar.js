// Sidebar: six icon buttons that toggle ui.panel.
import { h, setClass } from './dom.js';

export const PANELS = [
  { id: 'build', label: '建造', ico: '🔨', key: 'B' },
  { id: 'operate', label: '運作', ico: '🔬', key: 'O' },
  { id: 'clinic', label: '診所', ico: '🏥', key: 'C' },
  { id: 'overview', label: '一覽', ico: '📋', key: 'V' },
  { id: 'map', label: '地圖', ico: '🗺', key: 'M' },
  { id: 'system', label: '系統', ico: '⚙', key: 'Y' },
];
const btns = {};

export function initSidebar(ui, toggle) {
  const root = document.getElementById('sidebar');
  for (const p of PANELS) {
    const b = h('button', {
      class: 'sidebar-btn', type: 'button', tip: `${p.label}（${p.key}）`,
      onclick: () => toggle(p.id),
    }, h('span', { class: 'ico' }, p.ico), p.label);
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
