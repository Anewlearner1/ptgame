// Long-press context popover for placed objects. Bus 'object:context' {id, x, y}  (x,y = viewport/client px).
// Entries: 資訊 (select -> selection card), 移動 (pick up -> ghost + confirm bar), 旋轉 (re-orient in place when the footprint still fits), 拆除 (sell, with confirm).
import { bus } from '../core/bus.js';
import { BUILDABLES } from '../data/buildables.js';
import { removeAt, rotateObject, relocationCost } from '../sim/build.js';
import { h, clear } from './dom.js';
import { money } from './fmt.js';
import { confirmDialog, isModalOpen } from './modal.js';
import { hideTooltip } from './tooltip.js';
import { layout, setBMode } from './layout.js';

let menu = null, timer = 0;

export function initCtxMenu(state, ui) {
  const stage = document.getElementById('stage');
  menu = h('div', { class: 'u-ctx', hidden: true, role: 'menu' });
  stage.appendChild(menu);
  bus.on('object:context', p => show(state, ui, stage, p));
  const away = e => { if (!menu.hidden && !menu.contains(e.target)) hide(); };
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  bus.on('select:changed', hide);
  bus.on('layout:changed', hide);
}

function hide() { if (menu && !menu.hidden) { menu.hidden = true; clear(menu); } clearTimeout(timer); }

function rotateInPlace(state, ui, o) {
  const d = BUILDABLES[o.defId];
  const r = rotateObject(state, o.id);
  if (!r.ok) { bus.emit('toast', { text: `無法旋轉：${r.reason}（可改用「移動」放到別處）`, kind: 'bad' }); return; }
  bus.emit('toast', { text: `已旋轉「${d.name}」`, kind: 'good' });
}

// Pick the object up: input.js shows the ghost + ✔/✖/⟳ bar. Phones: get the sheet / tray out of the way first.
function startMove(ui, o) {
  if (layout.mobile) {
    if (ui.panel === 'build') setBMode(layout.portrait ? 'tray' : 'strip');
    else if (ui.panel) ui.panel = null;
  }
  bus.emit('object:move', { id: o.id });
}

function show(state, ui, stage, p) {
  if (!p || isModalOpen()) return;
  p.handled = true;                                   // tells render/input.js not to draw its own fallback chip
  const o = state.objects.find(x => x.id === p.id);
  if (!o) return;
  const d = BUILDABLES[o.defId] || {};
  hideTooltip();
  clear(menu);
  const item = (ico, label, fn, cls) => h('button', { class: 'u-ctx-btn' + (cls ? ' ' + cls : ''), type: 'button', role: 'menuitem', onclick: () => { hide(); fn(); } }, h('span', null, ico), label);
  menu.append(
    h('div', { class: 'u-ctx-title' }, `${d.glyph || '📦'} ${d.name || o.defId}`),
    item('ℹ️', '資訊', () => { ui.selected = { type: 'object', id: o.id }; bus.emit('select:changed', { selected: ui.selected }); }),
    item('✥', `移動（NT$ ${relocationCost(o.defId).toLocaleString('en-US')}）`, () => startMove(ui, o)),
    item('🔄', '旋轉', () => rotateInPlace(state, ui, o)),
    item('🧨', '拆除', () => confirmDialog({
      title: '出售設備', text: `確定拆除「${d.name}」？將退回約 ${money(Math.floor((d.cost || 0) / 2))}。`, okLabel: '拆除', danger: true,
      onOk: () => { removeAt(state, o.x, o.y); if (ui.selected && ui.selected.id === o.id) { ui.selected = null; bus.emit('select:changed', { selected: null }); } },
    }), 'danger'));
  menu.hidden = false;
  const sr = stage.getBoundingClientRect();
  const w = menu.offsetWidth, hh = menu.offsetHeight;
  let x = (p.x || 0) - sr.left - w / 2, y = (p.y || 0) - sr.top - hh - 14;
  if (y < 4) y = (p.y || 0) - sr.top + 18;
  x = Math.max(4, Math.min(sr.width - w - 4, x)); y = Math.max(4, Math.min(sr.height - hh - 4, y));
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  clearTimeout(timer); timer = setTimeout(hide, 8000);
}
