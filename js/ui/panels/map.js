// 地圖 panel: lot minimap with flow heat + 周邊客群熱點 bars.
import { MAP_W, MAP_H } from '../../core/constants.js';
import { bus } from '../../core/bus.js';
import { BUILDABLES } from '../../data/buildables.js';
import { PATIENT_TYPES, FOCUS } from '../../data/patients.js';
import { WEATHER } from '../../data/events.js';
import { STAFF_ROLES } from '../../data/staffdefs.js';
import { objectAt } from '../../core/grid.js';
import { h, setText, setBar, bar, setClass } from '../dom.js';
import { TYPE_ICONS } from '../fmt.js';
import { section } from './common.js';

// ---- heat cache (outside state; accumulated even while the panel is closed)
const heat = new Float32Array(MAP_W * MAP_H);
let heatMax = 1;
const STAGE_W = { waiting: 1, registering: 0.6, treating: 0.5, to_reception: 0.3, to_station: 0.3, arriving: 0.2, leaving: 0.2 };
export function resetHeat() { heat.fill(0); heatMax = 1; }
export function sampleHeat(state) {
  if (state.time.paused || !state.time.speed) return;
  const w = state.time.speed;
  for (let i = 0; i < heat.length; i++) heat[i] *= 0.9985;
  let mx = 1;
  for (const p of state.patients) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    heat[y * MAP_W + x] += (STAGE_W[p.stage] ?? 0.3) * w;
  }
  for (let i = 0; i < heat.length; i++) if (heat[i] > mx) mx = heat[i];
  heatMax = Math.max(mx, 8);
}
bus.on('state:loaded', resetHeat);

const DISTRICTS = {
  elder: { icon: '🏘', name: '住宅區（長輩社區）' },
  office: { icon: '🏢', name: '辦公大樓（上班族）' },
  sports: { icon: '🏟', name: '學校球場（運動族）' },
  kid: { icon: '🧸', name: '托兒所／學校（兒童）' },
};
const TYPE_COLOR = { elder: '#f4a261', office: '#3b7fd1', sports: '#d1495b', kid: '#f4d35e' };
const store = { heat: true, people: true };

function shares(state) {
  const F = FOCUS[state.policy.focus] || { spawnMult: {} };
  const w = WEATHER.find(x => x.id === (state.weather && state.weather.id)) || WEATHER.find(x => x.kind === (state.weather && state.weather.kind)) || {};
  const out = {}, base = {};
  let sum = 0, bsum = 0;
  for (const t of Object.keys(PATIENT_TYPES)) {
    const P = PATIENT_TYPES[t];
    const b = P.weight; base[t] = b; bsum += b;
    const v = b * (F.spawnMult[t] || 1) * ((state.mods.typeSpawn && state.mods.typeSpawn[t]) || 1) * ((w.typeBoost && w.typeBoost[t]) || 1);
    out[t] = v; sum += v;
  }
  for (const t of Object.keys(out)) { out[t] /= sum; base[t] /= bsum; }
  return { now: out, base };
}

export function mountMap(root, state, ui) {
  const canvas = h('canvas', { class: 'u-minimap' });
  const info = h('div', { class: 'muted u-small u-mapinfo' }, '把滑鼠移到格子上查看；點擊設備可選取。');
  const cbHeat = h('input', { type: 'checkbox', checked: store.heat, onchange: () => { store.heat = cbHeat.checked; } });
  const cbPeople = h('input', { type: 'checkbox', checked: store.people, onchange: () => { store.people = cbPeople.checked; } });
  root.append(
    section('診所平面圖與人流熱度',
      h('div', { class: 'row' },
        h('label', { class: 'u-check2' }, cbHeat, '人流熱度'),
        h('label', { class: 'u-check2' }, cbPeople, '病患／員工'),
        h('span', { class: 'u-legend', tip: '紅色越深表示越多人在該格停留（候診最重）' }, '少', h('i'), '多')),
      h('div', { class: 'u-canvaswrap' }, canvas), info));

  const hotList = h('div', { class: 'u-list2' });
  const hot = {};
  for (const t of Object.keys(PATIENT_TYPES)) {
    const D = DISTRICTS[t] || { icon: TYPE_ICONS[t], name: PATIENT_TYPES[t].name };
    const b = bar(0);
    b.firstChild.style.background = TYPE_COLOR[t] || '';
    const pctEl = h('b'), cntEl = h('span', { class: 'muted u-small' }), noteEl = h('span', { class: 'muted u-small' });
    hot[t] = { b, pctEl, cntEl, noteEl };
    hotList.appendChild(h('div', { class: 'card u-hot' },
      h('div', { class: 'row u-between' }, h('span', null, h('span', { class: 'u-sico' }, D.icon), ' ', h('b', null, D.name)), pctEl),
      b, h('div', { class: 'row u-between' }, noteEl, cntEl)));
  }
  root.append(section('周邊客群熱點（來客占比）', hotList,
    h('div', { class: 'muted u-small' }, '占比 = 基本客群 × 經營方針 × 研發／活動加成 × 今日天氣。想改變客群：到「診所」改方針，或到「運作」舉辦社區活動。')));

  // geometry cache
  let geo = null;
  function layout() {
    const l = state.lot;
    const key = [l.x0, l.y0, l.w, l.h].join();
    if (geo && geo.key === key) return geo;
    const pad = 1;
    const cols = l.w + pad * 2, rows = l.h + pad * 2;
    const tp = Math.max(10, Math.min(30, Math.floor(Math.min(500 / cols, 360 / rows))));
    geo = { key, x0: l.x0 - pad, y0: l.y0 - pad, cols, rows, tp };
    canvas.width = cols * tp; canvas.height = rows * tp;
    return geo;
  }
  function tileAtEvent(e) {
    const g = layout(), r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * g.cols) + g.x0;
    const y = Math.floor(((e.clientY - r.top) / r.height) * g.rows) + g.y0;
    return { x, y };
  }
  canvas.addEventListener('mousemove', e => {
    const t = tileAtEvent(e), o = objectAt(state, t.x, t.y);
    const d = o && BUILDABLES[o.defId];
    const hv = heat[t.y * MAP_W + t.x] || 0;
    setText(info, `(${t.x}, ${t.y})　${d ? d.glyph + ' ' + d.name : '空地'}　人流熱度 ${Math.round(hv / heatMax * 100)}%`);
  });
  canvas.addEventListener('click', e => {
    const t = tileAtEvent(e), o = objectAt(state, t.x, t.y);
    if (o) { ui.selected = { type: 'object', id: o.id }; bus.emit('select:changed', { selected: ui.selected }); }
  });

  function draw() {
    const g = layout(), c = canvas.getContext('2d'), tp = g.tp, l = state.lot;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#8a9296'; c.fillRect(0, 0, canvas.width, canvas.height);        // street
    const px = x => (x - g.x0) * tp, py = y => (y - g.y0) * tp;
    c.fillStyle = '#efe4c9'; c.fillRect(px(l.x0), py(l.y0), l.w * tp, l.h * tp);    // lot
    for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) {
      const f = state.map.floor[y] && state.map.floor[y][x];
      if (f && BUILDABLES[f]) { c.fillStyle = BUILDABLES[f].top; c.fillRect(px(x), py(y), tp, tp); }
      c.strokeStyle = 'rgba(31,45,51,0.10)'; c.strokeRect(px(x) + 0.5, py(y) + 0.5, tp - 1, tp - 1);
    }
    if (store.heat) {
      for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) {
        const v = heat[y * MAP_W + x];
        if (v < 0.4) continue;
        c.fillStyle = `rgba(231,60,40,${Math.min(0.8, Math.sqrt(v / heatMax) * 0.8).toFixed(2)})`;
        c.fillRect(px(x), py(y), tp, tp);
      }
    }
    for (const o of state.objects) {
      const d = BUILDABLES[o.defId]; if (!d) continue;
      const w = o.rot ? d.h : d.w, hh = o.rot ? d.w : d.h;
      c.fillStyle = d.color; c.globalAlpha = d.blocks === false ? 0.55 : 0.95;
      c.fillRect(px(o.x) + 1, py(o.y) + 1, w * tp - 2, hh * tp - 2);
      c.globalAlpha = 1;
      c.strokeStyle = '#1f2d33'; c.lineWidth = 1; c.strokeRect(px(o.x) + 1.5, py(o.y) + 1.5, w * tp - 3, hh * tp - 3);
      if (tp >= 14) {
        c.font = `${Math.min(tp * 0.75, 20)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = '#fff';
        c.fillText(d.glyph || '', px(o.x) + (w * tp) / 2, py(o.y) + (hh * tp) / 2 + 1);
      }
    }
    // zones
    c.strokeStyle = '#f4b942'; c.lineWidth = 2;
    for (const z of state.zones || []) for (const cell of z.cells) c.strokeRect(px(cell.x) + 1, py(cell.y) + 1, tp - 2, tp - 2);
    // lot border + door
    c.strokeStyle = '#1f2d33'; c.lineWidth = 3; c.strokeRect(px(l.x0), py(l.y0), l.w * tp, l.h * tp);
    c.fillStyle = '#e76f51'; c.fillRect(px(state.door.x) - 2, py(state.door.y - 1) + tp - 4, tp + 4, 6);
    c.font = '11px sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('入口', px(state.door.x) + tp + 6, py(state.door.y) + 1);
    if (store.people) {
      for (const p of state.patients) {
        c.fillStyle = TYPE_COLOR[p.type] || '#fff';
        c.beginPath(); c.arc(px(p.x), py(p.y), Math.max(3, tp * 0.22), 0, 6.283); c.fill();
        c.strokeStyle = '#1f2d33'; c.lineWidth = 1; c.stroke();
      }
      for (const s of state.staff) {
        c.fillStyle = (STAFF_ROLES[s.role] || {}).color || '#fff';
        const r = Math.max(4, tp * 0.26);
        c.fillRect(px(s.x) - r, py(s.y) - r, r * 2, r * 2);
        c.strokeStyle = '#1f2d33'; c.lineWidth = 1.5; c.strokeRect(px(s.x) - r, py(s.y) - r, r * 2, r * 2);
      }
    }
  }

  return {
    update() {
      draw();
      const sh = shares(state);
      const counts = {};
      for (const p of state.patients) counts[p.type] = (counts[p.type] || 0) + 1;
      for (const t of Object.keys(hot)) {
        const r = hot[t], now = sh.now[t], base = sh.base[t];
        setBar(r.b, now);
        setText(r.pctEl, Math.round(now * 100) + '%');
        const d = Math.round((now - base) * 100);
        setText(r.noteEl, d === 0 ? `基準 ${Math.round(base * 100)}%` : `基準 ${Math.round(base * 100)}% → ${d > 0 ? '+' : ''}${d}%`);
        setText(r.cntEl, `診所內 ${counts[t] || 0} 人`);
      }
    },
  };
}
