// Top bar: left = shop / date / clock / weather; right = money, 3 point types, reputation, 食安風險.
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import { h, setText } from './dom.js';
import { toggleFullscreen } from './pwa.js';
import { fmt, money, POINT_ICONS } from './fmt.js';
import { POINT_KEYS, POINT_LABELS } from '../core/constants.js';
import { formatDate, formatClock } from '../sim/calendar.js';
import { riskOf, RISK_TUNE } from '../sim/economy.js';
import { WEATHER } from '../data/events.js';
import { TITLES } from '../data/texts.js';
import { LOTS } from '../data/lots.js';
import { displayTitle } from '../sim/achievements.js';
import { artEl } from './artdom.js';
import { dual, icon, iconSvg, weatherIconName } from './icons.js';

const els = {};
let last = {};
// 廚藝 / 設備 / 服務 points: atlas role sprites when available, inline svg icons otherwise
const POINT_SPRITE = { culinary: 'role.inquiry', device: 'role.equip', service: 'role.educate' };
const POINT_FALLBACK = { culinary: 'bowl', device: 'gear', service: 'bulb' };

// icon slot: the classic emoji + (concept style) an svg icon name or a ready node (atlas sprite); css shows exactly one
function slot(emoji, concept) { return dual(emoji, concept); }
const sprite = (name, fallbackIcon) => artEl(name, { size: 22, fallback: icon(fallbackIcon), cls: 'u-art-ico' });

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
    item('clinic', slot('🍜', 'clinic'), 'tb-clinic'),
    item('date', slot('📅', 'calendar'), 'tb-date', null, true),
    item('weather', slot('☀️', 'sunny'), 'tb-weather', null, true),
    item('title', slot('🎖', 'medal'), 'tb-title'));
  const right = h('div', { class: 'tb-right' },
    item('money', slot('💰', 'coin'), 'tb-money', '資金'),
    POINT_KEYS.map(k => item('p_' + k, slot(POINT_ICONS[k], sprite(POINT_SPRITE[k], POINT_FALLBACK[k])), 'tb-pt', `${POINT_LABELS[k]}點\n研發用的點數。餐點完成時獲得，研發與訓練會消耗。`)),
    item('rep', slot('🏆', 'trophy'), 'tb-rep'),
    item('pv', slot('🧾', sprite('role.record', 'bill')), 'tb-pv'));
  // short landscape: the food-safety risk and the rest live in a tap-to-expand stats popover
  const statsBtn = h('button', { class: 'tb-stats', type: 'button', 'aria-label': '更多數據', 'aria-expanded': 'false', onclick: e => { e.stopPropagation(); togglePop(); } }, slot('📊', 'stats'));
  right.appendChild(statsBtn);
  root.append(left, right, h('span', { class: 'tb-break', 'aria-hidden': 'true' }), buildPop());
  document.addEventListener('pointerdown', e => { if (popEl && !popEl.hidden && !e.target.closest('.tb-pop, .tb-stats')) hidePop(); }, true);
  bus.on('layout:changed', hidePop);
  els.title.el.hidden = true;                  // only shown while a special title is equipped
  els.money.lbl.textContent = '';
  els.date.lbl.textContent = '';
  els.rep.lbl.textContent = '聲譽 ';
  els.pv.lbl.textContent = '食安 ';
  for (const k of POINT_KEYS) els['p_' + k].lbl.textContent = POINT_LABELS[k] + ' ';
  last = {};
}

// ---- stats popover (compact landscape) ----
let popEl = null, pop = {}, popTimer = 0;
function buildPop() {
  const row = (k, ico, label) => {
    const v = h('b', { class: 'tb-pop-v' });
    pop[k] = v;
    return h('div', { class: 'tb-pop-row' }, h('span', null, dual(ico[0], ico[1]), ' ' + label), v);
  };
  pop.note = h('div', { class: 'tb-pop-note muted' });
  pop.fs = h('button', { class: 'btn small', type: 'button', onclick: () => toggleFullscreen() }, '⛶ 全螢幕');
  popEl = h('div', { class: 'tb-pop', hidden: true, role: 'dialog' },
    row('pv', ['🧾', 'bill'], '食安風險'), pop.note, row('clinic', ['🍜', 'clinic'], '餐廳'), row('title', ['🎖', 'medal'], '稱號'), row('weather', ['☀️', 'sunny'], '天氣'), pop.fs);
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

// weather icon: emoji for classic, hand-drawn svg (by weather kind) for the concept style
function setWeatherIcon(w) {
  const d = els.weather.ico.firstChild;
  const emoji = w ? w.icon : '☀️', name = weatherIconName(w ? w.kind : 'sunny');
  if (d._e !== emoji) { d._e = emoji; d._c.textContent = emoji; }
  if (d._n.dataset.ico !== name) { d._n.dataset.ico = name; d._n.innerHTML = iconSvg(name); }
}

export function updateTopbar(state) {
  setText(els.clinic.val, state.shopName || '');
  const dtxt = formatDate(state), ctxt = formatClock(state);
  setText(els.date.val, dtxt + '　' + ctxt);
  setText(els.date.short, dtxt.replace(/\s+/g, '').replace(/^第/, '').replace('第', '') + ' ' + ctxt);
  els.date.el.dataset.tip = dtxt + ' ' + ctxt;

  // weather
  const wk = state.weather && state.weather.kind;
  const w = (state.weather && state.weather.id && WEATHER.find(x => x.id === state.weather.id)) || WEATHER.find(x => x.kind === wk);
  setWeatherIcon(w);
  const wtxt = `${w ? w.name : ''} ${state.weather ? Math.round(state.weather.temp) : ''}°C`;
  setText(els.weather.val, wtxt);
  setText(els.weather.short, `${state.weather ? Math.round(state.weather.temp) : ''}°`);
  els.weather.el.dataset.tip = `${wtxt}\n天氣會影響來客量與客人狀況。`;

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

  const risk = Math.round(riskOf(state));
  setText(els.pv.val, String(risk));
  els.pv.el.classList.toggle('u-bad', risk > RISK_TUNE.HIGH);
  const lot = LOTS[state.lotLevel || 0];
  els.pv.el.dataset.tip = `食安風險（0~100，越低越好）\n設備老舊、員工疲勞、客人滿意度低都會讓風險上升，每週自然下降 1。\n超過 ${RISK_TUNE.HIGH} 時食安類事件更容易發生，年度稽查也會被扣分。`;
  const special = !!(state.achv && state.achv.title) && dt !== cur.title;
  els.title.el.hidden = !special;
  if (special) { setText(els.title.val, dt); els.title.el.dataset.tip = `老闆稱號\n${dt}\n可在「餐廳 → 稱號與徽章」更換。`; }
  els.clinic.el.dataset.tip = `${state.shopName}\n${lot ? lot.name : ''}　稱號：${dt}`;
  if (popEl && !popEl.hidden) {
    setText(pop.pv, risk + (risk > RISK_TUNE.HIGH ? ' ⚠' : ''));
    setText(pop.note, '食安風險越低越安全');
    setText(pop.clinic, `${state.shopName || ''}${lot ? '（' + lot.name + '）' : ''}`);
    setText(pop.title, dt);
    setText(pop.weather, wtxt);
  }
}
