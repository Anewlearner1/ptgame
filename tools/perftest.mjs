// 效能診斷 / 畫質 / 幀率上限 / 版本與更新提示 regression test.
//   python3 -m http.server 8213 &  node tools/perftest.mjs [--url http://localhost:8213/index.html] [--quick]
// --quick skips the two real 12-second benchmark runs (HUD / quality / fps-cap / version tests still run).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const QUICK = process.argv.includes('--quick');
const BASE = arg('url', 'http://localhost:8213/index.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { failed++; console.log('FAIL', m); } else if (process.env.VERBOSE) console.log('ok  ', m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function open({ style = 'new', touch = false, w = 1280, h = 720, dpr = 1, search = '', keep = null, routes = null } = {}) {
  // service workers are blocked when a route mock is used (page.route cannot see requests the SW makes itself)
  const sw = routes ? { serviceWorkers: 'block' } : {};
  const ctx = keep || await browser.newContext(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: UA, ...sw } : { viewport: { width: w, height: h }, deviceScaleFactor: dpr, ...sw });
  if (!keep) {
    await ctx.addInitScript(([st]) => {
      try { if (!sessionStorage.getItem('pt-init')) { sessionStorage.setItem('pt-init', '1'); localStorage.clear(); if (st === 'classic') localStorage.setItem('ptgame.art', 'classic'); } } catch (e) { /* ignore */ }
    }, [style]);
  }
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Service Worker registration blocked/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  if (routes) await routes(page);
  await page.goto(BASE + search);
  await page.waitForTimeout(1300);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  await page.waitForTimeout(300);
  return { ctx, page, problems };
}
async function openSettings(page) {
  await page.evaluate(() => { window.__game.ui.panel = 'system'; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('#panel .tab')].find(t => t.textContent.includes('設定'))?.click(); });
  await page.waitForTimeout(200);
}
const hudText = page => page.evaluate(() => { const e = document.getElementById('perf-hud'); return e && !e.hidden ? e.innerText : null; });
const hudNums = t => (t.match(/-?\d+(\.\d+)?/g) || []).map(Number);

// ------------------------------------------------------------------------------------------------ 1. pure units (node, no browser)
{
  const PS = await import('../js/core/perfstats.js');
  const ps = PS.createPerfStats(64);
  for (let i = 0; i < 40; i++) PS.pushFrame(ps, 1000 + i * 20, 20, 1 + (i % 4), 2, 0.5);
  PS.pushFrame(ps, 1000 + 40 * 20 + 80, 100, 1, 2, 0.5);        // one slow frame
  const s = PS.summarize(ps, 1000 + 40 * 20 + 80, 2000);
  ok(s.n === 41, 'summarize counts samples ' + s.n);
  ok(Math.abs(s.frameP50 - 20) < 1e-6 && s.frameP95 >= 20 && s.frameP99 === 100, 'percentiles p50/p95/p99 ' + [s.frameP50, s.frameP95, s.frameP99]);
  ok(s.fps1 > 9 && s.fps1 < 11, '1% low = 1000/p99 ' + s.fps1);
  ok(s.fps > 30 && s.fps < 55, 'fps from timestamps ' + s.fps);
  ok(Math.abs(s.simAvg - 2.5) < 0.2 && Math.abs(s.renderAvg - 2) < 1e-6, 'averages');
  const s2 = PS.summarize(ps, 1000 + 40 * 20 + 80, 100);
  ok(s2.n < s.n && s2.n >= 1, 'window trims old samples ' + s2.n);
  ok(PS.summarize(PS.createPerfStats(8), 0).n === 0, 'empty stats do not throw');

  const V = await import('../js/ui/version.js');
  const mk = (sha, okFlag = true) => async () => ({ ok: okFlag, json: async () => ({ sha, built: '2026-10-22T00:00:00Z' }) });
  ok(!V.isNewer('dev', 'abc') && !V.isNewer('abc', 'abc') && V.isNewer('abc', 'def') && !V.isNewer('abc', null), 'isNewer decision table');
  V.version.sha = 'aaa111';
  let fired = [];
  ok(await V.checkForUpdate(mk('aaa111'), v => fired.push(v)) === 'same' && !fired.length, 'same sha: no toast');
  ok(await V.checkForUpdate(async () => { throw new Error('offline'); }, v => fired.push(v)) === 'unknown' && !fired.length, 'fetch failure: unknown, no toast');
  ok(await V.checkForUpdate(mk('x', false), v => fired.push(v)) === 'unknown' && !fired.length, 'HTTP error: unknown');
  ok(await V.checkForUpdate(async () => ({ ok: true, json: async () => ({ nope: 1 }) }), v => fired.push(v)) === 'unknown', 'malformed payload: unknown');
  ok(await V.checkForUpdate(mk('bbb222'), v => fired.push(v)) === 'update' && fired.length === 1 && fired[0].sha === 'bbb222', 'newer sha: toast callback fires');
  ok(await V.checkForUpdate(mk('bbb222'), v => fired.push(v)) === 'update' && fired.length === 1, 'toast fires only once per page load');
  V.resetUpdateNotice(); V.version.sha = 'dev';
  ok(await V.checkForUpdate(mk('zzz'), v => fired.push(v)) !== 'update' && fired.length === 1, 'dev boot never claims an update');
  const dv = await V.loadVersion(async () => ({ ok: false }));
  ok(dv.sha === 'dev', 'version.json missing -> dev');
  const lv = await V.loadVersion(mk('1234567890abcdef'));
  ok(lv.sha === '1234567890abcdef' && V.versionLabel().startsWith('1234567'), 'version.json parsed ' + V.versionLabel());
}

// ------------------------------------------------------------------------------------------------ 2. HUD: URL / F3 / settings switch
for (const style of ['new', 'classic']) {
  const { ctx, page, problems } = await open({ style, search: '?perf=1' });
  await page.waitForTimeout(1500);
  const t = await hudText(page);
  ok(!!t, `[${style}] HUD visible with ?perf=1`);
  if (t) {
    const nums = hudNums(t);
    ok(nums.length >= 14 && nums.every(Number.isFinite), `[${style}] HUD numbers finite (${nums.length})`);
    for (const key of ['幀率', '1%低', 'p50', 'p95', '模擬', '繪製', '角色', '畫布', 'DPR', '畫質', '診所']) ok(t.includes(key), `[${style}] HUD shows ${key}`);
    ok(t.includes(style === 'new' ? '新美術' : '原像素'), `[${style}] HUD shows art style`);
    const m = t.match(/畫布 (\d+)×(\d+)/);
    const cv = await page.evaluate(() => [document.getElementById('game').width, document.getElementById('game').height]);
    ok(m && +m[1] === cv[0] && +m[2] === cv[1], `[${style}] HUD canvas size matches the canvas ${m && m[0]} vs ${cv}`);
    ok(/幀率 [\d.]+ fps/.test(t) && +t.match(/幀率 ([\d.]+)/)[1] > 5, `[${style}] fps sane`);
  }
  const geo = await page.evaluate(() => { const e = document.getElementById('perf-hud'), r = e.getBoundingClientRect(); return { pe: getComputedStyle(e).pointerEvents, r: [r.left, r.top, r.right, r.bottom], vw: innerWidth }; });
  ok(geo.pe === 'none' && geo.r[2] <= geo.vw, `[${style}] HUD pointer-events none, inside viewport`);
  await page.keyboard.press('F3'); await page.waitForTimeout(150);
  ok(!(await hudText(page)), `[${style}] F3 hides`);
  await page.keyboard.press('F3'); await page.waitForTimeout(400);
  ok(!!(await hudText(page)), `[${style}] F3 shows`);
  await page.keyboard.press('F3');
  await openSettings(page);
  const sw = page.locator('input[data-perf="hud"]');
  ok(await sw.count() === 1 && !(await sw.isChecked()), `[${style}] settings switch present and off`);
  await sw.check(); await page.waitForTimeout(400);
  ok(!!(await hudText(page)), `[${style}] settings switch turns HUD on`);
  await page.reload(); await page.waitForTimeout(1500);
  ok(!!(await hudText(page)), `[${style}] switch persists after reload (no URL param)`);
  await page.goto(BASE + '?perf=0'); await page.waitForTimeout(1200);
  ok(!(await hudText(page)), `[${style}] ?perf=0 forces off`);
  ok(problems.length === 0, `[${style}] no console problems in HUD test: ${problems.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// HUD cost: while hidden nothing runs; while shown it updates at <= 4 Hz
{
  const { ctx, page } = await open({ search: '?perf=1' });
  const n = await page.evaluate(() => new Promise(res => {
    const e = document.getElementById('perf-hud'); let c = 0;
    const mo = new MutationObserver(m => { for (const r of m) if (r.type === 'characterData') c++; });
    mo.observe(e, { subtree: true, characterData: true });
    setTimeout(() => { mo.disconnect(); res(c); }, 2000);
  }));
  ok(n <= 6 * 4 * 2 + 6, `HUD text writes in 2 s bounded (${n}); <= 4 Hz`);
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------ 3. quality selector (phone-like, DPR 3)
{
  const { ctx, page, problems } = await open({ touch: true, w: 390, h: 844, dpr: 3 });
  await openSettings(page);
  const q = page.locator('select[data-perf="quality"]');
  ok(await q.count() === 1 && (await q.inputValue()) === 'auto', 'quality defaults to 自動 on touch');
  const opts = await q.evaluate(s => [...s.options].map(o => o.textContent));
  ok(opts.join() === '自動,高,中,低', 'quality options ' + opts);
  const lv = () => page.evaluate(() => ({ level: window.__game.ui.perf.level, auto: window.__game.ui.perf.auto, dpr: window.__game.ui.perf.dpr, w: document.getElementById('game').width }));
  const base = await lv();
  ok(base.auto === true, 'auto: scaler on for touch devices');
  await q.selectOption('low'); await page.waitForTimeout(250);
  let s = await lv();
  ok(s.level === 3 && s.auto === false, 'low -> level 3, scaler off ' + JSON.stringify(s));
  ok(s.w < base.w * 0.6 && Math.abs(s.dpr - 1.25) < 1e-6, `low applies immediately: backing ${base.w} -> ${s.w}`);
  await q.selectOption('mid'); await page.waitForTimeout(250);
  s = await lv();
  ok(s.level === 2 && Math.abs(s.dpr - 2) < 1e-6, 'mid -> level 2, DPR cap 2 ' + JSON.stringify(s));
  await q.selectOption('high'); await page.waitForTimeout(250);
  s = await lv();
  ok(s.level === 0 && s.w === base.w, 'high -> level 0, full backing size');
  ok((await page.evaluate(() => localStorage.getItem('ptgame.quality'))) === 'high', 'quality persisted in localStorage');
  await q.selectOption('low');
  await page.reload(); await page.waitForTimeout(1500);
  s = await lv();
  ok(s.level === 3 && s.auto === false, 'quality persists across reload ' + JSON.stringify(s));
  await openSettings(page);
  ok((await page.locator('select[data-perf="quality"]').inputValue()) === 'low', 'selector shows the stored value');
  await page.locator('select[data-perf="quality"]').selectOption('auto'); await page.waitForTimeout(250);
  s = await lv();
  ok(s.auto === true && s.level === 0, 'back to 自動 restarts the scaler at level 0');
  ok((await page.evaluate(() => localStorage.getItem('ptgame.quality'))) === 'auto', 'auto persisted');
  const help = await page.locator('#panel .u-section', { hasText: '效能與畫質' }).innerText();
  ok(help.includes('自動：') && help.includes('幀率上限：'), 'one-line explanations are present');
  ok(problems.length === 0, 'no console problems in quality test: ' + problems.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------ 4. frame cap keeps sim time correct
{
  const { ctx, page, problems } = await open({});
  const absMin = () => page.evaluate(() => { const t = window.__game.state.time; return ((t.year * 12 + t.month) * 4 + t.week) * 720 + t.clock; });
  await page.evaluate(() => { const g = window.__game; g.state.time.clock = 8 * 60; g.state.events.pendingDilemma = null; g.bus.emit('speed:set', { speed: 1 }); });
  async function rate(cap) {
    await openSettings(page);
    await page.locator('select[data-perf="fpscap"]').selectOption(String(cap));
    await page.evaluate(() => { document.querySelectorAll('#modal-root button').forEach(b => b.click()); window.__game.state.time.clock = 8 * 60; window.__game.bus.emit('speed:set', { speed: 1 }); });
    await page.waitForTimeout(800);
    const m0 = await absMin(), c0 = await page.evaluate(() => performance.now()); const f0 = await page.evaluate(() => window.__game.ui.perfStats.count + 0);
    const fr0 = await page.evaluate(() => { const p = window.__game.ui.perfStats; return p.head + p.skipped * 0; });
    await page.waitForTimeout(4000);
    const m1 = await absMin(), c1 = await page.evaluate(() => performance.now());
    const frames = await page.evaluate(([f]) => { const p = window.__game.ui.perfStats; return (p.head - f + p.n) % p.n; }, [fr0]);
    void f0;
    return { perSec: (m1 - m0) / ((c1 - c0) / 1000), fps: frames / ((c1 - c0) / 1000) };
  }
  let r60 = await rate(60);
  for (let k = 0; k < 2 && Math.abs(r60.perSec - 16) > 2; k++) r60 = await rate(60);     // an event dialog can pause the sim during a window: measure again
  let r30 = await rate(30);
  for (let k = 0; k < 2 && Math.abs(r30.perSec - 16) > 2; k++) r30 = await rate(30);
  ok(Math.abs(r30.perSec / r60.perSec - 1) <= 0.05, `sim minutes per real second equal at cap 30 vs 60 (±5%): ${r60.perSec.toFixed(2)} vs ${r30.perSec.toFixed(2)}`);
  ok(Math.abs(r60.perSec - 16) < 1.5, 'x1 speed is ~16 game-min per real second ' + r60.perSec.toFixed(2));
  ok(r30.fps > 24 && r30.fps < 36, 'cap 30 renders ~30 fps ' + r30.fps.toFixed(1));
  ok(r60.fps > 45, 'cap 60 renders ~60 fps ' + r60.fps.toFixed(1));
  ok((await page.evaluate(() => localStorage.getItem('ptgame.fpscap'))) === '30', 'fps cap persisted');
  const skipped = await page.evaluate(() => window.__game.ui.perfStats.skipped);
  ok(skipped > 50, 'limiter skipped rAF ticks ' + skipped);
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  await openSettings(page);
  ok((await page.locator('select[data-perf="fpscap"]').inputValue()) === '30', 'fps cap persists across reload');
  ok(problems.length === 0, 'no console problems in fps-cap test: ' + problems.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------ 5. version.json: missing -> dev (no console error); update toast via mocked payloads
{
  const { ctx, page, problems } = await open({});
  const v = await page.evaluate(async () => (await import('./js/ui/version.js')).version.sha);
  ok(v === 'dev', 'no version.json on the dev server -> dev');
  await openSettings(page);
  const about = await page.locator('#panel .u-ver').innerText();
  ok(about.includes('版本') && about.includes('dev'), '關於 shows the version: ' + about);
  ok(problems.length === 0, 'missing version.json causes no console error: ' + problems.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // forced lookup (?ver=1) against a mocked version.json that changes between two reads
  let sha = 'aaaaaaa1111111';
  const routes = async page => page.route('**/version.json', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ sha, built: '2026-10-22T08:00:00Z' }) }));
  const { ctx, page, problems } = await open({ search: '?ver=1', routes });
  await page.waitForTimeout(600);
  const v0 = await page.evaluate(async () => (await import('./js/ui/version.js')).version.sha);
  ok(v0 === 'aaaaaaa1111111', 'boot sha read from version.json: ' + v0);
  await openSettings(page);
  ok((await page.locator('#panel .u-ver').innerText()).includes('aaaaaaa'), '關於 shows the short sha');
  let r = await page.evaluate(async () => { const V = await import('./js/ui/version.js'); return V.checkForUpdate(null, V.showUpdateToast); });
  ok(r === 'same' && (await page.locator('.toast.u-update').count()) === 0, 'same sha -> no toast');
  sha = 'bbbbbbb2222222';
  r = await page.evaluate(async () => { const V = await import('./js/ui/version.js'); return V.checkForUpdate(null, V.showUpdateToast); });
  ok(r === 'update', 'newer sha detected');
  const tt = page.locator('.toast.u-update');
  ok(await tt.count() === 1 && (await tt.innerText()).includes('有新版本，重新整理即可更新'), 'update toast shown with the required text');
  ok(await tt.locator('button', { hasText: '重新整理' }).count() === 1, 'toast has a reload button');
  const reloaded = page.waitForNavigation({ timeout: 5000 }).then(() => true).catch(() => false);
  await tt.locator('button', { hasText: '重新整理' }).click();
  ok(await reloaded, 'reload button reloads the page');
  ok(problems.length === 0, 'no console problems in update test: ' + problems.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // visibilitychange path (>30 s since the boot read is simulated by moving the clock back through Date.now)
  let sha = 'ccccccc3333333';
  const routes = async page => page.route('**/version.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha }) }));
  const { ctx, page } = await open({ search: '?ver=1', routes });
  await page.waitForTimeout(500);
  sha = 'ddddddd4444444';
  await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 60000; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  ok(await page.locator('.toast.u-update').count() === 1, 'tab focus (visibilitychange) triggers the update check');
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------ 7. both styles run clean with everything on
for (const style of ['new', 'classic']) {
  const { ctx, page, problems } = await open({ style, search: '?perf=1' });
  await page.evaluate(() => { window.__game.bus.emit('speed:set', { speed: 3 }); });
  await openSettings(page);
  for (const q of ['low', 'mid', 'high', 'auto']) { await page.locator('select[data-perf="quality"]').selectOption(q); await page.waitForTimeout(400); }
  await page.locator('select[data-perf="fpscap"]').selectOption('30'); await page.waitForTimeout(1200);
  await page.locator('select[data-perf="fpscap"]').selectOption('60'); await page.waitForTimeout(800);
  ok(problems.length === 0, `[${style}] no console problems with HUD + quality + cap changes: ${problems.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nall ${total} checks passed`);
process.exit(failed ? 1 : 0);
