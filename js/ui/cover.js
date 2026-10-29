// 封面: title screen shown on every launch (skipped under automation or with ?nocover). The sim stays frozen behind it
// (ui.coverOn is read by the frame loop in main.js). Carries 繼續／開始遊戲 and the shared 安裝與全螢幕 controls.
import { h } from './dom.js';
import { artBanner } from './artdom.js';
import { installBox } from './installbox.js';
import { listSaves } from '../sim/save.js';
import { fmtDateTime } from './fmt.js';
import { bus } from '../core/bus.js';
import { supportAvailable, showSupport } from './support.js';
import { isModalOpen } from './modal.js';

export function coverWanted() {
  let q = '';
  try { q = location.search; } catch (e) { /* ignore */ }
  if (/[?&]cover=1\b/.test(q)) return true;
  if (/[?&]nocover\b/.test(q)) return false;
  return !navigator.webdriver;                // automated browsers (the test tools) go straight into the game
}

export function showCover(ui) {
  if (document.getElementById('cover')) return;
  let auto = null;
  try { auto = listSaves().find(s => s.slot === 'auto') || null; } catch (e) { auto = null; }
  const go = h('button', { class: 'btn primary cover-go', type: 'button', dataset: { cover: 'start' }, onclick: close },
    auto ? '▶ 繼續遊戲' : '▶ 開始遊戲');
  const box = installBox({ always: true });
  const el = h('div', { id: 'cover', class: 'cover', role: 'dialog', 'aria-label': '復健科診所物語 封面' },
    h('div', { class: 'cover-card' },
      h('div', { class: 'cover-title' }, '復健科診所物語'),
      h('div', { class: 'cover-sub' }, '台灣復健科診所模擬經營'),
      artBanner('scene.clinic', { title: '診所一景', maxVh: 30 }),
      go,
      supportAvailable() ? h('button', { class: 'btn small cover-support', type: 'button', dataset: { cover: 'support' }, onclick: showSupport }, '☕ 支持作者') : null,
      auto ? h('div', { class: 'cover-save muted u-small' }, `自動存檔：${auto.label || ''}　${auto.savedAt ? fmtDateTime(auto.savedAt) : ''}`) : null,
      box ? h('div', { class: 'cover-install', dataset: { cover: 'install' } }, h('div', { class: 'u-sec' }, '📲 安裝與全螢幕'), ...box) : null));
  function close() {
    ui.coverOn = false;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    bus.emit('cover:closed', {});
  }
  function onKey(e) {
    if (isModalOpen()) return;                 // the support page (or tutorial) has the keyboard
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  ui.coverOn = true;
  document.addEventListener('keydown', onKey, true);
  document.getElementById('app').append(el);
  go.focus({ preventScroll: true });
}
