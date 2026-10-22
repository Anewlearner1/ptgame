// Frame-timing statistics (ring buffer). Pure data + math, no DOM: shared by main.js (writer), js/ui/perfhud.js and the
// benchmark (readers), and unit-testable in node. One sample = one RENDERED frame.
//   frame = interval since the previous rendered frame (ms), sim / render / ui = JS time spent in that frame (ms).
// Reads are cheap (<= 240 samples, sorted on demand at <= 4 Hz). Writes are allocation-free.
export const PERF_RING = 720;

export function createPerfStats(n = PERF_RING) {
  return {
    n, head: 0, count: 0,
    t: new Float64Array(n),        // timestamp (ms) of the sample
    frame: new Float32Array(n), sim: new Float32Array(n), render: new Float32Array(n), ui: new Float32Array(n),
    // last-frame values, for the cheap `ui.perfStats.simMs` style access
    frameMs: 0, simMs: 0, renderMs: 0, uiMs: 0,
    skipped: 0,                    // rAF ticks skipped by the frame limiter
    agents: 0,
  };
}

export function pushFrame(ps, now, frameMs, simMs, renderMs, uiMs) {
  const i = ps.head;
  ps.t[i] = now; ps.frame[i] = frameMs; ps.sim[i] = simMs; ps.render[i] = renderMs; ps.ui[i] = uiMs;
  ps.head = (i + 1) % ps.n;
  if (ps.count < ps.n) ps.count++;
  ps.frameMs = frameMs; ps.simMs = simMs; ps.renderMs = renderMs; ps.uiMs = uiMs;
}

export function resetPerfStats(ps) { ps.head = 0; ps.count = 0; }

function pct(sorted, n, p) {
  if (!n) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[i];
}
function mean(arr, n) { let s = 0; for (let i = 0; i < n; i++) s += arr[i]; return n ? s / n : 0; }

// Summary of the samples newer than `now - windowMs`.
// fps = rendered frames per second over the window; fps1 = "1% low" fps = 1000 / p99 frame time.
export function summarize(ps, now, windowMs = 2000) {
  const sim = [], rnd = [], ui = [], fr = [];
  let tMin = Infinity, tMax = -Infinity;
  for (let k = 0; k < ps.count; k++) {
    const i = (ps.head - 1 - k + ps.n) % ps.n;
    if (now - ps.t[i] > windowMs) break;
    const f = ps.frame[i];
    fr.push(f); sim.push(ps.sim[i]); rnd.push(ps.render[i]); ui.push(ps.ui[i]);
    if (ps.t[i] < tMin) tMin = ps.t[i];
    if (ps.t[i] > tMax) tMax = ps.t[i];
  }
  const n = fr.length;
  const sf = fr.slice().sort((a, b) => a - b);
  const sr = rnd.slice().sort((a, b) => a - b);
  const meanFrame = mean(fr, n);
  const span = n > 1 ? (tMax - tMin) : 0;
  const fps = n > 1 && span > 0 ? (n - 1) * 1000 / span : (meanFrame > 0 ? 1000 / meanFrame : 0);
  const p99 = pct(sf, n, 0.99);
  return {
    n, fps, fps1: p99 > 0 ? 1000 / p99 : 0,
    frameAvg: meanFrame, frameP50: pct(sf, n, 0.5), frameP95: pct(sf, n, 0.95), frameP99: p99,
    simAvg: mean(sim, n), renderAvg: mean(rnd, n), renderP50: pct(sr, n, 0.5), renderP95: pct(sr, n, 0.95), uiAvg: mean(ui, n),
    jsAvg: mean(sim, n) + mean(rnd, n) + mean(ui, n),
  };
}
