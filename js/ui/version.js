// Build version + 'update available' check.
//   .github/workflows/pages.yml writes `version.json` = {"sha": GITHUB_SHA, "built": ISO time} next to index.html on deploy.
//   The app reads it once at boot (relative URL, cache:'no-store'; any failure -> 'dev'), shows it in 系統 → 設定 → 關於 and in
//   the performance report, and re-reads it on tab focus / every 10 min. A different sha than the one loaded at boot means a new
//   deploy is live -> toast 「有新版本，重新整理即可更新」 with a reload button. The fetch goes through sw.js (network-first),
//   so it is never answered from a stale cache while online.
import { bus } from '../core/bus.js';

export const VERSION_URL = 'version.json';
export const UPDATE_EVERY_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 30 * 1000;            // visibilitychange spam guard
export const UPDATE_TEXT = '有新版本，重新整理即可更新';

export const version = { sha: 'dev', built: '', loaded: false, latest: null, updateAvailable: false };

// Localhost / file:// has no version.json: asking would only print a 404 in the console, so dev builds do not ask
// (add ?ver=1 to the URL to force the lookup when testing a locally stamped version.json).
function skipLookup() {
  try {
    if (/[?&]ver=1\b/.test(location.search)) return false;
    return location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(location.hostname);
  } catch (e) { return true; }
}

export function parseVersion(j) {
  if (!j || typeof j !== 'object' || typeof j.sha !== 'string' || !j.sha) return null;
  return { sha: j.sha, built: typeof j.built === 'string' ? j.built : '' };
}

// fetchFn(url, init) -> Response-like. Resolves to {sha, built} or null (never throws).
export async function fetchVersion(fetchFn) {
  try {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) return null;
    const res = await f(VERSION_URL, { cache: 'no-store' });
    if (!res || !res.ok) return null;
    return parseVersion(await res.json());
  } catch (e) { return null; }
}

// Pure decision used by the checker (and unit-tested): notify only when both shas are real and different.
export function isNewer(bootSha, latestSha) {
  return !!bootSha && bootSha !== 'dev' && !!latestSha && latestSha !== bootSha;
}

export function shortSha(sha) { return sha && sha !== 'dev' ? String(sha).slice(0, 7) : 'dev'; }
export function versionLabel() {
  return version.sha === 'dev' ? 'dev（本機／未標記版本）' : shortSha(version.sha) + (version.built ? '（建置 ' + version.built + '）' : '');
}

export async function loadVersion(fetchFn) {
  if (!fetchFn && skipLookup()) { version.loaded = true; return version; }
  const v = await fetchVersion(fetchFn);
  if (v) { version.sha = v.sha; version.built = v.built; }
  version.loaded = true;
  bus.emit('version:loaded', { sha: version.sha });
  return version;
}

let checking = false, lastCheck = 0, notified = false;
// One update check. Returns 'update' | 'same' | 'unknown'. onUpdate(latest) fires at most once per page load.
export async function checkForUpdate(fetchFn, onUpdate) {
  if (checking) return 'unknown';
  if (!fetchFn && skipLookup()) return 'unknown';
  checking = true;
  try {
    const v = await fetchVersion(fetchFn);
    lastCheck = Date.now();
    if (!v) return 'unknown';
    version.latest = v.sha;
    if (isNewer(version.sha, v.sha)) {
      version.updateAvailable = true;
      if (!notified) { notified = true; if (onUpdate) onUpdate(v); }
      return 'update';
    }
    return 'same';
  } finally { checking = false; }
}
export function resetUpdateNotice() { notified = false; version.updateAvailable = false; version.latest = null; }

// toast with a reload button (the normal toast layer is pointer-events:none, the button re-enables it)
export function showUpdateToast() {
  const layer = typeof document !== 'undefined' && document.getElementById('toast-layer');
  if (!layer || layer.querySelector('.u-update')) return;
  const el = document.createElement('div');
  el.className = 'toast info u-update'; el.setAttribute('role', 'status');
  const txt = document.createElement('span'); txt.textContent = UPDATE_TEXT;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn small primary'; btn.textContent = '重新整理';
  btn.addEventListener('click', () => { try { location.reload(); } catch (e) { /* ignore */ } });
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'btn small'; x.textContent = '稍後'; x.setAttribute('aria-label', '關閉');
  x.addEventListener('click', () => el.remove());
  el.append(txt, btn, x);
  layer.appendChild(el);
}

export function initVersion() {
  loadVersion().then(() => {
    // first check happens on the first focus / after 10 min; the boot read already counts as the baseline
    lastCheck = Date.now();
  });
  const run = () => checkForUpdate(null, () => { showUpdateToast(); bus.emit('version:update', { latest: version.latest }); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_GAP_MS) run();
  });
  setInterval(() => { if (!document.hidden) run(); }, UPDATE_EVERY_MS);
}
