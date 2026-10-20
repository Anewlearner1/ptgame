// 建造 panel: category tabs (環境/設施/特殊) -> sub tabs -> item cards; demolish / rotate / cancel tools.
import { bus } from '../../core/bus.js';
import { BUILDABLES, BUILD_CATEGORIES } from '../../data/buildables.js';
import { RESEARCH } from '../../data/research.js';
import { isUnlocked } from '../../sim/build.js';
import { h, setClass, setText, tabbed } from '../dom.js';
import { money } from '../fmt.js';

const store = { tab: 'env', sub: {} };
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
    if (ui.tool.mode === 'demolish') cancelTool(); else ui.tool = { mode: 'demolish', defId: null, rot: 0, cat: null };
  } }, '🧨 拆除');
  const btnRot = h('button', { class: 'btn small', type: 'button', tip: '旋轉（R）', onclick: () => { ui.tool.rot = (ui.tool.rot || 0) ^ 1; } }, '🔄 旋轉');
  const btnCancel = h('button', { class: 'btn small', type: 'button', tip: '取消工具（Esc）', onclick: cancelTool }, '✖ 取消');
  function cancelTool() { ui.tool = { mode: 'none', defId: null, rot: 0, cat: null }; }

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
    ui.tool = { mode: d.layer === 'floor' ? 'paint' : 'place', defId: d.id, rot: 0, cat: d.cat };
  }

  const t = tabbed(tabs, store);
  root.appendChild(t.el);

  return {
    update(state, ui) {
      const m = ui.tool.mode, d = BUILDABLES[ui.tool.defId];
      setClass(btnDemo, 'primary', m === 'demolish');
      btnCancel.disabled = m === 'none';
      btnRot.disabled = !(m === 'place' && d && d.w !== d.h);
      setText(status,
        m === 'demolish' ? '🧨 拆除模式：點擊物件或地板（退回 50% 造價）'
          : (m === 'place' || m === 'paint') && d ? `目前：${d.glyph} ${d.name}${m === 'place' ? `（${ui.tool.rot ? '轉向' : '預設方向'}）` : '（拖曳塗刷）'}`
            : '選擇下方項目後，在地圖上點擊放置');
      t.update();
    },
  };
}
