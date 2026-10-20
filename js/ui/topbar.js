// Top bar: left = clinic / date / clock / weather; right = money, 3 point types, reputation, NHI point value.
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import { h, setText } from './dom.js';
import { toggleFullscreen } from './pwa.js';
import { fmt, money, POINT_ICONS } from './fmt.js';
import { POINT_KEYS, POINT_LABELS } from '../core/constants.js';
import { formatDate, formatClock } from '../sim/calendar.js';
import { getPointValue } from '../sim/economy.js';
import { WEATHER } from '../data/events.js';
import { TITLES } from '../data/texts.js';
import { LOTS } from '../data/lots.js';
import { displayTitle } from '../sim/achievements.js';

const els = {};
let last = {};

function item(key, ico, cls, tip, withShort) {
  const lbl = h('span', { class: 'tb-lbl' });
  const val = h('span', { class: 'tb-val' });
  const icoEl = h('span', { class: 'tb-ico' }, ico);
  const short = withShort ? h('span', { class: 'tb-short' }) : null;   // compact text shown instead of .tb-val on phones
  const el = h('div', { class: 'tb-item ' + (cls || ''), tip }, icoEl, lbl, val, short);
  els[key] = { el, val, lbl, ico: icoEl, short };
  return el;
}

export function titleFor(rep) {
  let cur = TITLES[0], next = null;
  for (let i = 0; i < TITLES.length; i++) {
    if (rep >= TITLES[i].minRep) { cur = TITLES[i]; next = TITLES[i + 1] || null; }
  }
  return { cur, next };
}

export function initTopbar() {
  const root = document.getElementById('topbar');
  const left = h('div', { class: 'tb-left' },
    item('clinic', '🏥', 'tb-clinic'),
    item('date', '📅', 'tb-date', null, true),
    item('weather', '☀️', 'tb-weather', null, true),
    item('title', '🎖', 'tb-title'));
  const right = h('div', { class: 'tb-right' },
    item('money', '💰', 'tb-money', '資金'),
    POINT_KEYS.map(k => item('p_' + k, POINT_ICONS[k], 'tb-pt', `${POINT_LABELS[k]}點\n研發用的點數。治療完成時獲得，研發與訓練會消耗。`)),
    item('rep', '🏆', 'tb-rep'),
    item('pv', '🧾', 'tb-pv'));
  // short landscape: the NHI value and the rest live in a tap-to-expand stats popover
  const statsBtn = h('button', { class: 'tb-stats', type: 'button', 'aria-label': '更多數據', 'aria-expanded': 'false', onclick: e => { e.stopPropagation(); togglePop(); } }, '📊');
  right.appendChild(statsBtn);
  root.append(left, right, h('span', { class: 'tb-break', 'aria-hidden': 'true' }), buildPop());
  document.addEventListener('pointerdown', e => { if (popEl && !popEl.hidden && !e.target.closest('.tb-pop, .tb-stats')) hidePop(); }, true);
  bus.on('layout:changed', hidePop);
  els.title.el.hidden = true;                  // only shown while a special title is equipped
  els.money.lbl.textContent = '';
  els.date.lbl.textContent = '';
  els.rep.lbl.textContent = '聲譽 ';
  els.pv.lbl.textContent = '點值 ';
  for (const k of POINT_KEYS) els['p_' + k].lbl.textContent = POINT_LABELS[k] + ' ';
  last = {};
}

// ---- stats popover (compact landscape) ----
let popEl = null, pop = {}, popTimer = 0;
function buildPop() {
  const row = (k, ico, label) => {
    const v = h('b', { class: 'tb-pop-v' });
    pop[k] = v;
    return h('div', { class: 'tb-pop-row' }, h('span', null, ico + ' ' + label), v);
  };
  pop.note = h('div', { class: 'tb-pop-note muted' });
  pop.fs = h('button', { class: 'btn small', type: 'button', onclick: () => toggleFullscreen() }, '⛶ 全螢幕');
  popEl = h('div', { class: 'tb-pop', hidden: true, role: 'dialog' },
    row('pv', '🧾', '健保點值'), pop.note, row('clinic', '🏥', '診所'), row('title', '🎖', '稱號'), row('weather', '☀️', '天氣'), pop.fs);
  return popEl;
}
function togglePop() { if (popEl.hidden) showPop(); else hidePop(); }
function showPop() {
  popEl.hidden = false;
  updateTopbar(ctx.state);
  document.querySelector('.tb-stats').setAttribute('aria-expanded', 'true');
  clearTimeout(popTimer); popTimer = setTimeout(hidePop, 9000);
}
function hidePop() {
  if (!popEl || popEl.hidden) return;
  popEl.hidden = true; clearTimeout(popTimer);
  const b = document.querySelector('.tb-stats'); if (b) b.setAttribute('aria-expanded', 'false');
}

function flash(el, up) {
  const c1 = up ? 'tb-flash-up' : 'tb-flash-down', c2 = up ? 'tb-flash-down' : 'tb-flash-up';
  el.classList.remove(c1, c2);
  void el.offsetWidth;
  el.classList.add(c1);
}

export function updateTopbar(state) {
  setText(els.clinic.val, state.clinicName || '');
  const dtxt = formatDate(state), ctxt = formatClock(state);
  setText(els.date.val, dtxt + '　' + ctxt);
  setText(els.date.short, dtxt.replace(/\s+/g, '').replace(/^第/, '').replace('第', '') + ' ' + ctxt);
  els.date.el.dataset.tip = dtxt + ' ' + ctxt;

  // weather
  const wk = state.weather && state.weather.kind;
  const w = (state.weather && state.weather.id && WEATHER.find(x => x.id === state.weather.id)) || WEATHER.find(x => x.kind === wk);
  setText(els.weather.ico, w ? w.icon : '☀️');
  const wtxt = `${w ? w.name : ''} ${state.weather ? Math.round(state.weather.temp) : ''}°C`;
  setText(els.weather.val, wtxt);
  setText(els.weather.short, `${state.weather ? Math.round(state.weather.temp) : ''}°`);
  els.weather.el.dataset.tip = `${wtxt}\n天氣會影響來客量與病患狀況。`;

  const m = Math.round(state.money);
  setText(els.money.val, money(m));
  if (last.money != null && m !== last.money) flash(els.money.el, m > last.money);
  last.money = m;
  els.money.val.parentElement.classList.toggle('u-neg', m < 0);

  for (const k of POINT_KEYS) {
    const v = Math.floor(state.points[k] || 0);
    setText(els['p_' + k].val, fmt(v));
    if (last[k] != null && v !== last[k] && v > last[k]) flash(els['p_' + k].el, true);
    last[k] = v;
  }

  const rep = Math.round(state.reputation);
  setText(els.rep.val, fmt(rep));
  const { cur, next } = titleFor(rep);
  let dt = cur.title;                         // 〔特殊稱號〕聲譽稱號 (docs/ACHIEVEMENTS.md §2)
  try { dt = displayTitle(state) || cur.title; } catch (e) { /* achievements module not ready */ }
  els.rep.el.dataset.tip = `聲譽 ${rep} / 1000\n稱號：${dt}` + (next ? `\n再 ${next.minRep - rep} 點升級為「${next.title}」` : '\n已達最高稱號') + '\n聲譽越高，每週來客越多。';

  let pv = state.nhi.pointValue;
  try { pv = getPointValue(state); } catch (e) { /* keep last settled */ }
  setText(els.pv.val, pv.toFixed(2));
  els.pv.el.classList.toggle('u-bad', pv < 0.995);
  const lot = LOTS[state.lotLevel || 0];
  const cap = lot ? Math.round(lot.nhiCap * (1 + ((state.mods && state.mods.nhiCapBonus) || 0))) : 0;
  const lastPv = state.nhi.lastSettlement && state.nhi.lastSettlement.pointValue != null ? state.nhi.lastSettlement.pointValue : state.nhi.pointValue;
  els.pv.el.dataset.tip = `健保點值（本月預估）\n本月已申報 ${fmt(state.nhi.monthPoints)} 點 / 上限 ${fmt(cap)} 點\n超過上限會稀釋所有點數的點值（最低 0.6）。\n上次結算點值：${Number(lastPv).toFixed(2)}`;
  const special = !!(state.achv && state.achv.title) && dt !== cur.title;
  els.title.el.hidden = !special;
  if (special) { setText(els.title.val, dt); els.title.el.dataset.tip = `院長稱號\n${dt}\n可在「診所 → 稱號與徽章」更換。`; }
  els.clinic.el.dataset.tip = `${state.clinicName}\n${lot ? lot.name : ''}　稱號：${dt}`;
  if (popEl && !popEl.hidden) {
    setText(pop.pv, pv.toFixed(2) + (pv < 0.995 ? ' ⚠' : ''));
    setText(pop.note, `本月已申報 ${fmt(state.nhi.monthPoints)} / 上限 ${fmt(cap)} 點`);
    setText(pop.clinic, `${state.clinicName || ''}${lot ? '（' + lot.name + '）' : ''}`);
    setText(pop.title, dt);
    setText(pop.weather, wtxt);
  }
}
