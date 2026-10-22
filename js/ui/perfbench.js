// 📋 效能報告: a 12-second automatic benchmark + plain-text report the player can copy / share.
//   0-1 s warm-up, 1-6 s measure at the CURRENT zoom, 6-7 s warm-up, 7-12 s measure at zoom x1.6 (clamped to the camera limits).
//   The sim is forced to x3 for the duration (so sim cost shows up), user input is blocked by an overlay, and speed / zoom /
//   camera are restored afterwards. Esc or the 取消 button aborts at any time.
// The numbers are JS time per rendered frame (sim = game update, render = canvas command recording, ui = DOM) plus the real
// frame interval; GPU raster time is only visible through the frame interval / fps.
import { bus } from '../core/bus.js';
import { summarize } from '../core/perfstats.js';
import { zoomAt } from '../render/camera.js';
import { showModal, isModalOpen } from './modal.js';
import { deviceInfo, countAgents } from './perfinfo.js';
import { perfCfg, qualityLabel } from './quality.js';
import { versionLabel } from './version.js';
import { artEnabled } from '../render/art.js';

export const BENCH_PHASES = [
  { id: 'cur', label: '目前縮放', warm: 1000, measure: 5000, zoomMul: 1 },
  { id: 'zoom', label: '放大 ×1.6', warm: 1000, measure: 5000, zoomMul: 1.6 },
];
export const BENCH_TOTAL_MS = BENCH_PHASES.reduce((a, p) => a + p.warm + p.measure, 0);   // 12000

let running = null;
export function benchRunning() { return !!running; }
export function cancelBenchmark() { if (running) running.cancel(); }

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
const f1 = v => (isFinite(v) ? v : 0).toFixed(1);

export function buildReport(res, info, snap, when) {
  const d = when || new Date();
  const p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const L = [];
  L.push('【復健科診所物語 效能報告】');
  L.push(`建置版本：${snap.version}`);
  L.push(`日期時間：${stamp}`);
  L.push(`瀏覽器 UA：${info.ua}`);
  L.push(`平台：${info.platform || '不明'}`);
  L.push(`螢幕：${info.screen} px　視窗：${info.viewport} px　DPR：${info.dpr}`);
  L.push(`畫布實際大小：${snap.canvasW}×${snap.canvasH} px（有效 DPR ${snap.effDpr.toFixed ? snap.effDpr.toFixed(2) : snap.effDpr}）`);
  L.push(`CPU 核心數：${info.cores != null ? info.cores : '不明'}　裝置記憶體：${info.memory != null ? info.memory + ' GB' : '不明'}　觸控裝置：${info.touch ? '是' : '否'}`);
  L.push(`GPU：${info.gpu}`);
  L.push(`美術風格：${snap.art === 'new' ? '新美術（概念圖）' : '原像素風（classic）'}`);
  L.push(`畫質設定：${qualityLabel()}　測試結束時的自動等級：L${res.endLevel}（測試中最高 L${res.maxLevel}）`);
  L.push(`幀率上限：${perfCfg.fpsCap}`);
  L.push(`診所等級：L${snap.lot}　場上角色數：${snap.agents}`);
  L.push(`測試：${Math.round(BENCH_TOTAL_MS / 1000)} 秒，模擬強制 ×3${res.cancelled ? '（已中途取消）' : ''}${res.interrupted ? '（期間曾被事件視窗暫停，模擬數字偏低）' : ''}`);
  L.push('');
  L.push('場景　　　　縮放 | fps   | 1%低 | 幀p50 | 幀p95 | 模擬ms | 繪製ms | 繪p95 | 介面ms | JS合計ms');
  for (const r of res.phases) {
    if (!r.s) { L.push(`${r.label}　（未完成）`); continue; }
    const s = r.s;
    L.push(`${pad(r.label, 8)}　${pad(r.zoom.toFixed(2), 4)} | ${pad(f1(s.fps), 5)} | ${pad(f1(s.fps1), 4)} | ${pad(f1(s.frameP50), 5)} | ${pad(f1(s.frameP95), 5)} | ${pad(f1(s.simAvg), 6)} | ${pad(f1(s.renderAvg), 6)} | ${pad(f1(s.renderP95), 5)} | ${pad(f1(s.uiAvg), 6)} | ${f1(s.jsAvg)}`);
  }
  L.push('（fps＝每秒實際繪製次數；1%低＝最慢 1% 幀的等效 fps；幀＝相鄰兩次繪製的間隔 ms；模擬／繪製／介面＝每幀 JavaScript 花費 ms）');
  return L.join('\n');
}

export async function copyText(text, fallbackEl) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through to the textarea path */ }
  try {
    const ta = fallbackEl || document.createElement('textarea');
    if (!fallbackEl) { ta.value = text; ta.style.cssText = 'position:fixed;left:-999px;top:0'; document.body.appendChild(ta); }
    ta.focus(); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    if (!fallbackEl) ta.remove();
    return !!ok;
  } catch (e) { return false; }
}

export function showReportModal(text) {
  const ta = document.createElement('textarea');
  ta.className = 'u-ta perf-report'; ta.readOnly = true; ta.rows = 14; ta.value = text; ta.spellcheck = false;
  ta.setAttribute('aria-label', '效能報告內容');
  const wrap = document.createElement('div');
  const hint = document.createElement('p');
  hint.className = 'muted u-p u-small';
  hint.textContent = '按「複製」後貼回給開發者，就能知道你的手機卡在哪裡。';
  wrap.append(hint, ta);
  const buttons = [
    { label: '複製', primary: true, onClick: async () => {
      const ok = await copyText(text, ta);
      bus.emit('toast', ok ? { text: '已複製效能報告', kind: 'good' } : { text: '無法自動複製，請長按文字手動選取', kind: 'bad' });
      return false;
    } },
  ];
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    buttons.push({ label: '分享', onClick: async () => {
      try { await navigator.share({ title: '復健科診所物語 效能報告', text }); } catch (e) { /* cancelled */ }
      return false;
    } });
  }
  buttons.push({ label: '關閉' });
  showModal({ title: '📋 效能報告', body: wrap, buttons, pause: false, tag: 'perfreport', cls: 'perf-modal' });
  return ta;
}

function makeOverlay(onCancel) {
  const el = document.createElement('div');
  el.id = 'perf-bench'; el.className = 'perf-bench'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '效能測試中');
  const card = document.createElement('div'); card.className = 'pb-card';
  const title = document.createElement('div'); title.className = 'pb-title'; title.textContent = '效能測試中…請勿操作';
  const phase = document.createElement('div'); phase.className = 'pb-phase';
  const bar = document.createElement('div'); bar.className = 'pb-bar'; const fill = document.createElement('i'); bar.appendChild(fill);
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = '取消';
  btn.addEventListener('click', onCancel);
  card.append(title, phase, bar, btn); el.appendChild(card);
  // the overlay swallows pointer / wheel / touch input so the map underneath is untouched
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'contextmenu', 'mousedown']) {
    el.addEventListener(t, e => { if (e.target !== btn && e.cancelable) e.preventDefault(); }, { passive: false });
  }
  document.body.appendChild(el);
  return { el, phase, fill, btn };
}

// Runs the benchmark. Resolves {phases, cancelled, interrupted, endLevel, maxLevel}. Never throws.
export function runBenchmark(state, ui, opts = {}) {
  if (running) return running.promise;
  const phasesDef = opts.phases || BENCH_PHASES;
  const canvas = document.getElementById('game');
  const ps = ui.perfStats;
  const out = { phases: phasesDef.map(p => ({ id: p.id, label: p.label, zoom: ui.cam.zoom, s: null })), cancelled: false, interrupted: false, endLevel: 0, maxLevel: 0 };
  const saved = { cam: { x: ui.cam.x, y: ui.cam.y, zoom: ui.cam.zoom }, speed: state.time.speed, paused: !!state.time.paused };
  let cancelled = false, overlay = null, timer = 0, finish = null;
  const total = phasesDef.reduce((a, p) => a + p.warm + p.measure, 0);

  const onKey = e => {
    if (e.key === 'Escape') cancel();
    e.stopPropagation(); if (e.cancelable) e.preventDefault();
  };
  function cancel() { cancelled = true; if (finish) finish(); }

  const promise = new Promise(resolve => {
    const startAt = performance.now();
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
    overlay = makeOverlay(cancel);
    out.maxLevel = (ui.perf && ui.perf.level) | 0;
    bus.emit('speed:set', { speed: 3 });
    let pi = -1, phaseStart = 0, measureAt = 0;
    const force3 = () => { if ((state.time.paused || state.time.speed !== 3) && !isModalOpen() && !(state.events && state.events.pendingDilemma)) bus.emit('speed:set', { speed: 3 }); };
    const startPhase = (i, now) => {
      pi = i; phaseStart = now;
      const p = phasesDef[i];
      if (i > 0 || p.zoomMul !== 1) {                          // zoom about the screen centre
        const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
        zoomAt(ui.cam, cx, cy, saved.cam.zoom * p.zoomMul, canvas);
      }
      out.phases[i].zoom = ui.cam.zoom;
      measureAt = now + p.warm;
      overlay.phase.textContent = `${i + 1}/${phasesDef.length}　${p.label}（縮放 ${ui.cam.zoom.toFixed(2)}）`;
    };
    finish = () => {
      if (!timer && out.done) return;
      clearInterval(timer); timer = 0; out.done = true;
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
      out.cancelled = cancelled;
      out.endLevel = (ui.perf && ui.perf.level) | 0;
      // restore speed / zoom / camera
      Object.assign(ui.cam, saved.cam);
      bus.emit('speed:set', { speed: saved.paused ? 0 : saved.speed });
      if (saved.paused) { state.time.paused = true; state.time.speed = saved.speed; }
      if (overlay) overlay.el.remove();
      running = null;
      resolve(out);
    };
    const tick = () => {
      const now = performance.now();
      if (cancelled || document.hidden) { if (document.hidden) cancelled = true; finish(); return; }
      const el = now - startAt;
      if (ui.perf && (ui.perf.level | 0) > out.maxLevel) out.maxLevel = ui.perf.level | 0;
      if (isModalOpen() || (state.events && state.events.pendingDilemma)) out.interrupted = true;
      force3();
      if (pi < 0) startPhase(0, now);
      else if (now - phaseStart >= phasesDef[pi].warm + phasesDef[pi].measure) {
        const p = phasesDef[pi];
        out.phases[pi].s = ps ? summarize(ps, now, p.measure) : null;
        if (pi + 1 < phasesDef.length) startPhase(pi + 1, now); else { finish(); return; }
      }
      overlay.fill.style.width = Math.min(100, el / total * 100).toFixed(1) + '%';
    };
    timer = setInterval(tick, 100);
    tick();
  });
  running = { promise, cancel };
  return promise;
}

// Full flow used by the settings button: run, then show the report. Resolves the report text (or null when cancelled early).
export async function runAndShowReport(state, ui) {
  if (benchRunning()) return null;
  const res = await runBenchmark(state, ui);
  if (res.cancelled) { bus.emit('toast', { text: '已取消效能測試', kind: 'info' }); return null; }
  const info = deviceInfo();
  const k = {
    version: versionLabel(), canvasW: 0, canvasH: 0, effDpr: (ui.perf && ui.perf.dpr) || 1, art: artEnabled() ? 'new' : 'classic',
    lot: state.lotLevel | 0, agents: countAgents(state),
  };
  const cv = document.getElementById('game');
  if (cv) { k.canvasW = cv.width; k.canvasH = cv.height; }
  const text = buildReport(res, info, k);
  showReportModal(text);
  bus.emit('perf:report', { text, res });
  return text;
}
