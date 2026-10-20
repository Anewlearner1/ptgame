// 診所 panel: 經營方針 / 衛教看板 / 擴建 / 院長稱號
import { bus } from '../../core/bus.js';
import { FOCUS, PATIENT_TYPES } from '../../data/patients.js';
import { POLICY_TEXT } from '../../data/events.js';
import { LOTS } from '../../data/lots.js';
import { BUILDABLES } from '../../data/buildables.js';
import { TITLES } from '../../data/texts.js';
import * as EV from '../../sim/events.js';
import * as INSP from '../../sim/inspection.js';
import { h, setClass, setText, tabbed, bar, setBar } from '../dom.js';
import { money, fmt, TYPE_ICONS } from '../fmt.js';
import { chipList, section, boardsSection } from './common.js';
import { confirmDialog } from '../modal.js';
import { titleFor } from '../topbar.js';

const store = { tab: 'policy' };

function buildPolicy(body, state) {
  const cards = {};
  const wrap = h('div', { class: 'u-list2' });
  for (const f of Object.keys(FOCUS)) {
    const F = FOCUS[f], T = POLICY_TEXT[f] || {};
    const chips = Object.keys(F.spawnMult).map(t => {
      const v = F.spawnMult[t];
      return { text: `${TYPE_ICONS[t] || ''}${(PATIENT_TYPES[t] || {}).name || t} ×${v}`, good: v >= 1 };
    });
    const mark = h('span', { class: 'badge' }, '目前方針');
    const el = h('div', { class: 'card u-focus', role: 'button', tabIndex: 0, dataset: { id: f }, onclick: () => pick(f) },
      h('div', null, h('b', null, `${F.name}`), ' ', h('span', { class: 'muted' }, T.label || ''), ' ', mark),
      h('div', { class: 'muted u-small' }, T.hint || ''),
      h('div', { class: 'u-small' }, F.desc),
      h('div', { class: 'u-small' }, '各類病患來客倍率：', chipList(chips)));
    cards[f] = { el, mark };
    wrap.appendChild(el);
  }
  function pick(f) {
    if (state.policy.focus === f) return;
    try { EV.setFocus(state, f); } catch (e) { state.policy.focus = f; bus.emit('mods:dirty', {}); }
    bus.emit('toast', { text: `經營方針改為「${FOCUS[f].name}」`, kind: 'info' });
  }
  body.append(section('經營方針', wrap));

  const nameIn = h('input', { type: 'text', maxLength: 16, class: 'u-input', value: state.clinicName || '' });
  const save = () => {
    const v = nameIn.value.trim();
    if (v) { state.clinicName = v; nameIn._dirty = false; bus.emit('toast', { text: '診所名稱已更新', kind: 'good' }); }
  };
  nameIn.addEventListener('input', () => { nameIn._dirty = true; });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); nameIn.blur(); } e.stopPropagation(); });
  body.append(section('診所名稱', h('div', { class: 'row' }, nameIn, h('button', { class: 'btn small', type: 'button', onclick: save }, '儲存'))));
  return {
    update() {
      for (const f of Object.keys(cards)) {
        const on = state.policy.focus === f;
        setClass(cards[f].el, 'selected', on);
        cards[f].mark.hidden = !on;
      }
      if (document.activeElement !== nameIn && nameIn.value !== state.clinicName && !nameIn._dirty) nameIn.value = state.clinicName || '';
    },
  };
}

function buildBoards(body, state) {
  const b = boardsSection(state);
  body.append(b.el);
  return { update() { b.update(state); } };
}

// ---- expansion
function stat(state) {
  const seats = state.objects.reduce((a, o) => a + ((BUILDABLES[o.defId] || {}).seats || 0), 0);
  const ramp = state.map.floor.some(r => r.some(c => c === 'ramp')) || state.objects.some(o => o.defId === 'ramp');
  const n = state.stats.satN;
  return { seats, ramp, avgSat: n ? state.stats.satSum / n : 0, staff: state.staff.length, rep: state.reputation, year: state.time.year };
}
function reqRows(req, s) {
  const out = [];
  if (req.minReputation) out.push({ key: 'rep', text: `聲譽 ≥ ${req.minReputation}`, cur: Math.round(s.rep), ok: s.rep >= req.minReputation });
  if (req.minYear > 1) out.push({ key: 'year', text: `第 ${req.minYear} 年起`, cur: `第 ${s.year} 年`, ok: s.year >= req.minYear });
  if (req.minStaff) out.push({ key: 'staff', text: `員工 ≥ ${req.minStaff} 人`, cur: s.staff, ok: s.staff >= req.minStaff });
  if (req.minAvgSat) out.push({ key: 'sat', text: `平均滿意度 ≥ ${req.minAvgSat}`, cur: Math.round(s.avgSat), ok: s.avgSat >= req.minAvgSat });
  if (req.needRamp) out.push({ key: 'ramp', text: '有無障礙坡道', cur: s.ramp ? '有' : '沒有', ok: s.ramp });
  if (req.minSeats) out.push({ key: 'seats', text: `候診座位 ≥ ${req.minSeats}`, cur: s.seats, ok: s.seats >= req.minSeats });
  return out;
}

function buildExpand(body, state) {
  const info = h('div'), list = h('div', { class: 'u-list2' }), btn = h('button', { class: 'btn primary', type: 'button' }, '擴建');
  const note = h('div', { class: 'bad u-small' });
  let rowsKey = '', rowEls = [];
  btn.addEventListener('click', () => {
    const next = LOTS[(state.lotLevel || 0) + 1];
    if (!next) return;
    confirmDialog({
      title: '擴建診所', text: `擴建為「${next.name}」需花費 ${money(next.expandCost)}。確定要擴建嗎？`, okLabel: '擴建',
      onOk: () => {
        let ok = false;
        try { ok = INSP.expand(state); } catch (e) { console.error(e); }
        bus.emit('toast', ok ? { text: `擴建完成：${next.name}`, kind: 'good' } : { text: '擴建失敗', kind: 'bad' });
      },
    });
  });
  body.append(section('擴建診所', info, list, note, h('div', { class: 'row' }, btn)));
  return {
    update() {
      const lvl = state.lotLevel || 0, cur = LOTS[lvl], next = LOTS[lvl + 1];
      if (!next) {
        setText(info, `🏆 ${cur.name}已是最大規模！`); list.hidden = true; btn.hidden = true; note.hidden = true; return;
      }
      const cmp = (label, a, b, f = fmt) => h('div', { class: 'u-cmp' }, h('span', { class: 'muted' }, label), h('span', null, `${f(a)} → `), h('b', null, f(b)));
      const sig = lvl + '';
      if (info._sig !== sig) {
        info._sig = sig;
        info.replaceChildren(
          h('div', null, `目前：${cur.name}　下一級：`, h('b', null, next.name)),
          h('div', { class: 'u-grid2' },
            cmp('土地', cur.lot.w * cur.lot.h, next.lot.w * next.lot.h, v => v + ' 格'),
            cmp('健保上限', cur.nhiCap, next.nhiCap),
            cmp('每週來客上限', cur.maxPatientsPerWeek, next.maxPatientsPerWeek),
            cmp('員工上限', cur.maxStaff, next.maxStaff),
            cmp('房租/月', cur.rent, next.rent, money),
            cmp('擴建費', 0, next.expandCost, v => money(v))));
      }
      const rows = reqRows(next.requires || {}, stat(state));
      const k = rows.map(r => r.key + r.ok + r.cur).join('|');
      if (k !== rowsKey) {
        rowsKey = k;
        list.replaceChildren(...rows.map(r => h('div', { class: 'u-check ' + (r.ok ? 'good' : 'bad') },
          h('span', null, r.ok ? '✔' : '✘'), h('span', { class: 'u-grow' }, r.text), h('span', { class: 'muted' }, `目前 ${r.cur}`))));
      }
      let can = { ok: false, missing: [] };
      try { can = INSP.canExpand(state); } catch (e) { /* module not ready */ }
      const afford = state.money >= next.expandCost;
      btn.disabled = !(can.ok && afford);
      setText(btn, `擴建（${money(next.expandCost)}）`);
      const allOk = rows.every(r => r.ok);
      setText(note, !can.ok && allOk && can.missing && can.missing.length ? '尚未達成：' + can.missing.join('、') : (!afford && can.ok ? '資金不足' : ''));
    },
  };
}

function buildTitle(body, state) {
  const nameEl = h('div', { class: 'u-bigtitle' }), nextEl = h('div', { class: 'muted' }), b = bar();
  const list = h('div', { class: 'u-list2' });
  const items = TITLES.map(t => {
    const el = h('div', { class: 'u-check' }, h('span'), h('span', { class: 'u-grow' }, t.title), h('span', { class: 'muted' }, `聲譽 ${t.minRep}`));
    list.appendChild(el);
    return { t, el };
  });
  body.append(section('院長稱號', nameEl, b, nextEl, list));
  return {
    update() {
      const rep = Math.round(state.reputation);
      const { cur, next } = titleFor(rep);
      setText(nameEl, `🎖 ${cur.title}`);
      setBar(b, next ? (rep - cur.minRep) / (next.minRep - cur.minRep) : 1);
      setText(nextEl, next ? `聲譽 ${rep}　距離「${next.title}」還差 ${next.minRep - rep}` : `聲譽 ${rep}　已達最高稱號`);
      for (const it of items) {
        const ok = rep >= it.t.minRep;
        it.el.className = 'u-check ' + (ok ? 'good' : 'muted');
        setText(it.el.firstChild, ok ? '★' : '☆');
      }
    },
  };
}

export function mountClinic(root, state, ui) {
  const t = tabbed([
    { id: 'policy', label: '🧭 經營方針', build: b => buildPolicy(b, state) },
    { id: 'boards', label: '📌 衛教看板', build: b => buildBoards(b, state) },
    { id: 'expand', label: '🏗 擴建', build: b => buildExpand(b, state) },
    { id: 'title', label: '🎖 稱號', build: b => buildTitle(b, state) },
  ], store);
  root.appendChild(t.el);
  return { update() { t.update(); } };
}
