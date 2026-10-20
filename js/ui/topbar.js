// Top bar: left = clinic / date / clock / weather; right = money, 3 point types, reputation, NHI point value.
import { h, setText } from './dom.js';
import { fmt, money, POINT_ICONS } from './fmt.js';
import { POINT_KEYS, POINT_LABELS } from '../core/constants.js';
import { formatDate, formatClock } from '../sim/calendar.js';
import { getPointValue } from '../sim/economy.js';
import { WEATHER } from '../data/events.js';
import { TITLES } from '../data/texts.js';
import { LOTS } from '../data/lots.js';

const els = {};
let last = {};

function item(key, ico, cls, tip) {
  const lbl = h('span', { class: 'tb-lbl' });
  const val = h('span', { class: 'tb-val' });
  const icoEl = h('span', { class: 'tb-ico' }, ico);
  const el = h('div', { class: 'tb-item ' + (cls || ''), tip }, icoEl, lbl, val);
  els[key] = { el, val, lbl, ico: icoEl };
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
    item('date', '📅', 'tb-date'),
    item('weather', '☀️', 'tb-weather'));
  const right = h('div', { class: 'tb-right' },
    item('money', '💰', 'tb-money', '資金'),
    POINT_KEYS.map(k => item('p_' + k, POINT_ICONS[k], 'tb-pt', `${POINT_LABELS[k]}點\n研發用的點數。治療完成時獲得，研發與訓練會消耗。`)),
    item('rep', '🏆', 'tb-rep'),
    item('pv', '🧾', 'tb-pv'));
  root.append(left, right);
  els.money.lbl.textContent = '';
  els.date.lbl.textContent = '';
  els.rep.lbl.textContent = '名聲 ';
  els.pv.lbl.textContent = '點值 ';
  for (const k of POINT_KEYS) els['p_' + k].lbl.textContent = POINT_LABELS[k] + ' ';
  last = {};
}

function flash(el, up) {
  const c1 = up ? 'tb-flash-up' : 'tb-flash-down', c2 = up ? 'tb-flash-down' : 'tb-flash-up';
  el.classList.remove(c1, c2);
  void el.offsetWidth;
  el.classList.add(c1);
}

export function updateTopbar(state) {
  setText(els.clinic.val, state.clinicName || '');
  setText(els.date.val, formatDate(state) + '　' + formatClock(state));

  // weather
  const wk = state.weather && state.weather.kind;
  const w = (state.weather && state.weather.id && WEATHER.find(x => x.id === state.weather.id)) || WEATHER.find(x => x.kind === wk);
  setText(els.weather.ico, w ? w.icon : '☀️');
  setText(els.weather.val, `${w ? w.name : ''} ${state.weather ? Math.round(state.weather.temp) : ''}°C`);

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
  els.rep.el.dataset.tip = `聲譽 ${rep} / 1000\n稱號：${cur.title}` + (next ? `\n再 ${next.minRep - rep} 點升級為「${next.title}」` : '\n已達最高稱號') + '\n聲譽越高，每週來客越多。';

  let pv = state.nhi.pointValue;
  try { pv = getPointValue(state); } catch (e) { /* keep last settled */ }
  setText(els.pv.val, pv.toFixed(2));
  els.pv.el.classList.toggle('u-bad', pv < 0.995);
  const lot = LOTS[state.lotLevel || 0];
  const cap = lot ? Math.round(lot.nhiCap * (1 + ((state.mods && state.mods.nhiCapBonus) || 0))) : 0;
  const lastPv = state.nhi.lastSettlement && state.nhi.lastSettlement.pointValue != null ? state.nhi.lastSettlement.pointValue : state.nhi.pointValue;
  els.pv.el.dataset.tip = `健保點值（本月預估）\n本月已申報 ${fmt(state.nhi.monthPoints)} 點 / 上限 ${fmt(cap)} 點\n超過上限會稀釋所有點數的點值（最低 0.6）。\n上次結算點值：${Number(lastPv).toFixed(2)}`;
  els.clinic.el.dataset.tip = `${state.clinicName}\n${lot ? lot.name : ''}　稱號：${cur.title}`;
}
