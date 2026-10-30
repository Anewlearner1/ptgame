// 餐廳 panel: 經營方針 / 菜單看板 / 擴建 / 稱號與徽章
import { bus } from '../../core/bus.js';
import { FOCUS, PATIENT_TYPES } from '../../data/patients.js';
import { POLICY_TEXT } from '../../data/events.js';
import { LOTS } from '../../data/lots.js';
import { BUILDABLES } from '../../data/buildables.js';
import { TITLES } from '../../data/texts.js';
import { ACHIEVEMENT_CATS, ACHIEVEMENT_TIERS, MAX_BADGES } from '../../data/achievements.js';
import { POINT_KEYS, POINT_LABELS } from '../../core/constants.js';
import { listAchievements, equipTitle, setBadges, displayTitle, badgeIcons } from '../../sim/achievements.js';
import * as EV from '../../sim/events.js';
import * as INSP from '../../sim/inspection.js';
import { riskOf, reviewOf, RISK_TUNE } from '../../sim/economy.js';
import { h, setClass, setText, tabbed, bar, setBar } from '../dom.js';
import { money, fmt, TYPE_ICONS } from '../fmt.js';
import { chipList, section, boardsSection } from './common.js';
import { confirmDialog } from '../modal.js';
import { ctx } from '../ctx.js';
import { titleFor } from '../topbar.js';
import * as CAR from '../../sim/career.js';
import { mountGoalsTab, setGoalsOpener } from '../career.js';

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
      h('div', { class: 'u-small' }, '各類客人來客倍率：', chipList(chips)));
    cards[f] = { el, mark };
    wrap.appendChild(el);
  }
  function pick(f) {
    if (state.policy.focus === f) return;
    try { EV.setFocus(state, f); } catch (e) { state.policy.focus = f; bus.emit('mods:dirty', {}); }
    bus.emit('toast', { text: `經營方針改為「${FOCUS[f].name}」`, kind: 'info' });
  }
  body.append(section('經營方針', wrap));

  const nameIn = h('input', { type: 'text', maxLength: 16, class: 'u-input', value: state.shopName || '' });
  const save = () => {
    const v = nameIn.value.trim();
    if (v) { state.shopName = v; nameIn._dirty = false; bus.emit('toast', { text: '店名已更新', kind: 'good' }); }
  };
  nameIn.addEventListener('input', () => { nameIn._dirty = true; });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); nameIn.blur(); } e.stopPropagation(); });
  body.append(section('店名', h('div', { class: 'row' }, nameIn, h('button', { class: 'btn small', type: 'button', onclick: save }, '儲存'))));
  return {
    update() {
      for (const f of Object.keys(cards)) {
        const on = state.policy.focus === f;
        setClass(cards[f].el, 'selected', on);
        cards[f].mark.hidden = !on;
      }
      if (document.activeElement !== nameIn && nameIn.value !== state.shopName && !nameIn._dirty) nameIn.value = state.shopName || '';
    },
  };
}

function buildBoards(body, state) {
  const b = boardsSection(state);
  body.append(b.el);
  return { update() { b.update(state); } };
}

// ---- expansion
function buildExpand(body, state) {
  try { if (CAR.markExpandTabOpened) CAR.markExpandTabOpened(state); } catch (e) { console.error(e); }   // 新手任務 #10
  const info = h('div'), list = h('div', { class: 'u-list2' }), btn = h('button', { class: 'btn primary', type: 'button' }, '擴建');
  const note = h('div', { class: 'bad u-small' });
  let rowsKey = '', rowEls = [];
  btn.addEventListener('click', () => {
    const next = LOTS[(state.lotLevel || 0) + 1];
    if (!next) return;
    confirmDialog({
      title: '擴建店面', text: `擴建為「${next.name}」需花費 ${money(next.expandCost)}。確定要擴建嗎？`, okLabel: '擴建',
      onOk: () => {
        let ok = false;
        try { ok = INSP.expand(state); } catch (e) { console.error(e); }
        bus.emit('toast', ok ? { text: `擴建完成：${next.name}`, kind: 'good' } : { text: '擴建失敗', kind: 'bad' });
      },
    });
  });
  body.append(section('擴建店面', info, list, note, h('div', { class: 'row' }, btn)));
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
            cmp('每日來客上限', cur.maxPatientsPerWeek, next.maxPatientsPerWeek),
            cmp('員工上限', cur.maxStaff, next.maxStaff),
            cmp('房租/月', cur.rent, next.rent, money),
            cmp('擴建費', 0, next.expandCost, v => money(v))));
      }
      let can = { ok: false, missing: [], checks: [] };
      try { can = INSP.canExpand(state); } catch (e) { /* module not ready */ }
      const rows = (can.checks || []).map(c => ({ ok: c.ok, text: c.label }));
      const k = rows.map(r => r.text + r.ok).join('|');
      if (k !== rowsKey) {
        rowsKey = k;
        list.replaceChildren(...rows.map(r => h('div', { class: 'u-check ' + (r.ok ? 'good' : 'bad') },
          h('span', null, r.ok ? '✔' : '✘'), h('span', { class: 'u-grow' }, r.text))));
      }
      const afford = state.money >= next.expandCost;
      btn.disabled = !(can.ok && afford);
      setText(btn, `擴建（${money(next.expandCost)}）`);
      setText(note, '');
    },
  };
}

// ---- 稱號與徽章 (docs/ACHIEVEMENTS.md §2 / §5.4)
const CAT_FALLBACK = { milestone: '經營里程碑', taiwan: '台灣在地特色', challenge: '挑戰與隱藏' };
const CAT_SHORT = { milestone: '里程碑', taiwan: '在地', challenge: '挑戰' };
const TIER_NAMES = { 1: '銅', 2: '銀', 3: '金' };
const TIER_ICONS = { 1: '🥉', 2: '🥈', 3: '🥇' };
const achvStore = { cat: 'all' };
let achvLive = null;          // {el, refresh} of the mounted 稱號與徽章 tab (bus listener below is registered once)
for (const ev of ['achievement:unlocked', 'achv:changed']) bus.on(ev, () => { if (achvLive && achvLive.el.isConnected) achvLive.refresh(); });

// ACHIEVEMENT_CATS may be an array of ids / {id,name} or an id -> name|{name} map; normalise to [{id,name}]
function normCats() {
  const raw = ACHIEVEMENT_CATS;
  let out = [];
  if (Array.isArray(raw)) out = raw.map(c => typeof c === 'string' ? { id: c } : { id: c.id || c.key, name: c.name || c.label, icon: c.icon });
  else if (raw && typeof raw === 'object') out = Object.keys(raw).map(k => typeof raw[k] === 'string' ? { id: k, name: raw[k] } : { id: k, name: raw[k].name || raw[k].label, icon: raw[k].icon });
  if (!out.length) out = Object.keys(CAT_FALLBACK).map(id => ({ id }));
  return out.map(c => ({ id: c.id, name: CAT_SHORT[c.id] || c.name || CAT_FALLBACK[c.id] || c.id, icon: c.icon || '' }));
}

function atText(at) { return at ? `第${at.year}年${at.month}月第${at.week}週` : ''; }

// reward = tier defaults (ACHIEVEMENT_TIERS) overridden by def.reward; points go to def.reward.pointKey (default 服務)
function rewardChips(def) {
  const T = (ACHIEVEMENT_TIERS && ACHIEVEMENT_TIERS[def.tier]) || {};
  const o = def.reward || {};
  const money_ = o.money != null ? o.money : T.money, rep = o.rep != null ? o.rep : T.rep;
  const out = [];
  if (money_) out.push(money(money_));
  if (rep) out.push(`聲譽 +${rep}`);
  if (o.points && typeof o.points === 'object') {
    for (const k of POINT_KEYS) if (o.points[k]) out.push(`${POINT_LABELS[k]}點 +${o.points[k]}`);
  } else {
    const pts = o.points != null ? o.points : T.points;
    if (pts) out.push(`${POINT_LABELS[o.pointKey] || POINT_LABELS.service}點 +${pts}`);
  }
  return out;
}

function buildTitle(body, state) {
  // -- current 老闆稱號 (reputation ladder, unchanged) + equipped special title
  const nameEl = h('div', { class: 'u-bigtitle u-curtitle' }), nextEl = h('div', { class: 'muted u-small' }), b = bar();
  const repList = h('div', { class: 'u-list2 u-replist' });
  const repItems = TITLES.map(t => {
    const el = h('div', { class: 'u-check' }, h('span'), h('span', { class: 'u-grow' }, t.title), h('span', { class: 'muted' }, `聲譽 ${t.minRep}`));
    repList.appendChild(el);
    return { t, el };
  });
  const repDet = h('details', { class: 'u-repdet' }, h('summary', { class: 'u-small muted' }, '聲譽稱號一覽'), repList);

  // -- 稱號與徽章
  const cntEl = h('b', { class: 'u-achcount' }), tierEl = h('span', { class: 'u-small' });
  const signEl = h('span', { class: 'u-signicons' }), slotEl = h('span', { class: 'muted u-small' });
  const noteEl = h('div', { class: 'u-small u-achnote' });
  const cats = normCats();
  const catBtns = {};
  const tabs = h('div', { class: 'tabs u-subtabs u-achtabs' });
  const list = h('div', { class: 'u-achlist' });
  const cards = new Map();    // id -> refs
  let built = false, lastKey = '';

  function toast(text, kind = 'bad') { bus.emit('toast', { text, kind }); }

  function makeCard(a) {
    const d = a.def;
    const ico = h('div', { class: 'u-achico' }, d.badge || '🏆');
    const nameT = h('b', { class: 'u-achname' });
    const chip = h('span', { class: `tag u-tier u-tier${d.tier}` }, `${TIER_ICONS[d.tier] || ''}${TIER_NAMES[d.tier] || ''}`);
    const titleChip = d.title ? h('span', { class: 'tag u-titlechip' }, `稱號「${d.title}」`) : null;
    const desc = h('div', { class: 'u-small u-achdesc' });
    const rew = h('div', { class: 'u-small muted u-achrew' }, '獎勵：' + (rewardChips(d).join('、') || '—'));
    const pbar = bar(), ptxt = h('span', { class: 'u-small muted u-achptxt' });
    const prog = h('div', { class: 'u-achprog' }, pbar, ptxt);
    const when = h('div', { class: 'u-small good u-achwhen' });
    const eq = d.title ? h('button', { class: 'btn small', type: 'button', onclick: () => onEquip(d.id) }, '配戴稱號') : null;
    const sign = h('button', { class: 'btn small', type: 'button', onclick: () => onSign(d.id) }, '掛上招牌');
    const el = h('div', { class: 'card u-ach', dataset: { ach: d.id, cat: d.cat, tier: d.tier } },
      ico,
      h('div', { class: 'u-achmain' },
        h('div', { class: 'u-achhead' }, nameT, chip, titleChip),
        desc, rew, prog, when),
      h('div', { class: 'u-achbtns' }, eq, sign));
    const r = { el, ico, nameT, desc, prog, pbar, ptxt, when, eq, sign, titleChip, rew };
    cards.set(d.id, r);
    return el;
  }

  function onEquip(id) {
    const eqId = state.achv && state.achv.title;
    let ok = false;
    try { ok = equipTitle(state, eqId === id ? null : id); } catch (e) { console.error(e); }
    if (!ok) toast('無法配戴這個稱號');
    else toast(eqId === id ? '已取下特殊稱號' : `已配戴稱號：${displayTitle(state)}`, 'good');
    refresh();
  }
  function onSign(id) {
    const cur = (state.achv && state.achv.badges) || [];
    const on = cur.includes(id);
    if (!on && cur.length >= MAX_BADGES) {
      const msg = `招牌最多只能掛 ${MAX_BADGES} 枚徽章，請先取下一枚`;
      setText(noteEl, '⚠ ' + msg); noteEl.hidden = false;
      toast(msg, 'info');
      return;
    }
    let ok = false;
    try { ok = setBadges(state, on ? cur.filter(x => x !== id) : [...cur, id]); } catch (e) { console.error(e); }
    if (!ok) toast('無法變更招牌徽章');
    else { setText(noteEl, ''); noteEl.hidden = true; }
    refresh();
  }

  for (const c of cats) {
    catBtns[c.id] = h('button', { class: 'tab', type: 'button', onclick: () => { achvStore.cat = c.id; refresh(); } }, c.name);
    tabs.appendChild(catBtns[c.id]);
  }
  catBtns.all = h('button', { class: 'tab', type: 'button', onclick: () => { achvStore.cat = 'all'; refresh(); } }, '全部');
  tabs.prepend(catBtns.all);

  noteEl.hidden = true;
  body.append(section('稱號與徽章', nameEl, b, nextEl, repDet,
    h('div', { class: 'u-achsum' },
      h('div', null, '已解鎖 ', cntEl, '　', tierEl),
      h('div', { class: 'u-small' }, '招牌：', signEl, ' ', slotEl)),
    noteEl, tabs, list));

  function refresh() {
    let arr = [];
    try { arr = listAchievements(state) || []; } catch (e) { console.error(e); }
    if (!built || arr.length !== cards.size) {
      // (re)build once: card set only changes if the data does
      built = true; cards.clear(); list.replaceChildren(...arr.map(makeCard));
    }
    const eqId = state.achv && state.achv.title;
    const badges = (state.achv && state.achv.badges) || [];
    const full = badges.length >= MAX_BADGES;
    let done = 0;
    const tierN = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }, catN = {};
    for (const a of arr) {
      const d = a.def, r = cards.get(d.id);
      if (!r) continue;
      if (a.unlocked) done++;
      if (tierN[d.tier]) { tierN[d.tier][1]++; if (a.unlocked) tierN[d.tier][0]++; }
      const cn = catN[d.cat] || (catN[d.cat] = [0, 0]);
      cn[1]++; if (a.unlocked) cn[0]++;
      const masked = !!a.masked;
      setText(r.nameT, masked ? '？？？' : d.name);
      setText(r.desc, masked ? (d.hint || '（隱藏成就）') : (a.unlocked ? d.desc : (d.desc || d.hint || '')));
      setText(r.ico, masked ? '❓' : (d.badge || '🏆'));
      setClass(r.el, 'u-locked', !a.unlocked);
      setClass(r.el, 'u-masked', masked);
      setClass(r.el, 'selected', a.unlocked && eqId === d.id);
      r.titleChip && (r.titleChip.hidden = masked);
      const showProg = !a.unlocked && !masked && a.goal != null && a.goal > 0 && a.progress != null;
      r.prog.hidden = !showProg;
      if (showProg) {
        setBar(r.pbar, a.progress / a.goal);
        const pf = d.metric === 'money' ? money : fmt;
        setText(r.ptxt, `${pf(Math.min(a.progress, a.goal))} / ${pf(a.goal)}`);
      }
      r.when.hidden = !a.unlocked;
      if (a.unlocked) setText(r.when, '✔ 已於 ' + atText(a.at) + ' 解鎖');
      if (r.eq) {
        const on = eqId === d.id;
        r.eq.hidden = !a.unlocked;
        setText(r.eq, on ? '取消配戴' : '配戴稱號');
        setClass(r.eq, 'primary', !on);
      }
      const hung = badges.includes(d.id);
      r.sign.hidden = !a.unlocked;
      setText(r.sign, hung ? '取下招牌' : '掛上招牌');
      setClass(r.sign, 'danger', hung);
      setClass(r.sign, 'u-dim', !hung && full);
    }
    setText(cntEl, `${done} / ${arr.length}`);
    setText(tierEl, [1, 2, 3].map(t => `${TIER_ICONS[t]}${tierN[t][0]}/${tierN[t][1]}`).join('　'));
    let icons = [];
    try { icons = badgeIcons(state) || []; } catch (e) { /* ignore */ }
    setText(signEl, icons.length ? icons.join(' ') : '（尚未掛上徽章）');
    setText(slotEl, `自選徽章 ${badges.length}/${MAX_BADGES}`);
    if (!full && !noteEl.hidden) { setText(noteEl, ''); noteEl.hidden = true; }
    // category tabs + filter
    if (achvStore.cat !== 'all' && !cats.some(c => c.id === achvStore.cat)) achvStore.cat = 'all';
    for (const c of cats) {
      const n = catN[c.id] || [0, 0];
      setText(catBtns[c.id], `${c.name} ${n[0]}/${n[1]}`);
    }
    setText(catBtns.all, `全部 ${done}/${arr.length}`);
    for (const id of Object.keys(catBtns)) setClass(catBtns[id], 'active', id === achvStore.cat);
    const k = achvStore.cat;
    if (k !== lastKey) {
      lastKey = k;
      for (const r of cards.values()) r.el.hidden = k !== 'all' && r.el.dataset.cat !== k;
    }
  }
  achvLive = { el: list, refresh };

  return {
    update() {
      const rep = Math.round(state.reputation);
      const { cur, next } = titleFor(rep);
      let dt = cur.title;
      try { dt = displayTitle(state) || cur.title; } catch (e) { /* module not ready */ }
      setText(nameEl, `🎖 ${dt}`);
      setBar(b, next ? (rep - cur.minRep) / (next.minRep - cur.minRep) : 1);
      setText(nextEl, next ? `聲譽 ${rep}　距離「${next.title}」還差 ${next.minRep - rep}` : `聲譽 ${rep}　已達最高稱號`);
      for (const it of repItems) {
        const ok = rep >= it.t.minRep;
        it.el.className = 'u-check ' + (ok ? 'good' : 'muted');
        setText(it.el.firstChild, ok ? '★' : '☆');
      }
      refresh();
    },
  };
}

// ---- 營運狀態列 (always visible above the tabs): 老闆稱號 · 網路評價 (M7) · 食安風險 (M3) + 目前效應 (buffs / community)
function buildStatus(state) {
  const titleEl = h('span', { class: 'u-st-title' });
  const reviewEl = h('span', { class: 'tag u-st-review', tip: '網路評價（1~5）：每月依平均滿意度漲跌，每差 0.1 影響新客量約 1%。' });
  const riskNum = h('em', { class: 'u-num' }), riskBar = bar();
  const riskEl = h('span', { class: 'u-bl u-st-risk', tip: `食安風險（0~100）：設備老舊、員工疲勞或客人滿意度低會上升，每週自然下降 ${RISK_TUNE.WEEK_DECAY}。超過 ${RISK_TUNE.HIGH} 時食安類事件更容易發生，年度稽查也會扣分。` }, '食安風險', riskBar, riskNum);
  const eff = h('div', { class: 'u-st-eff' });
  const el = h('div', { class: 'card u-status' }, h('div', { class: 'u-st-row' }, titleEl, reviewEl, riskEl), eff);
  let sig = '';
  return {
    el,
    update() {
      const rep = Math.round(state.reputation);
      let dt = titleFor(rep).cur.title;
      try { dt = displayTitle(state) || dt; } catch (e) { /* module not ready */ }
      setText(titleEl, `🎖 ${dt}`);
      const rv = reviewOf(state);
      setText(reviewEl, `⭐ 評價 ${rv.toFixed(1)}`);
      setClass(reviewEl, 'good', rv >= 4.2); setClass(reviewEl, 'bad', rv < 3.2);
      const rk = riskOf(state);
      setBar(riskBar, rk / 100, rk > RISK_TUNE.HIGH ? 'bad' : rk > 30 ? 'warn' : '');
      setText(riskNum, Math.round(rk));
      let list = [];
      try { list = EV.activeEffects(state); } catch (e) { /* ignore */ }
      const k = list.map(a => a.label + ':' + a.weeksLeft + ':' + a.chips.map(c => c.text).join('/')).join('|');
      if (k !== sig) {
        sig = k;
        eff.hidden = !list.length;
        eff.replaceChildren(...(list.length ? [h('span', { class: 'u-st-lab' }, '目前效應')] : []),
          ...list.map(a => {
            const good = a.chips.length ? a.chips.filter(c => c.good).length >= a.chips.length / 2 : true;
            return h('span', { class: 'tag u-chip u-st-chip ' + (good ? 'good' : 'bad'), tip: a.chips.map(c => c.text).join('、') || a.label }, `${a.label}　${a.weeksLeft} 週`);
          }));
      }
    },
  };
}

let liveTabs = null;
// 餐廳 panel -> 🎯 目標 tab (year-review 「看生涯進度」, career card); works whether or not the panel is already open
setGoalsOpener(() => {
  const ui = ctx.ui;
  store.tab = 'goals';
  if (ui && ui.panel === 'clinic' && liveTabs) liveTabs.select('goals');
  else if (ui) ui.panel = 'clinic';
});

export function mountClinic(root, state, ui) {
  const status = buildStatus(state);
  const t = tabbed([
    { id: 'goals', label: '🎯 目標', build: b => mountGoalsTab(b, state) },
    { id: 'policy', label: '🧭 經營方針', build: b => buildPolicy(b, state) },
    { id: 'boards', label: '📌 菜單看板', build: b => buildBoards(b, state) },
    { id: 'expand', label: '🏗 擴建', build: b => buildExpand(b, state) },
    { id: 'title', label: '🎖 稱號與徽章', build: b => buildTitle(b, state) },
  ], store);
  liveTabs = t;
  root.append(status.el, t.el);
  status.update();
  return { update() { status.update(); t.update(); } };
}
