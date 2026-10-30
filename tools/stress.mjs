// Stress / chaos regression. Server must run: `python3 -m http.server 8201` (or pass --url) in the repo root.
// Usage: node tools/stress.mjs <mode> [--minutes N] [--target N] [--seed N] [--url ...]
//   load   100+ simultaneous patients on a big L3 lot at x3: stuck-agent detector, fps / JS ms per frame, heap trend
//   chaos  every ~2 s random demolish/place/rotate/hire/fire/save/load/speed/panel actions at x3, consistency checker
//   rest   sustained load drains staff stamina: confirms walk-to-rest_room / recover / return, 'tired' bubble, no-rest_room case
// Exit code 1 on console errors/warnings, NaN positions, stuck agents (> 2 real min), consistency violations.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const mode = process.argv[2] || 'load';
const url = arg('url', 'http://localhost:8201/index.html');
const minutes = parseFloat(arg('minutes', mode === 'load' ? '3' : '2'));
const target = +arg('target', 100);
const W = +arg('w', 1280), H = +arg('h', 720);
const here = path.dirname(fileURLToPath(import.meta.url));

export async function boot({ w = W, h = H, dpr = 1 } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  // fresh shop every run (no autosave from earlier runs)
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  await page.addScriptTag({ path: path.join(here, 'stress-page.js') });
  await page.evaluate(() => window.__st.init());
  await page.evaluate(() => { window.__st.left = {}; window.__game.bus.on('patient:left', ({ patient }) => { window.__st.left[patient.reason] = (window.__st.left[patient.reason] || 0) + 1; if (patient.reason === 'timeout') (window.__st.timeouts ||= []).push(`${patient.type} plan=${patient.plan.join('>')}@${patient.planIdx} treated=${patient.treated}`); }); });
  return { browser, page, problems };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// sleep while auto-answering game modals (dilemmas / month reports) every 600 ms so the sim never stays frozen
let _page = null;
const nap = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await sleep(Math.min(600, end - Date.now())); if (_page) await dismiss(_page); } };
// dismiss any modal the game raised (settlement, events, dilemmas...) so the sim keeps running
const dismiss = (page) => page.evaluate(() => {
  for (let i = 0; i < 4; i++) {
    const m = document.querySelector('#modal-root .modal');
    if (!m) return;
    const b = m.querySelector('.u-choice') || m.querySelector('.modal-actions:not([hidden]) .btn.primary') || m.querySelector('.modal-actions:not([hidden]) .btn');
    if (!b) return;
    b.click();
  }
}).catch(() => {});

let failed = 0;
const fail = (m) => { failed++; console.log('FAIL', m); };
const info = (m) => console.log('    ', m);

async function heapMB(page, cdp) {
  try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) { /* ignore */ }
  const r = await cdp.send('Runtime.getHeapUsage');
  return +(r.usedSize / 1048576).toFixed(1);
}

async function runLoad() {
  const { browser, page, problems } = await boot();
  _page = page;
  const cdp = await page.context().newCDPSession(page);
  const setup = await page.evaluate(() => { const r = window.__st.setup100(); window.__game.bus.emit('speed:set', { speed: 3 }); return r; });
  info('layout ' + JSON.stringify(setup));
  const stuckSeen = new Map();
  const t0 = Date.now();
  const marks = [];
  const heap0 = await heapMB(page, cdp);
  for (const tgt of [60, target]) {
    await page.evaluate((t) => window.__st.keepFull(t), tgt);
    await nap(8000);
    const stats = await page.evaluate(() => window.__st.stats());
    const fps = await page.evaluate(() => window.__st.fps(3000));
    const stats2 = await page.evaluate(() => window.__st.stats());
    info(`target ${tgt}: patients=${stats2.pat} staff=${stats2.staff} fps=${fps.toFixed(1)} jsMs avg=${stats2.avgMs} p95=${stats2.p95Ms} stages=${JSON.stringify(stats2.stages)}`);
    marks.push({ tgt, fps, ms: stats2.avgMs, pat: stats2.pat });
  }
  let n = 0;
  while (Date.now() - t0 < minutes * 60000) {
    await nap(4000);
    const r = await page.evaluate(() => ({ bad: window.__st.watch(), stuck: window.__st.stuck(120000, ['treating', 'registering', 'idle', 'resting', 'chatting', 'working']), s: window.__st.stats() }));
    for (const m of r.stuck) if (!stuckSeen.has(m.split(' ')[0])) { stuckSeen.set(m.split(' ')[0], m); fail('STUCK ' + m); }
    for (const m of r.bad) fail('INCONSISTENT ' + m);
    if (++n % 5 === 0) info(`t=${r.s.t} clk=${r.s.clk} pd=${r.s.pd} paused=${r.s.paused} pat=${r.s.pat} money=${r.s.money} rep=${r.s.rep} ms=${r.s.avgMs} heap=${await heapMB(page, cdp)}MB hist=${r.s.hist} evlog=${r.s.evlog}`);
  }
  const heap1 = await heapMB(page, cdp);
  info(`heap start ${heap0}MB end ${heap1}MB`);
  const st = await page.evaluate(() => ({ dbg: window.__st.P.debug, s: window.__st.stats() }));
  info('debug counters ' + JSON.stringify(st.dbg));
  info('left reasons ' + JSON.stringify(await page.evaluate(() => window.__st.left)) + ' timeouts ' + JSON.stringify(await page.evaluate(() => (window.__st.timeouts || []).slice(0, 6))));
  await page.evaluate(() => window.__st.stopFill());
  const uniq = [...new Set(problems)];
  if (uniq.length) { failed++; console.log('PROBLEMS:\n' + uniq.join('\n')); }
  await browser.close();
  return marks;
}

async function runChaos() {
  const { browser, page, problems } = await boot();
  _page = page;
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { window.__st.setupChaos(); window.__game.bus.emit('speed:set', { speed: 3 }); });
  await page.evaluate((t) => window.__st.keepFull(t), Math.min(target, 50));
  const left = new Map();
  const t0 = Date.now();
  let acts = 0, lastCheck = 0;
  const heap0 = await heapMB(page, cdp);
  while (Date.now() - t0 < minutes * 60000) {
    await dismiss(page);
    const kind = await page.evaluate(() => window.__st.chaosAct()).catch(e => { problems.push('chaos act threw: ' + e.message); return 'error'; });
    acts++;
    await sleep(1000 + Math.random() * 1500);
    if (Date.now() - lastCheck > 3000) {
      lastCheck = Date.now();
      const r = await page.evaluate(() => ({ bad: window.__st.watch(), stuck: window.__st.stuck(120000, ['treating', 'registering', 'idle', 'resting', 'chatting', 'working']), log: window.__st.log.slice(-12), s: window.__st.stats() })).catch(e => ({ err: e.message }));
      if (r.err) { fail('page eval failed ' + r.err); continue; }
      for (const m of r.bad) fail('INCONSISTENT ' + m + '\n       recent: ' + r.log.join(' | '));
      for (const m of r.stuck) fail('STUCK ' + m + '\n       recent: ' + r.log.join(' | '));
    }
  }
  const fin = await page.evaluate(() => ({ s: window.__st.stats(), left: window.__st.left, timeouts: (window.__st.timeouts || []).slice(0, 8), dbg: window.__st.P.debug }));
  info(`${acts} chaos actions; final ${JSON.stringify(fin.s)}`);
  info('left reasons ' + JSON.stringify(fin.left) + '  debug ' + JSON.stringify(fin.dbg));
  if (fin.timeouts.length) info('timeouts: ' + fin.timeouts.join(' ; '));
  info(`heap ${heap0}MB -> ${await heapMB(page, cdp)}MB`);
  const uniq = [...new Set(problems)];
  if (uniq.length) { failed++; console.log('PROBLEMS:\n' + uniq.join('\n')); }
  await browser.close();
}

async function runRest() {
  for (const withRest of (process.argv.includes("--only-rest") ? [true] : process.argv.includes("--only-norest") ? [false] : [true, false])) {
    console.log(`--- rest scenario: rest_room ${withRest ? 'present' : 'ABSENT'}`);
    const { browser, page, problems } = await boot();
    _page = page;
    await page.evaluate((w) => { window.__st.setupRest(w); window.__game.bus.emit('speed:set', { speed: 3 }); window.__st.keepFull(30, ['manual_nhi', 'manual_nhi', 'manual_nhi', 'manual_nhi']); }, withRest);
    const t0 = Date.now();
    const treated0 = await page.evaluate(() => window.__st.stats().pat);
    while (Date.now() - t0 < minutes * 60000) {
      await nap(4000);
      const r = await page.evaluate(() => ({ bad: window.__st.watch(), stuck: window.__st.stuck(120000, ['treating', 'registering', 'idle', 'resting', 'chatting', 'working']) }));
      for (const m of r.bad) fail('INCONSISTENT ' + m);
      for (const m of r.stuck) fail('STUCK ' + m);
    }
    const rep = await page.evaluate(() => ({ rep: window.__st.restReport(), s: window.__st.stats(), left: window.__st.left,
      staff: window.__game.state.staff.map(s => `${s.role}:${Math.round(100 * s.stamina / s.staminaMax)}%`) }));
    info('left ' + JSON.stringify(rep.left) + '  stamina now ' + rep.staff.join(' '));
    for (const [id, r] of Object.entries(rep.rep.staff)) info(`staff ${id} ${r.role}: minStamina=${r.minFrac} tiredTicks=${r.tiredFlag} maxSlowdown=x${r.maxFactor} headedToRest=${r.headedRest} arrived=${r.arrivedRest} recovered=${r.recovered} returnedToWork=${r.returned}`);
    info('tired bubbles seen ' + rep.rep.tiredBubble);
    const any = Object.values(rep.rep.staff);
    const dropped = any.filter(r => r.minFrac < 0.3);
    if (!dropped.length) fail('no staff dropped below 30% stamina (load too light)');
    if (withRest) {
      for (const r of dropped) if (!(r.arrivedRest > 0 && r.recovered > 0 && r.returned > 0)) fail(`staff ${r.role} dropped to ${r.minFrac} but rest cycle incomplete (${JSON.stringify(r)})`);
      if (!rep.rep.tiredBubble) fail("no 'tired' bubble shown");
      if (!any.some(r => r.maxFactor > 1.05)) fail('no tired slowdown observed');
    } else {
      if (any.some(r => r.arrivedRest)) fail('staff rested without a rest_room?!');
      if (!any.some(r => r.maxFactor > 1.05)) info('note: no slowdown observed without rest_room');
    }
    const uniq = [...new Set(problems)];
    if (uniq.length) { failed++; console.log('PROBLEMS:\n' + uniq.join('\n')); }
    await browser.close();
  }
}

if (mode === "load") await runLoad();
if (mode === "rest") await runRest();
if (mode === "chaos") await runChaos();
console.log(failed ? `FAILED (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
