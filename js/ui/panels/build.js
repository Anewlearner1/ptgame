// 建造 panel: category tabs (環境/設施/特殊) -> sub tabs -> item cards; demolish / rotate / cancel tools.
import { bus } from '../../core/bus.js';
import { BUILDABLES, BUILD_CATEGORIES } from '../../data/buildables.js';
import { RESEARCH } from '../../data/research.js';
import { isUnlocked } from '../../sim/build.js';
import { h, setClass, setText, tabbed } from '../dom.js';
import { money } from '../fmt.js';
import { layout, setBMode } from '../layout.js';

const store = { tab: 'env', sub: {} };
let keepPref = false;     // 📌 keep-tool pin (ui.tool.keep, consumed by render/input.js): stay armed after each placement
let lastDef = null;       // last picked item, so the mobile tray can offer 「再放一個」
const CATS = (BUILD_CATEGORIES && BUILD_CATEGORIES.length ? BUILD_CATEGORIES : [
  { id: 'env', name: '環境' }, { id: 'facility', name: '設施' }, { id: 'special', name: '特殊' }]);

function subsOf(cat) {
  const seen = [];
  for (const d of Object.values(BUILDABLES)) if (d.cat === cat.id && !seen.includes(d.sub)) seen.push(d.sub);
  if (cat.subs) {
    const ordered = cat.subs.filter(s => seen.includes(s));
    return ordered.concat(seen.filter(s => !ordered.includes(s)));
  }
  return seen;
}

export function mountBuild(root, state, ui) {
  const status = h('div', { class: 'u-toolstatus' });
  const btnDemo = h('button', { class: 'btn small', type: 'button', onclick: () => {
    if (ui.tool.mode === 'demolish') cancelTool();
    else { ui.tool = { mode: 'demolish', defId: null, rot: 0, cat: null }; if (layout.mobile) setBMode(layout.portrait ? 'tray' : 'strip'); }
  } }, '🧨 拆除');
  const btnRot = h('button', { class: 'btn small', type: 'button', tip: '旋轉（R）', onclick: () => { ui.tool.rot = (ui.tool.rot || 0) ^ 1; } }, '🔄 旋轉');
  const btnCancel = h('button', { class: 'btn small', type: 'button', tip: '取消工具（Esc）', onclick: cancelTool }, '✖ 取消');
  function cancelTool() { ui.tool = { mode: 'none', defId: null, rot: 0, cat: null }; }

  // mobile tray (portrait) / strip controls (landscape): selected item, pin, rotate, cancel, expand
  const trayName = h('b', { class: 'u-tray-name' });
  const trayCost = h('span', { class: 'u-tray-cost muted' });
  const trayGlyph = h('span', { class: 'u-tray-glyph' });
  const bPin = h('button', { class: 'btn u-tray-btn', type: 'button', 'aria-label': '連續放置', onclick: () => {
    keepPref = !keepPref; if (ui.tool.mode === 'place' || ui.tool.mode === 'paint') ui.tool.keep = keepPref;
  } }, '📌', h('span', { class: 'u-tray-lbl' }, ' 連續'));
  const bRot = h('button', { class: 'btn u-tray-btn', type: 'button', 'aria-label': '旋轉', onclick: () => { ui.tool.rot = (ui.tool.rot || 0) ^ 1; } }, '🔄', h('span', { class: 'u-tray-lbl' }, ' 旋轉'));
  const bAgain = h('button', { class: 'btn primary u-tray-btn', type: 'button', onclick: () => { if (lastDef) armDef(lastDef); } }, '↻ 再放一個');
  const bCancel = h('button', { class: 'btn danger u-tray-btn', type: 'button', 'aria-label': '取消', onclick: () => { cancelTool(); ui.panel = null; } }, '✖', h('span', { class: 'u-tray-lbl' }, ' 取消'));
  const bFull = h('button', { class: 'btn u-tray-btn u-tray-full', type: 'button', 'aria-label': '展開建造清單', onclick: () => setBMode('full') }, '⤢', h('span', { class: 'u-tray-lbl' }, ' 展開'));
  const bChip = h('button', { class: 'btn u-tray-btn u-tray-chipbtn', type: 'button', 'aria-label': '收合', onclick: () => setBMode('chip') }, '▾');
  const tray = h('div', { class: 'u-tray' },
    h('div', { class: 'u-tray-item' }, trayGlyph, h('div', { class: 'u-tray-txt' }, trayName, trayCost)),
    h('div', { class: 'u-tray-btns' }, bPin, bRot, bAgain, bCancel, bFull, bChip));
  root.appendChild(tray);

  const toolbar = h('div', { class: 'u-toolbar' },
    h('div', { class: 'row' }, btnDemo, btnRot, btnCancel), status,
    h('div', { class: 'muted u-hint2' }, h('span', { class: 'kbd' }, 'Shift'), ' 連續放置　', h('span', { class: 'kbd' }, 'R'), ' 旋轉　地板可拖曳塗刷'));
  root.appendChild(toolbar);

  const cardEls = {};     // defId -> {el, req, cost}
  const tabs = CATS.map(cat => ({
    id: cat.id, label: cat.name,
    build(body) {
      const subs = subsOf(cat);
      let sub = store.sub[cat.id];
      if (!subs.includes(sub)) sub = subs[0];
      const strip = h('div', { class: 'tabs u-subtabs' });
      const grid = h('div', { class: 'grid u-buildgrid' });
      body.append(strip, grid);
      const sbtn = {};
      function pick(s) {
        store.sub[cat.id] = s;
        for (const k of Object.keys(sbtn)) setClass(sbtn[k], 'active', k === s);
        grid.replaceChildren();
        for (const k of Object.keys(cardEls)) delete cardEls[k];
        for (const d of Object.values(BUILDABLES)) {
          if (d.cat !== cat.id || d.sub !== s) continue;
          grid.appendChild(makeCard(d));
        }
        update();
      }
      for (const s of subs) {
        sbtn[s] = h('button', { class: 'tab', type: 'button', onclick: () => pick(s) }, s);
        strip.appendChild(sbtn[s]);
      }
      function update() {
        for (const id of Object.keys(cardEls)) {
          const c = cardEls[id], d = BUILDABLES[id];
          const open = isUnlocked(state, id);
          setClass(c.el, 'locked', !open);
          setClass(c.el, 'selected', ui.tool.defId === id && (ui.tool.mode === 'place' || ui.tool.mode === 'paint'));
          setClass(c.cost, 'bad', open && state.money < d.cost);
          if (c.open !== open) {
            c.open = open;
            const n = d.requires && RESEARCH[d.requires];
            setText(c.req, open ? '' : `🔒 需研發：${n ? n.name : d.requires}`);
            c.req.hidden = open;
          }
        }
      }
      pick(sub);
      return { update };
    },
  }));

  function makeCard(d) {
    const cost = h('div', { class: 'u-cost' }, money(d.cost) + (d.layer === 'floor' ? ' /格' : ''));
    const req = h('div', { class: 'u-req' });
    const el = h('div', {
      class: 'card u-item', role: 'button', tabIndex: 0, dataset: { id: d.id, tipDef: d.id },
      onclick: () => pickItem(d),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickItem(d); } },
    },
      h('span', { class: 'u-info', dataset: { tipDef: d.id }, 'aria-label': '資訊', onclick: e => e.stopPropagation() }, 'ⓘ'),
      h('div', { class: 'u-glyph', style: { background: d.top || '#ccc', color: '#fff' } }, d.glyph || '?'),
      h('div', { class: 'u-iname' }, d.name),
      cost,
      h('div', { class: 'u-sub muted' }, `${d.w}×${d.h} · 維護 ${money(d.upkeep || 0)}`),
      req);
    cardEls[d.id] = { el, cost, req, open: undefined };
    return el;
  }

  function pickItem(d) {
    if (!isUnlocked(state, d.id)) {
      const n = d.requires && RESEARCH[d.requires];
      bus.emit('toast', { text: `尚未解鎖：請先研發「${n ? n.name : d.requires}」`, kind: 'bad' });
      return;
    }
    armDef(d);
    // phones: get the sheet / drawer out of the way so the build area is free; the tray / strip stays for quick re-picks
    if (layout.mobile) setBMode(layout.portrait ? 'tray' : 'strip');
  }
  function armDef(d) {
    lastDef = d;
    ui.tool = { mode: d.layer === 'floor' ? 'paint' : 'place', defId: d.id, rot: 0, cat: d.cat, keep: keepPref };
  }

  const t = tabbed(tabs, store);
  root.appendChild(t.el);
  // phones: the toolbar row is hidden (the tray carries rotate / cancel); 拆除 lives at the end of the category tabs instead
  const demoTab = h('button', { class: 'tab u-demotab', type: 'button', onclick: () => btnDemo.click() }, '🧨 拆除');
  t.el.firstChild.appendChild(demoTab);

  return {
    update(state, ui) {
      const m = ui.tool.mode, d = BUILDABLES[ui.tool.defId];
      setClass(btnDemo, 'primary', m === 'demolish');
      setClass(demoTab, 'active', m === 'demolish');
      btnCancel.disabled = m === 'none';
      btnRot.disabled = !(m === 'place' && d && d.w !== d.h);
      // tray
      const armed = m === 'place' || m === 'paint' || m === 'demolish';
      const td = armed && m !== 'demolish' ? d : lastDef;
      trayGlyph.textContent = m === 'demolish' ? '🧨' : td ? td.glyph || '?' : '🔨';
      trayGlyph.style.background = m !== 'demolish' && td ? td.top || '#ccc' : '#e8d9b8';
      setText(trayName, m === 'demolish' ? '拆除模式' : td ? td.name : '建造');
      setText(trayCost, m === 'demolish' ? '點擊物件或地板' : td ? money(td.cost) + (td.layer === 'floor' ? ' /格' : '') + (armed ? '' : '　已放置') : '');
      bAgain.hidden = armed || !lastDef;
      bPin.hidden = !(m === 'place' || m === 'paint');
      setClass(bPin, 'on', keepPref);
      bPin.setAttribute('aria-pressed', keepPref ? 'true' : 'false');
      bRot.hidden = !(m === 'place' && d && d.w !== d.h);
      bCancel.hidden = false;
      setText(bCancel.lastChild, armed ? ' 取消' : ' 關閉');
      setText(status,
        m === 'demolish' ? '🧨 拆除模式：點擊物件或地板（退回 50% 造價）'
          : (m === 'place' || m === 'paint') && d ? `目前：${d.glyph} ${d.name}${m === 'place' ? `（${ui.tool.rot ? '轉向' : '預設方向'}）` : '（拖曳塗刷）'}`
            : '選擇下方項目後，在地圖上點擊放置');
      t.update();
    },
  };
}
