// Selection info card (bottom-right, above the speed bar): shows patient / staff / object details.
import { bus } from '../core/bus.js';
import { BUILDABLES } from '../data/buildables.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { TREATMENTS } from '../data/treatments.js';
import { STAFF_ROLES, TRAITS } from '../data/staffdefs.js';
import { removeAt } from '../sim/build.js';
import { h, clear, setText, bar, setBar, toneOf, setClass } from './dom.js';
import { STAGE_LABELS, STAFF_STATE_LABELS, TYPE_ICONS, ROLE_ICONS, money } from './fmt.js';
import { confirmDialog } from './modal.js';

let card = null, body = null, key = null, refs = null;

export function initSelection(state, ui) {
  card = h('div', { class: 'u-selcard', hidden: true });
  document.getElementById('stage').appendChild(card);
  bus.on('select:changed', () => { key = null; });
}

function find(state, sel) {
  if (!sel) return null;
  if (sel.type === 'patient') return state.patients.find(p => p.id === sel.id) || null;
  if (sel.type === 'staff') return state.staff.find(s => s.id === sel.id) || null;
  if (sel.type === 'object') return state.objects.find(o => o.id === sel.id) || null;
  return null;
}

function close(ui) {
  ui.selected = null;
  bus.emit('select:changed', { selected: null });
}

function row(label, node) { return h('div', { class: 'u-srow' }, h('span', { class: 'muted' }, label), node); }

function buildPatient(state, ui, e) {
  const P = PATIENT_TYPES[e.type] || {};
  refs = {
    stage: h('span', { class: 'tag' }), pat: bar(), sat: bar(), cure: bar(), bubble: h('div', { class: 'u-bubble' }),
    plan: h('div', { class: 'u-chips' }), paid: h('span'), flags: h('span', { class: 'muted' }),
  };
  body.append(
    h('div', { class: 'u-shead' }, h('span', { class: 'u-sico' }, TYPE_ICONS[e.type] || '🙂'),
      h('div', { class: 'u-stitle' }, h('b', null, e.name), h('span', { class: 'muted' }, P.name || e.type)), refs.stage),
    row('耐心', refs.pat), row('滿意度', refs.sat), row('康復進度', refs.cure),
    refs.plan, refs.bubble, row('已付', refs.paid), refs.flags);
}
function updPatient(state, e) {
  const P = PATIENT_TYPES[e.type] || {};
  setText(refs.stage, STAGE_LABELS[e.stage] || e.stage);
  setBar(refs.pat, e.patience / 100, toneOf(e.patience / 100));
  setBar(refs.sat, e.satisfaction / 100, toneOf(e.satisfaction / 100));
  setBar(refs.cure, (e.hp || 0) / (P.cureNeeded || 1));
  const sig = (e.plan || []).join(',') + '|' + e.planIdx;
  if (refs.plan._sig !== sig) {
    refs.plan._sig = sig;
    clear(refs.plan);
    (e.plan || []).forEach((t, i) => {
      const T = TREATMENTS[t];
      refs.plan.appendChild(h('span', { class: 'tag u-step' + (i < e.planIdx ? ' done' : i === e.planIdx ? ' cur' : '') },
        (i < e.planIdx ? '✓ ' : '') + (T ? T.name : t)));
    });
  }
  const b = e.bubble && e.bubble.text ? '💬 ' + e.bubble.text : '';
  setText(refs.bubble, b); refs.bubble.hidden = !b;
  setText(refs.paid, `健保 ${e.paid ? e.paid.nhi : 0} 點　自費 ${money(e.paid ? e.paid.self : 0)}`);
  const f = [];
  if (e.flags && e.flags.slipped) f.push('⚠ 曾滑倒');
  if (e.cured) f.push('✅ 已治癒');
  if (e.upsold) f.push('💰 已升級自費');
  setText(refs.flags, f.join('　'));
}

function buildStaff(state, ui, e) {
  const R = STAFF_ROLES[e.role] || {};
  const trait = TRAITS.find(t => t.id === e.trait);
  refs = { st: h('span', { class: 'tag' }), stam: bar(), task: h('div', { class: 'muted' }) };
  body.append(
    h('div', { class: 'u-shead' }, h('span', { class: 'u-sico' }, ROLE_ICONS[e.role] || '🧑‍⚕️'),
      h('div', { class: 'u-stitle' }, h('b', null, e.name), h('span', { class: 'muted' }, R.name || e.role)), refs.st),
    row('技術', h('b', null, `${'★'.repeat(Math.round(e.skill))}${'☆'.repeat(Math.max(0, 10 - Math.round(e.skill)))} ${e.skill}`)),
    row('魅力', h('b', null, String(e.charm))),
    row('體力', refs.stam),
    trait ? h('div', { class: 'u-chips' }, h('span', { class: 'tag', tip: trait.desc }, trait.name), h('span', { class: 'muted' }, trait.desc)) : null,
    row('月薪', h('span', null, money(e.salary))),
    refs.task);
}
function updStaff(state, e) {
  setText(refs.st, STAFF_STATE_LABELS[e.state] || e.state);
  const r = e.stamina / (e.staminaMax || 100);
  setBar(refs.stam, r, toneOf(r));
  let t = '';
  if (e.task) {
    const T = TREATMENTS[e.task.treatmentId];
    const p = state.patients.find(x => x.id === e.task.patientId);
    t = `正在進行：${T ? T.name : ''}${p ? '（' + p.name + '）' : ''}`;
  }
  setText(refs.task, t);
}

function buildObject(state, ui, e) {
  const d = BUILDABLES[e.defId] || {};
  refs = { wear: bar(), use: h('span') };
  body.append(
    h('div', { class: 'u-shead' }, h('span', { class: 'u-sico' }, d.glyph || '📦'),
      h('div', { class: 'u-stitle' }, h('b', null, d.name || e.defId), h('span', { class: 'muted' }, `${e.x}, ${e.y}`)), refs.use),
    h('div', { class: 'muted u-p' }, d.desc || ''),
    row('耗損', refs.wear),
    row('維護費', h('span', null, `${money(d.upkeep || 0)} / 月`)),
    h('div', { class: 'row' }, h('button', {
      class: 'btn small danger', type: 'button', onclick: () => {
        confirmDialog({
          title: '出售設備', text: `確定拆除「${d.name}」？將退回約 ${money(Math.floor((d.cost || 0) / 2))}。`, okLabel: '拆除', danger: true,
          onOk: () => { removeAt(state, e.x, e.y); close(ui); },
        });
      },
    }, '拆除出售')));
}
function updObject(state, e) {
  const w = e.wear > 1 ? e.wear / 100 : (e.wear || 0);
  setBar(refs.wear, w, w > 0.7 ? 'bad' : w > 0.4 ? 'warn' : '');
  setText(refs.use, e.usedBy ? '使用中' : e.busy ? '忙碌' : '閒置');
}

const BUILDERS = { patient: [buildPatient, updPatient], staff: [buildStaff, updStaff], object: [buildObject, updObject] };

export function updateSelection(state, ui) {
  const sel = ui.selected;
  const e = find(state, sel);
  if (!sel || !e) {
    if (sel && !e) close(ui);
    if (!card.hidden) { card.hidden = true; clear(card); key = null; }
    return;
  }
  const k = sel.type + ':' + sel.id;
  if (k !== key) {
    key = k;
    clear(card);
    const closeBtn = h('button', { class: 'u-selclose', type: 'button', onclick: () => close(ui), tip: '關閉' }, '✕');
    body = h('div', { class: 'u-selbody' });
    card.append(closeBtn, body);
    BUILDERS[sel.type][0](state, ui, e);
    card.hidden = false;
  }
  BUILDERS[sel.type][1](state, e);
}
