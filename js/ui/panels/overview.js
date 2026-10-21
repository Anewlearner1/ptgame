// 一覽 panel: 病患病歷 / 員工清單 + 招聘 / 設備維護表 / 專區組合辭典
import { bus } from '../../core/bus.js';
import { PATIENT_TYPES } from '../../data/patients.js';
import { TREATMENTS } from '../../data/treatments.js';
import { STAFF_ROLES, TRAITS } from '../../data/staffdefs.js';
import { BUILDABLES } from '../../data/buildables.js';
import { SYNERGIES } from '../../data/synergies.js';
import { LOTS } from '../../data/lots.js';
import * as ST from '../../sim/staff.js';
import * as EQ from '../../sim/equipment.js';
import * as RS from '../../sim/research.js';
import { removeAt } from '../../sim/build.js';
import { h, setClass, setText, tabbed, bar, setBar, toneOf, reconcile } from '../dom.js';
import { money, fmt, modChips, STAGE_LABELS, STAFF_STATE_LABELS, TYPE_ICONS, ROLE_ICONS } from '../fmt.js';
import { chipList, section } from './common.js';
import { confirmDialog } from '../modal.js';

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
  const empty = h('div', { class: 'muted u-p' }, '目前診所裡沒有病患。');
  body.append(h('div', { class: 'row u-between' }, sel, count), list, empty);

  function applyFilter() {
    if (!list._rows) return;
    for (const r of list._rows.values()) r.hidden = store.filter !== 'all' && r._type !== store.filter;
  }
  function create(p) {
    const P = PATIENT_TYPES[p.type] || {};
    const r = {
      stage: h('span', { class: 'tag' }), sat: bar(), pat: bar(), plan: h('div', { class: 'u-steps' }),
      hp: bar(),
    };
    const el = h('div', { class: 'card u-prow', role: 'button', tabIndex: 0, dataset: { id: p.id }, onclick: () => select(ui, 'patient', p.id) },
      h('div', { class: 'u-row2' },
        h('span', { class: 'u-sico' }, TYPE_ICONS[p.type] || '🙂'),
        h('div', { class: 'u-grow' }, h('b', null, p.name), ' ', h('span', { class: 'muted u-small' }, P.name || p.type)),
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
    setBar(r.sat, p.satisfaction / 100, toneOf(p.satisfaction / 100));
    setBar(r.pat, p.patience / 100, toneOf(p.patience / 100));
    const need = (PATIENT_TYPES[p.type] || {}).cureNeeded || 1;
    setBar(r.hp, (p.hp || 0) / need);
    const sig = (p.plan || []).join(',') + '|' + p.planIdx;
    if (r.plan._sig !== sig) {
      r.plan._sig = sig;
      r.plan.replaceChildren(...(p.plan || []).map((t, i) => h('span', { class: 'u-step' + (i < p.planIdx ? ' done' : i === p.planIdx ? ' cur' : '') },
        (i < p.planIdx ? '✓' : '') + ((TREATMENTS[t] || {}).name || t))));
    }
    setClass(el, 'selected', !!(ui.selected && ui.selected.type === 'patient' && ui.selected.id === p.id));
  }
  return {
    update() {
      reconcile(list, state.patients.slice(0, 80), p => p.id, create, upd);
      applyFilter();
      empty.hidden = state.patients.length > 0;
      setText(count, `診所內 ${state.patients.length} 人`);
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

function buildStaff(body, state, ui) {
  const head = h('div', { class: 'row u-between' }, h('b', null, '在職員工'), h('span', { class: 'muted' }));
  const headCount = head.lastChild;
  const list = h('div', { class: 'u-list2' });
  const poolHead = h('div', { class: 'row u-between' }, h('b', null, '📮 招聘中的應徵者'), h('span', { class: 'muted u-small' }, '每月更新一批'));
  const pool = h('div', { class: 'u-list2' });
  body.append(head, list, poolHead, pool);

  function traitOf(id) { return TRAITS.find(t => t.id === id); }
  function createStaff(s) {
    const r = { st: h('span', { class: 'tag' }), stam: bar(), mor: bar(), morNum: h('em', { class: 'u-num' }), mood: h('span', { class: 'tag u-tag2 u-mood' }), sal: h('span') };
    const R = STAFF_ROLES[s.role] || {};
    const tr = traitOf(s.trait);
    const el = h('div', { class: 'card u-srow2', role: 'button', tabIndex: 0, dataset: { id: s.id }, onclick: e => { if (!e.target.closest('button')) select(ui, 'staff', s.id); } },
      h('div', { class: 'u-row2' },
        h('span', { class: 'u-sico' }, ROLE_ICONS[s.role] || '🧑‍⚕️'),
        h('div', { class: 'u-grow' }, h('b', null, s.name), ' ', h('span', { class: 'muted u-small' }, R.name || s.role),
          tr ? h('span', { class: 'tag u-tag2', tip: tr.desc }, tr.name) : null, r.mood),
        r.st),
      h('div', { class: 'u-bars3 u-bars4' },
        h('span', { class: 'u-bl' }, '技術', bar(s.skill / 10), h('em', { class: 'u-num' }, s.skill)),
        h('span', { class: 'u-bl' }, '魅力', bar(s.charm / 10), h('em', { class: 'u-num' }, s.charm)),
        h('span', { class: 'u-bl' }, '體力', r.stam),
        h('span', { class: 'u-bl', tip: '士氣過低（< 25）的醫師／治療師可能遞辭呈。休息室、減少過勞、加薪與好事件都能提升士氣。' }, '士氣', r.mor, r.morNum)),
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
    const low = mo < ST.MORALE.RESIGN_BELOW && ST.MORALE.RESIGN_ROLES.includes(s.role);
    r.mood.hidden = !low; setText(r.mood, '想離職');
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
    const el = h('div', { class: 'card u-row2', dataset: { cid: c.cid } },
      h('span', { class: 'u-sico' }, ROLE_ICONS[c.role] || '🧑‍⚕️'),
      h('div', { class: 'u-grow' }, h('b', null, c.name), ' ', h('span', { class: 'muted u-small' }, R.name || c.role),
        tr ? h('span', { class: 'tag u-tag2', tip: tr.desc }, tr.name) : null,
        h('div', { class: 'u-small' }, `技術 ${c.skill}　魅力 ${c.charm}　月薪 ${money(c.salary)}　簽約金 ${money(c.hireCost)}`)),
      btn);
    el._btn = btn; el._c = c;
    return el;
  }
  function updCand(el, c) {
    el._btn.disabled = state.money < c.hireCost || state.staff.length >= maxStaff(state);
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

  body.append(sum, contract, table, h('div', { class: 'muted u-small u-p' }, '電療、牽引、熱敷、超音波、震波、雷射、懸吊等儀器會隨使用耗損：≥ 70 顯示老舊，≥ 90 每週有機會故障（故障的儀器無法使用，需「維修」）。「保養」可預防，保養合約期間耗損減半。出售設備會退回約 50% 造價。點選列可在地圖上選取。'));

  function toast(r, okText) {
    bus.emit('toast', r.ok ? { text: `${okText}（${money(r.cost)}）`, kind: 'good' } : { text: r.reason || '無法執行', kind: 'bad' });
  }
  function create(o) {
    const d = BUILDABLES[o.defId] || {};
    const wear = bar(), wearNum = h('em', { class: 'u-num' });
    const badges = h('span', { class: 'u-eqbadges' });
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
      h('td', null, h('span', { class: 'u-eqname' }, `${d.glyph || ''} ${d.name || o.defId}`), badges),
      h('td', { class: 'muted u-poscol' }, `${o.x},${o.y}`),
      wearCell,
      h('td', { class: 'num u-upcol' }, fmt(d.upkeep || 0)),
      h('td', { class: 'u-actcell' }, h('span', { class: 'u-acts' }, repair, service, sell)));
    tr._r = { wear, wearNum, badges, repair, service, wearCell, wearable: EQ.isWearable(o.defId) };
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
    const key = (o.broken ? 'B' : '') + (wearable && w >= EQ.WEAR_TUNE.OLD_AT ? 'O' : '') + (maint > 0 ? 'M' + maint : '');
    if (r.badges._k !== key) {
      r.badges._k = key;
      r.badges.replaceChildren(
        o.broken ? h('span', { class: 'tag u-eqb bad' }, '故障') : null,
        !o.broken && wearable && w >= EQ.WEAR_TUNE.OLD_AT ? h('span', { class: 'tag u-eqb warn' }, '老舊') : null,
        maint > 0 ? h('span', { class: 'tag u-eqb good', tip: '保養合約中：耗損速度減半' }, `合約 ${maint} 週`) : null);
    }
    setClass(tr, 'u-broken', !!o.broken);
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
      let up = 0, nb = 0, nw = 0, nWear = 0;
      for (const o of objs) {
        up += (BUILDABLES[o.defId] || {}).upkeep || 0;
        if (EQ.isWearable(o.defId)) { nWear++; if (o.broken) nb++; else if (EQ.isWorn(o)) nw++; }
      }
      const k = objs.length + '|' + up + '|' + nb + '|' + nw;
      if (sum._k !== k) {
        sum._k = k;
        sum.replaceChildren(h('span', null, `共 ${objs.length} 件設備`,
          nb ? h('b', { class: 'bad' }, `　故障 ${nb}`) : null, nw ? h('b', { class: 'warn-text' }, `　老舊 ${nw}`) : null),
        h('b', null, `維護費合計 ${money(up)} / 月`));
      }
      // maintenance contract box
      const cw = Math.max(0, ...EQ.wearables(state).map(o => EQ.maintainedWeeksLeft(state, o)));
      const info = nWear ? (cw > 0 ? `保養合約生效中，剩 ${cw} 週：儀器耗損速度減半。` : '簽約期間所有儀器耗損速度減半（只涵蓋簽約當下已有的儀器）。') : '還沒有會耗損的儀器（電療、牽引、熱敷等）。';
      setText(contractInfo, info);
      EQ.WEAR_TUNE.CONTRACT_WEEKS.forEach((w, i) => {
        const c = EQ.contractCost(state, w), btn = contractBtns[i];
        setText(btn, `${w} 週　${fmt(c)}`);
        btn.disabled = !nWear || state.money < c;
      });
    },
  };
}

// ---------------------------------------------------------------- synergies
function buildSyn(body, state) {
  body.append(h('div', { class: 'muted u-p' }, '把一組設施緊貼（含斜角）擺在一起，就會啟動專區加成。下方標示你已經擺了哪些、還缺什麼。'));
  const rows = [];
  for (const s of SYNERGIES) {
    const badge = h('span', { class: 'badge' }, '啟動中');
    const needs = s.needs.map(n => {
      const d = BUILDABLES[n] || {};
      return { id: n, el: h('span', { class: 'tag u-need' }, `${d.glyph || ''}${d.name || n}`) };
    });
    const hint = h('div', { class: 'u-small' });
    const el = h('div', { class: 'card u-syn' },
      h('div', null, h('span', { class: 'u-sico' }, s.icon || '✨'), h('b', null, ' ' + s.name), ' ', badge),
      h('div', { class: 'u-small' }, s.desc),
      h('div', { class: 'u-chips' }, needs.map(n => n.el)),
      h('div', { class: 'u-small u-efrow' }, '效果：', chipList(modChips(s.effects))), hint);
    rows.push({ s, el, badge, needs, hint, key: null });
    body.appendChild(el);
  }
  return {
    update() {
      const have = new Set(state.objects.map(o => o.defId));
      for (const r of rows) {
        const active = (state.zones || []).some(z => z.id === r.s.id);
        const miss = r.s.needs.filter(n => !have.has(n));
        const key = active + '|' + miss.join(',');
        if (r.key === key) continue;
        r.key = key;
        r.badge.hidden = !active;
        setClass(r.el, 'selected', active);
        for (const n of r.needs) { n.el.className = 'tag u-need ' + (have.has(n.id) ? 'have' : 'lack'); n.el.dataset.mark = have.has(n.id) ? '✓' : '✗'; }
        r.hint.className = 'u-small ' + (active ? 'good' : 'muted');
        r.hint.textContent = active ? '✅ 已啟動，效果生效中。'
          : miss.length ? `還缺：${miss.map(n => (BUILDABLES[n] || {}).name || n).join('、')}（需先解鎖並建造）`
            : '設施都有了，但還沒連在一起：請讓它們彼此相鄰擺放。';
      }
    },
  };
}

export function mountOverview(root, state, ui) {
  const t = tabbed([
    { id: 'patients', label: '🧑 病患病歷', build: b => buildPatients(b, state, ui) },
    { id: 'staff', label: '🩺 員工', build: b => buildStaff(b, state, ui) },
    { id: 'equip', label: '🔧 設備維護', build: b => buildEquip(b, state, ui) },
    { id: 'syn', label: '✨ 專區辭典', build: b => buildSyn(b, state) },
  ], store);
  root.appendChild(t.el);
  return { update() { t.update(); } };
}
