// 畫質 (quality) and 幀率上限 (frame-rate cap): persisted device settings that tune cost vs. battery.
//   畫質: 自動 = the existing scaler (ui.perf.auto; it only runs on touch devices, desktops stay at full quality) /
//         高 = level 0 / 中 = level 2 / 低 = level 3   (levels: see renderer.js "Quality scaler state")
//   幀率上限: 60 (every display refresh) | 30 (every second refresh; sim still advances by real dt, see main.js)
// Storage keys: localStorage 'restgame.quality' ('auto'|'high'|'mid'|'low'), 'restgame.fpscap' ('60'|'30'); wrapped in try/catch.
import { bus } from '../core/bus.js';

export const QUALITY_KEY = 'restgame.quality', FPSCAP_KEY = 'restgame.fpscap';
export const FRAME_30_MS = 1000 / 30;
export const QUALITY_MODES = [['auto', '自動'], ['high', '高'], ['mid', '中'], ['low', '低']];
export const QUALITY_LEVEL = { high: 0, mid: 2, low: 3 };
export const QUALITY_HELP = {
  auto: '自動：手機會依幀率自動降低畫質，電腦維持最高畫質。',
  high: '高：原生解析度與全部裝飾（車輛、天氣粒子），最吃效能。',
  mid: '中：解析度上限 2 倍、關閉車輛／天氣粒子／暗角，明顯省電。',
  low: '低：解析度上限約 1.25 倍，最流暢、最省電，畫面較糊。',
};
export const FPSCAP_HELP = '幀率上限：改成 30 會每隔一次畫面更新才繪製，電池與發熱明顯改善；遊戲時間照實際秒數前進，速度不變。';

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const perfCfg = { quality: 'auto', fpsCap: 60 };
let uiRef = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

export function ensurePerf(ui) {
  if (!ui.perf) ui.perf = { dpr: 1, fps: 60, level: 0, auto: COARSE };
  return ui.perf;
}

function apply() {
  if (!uiRef) return;
  const P = ensurePerf(uiRef), m = perfCfg.quality;
  P.mode = m; P.fpsCap = perfCfg.fpsCap;
  if (m === 'auto') {
    if (P.manual) P.level = 0;        // leaving a manual level: the scaler starts again from full quality
    P.auto = COARSE; P.manual = false;
  } else {
    P.auto = false; P.manual = true; P.level = QUALITY_LEVEL[m];
  }
}

export function setQuality(mode, persist = true) {
  if (!QUALITY_LEVEL.hasOwnProperty(mode) && mode !== 'auto') mode = 'auto';
  perfCfg.quality = mode;
  if (persist) lsSet(QUALITY_KEY, mode);
  apply();                                                // renderer.ensureSize() re-reads ui.perf on the very next frame
  bus.emit('quality:changed', { quality: mode });
}

export function setFpsCap(cap, persist = true) {
  cap = +cap === 30 ? 30 : 60;
  perfCfg.fpsCap = cap;
  if (uiRef && uiRef.perf) uiRef.perf.fpsCap = cap;
  if (persist) lsSet(FPSCAP_KEY, String(cap));
  bus.emit('quality:changed', { fpsCap: cap });
}

export function initQuality(ui) {
  uiRef = ui;
  const q = lsGet(QUALITY_KEY), c = lsGet(FPSCAP_KEY);
  perfCfg.quality = q && (q === 'auto' || QUALITY_LEVEL.hasOwnProperty(q)) ? q : 'auto';
  perfCfg.fpsCap = c === '30' ? 30 : 60;
  apply();
}

export function qualityLabel() {
  const m = QUALITY_MODES.find(x => x[0] === perfCfg.quality);
  return m ? m[1] : '自動';
}
