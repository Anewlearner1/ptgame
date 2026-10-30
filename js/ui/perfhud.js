// 效能診斷 HUD: a small always-on-top overlay with live frame statistics.
// Toggle: 系統 → 設定 → 效能診斷, URL `?perf=1` (`?perf=0` forces off), key F3 (desktop). The switch and F3 are remembered
// (localStorage 'restgame.perfhud'); the URL param is per page load only.
// Cost: while hidden nothing runs (no timer). While shown: one 4 Hz timer, summarize() over <= 360 samples, 6 text nodes that
// are only written when their string changed; the box is pointer-events:none and `contain:strict`-ish, so no layout of the game UI.
import { bus } from '../core/bus.js';
import { summarize } from '../core/perfstats.js';
import { snapshot } from './perfinfo.js';

const KEY = 'restgame.perfhud';
const WINDOW_MS = 2000, PERIOD_MS = 250;     // stats window; HUD refresh (4 Hz)
let root = null, rows = [], timer = 0, on = false, stateRef = null, uiRef = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

const f1 = v => (isFinite(v) ? v : 0).toFixed(1);
const f0 = v => String(Math.round(isFinite(v) ? v : 0));

function build() {
  const stage = document.getElementById('stage') || document.body;
  root = document.createElement('div');
  root.id = 'perf-hud'; root.className = 'perf-hud'; root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 6; i++) { const r = document.createElement('div'); r.className = 'ph-row'; r.appendChild(document.createTextNode('')); root.appendChild(r); rows.push(r.firstChild); }
  stage.appendChild(root);
}

function setRow(i, txt) { const n = rows[i]; if (n.data !== txt) n.data = txt; }

export function hudLines(state, ui, now) {
  const ps = ui.perfStats;
  const s = ps ? summarize(ps, now, WINDOW_MS) : null;
  const k = snapshot(state, ui);
  const lines = [];
  lines.push(s && s.n > 1 ? `幀率 ${f1(s.fps)} fps　1%低 ${f1(s.fps1)}` : '幀率 …（等待取樣）');
  lines.push(s ? `幀時間 p50 ${f1(s.frameP50)}　p95 ${f1(s.frameP95)} ms` : '幀時間 …');
  lines.push(s ? `模擬 ${f1(s.simAvg)}　繪製 ${f1(s.renderAvg)}　介面 ${f1(s.uiAvg)} ms` : '模擬 …　繪製 …');
  lines.push(`角色 ${k.agents}　畫布 ${k.canvasW}×${k.canvasH}　DPR ${k.dpr % 1 ? k.dpr.toFixed(2) : k.dpr}${k.effDpr !== k.dpr ? '→' + k.effDpr.toFixed(2) : ''}`);
  lines.push(`畫質 ${k.qualityName} L${k.level}${k.auto ? '(自動)' : ''}　${k.art === 'new' ? '新美術' : '原像素'}　餐廳 L${k.lot}　上限 ${k.fpsCap}`);
  lines.push(k.heap != null ? `JS 記憶體 ${f0(k.heap)} MB　縮放 ${k.zoom.toFixed(2)}` : `縮放 ${k.zoom.toFixed(2)}`);
  return { lines, stats: s, snap: k };
}

export function refreshHud() {
  if (!root || !stateRef) return null;
  const r = hudLines(stateRef, uiRef, performance.now());
  for (let i = 0; i < r.lines.length; i++) setRow(i, r.lines[i]);
  return r;
}

export function isHudOn() { return on; }

export function setHud(next, persist = true) {
  next = !!next;
  if (!root) return;
  if (persist) lsSet(KEY, next ? '1' : '0');
  if (next === on) { bus.emit('perfhud:changed', { on }); return; }
  on = next;
  root.hidden = !on;
  if (on) { refreshHud(); timer = setInterval(refreshHud, PERIOD_MS); }
  else { clearInterval(timer); timer = 0; }
  bus.emit('perfhud:changed', { on });
}

export function toggleHud() { setHud(!on); }

export function initPerfHud(state, ui) {
  if (root) return;
  stateRef = state; uiRef = ui;
  build();
  let want = lsGet(KEY) === '1';
  let persist = true;
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q === '1') { want = true; persist = false; } else if (q === '0') { want = false; persist = false; }
  } catch (e) { /* no URLSearchParams */ }
  document.addEventListener('keydown', e => {
    if (e.key !== 'F3' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();                         // not the browser's find-in-page
    toggleHud();
  });
  document.addEventListener('visibilitychange', () => { if (on && !document.hidden) refreshHud(); });
  if (want) setHud(true, persist);
}
