// Selection info card (bottom-right, above the speed bar): shows patient / staff / object details.
import { bus } from '../core/bus.js';
import { BUILDABLES } from '../data/buildables.js';
import { PATIENT_TYPES } from '../data/patients.js';
import { TREATMENTS } from '../data/treatments.js';
import { DISH_FEES } from '../data/fees.js';
import { STAFF_ROLES, TRAITS } from '../data/staffdefs.js';
import { removeAt, rotateObject, relocationCost } from '../sim/build.js';
import { h, clear, setText, bar, setBar, toneOf, setClass, append } from './dom.js';
import { STAGE_LABELS, STAFF_STATE_LABELS, TYPE_ICONS, ROLE_ICONS, money } from './fmt.js';
import { confirmDialog } from './modal.js';
import { layout, setBMode } from './layout.js';
import { artEl, artOn, thumbEl, staffBust, patientMoodArt, STAFF_SPRITE, PATIENT_SPRITE, staffTaskIcon, itemSprite } from './artdom.js';
import { initMoods, gameMinutes, staffMood, staffMoodHint } from './moods.js';
import { ctx } from './ctx.js';
import * as ST from '../sim/staff.js';
import { isUnstaffed, requiredRolesFor, toastIfUnstaffed, roleShort } from '../sim/qualify.js';
import { roleRow, updateRoleRow, operatesTip } from './roles.js';

let card = null, body = null, key = null, refs = null;

export function initSelection(state, ui) {
  card = h('div', { class: 'u-selcard', hidden: true });
  document.getElementById('stage').appendChild(card);
  bus.on('select:changed', () => { key = null; });
  initMoods(bus, () => ctx.state);
  // a facility that is placed while nobody on the payroll can operate it: say so once per role (尚未僱用○○，這台設備無法運作)
  let known = new Set(state.objects.map(o => o.id));
  bus.on('state:loaded', () => { known = new Set(state.objects.map(o => o.id)); });
  bus.on('map:changed', () => {
    for (const o of state.objects) if (!known.has(o.id)) toastIfUnstaffed(state, o);
    known = new Set(state.objects.map(o => o.id));
  });
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

function row(label, node, cls) { return h('div', { class: 'u-srow' + (cls ? ' ' + cls : '') }, h('span', { class: 'muted' }, label), node); }

function buildPatient(state, ui, e) {
  const P = PATIENT_TYPES[e.type] || {};
  refs = {
    stage: h('span', { class: 'tag' }), pat: bar(), sat: bar(), cure: bar(), bubble: h('div', { class: 'u-bubble' }),
    plan: h('div', { class: 'u-chips' }), paid: h('span'), flags: h('span', { class: 'muted' }),
    mood: artEl(patientMoodArt(e, gameMinutes(state)).name, { size: 44, cls: 'u-art-tile u-art-ring', fallback: TYPE_ICONS[e.type] || '🙂', title: '心情' }),
    moodTxt: h('span', { class: 'u-moodlbl', hidden: true }),
  };
  body.append(
    h('div', { class: 'u-shead' }, h('span', { class: 'u-art-pair' }, refs.mood, artEl(PATIENT_SPRITE[e.type], { height: 48, width: 34, title: P.name || e.type })),
      h('div', { class: 'u-stitle' }, h('b', null, e.name), h('span', { class: 'muted' }, P.name || e.type, refs.moodTxt)), refs.stage),
    row('耐心', refs.pat), row('滿意度', refs.sat), row('康復進度', refs.cure),
    refs.plan, refs.bubble, row('已付', refs.paid), refs.flags);
}
function updPatient(state, e) {
  const P = PATIENT_TYPES[e.type] || {};
  const pm = patientMoodArt(e, gameMinutes(state));
  refs.mood.setArt(pm.name);
  const on = artOn() && !!pm.name;
  refs.moodTxt.hidden = !on;
  if (on) { setText(refs.moodTxt, '・' + pm.label); refs.moodTxt.dataset.key = pm.mood.key; refs.moodTxt.dataset.tip = pm.mood.reason; }
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
      const F = DISH_FEES[t];
      refs.plan.appendChild(h('span', { class: 'tag u-step' + (i < e.planIdx ? ' done' : i === e.planIdx ? ' cur' : ''), tip: F && F.price > 0 ? `單價 NT$ ${F.price}` : null },
        (i < e.planIdx ? '✓ ' : '') + (T ? T.name : t)));
    });
  }
  const b = e.bubble && e.bubble.text ? '💬 ' + e.bubble.text : '';
  setText(refs.bubble, b); refs.bubble.hidden = !b;
  setText(refs.paid, `主餐 ${money(e.paid ? e.paid.menu : 0)}　特色 ${money(e.paid ? e.paid.special : 0)}`);
  const f = [];
  if (e.flags && e.flags.slipped) f.push('⚠ 曾滑倒');
  if (e.cured) f.push('✅ 已成為熟客');
  if (e.upsold) f.push('💰 已加點特色料理');
  setText(refs.flags, f.join('　'));
}

function buildStaff(state, ui, e) {
  const R = STAFF_ROLES[e.role] || {};
  const trait = TRAITS.find(t => t.id === e.trait);
  refs = {
    st: h('span', { class: 'tag' }), stam: bar(), taskTxt: h('span'),
    taskIco: artEl(null, { size: 22, cls: 'u-art-ico', title: '工作中' }),
    mor: bar(), morNum: h('em', { class: 'u-num' }), hint: h('span', { class: 'u-moodhint', hidden: true }),
    bust: e.role in STAFF_SPRITE ? staffBust(e.role, staffMood(e, gameMinutes(state)), { height: 52, width: 44, fallback: ROLE_ICONS[e.role] || '🧑‍⚕️', title: R.name || e.role }) : null,
  };
  refs.task = h('div', { class: 'muted u-seltask' }, refs.taskIco, refs.taskTxt);
  append(body, [
    h('div', { class: 'u-shead' }, refs.bust || h('span', { class: 'u-sico' }, ROLE_ICONS[e.role] || '🧑‍⚕️'),
      h('div', { class: 'u-stitle' }, h('b', null, e.name), h('span', { class: 'muted', tip: operatesTip(e.role) }, R.name || e.role)), refs.st),
    row('技術', h('span', { class: 'u-bl' }, bar(e.skill / 10), h('em', { class: 'u-num' }, e.skill))),
    row('魅力', h('span', { class: 'u-bl' }, bar(e.charm / 10), h('em', { class: 'u-num' }, e.charm))),
    row('體力', refs.stam),
    row('士氣', h('span', { class: 'u-bl u-morale' }, refs.mor, refs.morNum, refs.hint)),
    trait ? h('div', { class: 'u-chips' }, h('span', { class: 'tag', tip: trait.desc }, trait.name), h('span', { class: 'muted u-small' }, trait.desc)) : null,
    row('月薪', h('span', null, money(e.salary))),
    refs.task]);
}
function updStaff(state, e) {
  setText(refs.st, STAFF_STATE_LABELS[e.state] || e.state);
  const r = e.stamina / (e.staminaMax || 100);
  setBar(refs.stam, r, toneOf(r));
  const mo = ST.moraleOf(e);
  setBar(refs.mor, mo / 100, toneOf(mo / 100));
  setText(refs.morNum, Math.round(mo));
  const mood = staffMood(e, gameMinutes(state));
  if (refs.bust) refs.bust.setMood(mood);
  refs.hint.hidden = !artOn() || !refs.bust;
  if (!refs.hint.hidden) { setText(refs.hint, staffMoodHint(e, mood)); refs.hint.dataset.mood = mood; }
  let t = '';
  if (e.task) {
    const T = TREATMENTS[e.task.treatmentId];
    const p = state.patients.find(x => x.id === e.task.patientId);
    t = `正在進行：${T ? T.name : ''}${p ? '（' + p.name + '）' : ''}`;
  }
  setText(refs.taskTxt, t);
  refs.task.hidden = !t;
  refs.taskIco.setArt(t ? staffTaskIcon(e, TREATMENTS) : null);
}

function buildObject(state, ui, e) {
  const d = BUILDABLES[e.defId] || {};
  const rr = roleRow(state, e.defId);
  refs = { wear: bar(), use: h('span', { class: 'u-sstat' }), rr, need: rr ? null : h('span', { class: 'muted' }, '不需要人員') };
  body.append(
    h('div', { class: 'u-shead' }, itemSprite(e.defId)
      ? artEl(itemSprite(e.defId), { size: 48, fallback: d.glyph || '📦', title: d.name })
      : thumbEl(e.defId, { width: 48, height: 48, fallback: h('span', { class: 'u-sico' }, d.glyph || '📦') }),
      h('div', { class: 'u-stitle' }, h('b', null, d.name || e.defId), h('span', { class: 'muted' }, `${e.x}, ${e.y}`))),
    h('div', { class: 'muted u-p' }, d.desc || ''),
    row('所需人員', refs.rr || refs.need, 'u-srow-wide'),
    row('狀態', refs.use, 'u-srow-wide'),
    row('耗損', refs.wear),
    row('維護費', h('span', null, `${money(d.upkeep || 0)} / 月`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', tip: `移動（M）：搬移費 ${money(relocationCost(e.defId))}`, onclick: () => {
        if (layout.mobile) { if (ui.panel === 'build') setBMode(layout.portrait ? 'tray' : 'strip'); else if (ui.panel) ui.panel = null; }
        bus.emit('object:move', { id: e.id });
      } }, '✥ 移動'),
      h('button', { class: 'btn small', type: 'button', tip: '原地旋轉（免費）', onclick: () => {
        const r = rotateObject(state, e.id);
        bus.emit('toast', r.ok ? { text: `已旋轉「${d.name}」`, kind: 'good' } : { text: `無法旋轉：${r.reason}（可改用「移動」放到別處）`, kind: 'bad' });
      } }, '🔄 旋轉'),
      h('button', {
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
  if (refs.rr) updateRoleRow(refs.rr, state);
  const unst = isUnstaffed(state, e);
  const req = requiredRolesFor(e.defId);
  setText(refs.use, e.broken ? '故障中' : unst ? (e.defId === 'reception' ? '缺人（點餐較慢）' : '缺人，無法運作') : e.usedBy ? (e.staffId ? '運作中' : '使用中') : e.busy ? '忙碌' : '閒置');
  setClass(refs.use, 'bad', !!e.broken || unst);
  refs.use.dataset.tip = unst ? `餐廳尚未僱用${req.map(roleShort).join('或')}：先到「一覽 → 員工清單」招聘` : '';
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
