// Device / runtime facts for the HUD and the performance report. Everything is optional and wrapped in try/catch.
import { artEnabled } from '../render/art.js';
import { perfCfg, qualityLabel } from './quality.js';
import { versionLabel } from './version.js';

let gpuCache = null;
// GPU renderer string through WEBGL_debug_renderer_info on a throwaway canvas (context released straight away).
export function gpuRenderer() {
  if (gpuCache !== null) return gpuCache;
  let out = '不明';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '不明（瀏覽器未開放 WEBGL_debug_renderer_info）';
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } else out = '不明（無 WebGL）';
  } catch (e) { out = '不明'; }
  gpuCache = out;
  return out;
}

export function jsHeapMB() {
  try {
    const m = performance.memory;
    if (m && m.usedJSHeapSize) return m.usedJSHeapSize / 1048576;
  } catch (e) { /* not available */ }
  return null;
}

export function countAgents(state) {
  let n = 0;
  const p = state.patients || [];
  for (let i = 0; i < p.length; i++) if (p[i].stage !== 'gone') n++;
  return n + (state.staff ? state.staff.length : 0);
}

export function deviceInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const s = typeof screen !== 'undefined' ? screen : {};
  return {
    ua: nav.userAgent || '', platform: (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '',
    screen: (s.width || 0) + '×' + (s.height || 0), viewport: (window.innerWidth || 0) + '×' + (window.innerHeight || 0),
    dpr: window.devicePixelRatio || 1, cores: nav.hardwareConcurrency || null, memory: nav.deviceMemory || null,
    touch: matchMedia('(pointer: coarse)').matches, gpu: gpuRenderer(),
  };
}

// One flat snapshot of the live state (cheap: no allocation beyond the returned object).
export function snapshot(state, ui) {
  const cv = document.getElementById('game');
  const P = ui.perf || {};
  return {
    agents: countAgents(state),
    canvasW: cv ? cv.width : 0, canvasH: cv ? cv.height : 0,
    dpr: window.devicePixelRatio || 1, effDpr: P.dpr || 1,
    level: P.level | 0, auto: !!P.auto, quality: perfCfg.quality, qualityName: qualityLabel(), fpsCap: perfCfg.fpsCap,
    art: artEnabled() ? 'new' : 'classic', lot: state.lotLevel | 0, zoom: ui.cam ? ui.cam.zoom : 1,
    heap: jsHeapMB(), version: versionLabel(),
  };
}
