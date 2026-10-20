// 運作 panel: 研發 / 自費定價 / 社區衛教
import { bus } from '../../core/bus.js';
import { RESEARCH, RESEARCH_TRACKS } from '../../data/research.js';
import { BUILDABLES } from '../../data/buildables.js';
import { TREATMENTS } from '../../data/treatments.js';
import { PATIENT_TYPES } from '../../data/patients.js';
import { COMMUNITY } from '../../data/events.js';
import { LOTS } from '../../data/lots.js';
import * as RS from '../../sim/research.js';
import * as EV from '../../sim/events.js';
import { h, setClass, setText, tabbed, bar, setBar } from '../dom.js';
import { money, fmt, POINT_ICONS, TRACK_COLORS } from '../fmt.js';
import { POINT_LABELS } from '../../core/constants.js';
import { chipList, section, boardsSection } from './common.js';

const store = { tab: 'research' };

// ---------------------------------------------------------------- research
function effectText(e) {
  switch (e.type) {
    case 'unlockBuild': return '解鎖建築：' + e.ids.map(i => (BUILDABLES[i] || {}).name || i).join('、');
    case 'unlockTreatment': return '解鎖療程：' + e.ids.map(i => (TREATMENTS[i] || {}).name || i).join('、');
    case 'maxStaff': return `員工上限 +${e.n}`;
    case 'rep': return `聲譽 +${e.value}`;
    case 'mod': {
      const key = e.key.startsWith('typeSpawn.') ? (PATIENT_TYPES[e.key.split('.')[1]] || {}).name + '來客' : e.key;
      const names = { selfPayConv: '自費轉換率', selfPayPrice: '自費單價', researchGain: '點數獲得', elderSat: '長輩滿意度', walkSpeed: '步行速度',
        spawnMult: '來客量', patience: '病患耐心', slipRisk: '滑倒風險', staffStamina: '員工體力消耗', rentMult: '房租', wageMult: '薪資', nhiTurnover: '健保翻桌率', nhiCapBonus: '健保上限' };
      const nm = names[e.key] || key;
      if (e.op === 'mul') return `${nm} ×${e.value}`;
      const pctKey = e.key !== 'elderSat';
      return `${nm} ${e.value >= 0 ? '+' : ''}${pctKey ? Math.round(e.value * 100) + '%' : e.value}`;
    }
    default: return '';
  }
}

function buildResearch(body, state) {
  const cur = h('div', { class: 'card u-curres' });
  const curName = h('b'), curInfo = h('span', { class: 'muted' }), curBar = bar();
  cur.append(h('div', { class: 'row' }, h('span', null, '🔬 研發中：'), curName, curInfo), curBar);
  const pts = h('div', { class: 'row u-pts' });
  const ptEls = {};
  for (const tr of RESEARCH_TRACKS) {
    ptEls[tr.id] = h('b');
    pts.appendChild(h('span', { class: 'tag' }, `${POINT_ICONS[tr.pointKey || tr.id]} ${tr.name}點 `, ptEls[tr.id]));
  }
  body.append(cur, pts);

  const rows = {};
  for (const tr of RESEARCH_TRACKS) {
    const list = h('div', { class: 'u-list2' });
    body.append(h('div', { class: 'u-sec', style: { borderColor: TRACK_COLORS[tr.id] } }, `${POINT_ICONS[tr.pointKey || tr.id]} ${tr.name}線`,
      h('span', { class: 'muted u-small' }, '　' + (tr.desc || ''))), list);
    for (const n of Object.values(RESEARCH).filter(x => x.track === tr.id)) {
      const status = h('span', { class: 'badge' });
      const btn = h('button', { class: 'btn small primary', type: 'button', onclick: () => {
        const c = RS.canStart(state, n.id);
        if (!c.ok) { bus.emit('toast', { text: c.reason, kind: 'bad' }); return; }
        RS.start(state, n.id);
      } }, '研發');
      const need = (n.requires || []).map(q => (RESEARCH[q] || {}).name || q);
      const el = h('div', { class: 'card u-node' },
        h('div', { class: 'u-row2' },
          h('div', { class: 'u-grow' },
            h('div', null, h('b', null, n.name), ' ', status),
            h('div', { class: 'muted u-small' }, n.desc),
            h('div', { class: 'u-small u-effs' }, (n.effects || []).map(effectText).filter(Boolean).map(t => h('span', { class: 'u-eff' }, '▸ ' + t))),
            need.length ? h('div', { class: 'muted u-small' }, '前置：' + need.join('、')) : null),
          h('div', { class: 'u-side' },
            h('div', { class: 'u-pcost' }, `${POINT_ICONS[tr.pointKey || tr.id]} ${n.cost}`),
            h('div', { class: 'muted u-small' }, `${n.weeks} 週`), btn)));
      rows[n.id] = { el, status, btn, st: null, ok: null };
      list.appendChild(el);
    }
  }
  const LABEL = { done: '已完成', current: '研發中', available: '可研發', locked: '未解鎖' };
  return {
    update() {
      for (const tr of RESEARCH_TRACKS) setText(ptEls[tr.id], fmt(Math.floor(state.points[tr.pointKey || tr.id] || 0)));
      const info = RS.progressInfo(state);
      cur.hidden = !info.node;
      if (info.node) {
        setText(curName, info.node.name);
        setText(curInfo, `　第 ${info.progress} / ${info.weeks} 週，剩 ${info.remaining} 週`);
        setBar(curBar, info.pct);
      }
      for (const { node, status } of RS.list(state)) {
        const r = rows[node.id];
        if (!r) continue;
        let reason = '';
        if (status === 'available') {
          const c = RS.canStart(state, node.id);
          if (!c.ok) reason = c.reason;
        }
        const key = status + '|' + reason;
        if (r.st !== key) {
          r.st = key;
          setText(r.status, LABEL[status]);
          r.el.classList.toggle('locked', status === 'locked');
          r.el.classList.toggle('u-done', status === 'done');
          r.el.classList.toggle('selected', status === 'current');
          r.btn.hidden = status === 'done' || status === 'current';
          r.btn.disabled = status !== 'available' || !!reason;
          r.btn.dataset.tip = status === 'locked' ? '需先完成前置研發' : reason;
          r.status.className = 'badge' + (status === 'done' ? ' u-b-done' : status === 'current' ? ' u-b-cur' : status === 'locked' ? ' u-b-lock' : '');
        }
      }
    },
  };
}

// ---------------------------------------------------------------- pricing
function convOf(state, mult) {
  const base = Math.max(0, Math.min(0.9, 0.25 + ((state.mods && state.mods.selfPayConv) || 0)));
  return Math.max(0.03, Math.min(0.95, base * (1 - 0.8 * (mult - 1))));
}
function weeklyPatients(state) {
  const lot = LOTS[state.lotLevel || 0];
  const raw = (12 + state.reputation * 0.12) * ((state.mods && state.mods.spawnMult) || 1);
  return Math.min(raw, lot ? lot.maxPatientsPerWeek : raw);
}

function buildPricing(body, state) {
  body.append(h('div', { class: 'muted u-p' }, '自費項目的售價 = 基本價 × 你設定的倍率 × 專區加成。定價越高，願意升級自費的病人越少。下方「預估」為粗略推算，僅供參考。'));
  const rows = [];
  const plist = h('div', { class: 'u-list2' });
  body.appendChild(plist);
  const self = Object.values(TREATMENTS).filter(t => t.kind === 'self');
  for (const t of self) {
    const slider = h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, value: (state.policy.priceMult[t.id]) || 1 });
    const multEl = h('b'), priceEl = h('b'), hint = h('span', { class: 'muted' }), income = h('b'), conv = bar(), warn = h('div', { class: 'bad u-small' });
    slider.addEventListener('input', () => {
      const m = parseFloat(slider.value);
      try { EV.setPriceMult(state, t.id, m); } catch (e) { state.policy.priceMult[t.id] = m; }
      refresh(r);
    });
    const reset = h('button', { class: 'btn small', type: 'button', onclick: () => { slider.value = 1; slider.dispatchEvent(new Event('input')); } }, '×1');
    const el = h('div', { class: 'card u-price' },
      h('div', { class: 'u-row2' }, h('div', { class: 'u-grow' }, h('b', null, t.name), h('div', { class: 'muted u-small' }, t.intro)),
        h('div', { class: 'u-side' }, h('div', { class: 'muted u-small' }, `基本價 ${money(t.price)}`))),
      h('div', { class: 'u-slide' }, slider, multEl, reset),
      h('div', { class: 'u-grid2' },
        h('div', { class: 'stat' }, h('span', null, '實收單價'), priceEl),
        h('div', { class: 'stat' }, h('span', null, '預估週收入'), income),
        h('div', { class: 'stat' }, h('span', null, '預估轉換率'), conv)),
      hint, warn);
    const r = { t, el, slider, multEl, priceEl, hint, income, conv, warn, unlocked: null };
    rows.push(r);
    plist.appendChild(el);
  }
  function refresh(r) {
    const mult = parseFloat(r.slider.value);
    const price = r.t.price * mult * ((state.mods && state.mods.selfPayPrice) || 1);
    const cv = convOf(state, mult);
    const vol = weeklyPatients(state) * 0.3;
    setText(r.multEl, '×' + mult.toFixed(2));
    setText(r.priceEl, money(price));
    setBar(r.conv, cv, cv < 0.15 ? 'bad' : cv < 0.3 ? 'warn' : '');
    setText(r.income, money(price * cv * vol));
    setText(r.hint, cv >= 0.4 ? '💬 價格親民，多數病人願意嘗試。' : cv >= 0.25 ? '💬 約三、四成的病人會升級。' : cv >= 0.12 ? '💬 只有少數人買單，高價走精緻路線。' : '💬 定價偏高，幾乎沒人願意自費。');
    const built = state.objects.some(o => r.t.objects.includes(o.defId));
    setText(r.warn, built ? '' : '⚠ 尚未建置對應設備，目前無法提供此療程。');
    r.warn.hidden = built;
  }
  return {
    update() {
      for (const r of rows) {
        const u = RS.isTreatmentUnlocked(state, r.t.id);
        if (r.unlocked !== u) {
          r.unlocked = u;
          r.el.classList.toggle('locked', !u);
          r.slider.disabled = !u;
          if (!u) { const n = RESEARCH[r.t.requires]; r.hint.textContent = '🔒 需研發：' + (n ? n.name : r.t.requires); }
        }
        if (u && document.activeElement !== r.slider) r.slider.value = state.policy.priceMult[r.t.id] || 1;
        if (u) refresh(r);
      }
    },
  };
}

// ---------------------------------------------------------------- community
function buildCommunity(body, state) {
  const rows = {};
  const list = h('div', { class: 'u-list2' });
  for (const c of COMMUNITY) {
    const btn = h('button', { class: 'btn small primary', type: 'button', onclick: () => {
      let r;
      try { r = EV.startCommunity(state, c.id); } catch (e) { console.error(e); r = { ok: false, reason: '無法舉辦' }; }
      if (r && r.ok === false) bus.emit('toast', { text: r.reason || '無法舉辦', kind: 'bad' });
      else bus.emit('toast', { text: `開始舉辦：${c.name}`, kind: 'good' });
    } }, '舉辦');
    const eff = [];
    for (const k of Object.keys((c.effects && c.effects.spawn) || {})) eff.push({ text: `${(PATIENT_TYPES[k] || {}).name || k}來客 +${Math.round(c.effects.spawn[k] * 100)}%`, good: true });
    if (c.effects && c.effects.reputation) eff.push({ text: `聲譽 +${c.effects.reputation}`, good: true });
    for (const k of Object.keys((c.effects && c.effects.points) || {})) eff.push({ text: `${POINT_LABELS[k]}點 +${c.effects.points[k]}`, good: true });
    const status = h('div', { class: 'u-small' });
    const el = h('div', { class: 'card u-row2' },
      h('div', { class: 'u-grow' }, h('b', null, '🎪 ' + c.name), h('div', { class: 'muted u-small' }, c.desc),
        h('div', { class: 'u-small' }, chipList(eff)),
        h('div', { class: 'muted u-small' }, `費用 ${money(c.cost)}　持續 ${c.durationWeeks} 週　冷卻 ${c.cooldownWeeks} 週`), status),
      h('div', { class: 'u-side' }, btn));
    rows[c.id] = { el, btn, status, key: null };
    list.appendChild(el);
  }
  const boards = boardsSection(state);
  body.append(section('社區活動', list), boards.el);
  return {
    update() {
      let info = [];
      try { info = (EV.communityList && EV.communityList(state)) || []; } catch (e) { info = []; }
      for (const c of COMMUNITY) {
        const r = rows[c.id];
        const meta = info.find(x => x && x.def && x.def.id === c.id) || {};
        const isAct = meta.status === 'active';
        let text = '', dis = false;
        if (isAct) { text = `進行中，剩 ${meta.weeksLeft} 週`; dis = true; }
        else if (meta.status === 'cooldown') { text = `冷卻中，還要 ${meta.cooldownLeft} 週`; dis = true; }
        else if (state.money < c.cost) { text = '資金不足'; dis = true; }
        const key = text + dis;
        if (r.key !== key) {
          r.key = key;
          setText(r.status, text);
          r.status.className = 'u-small ' + (isAct ? 'good' : 'bad');
          r.btn.disabled = dis;
          setClass(r.el, 'selected', isAct);
        }
      }
      boards.update(state);
    },
  };
}

export function mountOperate(root, state, ui) {
  const t = tabbed([
    { id: 'research', label: '🔬 研發', build: b => buildResearch(b, state) },
    { id: 'pricing', label: '💲 自費定價', build: b => buildPricing(b, state) },
    { id: 'community', label: '🎪 社區衛教', build: b => buildCommunity(b, state) },
  ], store);
  root.appendChild(t.el);
  return { update() { t.update(); } };
}
