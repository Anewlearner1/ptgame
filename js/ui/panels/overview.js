// 一覽 panel: 客人名單 / 員工清單 + 招聘 / 設備維護表 / 專區組合辭典
import { bus } from '../../core/bus.js';
import { PATIENT_TYPES } from '../../data/patients.js';
import { TREATMENTS } from '../../data/treatments.js';
import { DISH_FEES } from '../../data/fees.js';
import { STAFF_ROLES, TRAITS } from '../../data/staffdefs.js';
import { BUILDABLES } from '../../data/buildables.js';
import { SYNERGIES, ZONE_GROUPS, ZONE_TIERS } from '../../data/synergies.js';
import { RESEARCH } from '../../data/research.js';
import * as SY from '../../sim/synergy.js';
import { focusTiles, recenter } from '../../render/camera.js';
import { layout } from '../layout.js';
import { SHEET_HALF, applySheet } from '../sheet.js';
import { LOTS } from '../../data/lots.js';
import * as ST from '../../sim/staff.js';
import * as EQ from '../../sim/equipment.js';
import * as RS from '../../sim/research.js';
import { removeAt } from '../../sim/build.js';
import { h, setClass, setText, tabbed, bar, setBar, toneOf, reconcile } from '../dom.js';
import { money, fmt, modChips, STAGE_LABELS, STAFF_STATE_LABELS, TYPE_ICONS, ROLE_ICONS } from '../fmt.js';
import { chipList, section } from './common.js';
import { confirmDialog } from '../modal.js';
import { artEl, artOn, thumbEl, staffBust, patientMoodArt, STAFF_SPRITE, itemSprite } from '../artdom.js';
import { gameMinutes, staffMood, staffMoodHint } from '../moods.js';
import { isUnstaffed, isRoleMissing } from '../../sim/qualify.js';
import { roleLine, operatesTip } from '../roles.js';

const store = { tab: 'patients', filter: 'all' };

function select(ui, type, id) {
  ui.selected = { type, id };
  bus.emit('select:changed', { selected: ui.selected });
}

// ---------------------------------------------------------------- patients
function buildPatients(body, state, ui) {
  const count = h('span', { class: 'muted' });
  const sel = h('select', { onchange: () => { store.filter = sel.value; applyFilter(); } },
    h('option', { value: 'all' }, '全部類型'),
    Object.values(PATIENT_TYPES).map(t => h('option', { value: t.id }, `${TYPE_ICONS[t.id] || ''} ${t.name}`)));
  sel.value = store.filter;
  const list = h('div', { class: 'u-list2' });
  const empty = h('div', { class: 'muted u-p' }, '目前餐廳裡沒有客人。');
  body.append(h('div', { class: 'row u-between' }, sel, count), list, empty);

  function applyFilter() {
    if (!list._rows) return;
    for (const r of list._rows.values()) r.hidden = store.filter !== 'all' && r._type !== store.filter;
  }
  // tooltip of a plan step: the dish price and its ingredient-cost rate
  function stepTip(t) {
    const F = DISH_FEES[t];
    if (!F || !(F.price > 0)) return '';
    return `${F.kind === 'special' ? '特色料理' : '基本菜單'}　單價 NT$ ${F.price}（食材成本 ${Math.round(F.foodCost * 100)}%）`;
  }
  function create(p) {
    const P = PATIENT_TYPES[p.type] || {};
    const r = {
      stage: h('span', { class: 'tag' }), sat: bar(), pat: bar(), plan: h('div', { class: 'u-steps' }),
      hp: bar(),
      mood: artEl(patientMoodArt(p, gameMinutes(state)).name, { size: 40, cls: 'u-art-tile u-art-ring', fallback: TYPE_ICONS[p.type] || '🙂', fbSize: 22 }),
      moodTxt: h('span', { class: 'u-moodlbl', hidden: true }),
    };
    const el = h('div', { class: 'card u-prow', role: 'button', tabIndex: 0, dataset: { id: p.id }, onclick: () => select(ui, 'patient', p.id) },
      h('div', { class: 'u-row2' },
        r.mood,
        h('div', { class: 'u-grow' }, h('b', null, p.name), ' ', h('span', { class: 'muted u-small' }, P.name || p.type), r.moodTxt),
        r.stage),
      h('div', { class: 'u-bars3' },
        h('span', { class: 'u-bl' }, '滿意', r.sat), h('span', { class: 'u-bl' }, '耐心', r.pat), h('span', { class: 'u-bl' }, '康復', r.hp)),
      r.plan);
    el._r = r; el._type = p.type; el._id = p.id;
    el.hidden = store.filter !== 'all' && p.type !== store.filter;
    return el;
  }
  function upd(el, p) {
    const r = el._r;
    setText(r.stage, STAGE_LABELS[p.stage] || p.stage);
    const pm = patientMoodArt(p, gameMinutes(state));
    r.mood.setArt(pm.name);
    const mon = artOn() && !!pm.name;
    r.moodTxt.hidden = !mon;
    if (mon) { setText(r.moodTxt, '・' + pm.label); r.moodTxt.dataset.key = pm.mood.key; }
    setBar(r.sat, p.satisfaction / 100, toneOf(p.satisfaction / 100));
    setBar(r.pat, p.patience / 100, toneOf(p.patience / 100));
    const need = (PATIENT_TYPES[p.type] || {}).cureNeeded || 1;
    setBar(r.hp, (p.hp || 0) / need);
    const sig = (p.plan || []).join(',') + '|' + p.planIdx;
    if (r.plan._sig !== sig) {
      r.plan._sig = sig;
      r.plan.replaceChildren(...(p.plan || []).map((t, i) => h('span', { class: 'u-step' + (i < p.planIdx ? ' done' : i === p.planIdx ? ' cur' : ''), tip: stepTip(t) || null },
        (i < p.planIdx ? '✓' : '') + ((TREATMENTS[t] || {}).name || t))));
    }
    setClass(el, 'selected', !!(ui.selected && ui.selected.type === 'patient' && ui.selected.id === p.id));
  }
  return {
    update() {
      reconcile(list, state.patients.slice(0, 80), p => p.id, create, upd);
      applyFilter();
      empty.hidden = state.patients.length > 0;
      setText(count, `餐廳內 ${state.patients.length} 人`);
    },
  };
}

// ---------------------------------------------------------------- staff
function maxStaff(state) {
  if (typeof RS.maxStaffOf === 'function') return RS.maxStaffOf(state);
  const lot = LOTS[state.lotLevel || 0];
  return lot ? lot.maxStaff : 6;
}
function stars(v) { const n = Math.round(v); return '★'.repeat(Math.max(0, Math.min(10, n))) + '☆'.repeat(Math.max(0, 10 - n)); }

function staffThumb(role, mood = 'normal') {
  const em = ROLE_ICONS[role] || '🧑‍⚕️';
  if (!STAFF_SPRITE[role]) return h('span', { class: 'u-sico' }, em);
  return staffBust(role, mood, { height: 52, width: 44, fallback: em, fbSize: 22, title: (STAFF_ROLES[role] || {}).name });
}

function buildStaff(body, state, ui) {
  const head = h('div', { class: 'row u-between' }, h('b', null, '在職員工'), h('span', { class: 'muted' }));
  const headCount = head.lastChild;
  const list = h('div', { class: 'u-list2' });
  const poolHead = h('div', { class: 'row u-between' }, h('b', null, '📮 招聘中的應徵者'), h('span', { class: 'muted u-small' }, '每月更新一批'));
  const pool = h('div', { class: 'u-list2' });
  body.append(head, list, poolHead, pool);

  function traitOf(id) { return TRAITS.find(t => t.id === id); }
  function createStaff(s) {
    const r = { st: h('span', { class: 'tag' }), stam: bar(), mor: bar(), morNum: h('em', { class: 'u-num' }), mood: h('span', { class: 'tag u-tag2 u-mood' }), sal: h('span'), hint: h('span', { class: 'u-moodhint', hidden: true }), bust: staffThumb(s.role, staffMood(s, gameMinutes(state))) };
    const R = STAFF_ROLES[s.role] || {};
    const tr = traitOf(s.trait);
    const el = h('div', { class: 'card u-srow2', role: 'button', tabIndex: 0, dataset: { id: s.id }, onclick: e => { if (!e.target.closest('button')) select(ui, 'staff', s.id); } },
      h('div', { class: 'u-row2' },
        r.bust,
        h('div', { class: 'u-grow' }, h('b', null, s.name), ' ', h('span', { class: 'muted u-small', tip: operatesTip(s.role) }, R.name || s.role),
          tr ? h('span', { class: 'tag u-tag2', tip: tr.desc }, tr.name) : null, r.mood),
        r.st),
      h('div', { class: 'u-bars3 u-bars4' },
        h('span', { class: 'u-bl' }, '技術', bar(s.skill / 10), h('em', { class: 'u-num' }, s.skill)),
        h('span', { class: 'u-bl' }, '魅力', bar(s.charm / 10), h('em', { class: 'u-num' }, s.charm)),
        h('span', { class: 'u-bl' }, '體力', r.stam),
        h('span', { class: 'u-bl', tip: '士氣過低（< 25）的廚房與外場員工可能遞辭呈。休息室、減少過勞、加薪與好事件都能提升士氣。' }, '士氣', r.mor, r.morNum),
        r.hint),
      h('div', { class: 'row u-between' }, h('span', { class: 'muted u-small' }, '月薪 ', r.sal),
        h('span', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', tip: trainTip(s), onclick: () => train(s) }, '訓練'),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => fire(s) }, '解僱'))));
    el._r = r; el._s = s;
    return el;
  }
  function updStaff(el, s) {
    const r = el._r;
    setText(r.st, STAFF_STATE_LABELS[s.state] || s.state);
    const q = s.stamina / (s.staminaMax || 100);
    setBar(r.stam, q, toneOf(q));
    const mo = ST.moraleOf(s);
    setBar(r.mor, mo / 100, toneOf(mo / 100));
    setText(r.morNum, Math.round(mo));
    const mood = staffMood(s, gameMinutes(state));
    if (r.bust.setMood) r.bust.setMood(mood);
    const low = mo < ST.MORALE.RESIGN_BELOW && ST.MORALE.RESIGN_ROLES.includes(s.role);
    r.mood.hidden = !low; setText(r.mood, '想離職');
    r.hint.hidden = !artOn() || !r.bust.setMood || low;   // the 想離職 tag already says it
    if (!r.hint.hidden) { setText(r.hint, staffMoodHint(s, mood)); r.hint.dataset.mood = mood; }
    let sal = s.salary; try { sal = ST.salaryOf(s); } catch (e) { /* keep */ }
    setText(r.sal, money(sal));
    setClass(el, 'selected', !!(ui.selected && ui.selected.type === 'staff' && ui.selected.id === s.id));
  }
  function trainTip(s) {
    const T = ST.TUNE;
    if (!T) return '訓練：花費資金與服務點數，提升技術';
    const lv = s.level || 1;
    return `訓練：花費 ${money(T.TRAIN_COST_BASE + T.TRAIN_COST_PER_LEVEL * lv)} 與服務點 ${T.TRAIN_POINTS_BASE * lv}，技術 +1`;
  }
  function train(s) {
    let ok = false;
    try { ok = ST.train(state, s.id); } catch (e) { console.error(e); }
    bus.emit('toast', ok ? { text: `${s.name} 完成訓練，技術提升！`, kind: 'good' } : { text: '訓練失敗：資金或服務點數不足，或技術已達上限', kind: 'bad' });
  }
  function fire(s) {
    confirmDialog({
      title: '解僱員工', text: `確定要解僱「${s.name}」嗎？解僱後無法復職，只能重新招聘。`, okLabel: '解僱', danger: true,
      onOk: () => {
        let ok = false;
        try { ok = ST.fire(state, s.id); } catch (e) { console.error(e); }
        bus.emit('toast', ok ? { text: `已解僱 ${s.name}`, kind: 'info' } : { text: '無法解僱', kind: 'bad' });
      },
    });
  }
  function createCand(c) {
    const R = STAFF_ROLES[c.role] || {};
    const tr = traitOf(c.trait);
    const btn = h('button', { class: 'btn small primary', type: 'button', onclick: () => {
      const full = state.staff.length >= maxStaff(state);
      let s = null;
      if (!full && state.money >= c.hireCost) { try { s = ST.hire(state, c.cid); } catch (e) { console.error(e); } }
      if (s) bus.emit('toast', { text: `${c.name} 加入團隊！`, kind: 'good' });
      else bus.emit('toast', { text: full ? '員工人數已達上限，請先擴建或研發行政效率' : state.money < c.hireCost ? '資金不足，無法招聘' : '無法招聘', kind: 'bad' });
    } }, '雇用');
    const need = h('span', { class: 'tag u-tag2 u-need', hidden: true, tip: '餐廳裡有蓋好的設施，需要這個職類才能運作，但目前沒有人在職。' }, '餐廳缺這個職類');
    const el = h('div', { class: 'card u-row2', dataset: { cid: c.cid } },
      staffThumb(c.role),
      h('div', { class: 'u-grow' }, h('b', null, c.name), ' ', h('span', { class: 'muted u-small', tip: operatesTip(c.role) }, R.name || c.role),
        tr ? h('span', { class: 'tag u-tag2', tip: tr.desc }, tr.name) : null, need,
        h('div', { class: 'u-small' }, `技術 ${c.skill}　魅力 ${c.charm}　月薪 ${money(c.salary)}　簽約金 ${money(c.hireCost)}`)),
      btn);
    el._btn = btn; el._c = c; el._need = need;
    return el;
  }
  function updCand(el, c) {
    el._btn.disabled = state.money < c.hireCost || state.staff.length >= maxStaff(state);
    el._need.hidden = !isRoleMissing(state, c.role);       // a built facility has nobody to run it
  }
  const noPool = h('div', { class: 'muted u-p' }, '目前沒有應徵者，下個月會有新的人選。');
  body.appendChild(noPool);
  return {
    update() {
      reconcile(list, state.staff, s => s.id, createStaff, updStaff);
      reconcile(pool, state.hirePool || [], c => c.cid, createCand, updCand);
      noPool.hidden = (state.hirePool || []).length > 0;
      let total = 0; for (const s of state.staff) total += s.salary;
      setText(headCount, `${state.staff.length} / ${maxStaff(state)} 人　月薪合計 ${money(total)}`);
    },
  };
}

// ---------------------------------------------------------------- equipment
function buildEquip(body, state, ui) {
  const sum = h('div', { class: 'row u-between u-eqsum' });
  const tbody = h('tbody');
  const table = h('table', { class: 'list u-eq' },
    h('thead', null, h('tr', null, h('th', null, '設備'), h('th', { class: 'u-poscol' }, '位置'), h('th', null, '耗損'), h('th', { class: 'num u-upcol' }, '維護/月'), h('th'))),
    tbody);

  // 保養合約 (M2): half wear speed for N weeks, one price for every machine owned now
  const contractInfo = h('div', { class: 'u-small' });
  const contractBtns = EQ.WEAR_TUNE.CONTRACT_WEEKS.map(w => h('button', { class: 'btn small', type: 'button', onclick: () => {
    const r = EQ.signMaintenance(state, w);
    bus.emit('toast', r.ok ? { text: `已簽 ${w} 週保養合約（${money(r.cost)}），期間設備耗損減半`, kind: 'good' } : { text: `無法簽約：${r.reason}`, kind: 'bad' });
  } }, `${w} 週`));
  const contract = h('div', { class: 'card u-contract' },
    h('div', { class: 'u-row2' }, h('span', { class: 'u-sico' }, '🧰'), h('div', { class: 'u-grow' }, h('b', null, '保養合約'), contractInfo)),
    h('div', { class: 'row u-contract-btns' }, contractBtns));

  body.append(sum, contract, table, h('div', { class: 'muted u-small u-p' }, '油炸鍋、煮麵台、滷肉鍋、鐵板、爐台、飲料吧、冰品檯等設備會隨使用耗損：≥ 70 顯示老舊，≥ 90 每週有機會故障（故障的設備無法使用，需「維修」）。「保養」可預防，保養合約期間耗損減半。出售設備會退回約 50% 造價。點選列可在地圖上選取。'));

  function toast(r, okText) {
    bus.emit('toast', r.ok ? { text: `${okText}（${money(r.cost)}）`, kind: 'good' } : { text: r.reason || '無法執行', kind: 'bad' });
  }
  function create(o) {
    const d = BUILDABLES[o.defId] || {};
    const wear = bar(), wearNum = h('em', { class: 'u-num' });
    const badges = h('span', { class: 'u-eqbadges' });
    const reqTxt = h('div', { class: 'u-eqreq muted u-small' });
    const repair = h('button', { class: 'btn small primary', type: 'button', onclick: () => toast(EQ.repairObject(state, o.id), `已修復${d.name || ''}`) });
    const service = h('button', { class: 'btn small', type: 'button', onclick: () => toast(EQ.serviceObject(state, o.id), `已保養${d.name || ''}`) });
    const sell = h('button', { class: 'btn small danger', type: 'button', onclick: () => {
      confirmDialog({
        title: '出售設備', text: `確定出售「${d.name}」？退回約 ${money(Math.floor((d.cost || 0) / 2))}。`, okLabel: '出售', danger: true,
        onOk: () => { removeAt(state, o.x, o.y); },
      });
    } }, '出售');
    const wearCell = h('td', { class: 'u-wearcell' }, h('span', { class: 'u-wearin' }, wear, wearNum));
    const tr = h('tr', { dataset: { id: o.id }, onclick: e => { if (!e.target.closest('button')) select(ui, 'object', o.id); } },
      h('td', null, itemSprite(o.defId)
        ? h('span', { class: 'u-eqname u-eqart' }, artEl(itemSprite(o.defId), { size: 28, fallback: d.glyph || '', fbSize: 18 }), d.name || o.defId)
        : h('span', { class: 'u-eqname' }, thumbEl(o.defId, { width: 30, height: 28, fallback: h('span', null, `${d.glyph || ''} `) }), d.name || o.defId), badges, reqTxt),
      h('td', { class: 'muted u-poscol' }, `${o.x},${o.y}`),
      wearCell,
      h('td', { class: 'num u-upcol' }, fmt(d.upkeep || 0)),
      h('td', { class: 'u-actcell' }, h('span', { class: 'u-acts' }, repair, service, sell)));
    tr._r = { wear, wearNum, badges, reqTxt, repair, service, wearCell, wearable: EQ.isWearable(o.defId) };
    return tr;
  }
  function upd(tr, o) {
    const r = tr._r;
    const wearable = r.wearable;
    const w = EQ.wearOf(o);
    r.wearCell.firstChild.hidden = !wearable;
    if (wearable) {
      setBar(r.wear, w / 100, o.broken || w >= EQ.WEAR_TUNE.OLD_AT ? 'bad' : w >= 50 ? 'warn' : '');
      setText(r.wearNum, Math.round(w));
    }
    const maint = EQ.maintainedWeeksLeft(state, o);
    const unst = isUnstaffed(state, o);
    const key = (o.broken ? 'B' : '') + (unst ? 'U' : '') + (wearable && w >= EQ.WEAR_TUNE.OLD_AT ? 'O' : '') + (maint > 0 ? 'M' + maint : '');
    if (r.badges._k !== key) {
      r.badges._k = key;
      r.badges.replaceChildren(...[
        o.broken ? h('span', { class: 'tag u-eqb bad' }, '故障') : null,
        unst ? h('span', { class: 'tag u-eqb bad u-eqmiss', tip: '餐廳沒有能操作這台設備的人員：客人不會使用它。到「員工清單」招聘對應職類。' }, '缺人') : null,
        !o.broken && wearable && w >= EQ.WEAR_TUNE.OLD_AT ? h('span', { class: 'tag u-eqb warn' }, '老舊') : null,
        maint > 0 ? h('span', { class: 'tag u-eqb good', tip: '保養合約中：耗損速度減半' }, `合約 ${maint} 週`) : null].filter(Boolean));
    }
    setClass(tr, 'u-broken', !!o.broken);
    setClass(tr, 'u-unstaffed', unst);
    const rl = roleLine(state, o.defId);
    setText(r.reqTxt, rl); r.reqTxt.hidden = !rl;
    r.repair.hidden = !o.broken;
    r.service.hidden = !wearable || !!o.broken;
    if (o.broken) {
      const c = EQ.repairCost(o);
      setText(r.repair, `維修 ${fmt(c)}`); r.repair.dataset.tip = `維修費 ${money(c)}，修好後耗損歸零`; r.repair.disabled = state.money < c;
    }
    if (wearable && !o.broken) {
      const c = EQ.serviceCost(o);
      setText(r.service, `保養 ${fmt(c)}`); r.service.dataset.tip = `保養費 ${money(c)}，耗損歸零`; r.service.disabled = state.money < c || w <= 0;
    }
    setClass(tr, 'u-sel', !!(ui.selected && ui.selected.type === 'object' && ui.selected.id === o.id));
  }
  return {
    update() {
      const objs = state.objects;
      reconcile(tbody, objs, o => o.id, create, upd);
      let up = 0, nb = 0, nw = 0, nWear = 0, nu = 0;
      for (const o of objs) {
        if (isUnstaffed(state, o)) nu++;
        up += (BUILDABLES[o.defId] || {}).upkeep || 0;
        if (EQ.isWearable(o.defId)) { nWear++; if (o.broken) nb++; else if (EQ.isWorn(o)) nw++; }
      }
      const k = objs.length + '|' + up + '|' + nb + '|' + nw + '|' + nu;
      if (sum._k !== k) {
        sum._k = k;
        sum.replaceChildren(h('span', null, `共 ${objs.length} 件設備`,
          nb ? h('b', { class: 'bad' }, `　故障 ${nb}`) : null, nu ? h('b', { class: 'bad' }, `　缺人 ${nu}`) : null, nw ? h('b', { class: 'warn-text' }, `　老舊 ${nw}`) : null),
        h('b', null, `維護費合計 ${money(up)} / 月`));
      }
      // maintenance contract box
      const cw = Math.max(0, ...EQ.wearables(state).map(o => EQ.maintainedWeeksLeft(state, o)));
      const info = nWear ? (cw > 0 ? `保養合約生效中，剩 ${cw} 週：設備耗損速度減半。` : '簽約期間所有設備耗損速度減半（只涵蓋簽約當下已有的設備）。') : '還沒有會耗損的設備（油炸鍋、煮麵台、滷肉鍋等）。';
      setText(contractInfo, info);
      EQ.WEAR_TUNE.CONTRACT_WEEKS.forEach((w, i) => {
        const c = EQ.contractCost(state, w), btn = contractBtns[i];
        setText(btn, `${w} 週　${fmt(c)}`);
        btn.disabled = !nWear || state.money < c;
      });
    },
  };
}

// ---------------------------------------------------------------- synergies (專區組合辭典)
const SYN_STATUS = [['all', '全部'], ['on', '已啟動'], ['off', '未啟動'], ['lock', '🔒需研發']];

// canvas rect (CSS px) the panel leaves free: the mobile free rect, or the stage right of the desktop panel
function mapFreeRect(ui) {
  if (ui.freeRect) return ui.freeRect;
  const cv = document.getElementById('game'), pn = document.getElementById('panel');
  if (!cv) return null;
  const sr = cv.getBoundingClientRect();
  let x0 = 0;
  if (pn && !pn.hidden) { const pr = pn.getBoundingClientRect(); if (pr.width > 0) x0 = Math.max(0, pr.right - sr.left + 6); }
  return { x: x0, y: 0, w: Math.max(80, sr.width - x0), h: sr.height };
}

// 「在地圖上看」: pan/zoom to the active zone (or back to the whole clinic when it is not active) and pulse its glow ~2 s
function showZoneOnMap(state, ui, syn) {
  const cv = document.getElementById('game');
  const zn = (state.zones || []).filter(z => z.id === syn.id).sort((a, b) => b.cells.length - a.cells.length)[0];
  const go = () => {
    if (zn) { focusTiles(state, cv, zn.cells, mapFreeRect(ui), ui); ui.zonePulse = { id: syn.id, until: performance.now() + 2000 }; }
    else { recenter(state, cv, ui); bus.emit('toast', { text: `「${syn.name}」還沒啟動：已回到餐廳全景，照下方「怎麼擺」試試看。`, kind: 'info' }); }
  };
  if (layout.mobile && layout.portrait && layout.sheetFrac > 0.7) { layout.sheetFrac = SHEET_HALF; applySheet(); setTimeout(go, 260); }   // un-cover the map first
  else go();
}

function buildSyn(body, state, ui) {
  const st = store.syn || (store.syn = { status: 'all', group: 'all' });
  const title = h('b', { class: 'u-syn-title' });
  const prog = bar(0);
  const mkChip = (kind, val, label) => h('button', { class: 'u-fchip', type: 'button', dataset: { kind, val },
    onclick: () => { st[kind] = val; refreshChips(); applyFilter(); } }, label);
  const statusChips = SYN_STATUS.map(([v, l]) => mkChip('status', v, l));
  const groupsUsed = Object.keys(ZONE_GROUPS).filter(g => SYNERGIES.some(s => s.group === g));
  const groupChips = [mkChip('group', 'all', '全部類別'), ...groupsUsed.map(g => mkChip('group', g, ZONE_GROUPS[g]))];
  const empty = h('div', { class: 'muted u-p', hidden: true }, '這個篩選條件下沒有專區。');
  body.append(
    h('div', { class: 'u-synhead' }, title, prog),
    h('div', { class: 'muted u-small u-synnote' }, '設施緊貼（含斜角）擺在一起就會啟動，加成可疊加。✔ 已有　✘ 還缺　🔒 需研發'),
    h('div', { class: 'u-fchips' }, statusChips), h('div', { class: 'u-fchips u-hscroll' }, groupChips));

  const cards = [];
  const list = h('div', { class: 'u-list2 u-synlist' });
  for (const s of SYNERGIES) {
    const badge = h('span', { class: 'badge u-synbadge' });
    const reqs = [];
    const reqWrap = h('div', { class: 'u-chips u-synreq' });
    for (const n of s.needs) {
      const d = BUILDABLES[n] || {};
      const el = h('span', { class: 'tag u-need' });
      reqs.push({ kind: 'obj', id: n, name: `${d.glyph || ''}${d.name || n}`, el });
      reqWrap.appendChild(el);
    }
    for (const f of Object.keys(s.needsFloors || {})) {
      const d = BUILDABLES[f] || {};
      const el = h('span', { class: 'tag u-need' });
      reqs.push({ kind: 'floor', id: f, name: `${d.glyph || ''}${d.name || f}`, el });
      reqWrap.appendChild(el);
    }
    const status = h('div', { class: 'u-small u-synstat' });
    const btn = h('button', { class: 'btn small u-synmap', type: 'button', onclick: () => showZoneOnMap(state, ui, s) }, '📍 在地圖上看');
    const tier = s.tier ? h('span', { class: 'tag u-syntier', dataset: { tier: s.tier } }, ZONE_TIERS[s.tier] || s.tier) : null;
    const grp = s.group ? h('span', { class: 'tag u-syngrp' }, ZONE_GROUPS[s.group] || s.group) : null;
    const el = h('div', { class: 'card u-syn', dataset: { zone: s.id } },
      h('div', { class: 'u-synh' }, h('span', { class: 'u-sico' }, s.icon || '✨'), h('b', { class: 'u-synname' }, s.name), tier, grp, badge),
      h('div', { class: 'u-small u-syndesc' }, s.desc),
      h('div', { class: 'u-small u-efrow' }, h('span', { class: 'muted' }, '效果'), chipList(modChips(s.effects))),
      h('div', { class: 'u-small u-efrow' }, h('span', { class: 'muted' }, '需要'), reqWrap),
      status,
      s.hint ? h('div', { class: 'u-small muted u-synhint' }, '📐 怎麼擺：' + s.hint) : null,
      h('div', { class: 'u-synact' }, btn));
    cards.push({ s, el, badge, reqs, status, key: null, active: false, locked: false });
    list.appendChild(el);
  }
  body.append(list, empty);

  function refreshChips() {
    for (const c of [...statusChips, ...groupChips]) {
      const on = st[c.dataset.kind] === c.dataset.val;
      setClass(c, 'on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function applyFilter() {
    let shown = 0;
    for (const c of cards) {
      const okS = st.status === 'all' || (st.status === 'on' && c.active) || (st.status === 'off' && !c.active && !c.locked) || (st.status === 'lock' && !c.active && c.locked);
      const okG = st.group === 'all' || c.s.group === st.group;
      const vis = okS && okG;
      if (c.el.hidden === vis) c.el.hidden = !vis;
      if (vis) shown++;
    }
    empty.hidden = shown > 0;
  }
  refreshChips();

  return {
    update() {
      const owned = new Map();
      for (const o of state.objects) owned.set(o.defId, (owned.get(o.defId) || 0) + 1);
      const doneRs = new Set(state.research.done || []);
      const activeIds = new Set((state.zones || []).map(z => z.id));
      let nOn = 0, nLock = 0, nOff = 0;
      for (const c of cards) {
        const s = c.s;
        const active = activeIds.has(s.id);
        const locks = active ? [] : SY.zoneLocks(state, s);
        const prog = SY.synergyProgress(state, s);
        // key = everything the card shows that can change
        const key = active + '|' + locks.join(',') + '|' + prog.map(p => p.have + '/' + p.need).join(',');
        c.active = active; c.locked = locks.length > 0;
        if (active) nOn++; else if (c.locked) nLock++; else nOff++;
        if (c.key === key) continue;
        c.key = key;
        c.badge.hidden = false;
        c.badge.textContent = active ? '啟動中' : c.locked ? '🔒 需研發' : '未啟動';
        c.badge.dataset.st = active ? 'on' : c.locked ? 'lock' : 'off';
        setClass(c.el, 'selected', active);
        setClass(c.el, 'u-synlock', !active && c.locked);
        const missing = [];
        c.reqs.forEach((r, i) => {
          const p = prog[i];
          const bdef = BUILDABLES[r.id] || {};
          const lockNode = r.kind === 'obj' && bdef.requires && !doneRs.has(bdef.requires) ? bdef.requires : null;
          const mark = p.ok ? '✔' : lockNode ? '🔒' : '✘';
          const cls = p.ok ? 'have' : lockNode ? 'lock' : 'lack';
          let txt = r.name;
          if (p.need > 1) txt += ` ${p.have}/${p.need}`;
          if (!p.ok && lockNode) txt += `（需研發「${(RESEARCH[lockNode] || {}).name || lockNode}」）`;
          r.el.className = 'tag u-need ' + cls;
          r.el.dataset.mark = mark;
          r.el.textContent = txt;
          if (!p.ok) missing.push(txt);
        });
        let msg, tone;
        if (active) { msg = '✅ 已啟動，效果生效中。'; tone = 'good'; }
        else if (locks.length) {
          msg = `🔒 先研發：${locks.map(id => `「${(RESEARCH[id] || {}).name || id}」`).join('、')}，才能建齊所有設施。`; tone = 'muted';
        } else if (missing.length) { msg = `還缺：${missing.join('、')}。`; tone = 'muted'; }
        else { msg = '東西都備齊了，但還沒連成一區：請讓它們彼此緊貼擺放（斜角也算）。'; tone = 'muted'; }
        c.status.className = 'u-small u-synstat ' + tone;
        c.status.textContent = msg;
      }
      setText(title, `已啟動 ${nOn} / 共 ${cards.length} 個專區`);
      setBar(prog, nOn / Math.max(1, cards.length));
      for (const ch of statusChips) {
        const n = ch.dataset.val === 'all' ? cards.length : ch.dataset.val === 'on' ? nOn : ch.dataset.val === 'off' ? nOff : nLock;
        const label = (SYN_STATUS.find(x => x[0] === ch.dataset.val) || [])[1];
        setText(ch, `${label} ${n}`);
      }
      applyFilter();
    },
  };
}

export function mountOverview(root, state, ui) {
  const t = tabbed([
    { id: 'patients', label: '🧑 客人名單', build: b => buildPatients(b, state, ui) },
    { id: 'staff', label: '🩺 員工', build: b => buildStaff(b, state, ui) },
    { id: 'equip', label: '🔧 設備維護', build: b => buildEquip(b, state, ui) },
    { id: 'syn', label: '✨ 專區辭典', build: b => buildSyn(b, state, ui) },
  ], store);
  root.appendChild(t.el);
  return { update() { t.update(); } };
}
