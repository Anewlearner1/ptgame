// ☕ 支持作者: donation page (modal body reused by the cover and 系統 → 支持作者). Links out only; entry points hide while no URL is set.
import { h } from './dom.js';
import { artBanner } from './artdom.js';
import { showModal } from './modal.js';
import { SUPPORT, supportUrl } from '../data/support.js';

export function supportAvailable() { return !!supportUrl(); }

export function openSupportLink() {
  const u = supportUrl(); if (!u) return;
  const a = h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' });     // (window.open + noopener always returns null, so it cannot detect a blocked popup)
  document.body.appendChild(a); a.click(); a.remove();
}

export function supportBody() {
  return h('div', { class: 'support-page', dataset: { support: 'page' } },
    artBanner('scene.clinic', { title: '診所一景', cls: 'u-banner-sm' }),
    h('p', { class: 'support-lead' }, SUPPORT.lead),
    h('ul', { class: 'support-points' }, SUPPORT.points.map(t => h('li', null, t))),
    h('p', { class: 'support-thanks' }, SUPPORT.thanks),
    h('button', { class: 'btn primary support-go', type: 'button', dataset: { support: 'go' }, onclick: openSupportLink }, '☕ ' + SUPPORT.button + ' ↗'),
    h('p', { class: 'muted u-small support-note' }, '會在新分頁開啟外部網站。'));
}

export function showSupport() {
  if (!supportAvailable()) return;
  showModal({ title: SUPPORT.title, body: supportBody(), tag: 'support', cls: 'support-modal', buttons: [{ label: '關閉', primary: false }] });
}
