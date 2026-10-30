// 建造 panel: category tabs (環境/設施/特殊) -> sub tabs -> item cards; demolish / rotate / cancel tools.
import { bus } from '../../core/bus.js';
import { BUILDABLES, BUILD_CATEGORIES } from '../../data/buildables.js';
import { RESEARCH } from '../../data/research.js';
import { isUnlocked, relocationCost } from '../../sim/build.js';
import { h, setClass, setText, tabbed } from '../dom.js';
import { money } from '../fmt.js';
import { layout, setBMode } from '../layout.js';
import { artEl, artOn, itemSprite, thumbEl } from '../artdom.js';
import { roleRow, updateRoleRow, roleLine } from '../roles.js';

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
  const btnMove = h('button', { class: 'btn small', type: 'button', tip: '移動已蓋好的設備（M）：點設備拿起，再點空位放下', onclick: () => {
    if (ui.tool.mode === 'move') cancelTool();
    else { ui.tool = { mode: 'move', defId: null, rot: 0, cat: null, keep: false, carry: null }; if (layout.mobile) setBMode(layout.portrait ? 'tray' : 'strip'); }
  } }, '✥ 移動');
  const btnRot = h('button', { class: 'btn small', type: 'button', tip: '旋轉（R）', onclick: () => { ui.tool.rot = (ui.tool.rot || 0) ^ 1; } }, '🔄 旋轉');
  const btnCancel = h('button', { class: 'btn small', type: 'button', tip: '取消工具（Esc）', onclick: cancelTool }, '✖ 取消');
  function cancelTool() { ui.tool = { mode: 'none', defId: null, rot: 0, cat: null }; }

  // mobile tray (portrait) / strip controls (landscape): selected item, pin, rotate, cancel, expand
  const trayName = h('b', { class: 'u-tray-name' });
  const trayCost = h('span', { class: 'u-tray-cost muted' });
  const trayRole = h('span', { class: 'u-tray-role', hidden: true });
  const trayGlyph = h('span', { class: 'u-tray-glyph' });
  const trayArt = artEl(null, { size: 44, noReserve: true, cls: 'u-tray-art' });
  const trayThumb = thumbEl(null, { width: 44, height: 44, fallback: trayGlyph });
  const bPin = h('button', { class: 'btn u-tray-btn', type: 'button', 'aria-label': '連續放置', onclick: () => {
    if (ui.tool.mode === 'move') { ui.tool.keep = !ui.tool.keep; return; }
    keepPref = !keepPref; if (ui.tool.mode === 'place' || ui.tool.mode === 'paint') ui.tool.keep = keepPref;
  } }, '📌', h('span', { class: 'u-tray-lbl' }, ' 連續'));
  const bRot = h('button', { class: 'btn u-tray-btn', type: 'button', 'aria-label': '旋轉', onclick: () => { ui.tool.rot = (ui.tool.rot || 0) ^ 1; } }, '🔄', h('span', { class: 'u-tray-lbl' }, ' 旋轉'));
  const bAgain = h('button', { class: 'btn primary u-tray-btn', type: 'button', onclick: () => { if (lastDef) armDef(lastDef); } }, '↻ 再放一個');
  const bCancel = h('button', { class: 'btn danger u-tray-btn', type: 'button', 'aria-label': '取消', onclick: () => { cancelTool(); ui.panel = null; } }, '✖', h('span', { class: 'u-tray-lbl' }, ' 取消'));
  const bFull = h('button', { class: 'btn u-tray-btn u-tray-full', type: 'button', 'aria-label': '展開建造清單', onclick: () => setBMode('full') }, '⤢', h('span', { class: 'u-tray-lbl' }, ' 展開'));
  const bChip = h('button', { class: 'btn u-tray-btn u-tray-chipbtn', type: 'button', 'aria-label': '收合', onclick: () => setBMode('chip') }, '▾');
  const tray = h('div', { class: 'u-tray' },
    h('div', { class: 'u-tray-item' }, trayArt, trayThumb, h('div', { class: 'u-tray-txt' }, trayName, trayCost, trayRole)),
    h('div', { class: 'u-tray-btns' }, bPin, bRot, bAgain, bCancel, bFull, bChip));
  root.appendChild(tray);

  const toolbar = h('div', { class: 'u-toolbar' },
    h('div', { class: 'row' }, btnDemo, btnMove, btnRot, btnCancel), status,
    h('div', { class: 'muted u-hint2' }, h('span', { class: 'kbd' }, 'Shift'), ' 連續放置　', h('span', { class: 'kbd' }, 'R'), ' 旋轉　', h('span', { class: 'kbd' }, 'M'), ' 移動設備　地板可拖曳塗刷'));
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
          if (c.roles) updateRoleRow(c.roles, state);
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
    const roles = roleRow(state, d.id);      // 需要：✔／⚠ 職類 (null for furniture and floors)
    const el = h('div', {
      class: 'card u-item', role: 'button', tabIndex: 0, dataset: { id: d.id, tipDef: d.id },
      onclick: () => pickItem(d),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickItem(d); } },
    },
      h('span', { class: 'u-info', dataset: { tipDef: d.id }, 'aria-label': '資訊', onclick: e => e.stopPropagation() }, 'ⓘ'),
      itemSprite(d.id)
        ? artEl(itemSprite(d.id), { width: 52, height: 44, fallback: d.glyph || '?', fbCls: 'u-glyph u-art-glyphfb', fbBg: d.top || '#ccc', fbColor: '#fff', title: d.name })
        : thumbEl(d.id, { width: 52, height: 44, fallback: h('div', { class: 'u-glyph', style: { background: d.top || '#ccc', color: '#fff' } }, d.glyph || '?') }),
      h('div', { class: 'u-iname' }, d.name),
      cost,
      h('div', { class: 'u-sub muted' }, `${d.w}×${d.h} · 維護 ${money(d.upkeep || 0)}`),
      roles,
      req);
    cardEls[d.id] = { el, cost, req, roles, open: undefined };
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
  const moveTab = h('button', { class: 'tab u-demotab u-movetab', type: 'button', onclick: () => btnMove.click() }, '✥ 移動');
  t.el.firstChild.append(moveTab, demoTab);

  return {
    update(state, ui) {
      const m = ui.tool.mode, d = BUILDABLES[ui.tool.defId];
      const carried = m === 'move' && ui.tool.carry ? BUILDABLES[ui.tool.carryDef] : null;
      setClass(btnDemo, 'primary', m === 'demolish');
      setClass(demoTab, 'active', m === 'demolish');
      setClass(btnMove, 'primary', m === 'move');
      setClass(moveTab, 'active', m === 'move');
      btnCancel.disabled = m === 'none';
      btnRot.disabled = !((m === 'place' && d && d.w !== d.h) || carried);
      // tray
      const armed = m === 'place' || m === 'paint' || m === 'demolish' || m === 'move';
      const td = armed && m !== 'demolish' && m !== 'move' ? d : lastDef;
      trayGlyph.textContent = m === 'demolish' ? '🧨' : m === 'move' ? (carried ? carried.glyph || '?' : '✥') : td ? td.glyph || '?' : '🔨';
      trayGlyph.style.background = m === 'move' ? (carried ? carried.top || '#ccc' : '#f4d8bc') : m !== 'demolish' && td ? td.top || '#ccc' : '#e8d9b8';
      const tsp = m !== 'demolish' && m !== 'move' && td ? itemSprite(td.id) : null;
      const useArt = !!(tsp && artOn());
      trayArt.setArt(useArt ? tsp : null);
      trayGlyph.hidden = useArt;
      trayThumb.setDef(useArt || m === 'demolish' ? null : m === 'move' ? (carried ? carried.id : null) : td ? td.id : null);
      setText(trayName, m === 'demolish' ? '拆除模式' : m === 'move' ? (carried ? `移動「${carried.name}」` : '移動模式') : td ? td.name : '建造');
      setText(trayCost, m === 'demolish' ? '點擊物件或地板'
        : m === 'move' ? (carried ? `搬移費 ${money(relocationCost(ui.tool.carryDef))}` : '點選要搬移的設備')
          : td ? money(td.cost) + (td.layer === 'floor' ? ' /格' : '') + (armed ? '' : '　已放置') : '');
      const rl = m !== 'demolish' && m !== 'move' && td ? roleLine(state, td.id) : '';
      setText(trayRole, rl); trayRole.hidden = !rl;
      setClass(trayRole, 'lack', !!rl && rl.indexOf('✔') < 0);
      bAgain.hidden = armed || !lastDef;
      bPin.hidden = !(m === 'place' || m === 'paint' || m === 'move');
      const pinOn = m === 'move' ? !!ui.tool.keep : keepPref;
      setClass(bPin, 'on', pinOn);
      bPin.setAttribute('aria-pressed', pinOn ? 'true' : 'false');
      bRot.hidden = !((m === 'place' && d && d.w !== d.h) || carried);
      bCancel.hidden = false;
      setText(bCancel.lastChild, armed ? ' 取消' : ' 關閉');
      setText(status,
        m === 'demolish' ? '🧨 拆除模式：點擊物件或地板（退回 50% 造價）'
          : m === 'move' ? (carried ? `✥ 搬移「${carried.name}」：點空位放下（搬移費 ${money(relocationCost(ui.tool.carryDef))}），R 旋轉，Esc／右鍵取消`
            : '✥ 移動模式：點選要搬移的設備（Shift 可連續搬移）')
          : (m === 'place' || m === 'paint') && d ? `目前：${d.glyph} ${d.name}${m === 'place' ? `（${ui.tool.rot ? '轉向' : '預設方向'}）` : '（拖曳塗刷）'}`
            : '選擇下方項目後，在地圖上點擊放置');
      t.update();
    },
  };
}
