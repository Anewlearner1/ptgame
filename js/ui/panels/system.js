// 系統 panel: 存檔 / 匯出匯入 / 設定 / 營運數據圖表 / 新遊戲
import { bus } from '../../core/bus.js';
import * as SV from '../../sim/save.js';
import { h, setText, tabbed, clear } from '../dom.js';
import { fmt, money, fmtDateTime } from '../fmt.js';
import { section } from './common.js';
import { confirmDialog } from '../modal.js';
import { showTutorial, showHelp } from '../modals.js';
import { layout } from '../layout.js';
import { artBanner } from '../artdom.js';
import { artEnabled, setArtEnabled } from '../../render/art.js';
import { QUALITY_MODES, QUALITY_HELP, FPSCAP_HELP, perfCfg, setQuality, setFpsCap } from '../quality.js';
import { isHudOn, setHud } from '../perfhud.js';
import { versionLabel } from '../version.js';
import { installBox } from '../installbox.js';
import { supportAvailable, supportBody } from '../support.js';

const store = { tab: 'save', metric: 'cash' };
const SLOTS = [['auto', '自動存檔'], ['1', '存檔 1'], ['2', '存檔 2'], ['3', '存檔 3']];

export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- saves
function buildSave(body, state, ui) {
  const list = h('div', { class: 'u-list2' });
  const ta = h('textarea', { class: 'u-ta', rows: 4, placeholder: '匯出的存檔 JSON 會顯示在這裡；要匯入時，貼上 JSON 後按「匯入」。', spellcheck: false });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', () => {
    const f = file.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { ta.value = String(rd.result); bus.emit('toast', { text: '已讀入檔案，按「匯入」套用', kind: 'info' }); };
    rd.readAsText(f); file.value = '';
  });
  body.append(
    section('存檔與讀檔', list),
    section('匯出／匯入（JSON）', ta,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: doExport }, '匯出目前存檔'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { ta.select(); try { navigator.clipboard.writeText(ta.value); bus.emit('toast', { text: '已複製', kind: 'info' }); } catch (e) { document.execCommand && document.execCommand('copy'); } } }, '複製'),
        h('button', { class: 'btn small', type: 'button', onclick: download }, '下載 .json'),
        h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, '選擇檔案…'),
        h('button', { class: 'btn small primary', type: 'button', onclick: doImport }, '匯入'), file)));
  function doExport() { try { ta.value = SV.exportSave(state); } catch (e) { bus.emit('toast', { text: '匯出失敗', kind: 'bad' }); } }
  function download() {
    if (!ta.value) doExport();
    const url = URL.createObjectURL(new Blob([ta.value], { type: 'application/json' }));
    const a = h('a', { href: url, download: `restgame-${state.time.year}y${state.time.month}m.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function doImport() {
    if (!ta.value.trim()) { bus.emit('toast', { text: '請先貼上存檔 JSON', kind: 'bad' }); return; }
    confirmDialog({
      title: '匯入存檔', text: '匯入會覆蓋目前進度，確定嗎？', okLabel: '匯入', danger: true,
      onOk: () => {
        let ok = false;
        try { ok = SV.importSave(state, ta.value); } catch (e) { console.error(e); }
        bus.emit('toast', ok ? { text: '匯入成功', kind: 'good' } : { text: '匯入失敗：格式不正確', kind: 'bad' });
      },
    });
  }

  const rows = {};
  for (const [slot, name] of SLOTS) {
    const info = h('div', { class: 'muted u-small' });
    const bSave = slot === 'auto' ? null : h('button', { class: 'btn small primary', type: 'button', onclick: () => saveTo(slot, name) }, '存檔');
    const bLoad = h('button', { class: 'btn small', type: 'button', onclick: () => loadFrom(slot, name) }, '讀取');
    const bDel = h('button', { class: 'btn small danger', type: 'button', onclick: () => del(slot, name) }, '刪除');
    const el = h('div', { class: 'card u-row2' }, h('div', { class: 'u-grow' }, h('b', null, name), info), h('div', { class: 'row' }, bSave, bLoad, bDel));
    rows[slot] = { el, info, bLoad, bDel, sig: null };
    list.appendChild(el);
  }
  function saveTo(slot, name) {
    const go = () => {
      let ok = false;
      try { ok = SV.saveGame(state, slot); } catch (e) { console.error(e); }
      bus.emit('toast', ok ? { text: `已存入「${name}」`, kind: 'good' } : { text: '存檔失敗（瀏覽器儲存空間不可用？）', kind: 'bad' });
      refresh(true);
    };
    if (rows[slot].has) confirmDialog({ title: '覆蓋存檔', text: `「${name}」已有存檔，要覆蓋嗎？`, okLabel: '覆蓋', onOk: go }); else go();
  }
  function loadFrom(slot, name) {
    confirmDialog({
      title: '讀取存檔', text: `讀取「${name}」會放棄目前未存檔的進度，確定嗎？`, okLabel: '讀取',
      onOk: () => {
        let ok = false;
        try { ok = SV.loadGame(state, slot); } catch (e) { console.error(e); }
        bus.emit('toast', ok ? { text: '讀檔完成', kind: 'good' } : { text: '讀檔失敗', kind: 'bad' });
      },
    });
  }
  function del(slot, name) {
    confirmDialog({ title: '刪除存檔', text: `刪除「${name}」？無法復原。`, okLabel: '刪除', danger: true, onOk: () => { try { SV.deleteSave(slot); } catch (e) { /* ignore */ } refresh(true); } });
  }
  let lastAt = 0;
  function refresh(force) {
    const now = performance.now();
    if (!force && now - lastAt < 1500) return;
    lastAt = now;
    let saves = [];
    try { saves = SV.listSaves() || []; } catch (e) { saves = []; }
    for (const [slot] of SLOTS) {
      const r = rows[slot], s = saves.find(x => String(x.slot) === slot);
      const sig = s ? JSON.stringify(s) : '';
      r.has = !!s;
      if (r.sig !== sig) {
        r.sig = sig;
        setText(r.info, s ? `${s.label || ''}　${fmtDateTime(s.savedAt)}` : '（空）');
        r.bLoad.disabled = !s; r.bDel.disabled = !s;
      }
    }
  }
  refresh(true);
  return { update() { refresh(false); } };
}

// ---------------------------------------------------------------- performance (效能診斷 / 畫質 / 幀率上限)
function perfSection(state, ui) {
  const hud = h('input', { type: 'checkbox', checked: isHudOn(), dataset: { perf: 'hud' }, onchange: () => setHud(hud.checked) });
  const q = h('select', { dataset: { perf: 'quality' }, 'aria-label': '畫質', onchange: () => setQuality(q.value) },
    QUALITY_MODES.map(([v, l]) => h('option', { value: v }, l)));
  const fc = h('select', { dataset: { perf: 'fpscap' }, 'aria-label': '幀率上限', onchange: () => setFpsCap(fc.value) },
    [['60', '60'], ['30', '30']].map(([v, l]) => h('option', { value: v }, l)));
  const qHelp = h('p', { class: 'muted u-p u-small' });
  const sync = () => {
    q.value = perfCfg.quality; fc.value = String(perfCfg.fpsCap); hud.checked = isHudOn();
    qHelp.textContent = QUALITY_HELP[perfCfg.quality];
  };
  sync();
  const un1 = bus.on('quality:changed', () => { if (q.isConnected) sync(); else { un1(); un2(); } });
  const un2 = bus.on('perfhud:changed', () => { if (hud.isConnected) sync(); else { un1(); un2(); } });
  return section('⚡ 效能與畫質',
    h('label', { class: 'u-setting' }, hud, ' 效能診斷（畫面左上角顯示 fps／耗時，快捷鍵 F3）'),
    h('label', { class: 'u-setting' }, '畫質　', q), qHelp,
    h('label', { class: 'u-setting' }, '幀率上限　', fc, h('span', { class: 'muted u-small' }, '　fps')),
    h('p', { class: 'muted u-p u-small' }, FPSCAP_HELP));
}

// ---------------------------------------------------------------- settings
function buildSettings(body, state, ui) {
  const grid = h('input', { type: 'checkbox', checked: ui.showGrid, onchange: () => { ui.showGrid = grid.checked; } });
  const snd = h('input', { type: 'checkbox', checked: lsGet('restgame.sound', '1') === '1', onchange: () => lsSet('restgame.sound', snd.checked ? '1' : '0') });
  const sp = h('select', { onchange: () => lsSet('restgame.defaultSpeed', sp.value) },
    [['1', '×1 正常'], ['2', '×2'], ['3', '×3']].map(([v, l]) => h('option', { value: v }, l)));
  sp.value = lsGet('restgame.defaultSpeed', '1');
  const tut = h('button', { class: 'btn small', type: 'button', onclick: () => showTutorial(true) }, '重看新手導覽');
  const help = h('button', { class: 'btn small', type: 'button', onclick: () => showHelp() }, '操作說明');
  const inst = installBox();
  if (inst) body.append(section('📲 安裝與全螢幕', ...inst));
  const verLine = h('p', { class: 'muted u-p u-small u-ver' }, '版本：' + versionLabel());
  const unVer = bus.on('version:loaded', () => { if (verLine.isConnected) verLine.textContent = '版本：' + versionLabel(); else unVer(); });
  // 美術風格: concept art (new) vs the original procedural pixel art; applies immediately and persists (render/art.js)
  const styleBtns = [[true, '新美術（概念圖）'], [false, '原像素風']].map(([on, label]) =>
    h('button', { class: 'btn u-artbtn', type: 'button', dataset: { art: on ? 'new' : 'classic' }, onclick: () => setArtEnabled(on) }, label));
  const syncStyle = () => {
    const on = artEnabled();
    styleBtns.forEach((b, i) => { const act = (i === 0) === on; b.classList.toggle('primary', act); b.classList.toggle('active', act); b.setAttribute('aria-pressed', act ? 'true' : 'false'); });
  };
  syncStyle();
  const unsub = bus.on('art:changed', () => { if (styleBtns[0].isConnected) syncStyle(); else unsub(); });
  body.append(section('🎨 美術風格',
    h('div', { class: 'row u-artswitch', role: 'group', 'aria-label': '美術風格' }, styleBtns),
    h('p', { class: 'muted u-p u-small' }, '切換後立即生效，並記在這台裝置上。新美術會多下載一張約 1 MB 的圖片（首次載入後可離線使用）；在手機上若想節省流量，可改回「原像素風」。')));
  body.append(perfSection(state, ui));
  body.append(section('遊戲設定',
    h('label', { class: 'u-setting' }, grid, ' 顯示地圖格線（G）'),
    h('label', { class: 'u-setting' }, snd, ' 音效（預留，尚無音效）'),
    h('label', { class: 'u-setting' }, '開局預設速度　', sp, h('span', { class: 'muted u-small' }, '　下次進入遊戲時套用')),
    h('div', { class: 'row' }, tut, help)),
    section('新遊戲', h('p', { class: 'muted u-p' }, '重新開始會清除目前進度（自動存檔也會被覆蓋）。建議先到「存檔」分頁手動存檔。'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => {
        confirmDialog({
          title: '重新開始', text: '確定要放棄目前的餐廳，重新開業嗎？', okLabel: '重新開業', danger: true,
          onOk: () => { try { SV.newGame(state); } catch (e) { console.error(e); } },
        });
      } }, '🆕 新遊戲')),
    section('關於',
      artBanner('scene.clinic', { title: '餐廳一景', maxVh: 15, cls: 'u-banner-sm' }),
      h('p', { class: 'muted u-p u-small' }, '餐廳物語'),
      verLine,
      h('p', { class: 'muted u-p u-small' }, '角色與設備美術：使用者提供的概念圖')));
  return { update() { if (grid.checked !== ui.showGrid) grid.checked = ui.showGrid; } };
}

// ---------------------------------------------------------------- charts
const num = v => (v && typeof v === 'object') ? Object.values(v).reduce((a, b) => a + (+b || 0), 0) : (+v || 0);
const METRICS = {
  cash: { label: '收入 / 支出', series: [['income', '收入', '#3a9d4d'], ['expense', '支出', '#d1495b']], bars: true },
  money: { label: '資金', series: [['money', '資金', '#2a9d8f']], fmt: v => money(v) },
  patients: { label: '客人數', series: [['patients', '客人數', '#3b7fd1']] },
  satisfaction: { label: '滿意度', series: [['satisfaction', '平均滿意度', '#f4a261']] },
  reputation: { label: '聲譽', series: [['reputation', '聲譽', '#8e5bc4']] },
};

function drawChart(canvas, state, metricKey, hoverIdx) {
  const M = METRICS[metricKey];
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 480, H = canvas.clientHeight || 220;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#fffaf0'; c.fillRect(0, 0, W, H);
  const hist = (state.history || []).slice(-24);
  c.font = '12px sans-serif'; c.textBaseline = 'middle';
  if (!hist.length) {
    c.fillStyle = '#6b7a80'; c.textAlign = 'center';
    c.fillText('尚無資料，第一個月結算後就會出現圖表', W / 2, H / 2);
    return null;
  }
  const L = 58, R = 10, T = 14, B = 26, pw = W - L - R, ph = H - T - B;
  const vals = M.series.map(s => hist.map(r => num(r[s[0]])));
  let lo = Math.min(0, ...vals.flat()), hi = Math.max(1, ...vals.flat());
  if (metricKey === 'satisfaction') { lo = 0; hi = Math.max(100, hi); }
  const pad = (hi - lo) * 0.04; hi += pad; if (lo < 0) lo -= pad;
  const step0 = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step0) * step0; hi = Math.ceil(hi / step0) * step0;
  const yOf = v => T + ph - ((v - lo) / (hi - lo)) * ph;
  const fm = M.fmt || (v => fmt(v));
  // grid + y labels
  c.strokeStyle = 'rgba(31,45,51,0.15)'; c.lineWidth = 1; c.fillStyle = '#6b7a80'; c.textAlign = 'right';
  const step = step0;
  for (let v = lo; v <= hi + step * 0.01; v += step) {
    const y = yOf(v);
    c.beginPath(); c.moveTo(L, y + 0.5); c.lineTo(W - R, y + 0.5); c.stroke();
    c.fillText(fmtShort(v), L - 6, y);
  }
  if (lo < 0) { c.strokeStyle = '#1f2d33'; c.beginPath(); c.moveTo(L, yOf(0) + 0.5); c.lineTo(W - R, yOf(0) + 0.5); c.stroke(); }
  const n = hist.length, slot = pw / n;
  const xOf = i => L + slot * (i + 0.5);
  // x labels
  c.fillStyle = '#6b7a80'; c.textAlign = 'center';
  const every = Math.ceil(n / 8);
  hist.forEach((r, i) => { if (i % every === 0 || i === n - 1) c.fillText(`${r.year}-${r.month}`, xOf(i), H - 10); });
  if (M.bars) {
    const bw = Math.max(3, Math.min(18, slot * 0.36));
    M.series.forEach((s, si) => {
      c.fillStyle = s[2];
      hist.forEach((r, i) => {
        const v = vals[si][i], x = xOf(i) + (si - 0.5) * (bw + 1) - bw / 2;
        const y0 = yOf(0), y1 = yOf(v);
        c.fillRect(x, Math.min(y0, y1), bw, Math.abs(y1 - y0));
      });
    });
    // net line
    c.strokeStyle = '#264653'; c.lineWidth = 2; c.beginPath();
    hist.forEach((r, i) => { const v = vals[0][i] - vals[1][i], x = xOf(i), y = yOf(v); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
    hist.forEach((r, i) => { c.fillStyle = '#264653'; c.fillRect(xOf(i) - 2, yOf(vals[0][i] - vals[1][i]) - 2, 4, 4); });
  } else {
    M.series.forEach((s, si) => {
      c.strokeStyle = s[2]; c.lineWidth = 2.5; c.beginPath();
      hist.forEach((r, i) => { const x = xOf(i), y = yOf(vals[si][i]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.fillStyle = s[2];
      hist.forEach((r, i) => c.fillRect(xOf(i) - 2.5, yOf(vals[si][i]) - 2.5, 5, 5));
    });
  }
  // legend
  c.textAlign = 'left'; let lx = L + 6;
  const leg = M.series.map(s => [s[1], s[2]]); if (M.bars) leg.push(['淨利', '#264653']);
  for (const [name, col] of leg) { c.fillStyle = col; c.fillRect(lx, T + 2, 10, 10); c.fillStyle = '#1f2d33'; c.fillText(name, lx + 14, T + 7); lx += 14 + c.measureText(name).width + 14; }
  // hover
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
    const x = xOf(hoverIdx);
    c.strokeStyle = 'rgba(31,45,51,0.5)'; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.setLineDash([]);
    const r = hist[hoverIdx];
    const lines = [`第${r.year}年 ${r.month}月`];
    M.series.forEach((s, si) => lines.push(`${s[1]}：${fm(vals[si][hoverIdx])}`));
    if (M.bars) lines.push(`淨利：${fm(vals[0][hoverIdx] - vals[1][hoverIdx])}`);
    const bw2 = Math.max(...lines.map(t => c.measureText(t).width)) + 16, bh = lines.length * 16 + 8;
    let bx = x + 10; if (bx + bw2 > W - 4) bx = x - bw2 - 10;
    c.fillStyle = 'rgba(20,36,41,0.92)'; c.fillRect(bx, T + 18, bw2, bh);
    c.fillStyle = '#fdf6e3'; c.textAlign = 'left';
    lines.forEach((t, i) => c.fillText(t, bx + 8, T + 18 + 12 + i * 16));
  }
  return { n, slot, L };
}
function niceStep(raw) {
  const e = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function fmtShort(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K';
  return Math.round(v).toString();
}

function buildCharts(body, state) {
  const canvas = h('canvas', { class: 'u-chart' });
  const chips = h('div', { class: 'tabs u-subtabs' });
  const btns = {};
  let hover = null, geo = null, dirty = true, lastLen = -1;
  for (const k of Object.keys(METRICS)) {
    btns[k] = h('button', { class: 'tab' + (store.metric === k ? ' active' : ''), type: 'button', onclick: () => {
      store.metric = k; for (const b of Object.keys(btns)) btns[b].classList.toggle('active', b === k); dirty = true; redraw();
    } }, METRICS[k].label);
    chips.appendChild(btns[k]);
  }
  canvas.addEventListener('mousemove', e => {
    if (!geo) return;
    const r = canvas.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) - geo.L) / geo.slot);
    if (i !== hover) { hover = i; redraw(); }
  });
  canvas.addEventListener('mouseleave', () => { hover = null; redraw(); });
  function redraw() { geo = drawChart(canvas, state, store.metric, hover); }
  const summary = h('div', { class: 'u-grid2' });
  body.append(chips, h('div', { class: 'u-canvaswrap' }, canvas), summary,
    h('div', { class: 'muted u-small u-p' }, '圖表顯示最近 24 個月（每月結算後更新）。把滑鼠移到（或用手指點）圖上可看詳細數字。'));
  requestAnimationFrame(redraw);
  return {
    update() {
      const len = (state.history || []).length;
      if (len !== lastLen) {
        lastLen = len; redraw();
        const last = state.history[len - 1];
        clear(summary);
        if (last) summary.append(
          h('div', { class: 'stat' }, h('span', null, '上月收入'), h('span', { class: 'good' }, money(num(last.income)))),
          h('div', { class: 'stat' }, h('span', null, '上月支出'), h('span', { class: 'bad' }, money(num(last.expense)))),
          h('div', { class: 'stat' }, h('span', null, '上月淨利'), h('span', { class: num(last.income) - num(last.expense) >= 0 ? 'good' : 'bad' }, money(num(last.income) - num(last.expense)))));
      }
    },
  };
}

export function mountSystem(root, state, ui) {
  const tabs = [
    { id: 'save', label: '💾 存檔', build: b => buildSave(b, state, ui) },
    { id: 'charts', label: '📈 營運圖表', build: b => buildCharts(b, state) },
    { id: 'settings', label: '⚙ 設定', build: b => buildSettings(b, state, ui) },
  ];
  if (supportAvailable()) tabs.push({ id: 'support', label: '☕ 支持', build: b => b.append(supportBody()) });
  const t = tabbed(tabs, store);
  root.appendChild(t.el);
  return { update() { t.update(); } };
}
