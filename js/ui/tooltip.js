// Hover tooltips. Any element with data-tip="text" (\n = line break) or data-tip-def="buildableId".
import { BUILDABLES } from '../data/buildables.js';
import { RESEARCH } from '../data/research.js';
import { h, clear } from './dom.js';
import { money } from './fmt.js';

let tipEl = null, stage = null, cur = null;

function contentFor(el) {
  if (el.dataset.tipDef) {
    const d = BUILDABLES[el.dataset.tipDef];
    if (!d) return null;
    const box = h('div', { class: 'u-tip' },
      h('div', { class: 'u-tip-h' }, `${d.glyph || ''} ${d.name}`),
      h('div', null, `造價 ${money(d.cost)}${d.layer === 'floor' ? ' / 格' : ''}　維護 ${money(d.upkeep || 0)}/月`),
      h('div', { class: 'u-tip-s' }, `佔地 ${d.w}×${d.h}` + (d.seats ? `　座位 ${d.seats}` : '') + (d.comfort ? `　舒適 ${d.comfort}` : '')),
      h('div', null, d.desc || ''));
    if (d.requires) {
      const n = RESEARCH[d.requires];
      box.appendChild(h('div', { class: 'u-tip-req' }, `🔒 需研發：${n ? n.name : d.requires}`));
    }
    return box;
  }
  if (el.dataset.tip) {
    const lines = el.dataset.tip.split('\n');
    return h('div', { class: 'u-tip' }, lines.map((l, i) => h('div', { class: i === 0 && lines.length > 1 ? 'u-tip-h' : null }, l)));
  }
  return null;
}

function place(e) {
  if (!tipEl || tipEl.hidden) return;
  const sr = stage.getBoundingClientRect();
  const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  let x = e.clientX - sr.left + 14, y = e.clientY - sr.top + 16;
  if (x + w > sr.width - 6) x = e.clientX - sr.left - w - 14;
  if (y + hh > sr.height - 6) y = e.clientY - sr.top - hh - 12;
  tipEl.style.left = Math.max(4, x) + 'px';
  tipEl.style.top = Math.max(4, y) + 'px';
}

function hide() { cur = null; if (tipEl) tipEl.hidden = true; }

export function initTooltip() {
  tipEl = document.getElementById('tooltip');
  stage = document.getElementById('stage');
  if (!tipEl) return;
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('[data-tip],[data-tip-def]');
    if (el === cur) return;
    if (!el) { hide(); return; }
    const c = contentFor(el);
    if (!c) { hide(); return; }
    cur = el;
    clear(tipEl).appendChild(c);
    tipEl.hidden = false;
    place(e);
  });
  document.addEventListener('mousemove', e => { if (cur) place(e); });
  document.addEventListener('mousedown', hide);
  document.addEventListener('scroll', hide, true);
}
export function hideTooltip() { hide(); }
