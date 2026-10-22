// Modal stack. Structure follows style.css: .modal-backdrop > .modal > .modal-title + .modal-body + .modal-actions
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import { h, clear } from './dom.js';
import { hideTooltip } from './tooltip.js';

let root = null;
let current = null;       // {opts, el}
const queue = [];
let closedAt = 0;
export function modalClosedRecently() { return performance.now() - closedAt < 120; }
let pausedBy = null;      // {prevSpeed} when we paused the sim for the open modal

export function initModal() {
  root = document.getElementById('modal-root');
  document.addEventListener('keydown', e => {
    if (!current) return;
    const editable = e.target && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
    if (current.opts.onKey) current.opts.onKey(e);
    // keep game hotkeys (space, 1/2/3, R, G) from reaching the map while a dialog is open
    if (!editable && (e.key === ' ' || /^[123rRgG]$/.test(e.key))) { e.stopPropagation(); if (e.key !== ' ' || !(e.target && e.target.tagName === 'BUTTON')) e.preventDefault(); return; }
    if (e.key === 'Escape' && current.opts.dismissable !== false) {
      e.preventDefault(); e.stopPropagation(); closeModal();
    } else if (e.key === 'Enter' && !(e.target && /^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(e.target.tagName))) {
      const primary = current.el.querySelector('.modal-actions .btn.primary:not([disabled])');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  }, true);
}

export function setResumeSpeed(sp) { if (pausedBy) pausedBy.prevSpeed = sp; }
export function isModalOpen() { return !!current; }
export function currentModalTag() { return current ? current.opts.tag : null; }

function pauseSim(opts) {
  if (pausedBy || opts.pause === false) return;
  const t = ctx.state.time;
  const prev = t.speed || 1;
  if (t.paused || t.speed === 0) {
    // already paused (e.g. by events.js for a dilemma). Remember to resume only when asked to.
    if (opts.resume) pausedBy = { prevSpeed: prev };
    return;
  }
  pausedBy = { prevSpeed: prev };
  bus.emit('speed:set', { speed: 0 });
}
function resumeSim() {
  if (!pausedBy) return;
  const t = ctx.state.time;
  const p = pausedBy; pausedBy = null;
  if (t.paused || t.speed === 0) bus.emit('speed:set', { speed: p.prevSpeed });
}

function render(opts) {
  const titleEl = h('div', { class: 'modal-title' }, opts.title || '');
  const body = h('div', { class: 'modal-body' });
  if (typeof opts.body === 'string') body.textContent = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  const actions = h('div', { class: 'modal-actions' });
  if (opts.noActions) actions.hidden = true;
  const btns = opts.buttons && opts.buttons.length ? opts.buttons : [{ label: '確定', primary: true }];
  for (const b of btns) {
    const el = h('button', {
      class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), type: 'button',
      disabled: !!b.disabled,
      onclick: () => {
        let keep = false;
        if (b.onClick) keep = b.onClick(el) === false;
        if (!keep && (!current || current.opts === opts)) closeModal();
      },
    }, b.label);
    actions.appendChild(el);
  }
  const modal = h('div', { class: 'modal' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog', 'aria-modal': 'true' }, titleEl, body, actions);
  const backdrop = h('div', {
    class: 'modal-backdrop',
    onmousedown: e => { if (e.target === backdrop && opts.dismissable !== false && opts.backdropClose) closeModal(); },
  }, modal);
  return backdrop;
}

// FIFO, except opts.rank (default 0): a higher rank always waits behind every lower-ranked modal (year review 20, career ending 30)
function enqueue(opts) {
  const r = opts.rank || 0;
  let i = queue.length;
  while (i > 0 && (queue[i - 1].rank || 0) > r) i--;
  queue.splice(i, 0, opts);
}

export function showModal(opts) {
  if (!root) root = document.getElementById('modal-root');
  if (current) {
    if (opts.replace) closeModal(true);
    else { enqueue(opts); return; }
  }
  hideTooltip();
  pauseSim(opts);
  const el = render(opts);
  current = { opts, el };
  root.appendChild(el);
  const first = el.querySelector('.btn.primary') || el.querySelector('.btn');
  if (first) first.focus({ preventScroll: true });
  if (opts.onShow) opts.onShow(el);
}

export function closeModal(keepPaused) {
  if (!current) return;
  const { opts, el } = current;
  current = null;
  closedAt = performance.now();
  el.remove();
  if (opts.onClose) { try { opts.onClose(); } catch (e) { console.error(e); } }
  if (queue.length) { showModal(queue.shift()); return; }
  if (!keepPaused) resumeSim();
}

// Replace body content of the open modal (used by multi-step dialogs).
export function setModalBody(node) {
  if (!current) return;
  const body = current.el.querySelector('.modal-body');
  clear(body).appendChild(node);
}

export function confirmDialog({ title = '確認', text, okLabel = '確定', cancelLabel = '取消', danger = false, onOk, onCancel }) {
  showModal({
    title, body: typeof text === 'string' ? h('p', { class: 'u-p' }, text) : text,
    pause: false, tag: 'confirm',
    buttons: [
      { label: cancelLabel, onClick: () => { if (onCancel) onCancel(); } },
      { label: okLabel, primary: !danger, danger, onClick: () => { if (onOk) onOk(); } },
    ],
  });
}
