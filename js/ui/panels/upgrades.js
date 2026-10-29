// 持續精進 section of the 運作 → 研發 tab: 6 repeatable upgrade lines (data/upgrades.js, sim/research.js).
// Built once, updated in place (no re-render): level, now -> next effect text, cost chip, button state + visible reason.
import { bus } from '../../core/bus.js';
import { PATIENT_TYPES } from '../../data/patients.js';
import { UPGRADE_LINES, UPGRADE_DOMAIN_NAMES, upgradeCost, upgradeCostTotal } from '../../data/upgrades.js';
import { MOD_LABELS } from '../../sim/efftext.js';
import * as RS from '../../sim/research.js';
import { h, setText, setClass, bar, setBar } from '../dom.js';
import { fmt, POINT_ICONS, TRACK_COLORS } from '../fmt.js';

const MINUS = '−';
const round1 = (v) => Math.round(v * 10) / 10;

// One effect of a line at some level -> { label, text }. typeCure.* / typeSat.* entries collapse to a single "四類病患…" row.
function effectParts(line, level) {
  const out = [], seenGroup = new Set();
  for (const e of line.effects) {
    const v = Math.round(e.perLevel * level * 1e6) / 1e6;
    let label, kind = 'pct';
    const dot = /^(typeCure|typeSat)\./.exec(e.key);
    if (dot) {
      if (seenGroup.has(dot[1])) continue;
      seenGroup.add(dot[1]);
      const n = Object.keys(PATIENT_TYPES).length;
      label = (n === 4 ? '四類病患' : '各類病患') + (dot[1] === 'typeCure' ? '治癒效率' : '滿意度');
      if (dot[1] === 'typeSat') kind = 'abs';
    } else {
      const m = MOD_LABELS[e.key] || [e.key, 'abs'];
      label = m[0]; kind = m[1];
    }
    let text;
    const sign = v > 0 ? '+' : v < 0 ? MINUS : '';
    const a = Math.abs(v);
    if (v === 0) text = kind === 'pct' ? '0%' : '0';
    else if (kind === 'pct') text = sign + round1(a * 100) + '%';
    else text = sign + round1(a) + (e.key === 'repGrowth' ? '/週' : '');
    out.push({ label, text, v, key: e.key });
  }
  return out;
}

function effectLine(line, level) { return effectParts(line, level).map(p => `${p.label} ${p.text}`).join('、'); }

function tipText(line, lv) {
  const per = effectParts(line, 1).map(p => `${p.label} ${p.text}`).join('、');
  const max = effectLine(line, line.cap);
  const costs = [];
  for (let i = lv; i < Math.min(line.cap, lv + 3); i++) costs.push(upgradeCost(line, i));
  return [
    line.desc,
    `每級：${per}`,
    `滿級（Lv.${line.cap}）：${max}`,
    costs.length ? `接下來費用：${costs.join(' → ')} ${UPGRADE_DOMAIN_NAMES[line.domain]}點` : '已達最高等級',
    `滿級累計：${fmt(upgradeCostTotal(line))} ${UPGRADE_DOMAIN_NAMES[line.domain]}點`,
    line.note ? `「${line.note.replace(/[「」]/g, '')}」` : '',
  ].filter(Boolean).join('\n');
}

function sparkle(card) {
  card.classList.remove('u-upg-flash');
  void card.offsetWidth;             // restart the animation
  card.classList.add('u-upg-flash');
  const sp = h('span', { class: 'u-upg-spark', 'aria-hidden': 'true' }, '✨');
  card.appendChild(sp);
  setTimeout(() => { sp.remove(); card.classList.remove('u-upg-flash'); }, 900);
}

export function buildUpgrades(state) {
  const summary = h('span', { class: 'tag u-upg-sum' });
  const el = h('div', { class: 'u-section u-upg', dataset: { upgrades: '1' } },
    h('div', { class: 'u-sec u-upg-head' }, '♾ 持續精進', h('span', { class: 'muted u-small' }, '　研發樹之外，點數可以一直投資。'), summary),
    h('div', { class: 'muted u-small u-upg-intro' }, '每條路線可重複提升，費用逐級增加。效果即時生效，滿級後不再提供加成。'));
  const grid = h('div', { class: 'u-upg-grid' });
  el.appendChild(grid);

  const rows = {};
  for (const line of UPGRADE_LINES) {
    const color = TRACK_COLORS[line.domain];
    const lvEl = h('b', { class: 'u-upg-lv' });
    const pips = bar();
    const nowEl = h('span', { class: 'u-upg-now' });
    const nextEl = h('span', { class: 'u-upg-next' });
    const costEl = h('span', { class: 'tag u-upg-cost', style: { '--pc': color } });
    const why = h('div', { class: 'u-small u-upg-why' });
    const info = h('span', { class: 'u-upg-info', role: 'img', 'aria-label': '詳細說明' }, 'ⓘ');
    info.dataset.tipTap = '';
    const btn = h('button', { class: 'btn small primary u-upg-btn', type: 'button', onclick: () => {
      const c = RS.canUpgrade(state, line.id);
      if (!c.ok) { bus.emit('toast', { text: c.reason, kind: 'bad' }); return; }
      if (RS.buyUpgrade(state, line.id)) sparkle(card);
    } }, '提升');
    const card = h('div', { class: 'card u-upg-card', dataset: { line: line.id, domain: line.domain }, style: { '--pc': color } },
      h('div', { class: 'u-row2 u-upg-top' },
        h('span', { class: 'u-upg-ico', 'aria-hidden': 'true' }, line.icon),
        h('div', { class: 'u-grow' },
          h('div', { class: 'u-upg-title' }, h('b', null, line.name), ' ',
            h('span', { class: 'tag u-upg-dom', style: { '--pc': color } }, `${POINT_ICONS[line.domain]} ${UPGRADE_DOMAIN_NAMES[line.domain]}`)),
          h('div', { class: 'muted u-small' }, line.desc)),
        info),
      h('div', { class: 'u-upg-lvrow' }, lvEl, pips),
      h('div', { class: 'u-upg-eff' }, nowEl, nextEl),
      h('div', { class: 'u-upg-act' }, costEl, btn),
      why);
    rows[line.id] = { line, card, lvEl, pips, nowEl, nextEl, costEl, btn, why, info, key: null, tipKey: null };
    grid.appendChild(card);
  }

  return {
    el,
    // true when at least one line can be shown (any line unlocked)
    anyUnlocked() { return UPGRADE_LINES.some(l => RS.upgradeUnlock(state, l.id).ok); },
    update() {
      const total = RS.totalLevels(state);
      const capTotal = UPGRADE_LINES.reduce((n, l) => n + l.cap, 0);
      setText(summary, `已投入 ${total} 級 / ${capTotal}`);
      for (const line of UPGRADE_LINES) {
        const r = rows[line.id];
        const lv = RS.levelOf(state, line.id);
        const un = RS.upgradeUnlock(state, line.id);
        const capped = lv >= line.cap;
        const cost = capped ? 0 : upgradeCost(line, lv);
        const have = Math.floor(state.points[line.domain] || 0);
        const poor = !capped && un.ok && have < cost;
        const key = [lv, un.ok ? 1 : 0, un.have, capped ? 1 : 0, poor ? cost - have : 0].join('|');
        if (r.key === key) continue;
        r.key = key;
        setText(r.lvEl, `Lv.${lv} / ${line.cap}`);
        setBar(r.pips, lv / line.cap);
        setText(r.nowEl, effectLine(line, lv));
        setText(r.nextEl, capped ? '　（已滿級）' : `　→ ${effectParts(line, lv + 1).map(p => p.text).join('、')}`);
        setText(r.costEl, capped ? '已滿級' : `${POINT_ICONS[line.domain]} ${fmt(cost)}`);
        setClass(r.costEl, 'lack', poor);
        setClass(r.costEl, 'done', capped);
        let reason = '';
        if (!un.ok) reason = un.reason;
        else if (capped) reason = '';
        else if (poor) reason = `${UPGRADE_DOMAIN_NAMES[line.domain]}點數不足（還差 ${fmt(cost - have)}）`;
        setText(r.why, reason);
        r.why.hidden = !reason;
        r.btn.disabled = !un.ok || capped || poor;
        setText(r.btn, capped ? '已滿級' : !un.ok ? '未解鎖' : '提升');
        r.btn.dataset.tip = reason;
        setClass(r.card, 'locked', !un.ok);
        setClass(r.card, 'u-done', capped);
        r.info.dataset.tip = tipText(line, lv);
      }
    },
  };
}
