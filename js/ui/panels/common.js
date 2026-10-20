// Shared panel pieces.
import { bus } from '../../core/bus.js';
import { BOARDS } from '../../data/events.js';
import * as EV from '../../sim/events.js';
import { h, setClass, setText } from '../dom.js';
import { modChips, money } from '../fmt.js';

export function chipList(list) {
  return h('span', { class: 'u-chips' }, list.map(c => h('span', { class: 'tag u-chip ' + (c.good ? 'good' : 'bad') }, c.text)));
}

export function section(title, ...kids) {
  return h('div', { class: 'u-section' }, h('div', { class: 'u-sec' }, title), kids);
}

// 衛教看板 toggles (used by 診所 and 運作 panels)
export function boardsSection(state) {
  const list = h('div', { class: 'u-list2' });
  const rows = {};
  for (const b of BOARDS) {
    const btn = h('button', { class: 'btn small', type: 'button', onclick: () => {
      const on = !state.policy.boards.includes(b.id);
      let ok = true;
      try { ok = EV.setBoard(state, b.id, on); } catch (e) { console.error(e); ok = false; }
      if (ok === false) bus.emit('toast', { text: on ? '資金不足，無法張貼看板' : '無法撤下看板', kind: 'bad' });
    } });
    const el = h('div', { class: 'card u-row2', dataset: { board: b.id } },
      h('div', { class: 'u-grow' },
        h('b', null, '📌 ' + b.name),
        h('div', { class: 'muted u-small' }, b.desc),
        h('div', { class: 'u-small' }, chipList(modChips(b.effects)), `　張貼 ${money(b.cost)}　維護 ${money(b.upkeep)}/月`)),
      btn);
    rows[b.id] = { el, btn, on: null };
    list.appendChild(el);
  }
  return {
    el: section('衛教看板（張貼後長期生效，每月扣維護費）', list),
    update(state) {
      for (const b of BOARDS) {
        const r = rows[b.id], on = state.policy.boards.includes(b.id);
        if (r.on !== on) { r.on = on; setText(r.btn, on ? '撤下' : '張貼'); setClass(r.el, 'selected', on); setClass(r.btn, 'danger', on); }
        r.btn.disabled = !on && state.money < b.cost;
      }
    },
  };
}
