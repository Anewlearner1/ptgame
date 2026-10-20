// Speed bar: ⏸ ×1 ×2 ×3, skip-week, help. Emits bus 'speed:set'; highlights from state + the event.
import { bus } from '../core/bus.js';
import { h, setClass } from './dom.js';
import { isModalOpen, setResumeSpeed } from './modal.js';

const btns = {};
let optimistic = null;     // speed we just requested, until state catches up
let skipping = null;       // {prev} while 「跳過本週」 is active
let skipBtn = null;

export function initSpeedbar(state, onHelp) {
  const root = document.getElementById('speedbar');
  const defs = [[0, '⏸', '暫停（空白鍵）'], [1, '×1', '正常速度（1）'], [2, '×2', '兩倍速（2）'], [3, '×3', '三倍速（3）']];
  for (const [sp, label, tip] of defs) {
    btns[sp] = h('button', { class: 'speed-btn', type: 'button', tip, onclick: () => { cancelSkip(); setSpeed(sp); } }, label);
    root.appendChild(btns[sp]);
  }
  skipBtn = h('button', {
    class: 'speed-btn', type: 'button', tip: '用最高速快轉到本週結束',
    onclick: () => {
      if (skipping) { cancelSkip(true); return; }
      skipping = { prev: currentSpeed(state) || 1 };
      setSpeed(3);
    },
  }, '⏩ 跳過本週');
  root.appendChild(skipBtn);
  root.appendChild(h('button', { class: 'speed-btn', type: 'button', tip: '操作說明（?）', onclick: onHelp }, '?'));
  bus.on('speed:set', ({ speed }) => { optimistic = speed; });
  bus.on('week:start', () => { if (skipping) cancelSkip(true); });
}

function currentSpeed(state) { return state.time.paused ? 0 : state.time.speed; }
function setSpeed(sp) { bus.emit('speed:set', { speed: sp }); }
function cancelSkip(restore) {
  if (!skipping) return;
  const prev = skipping.prev; skipping = null;
  if (!restore) return;
  if (isModalOpen()) setResumeSpeed(prev);   // a report modal paused the sim; resume to prev when it closes
  else setSpeed(prev);
}

export function updateSpeedbar(state) {
  const cur = currentSpeed(state);
  if (optimistic != null && cur === optimistic) optimistic = null;
  const shown = optimistic != null ? optimistic : cur;
  for (const k of Object.keys(btns)) setClass(btns[k], 'active', Number(k) === shown);
  setClass(skipBtn, 'active', !!skipping);
  skipBtn.textContent = skipping ? '⏩ 快轉中…' : '⏩ 跳過本週';
}
