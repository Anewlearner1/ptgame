// Sprite-atlas regression (S-L). Server must run: `python3 -m http.server 8201` in the repo root (or pass --url).
// Usage: node tools/arttest.mjs [--url http://localhost:8201/index.html] [--minutes 2] [--quick] [--shots <dir>]
// Asserts: atlas loads (artReady), classic/new toggle works + persists + swaps the sprites, atlas 404 (route abort) -> game
// still runs with no errors on the procedural art, the service worker caches the atlas, perf (60 agents) is not worse than
// classic, and 3 soak runs (new / classic / toggling every 8 s) of --minutes each (default 2) have no console problems.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8201/index.html');
const quick = process.argv.includes('--quick');
const minutes = quick ? 0.25 : parseFloat(arg('minutes', '2'));
const shotDir = arg('shots', '');
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());

async function open({ style, w = 1280, h = 720, dpr = 1, route404 = false, fresh = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, serviceWorkers: route404 ? 'block' : 'allow' });
  if (style) await ctx.addInitScript(([s, fresh]) => { try { if (fresh && !sessionStorage.getItem('arttest')) { localStorage.clear(); sessionStorage.setItem('arttest', '1'); } if (s) localStorage.setItem('ptgame.art', s); } catch (e) { /* ignore */ } }, [style, fresh]);
  if (route404) await ctx.route(/assets\/art\/atlas\.(png|json)/, r => r.abort());
  const page = await ctx.newPage();
  const problems = [];
  const expectedFail = route404 ? /atlas\.(png|json)|Failed to load resource|Service Worker registration blocked/ : null;
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !(expectedFail && expectedFail.test(m.text() + (m.location().url || '')))) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  if (!route404) {
    page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
    page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  }
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  return { ctx, page, problems };
}

const G = (page, fn, a) => page.evaluate(fn, a);
const clearModals = page => page.evaluate(() => document.querySelectorAll('#modal-root button').forEach(b => b.click()));

// ───────────── 1. loads + API shape ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(async () => (await import('./js/render/art.js')).artReady(), null, { timeout: 8000 }).catch(() => {});
  const r = await G(page, async () => {
    const A = await import('./js/render/art.js');
    const rect = A.artRect('staff.doctor'), cv = A.artCanvas('patient.elder.stand');
    return { ready: A.artReady(), en: A.artEnabled(), rect, cw: cv && cv.width, ch: cv && cv.height, nil: A.artRect('nope.nope'), url: A.artUrl(), load: await A.loadArt(), load2: await A.loadArt() };
  });
  ok(r.ready && r.en, 'artReady() true after load (default style new)');
  ok(r.rect && r.rect.w > 50 && r.rect.facing === 'front' && r.rect.heightPx === 166 && r.rect.ax >= 0, 'artRect(staff.doctor) = {x,y,w,h,ax,ay,facing,heightPx}');
  ok(r.cw === 59 && r.ch === 113, `artCanvas native size (${r.cw}x${r.ch})`);
  ok(r.nil === null, 'unknown sprite -> null');
  ok(/\/assets\/art\/atlas\.png$/.test(r.url) && r.load === true && r.load2 === true, 'artUrl() absolute, loadArt() idempotent -> true');
  // the renderer really draws the atlas: art object sprite + a person
  const used = await G(page, async () => {
    const S = await import('./js/render/sprites.js');
    return { bed: !!S.getObjectSprite('bed', 0).art, bedRot: !!S.getObjectSprite('bed', 1).art, heat: !!S.getObjectSprite('heatbox', 0).art && !S.getObjectSprite('heatbox', 0).cobj };
  });
  ok(used.bed && used.bedRot && !used.heat, 'bed uses atlas art (both rotations), heatbox is not an atlas sprite (concept-style procedural)');
  ok(problems.length === 0, 'no console problems at load' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 2. toggle + persistence ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(async () => (await import('./js/render/art.js')).artReady(), null, { timeout: 8000 }).catch(() => {});
  const t = await G(page, async () => {
    const A = await import('./js/render/art.js'), S = await import('./js/render/sprites.js');
    const bus = window.__game.bus; const ev = []; bus.on('art:changed', e => ev.push(e));
    const out = {};
    A.setArtEnabled(false);
    out.off = { ready: A.artReady(), en: A.artEnabled(), ls: localStorage.getItem('ptgame.art'), rect: A.artRect('staff.doctor'), cv: A.artCanvas('staff.doctor'), bedArt: !!S.getObjectSprite('bed', 0).art };
    await new Promise(r => setTimeout(r, 300));
    out.recsClassic = true;
    A.setArtEnabled(true);
    out.on = { ready: A.artReady(), en: A.artEnabled(), ls: localStorage.getItem('ptgame.art'), bedArt: !!S.getObjectSprite('bed', 0).art };
    out.ev = ev.map(e => e.enabled);
    A.setArtEnabled(false);
    return out;
  });
  ok(!t.off.ready && !t.off.en && t.off.ls === 'classic' && t.off.rect === null && t.off.cv === null && !t.off.bedArt, 'setArtEnabled(false): classic, persisted, sprites procedural');
  ok(t.on.ready && t.on.en && t.on.ls === 'new' && t.on.bedArt, 'setArtEnabled(true): new, persisted, atlas sprites');
  ok(JSON.stringify(t.ev) === '[false,true]', 'bus art:changed emitted on each toggle ' + JSON.stringify(t.ev));
  await page.reload();
  await page.waitForTimeout(1500);
  const persisted = await G(page, async () => { const A = await import('./js/render/art.js'); return { en: A.artEnabled(), ready: A.artReady(), ls: localStorage.getItem('ptgame.art') }; });
  ok(!persisted.en && !persisted.ready && persisted.ls === 'classic', 'classic choice survives a reload');
  // the frame keeps rendering after a live toggle (classic -> new): objects and layer are rebuilt
  await G(page, async () => { (await import('./js/render/art.js')).setArtEnabled(true); });
  await page.waitForTimeout(600);
  const px = await G(page, () => { const c = document.getElementById('game'); const g = c.getContext('2d'); const d = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3]; });
  ok(px === 255, 'canvas still painting after live toggle');
  ok(problems.length === 0, 'no console problems while toggling' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 3. atlas missing ─────────────
{
  const { ctx, page, problems } = await open({ route404: true });
  await page.waitForTimeout(1500);
  const r = await G(page, async () => {
    const A = await import('./js/render/art.js'), S = await import('./js/render/sprites.js');
    const t0 = window.__game.state.time.clock;
    window.__game.bus.emit('speed:set', { speed: 3 });
    await new Promise(r => setTimeout(r, 2500));
    return { ready: A.artReady(), load: await A.loadArt(), bedArt: !!S.getObjectSprite('bed', 0).art && !S.getObjectSprite('bed', 0).cobj, adv: window.__game.state.time.clock !== t0 || window.__game.state.time.day !== undefined };
  });
  ok(!r.ready && r.load === false && !r.bedArt, 'atlas aborted -> artReady false, loadArt() resolves false, procedural sprites');
  const painted = await G(page, () => { const c = document.getElementById('game'); const g = c.getContext('2d'); return g.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]; });
  ok(painted === 255, 'game still renders without the atlas');
  ok(problems.length === 0, 'no console errors with the atlas missing' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 4. service worker caches the atlas ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(1500);
  const c = await G(page, async () => {
    const keys = await caches.keys();
    const hits = {};
    for (const k of keys) { const cache = await caches.open(k); for (const f of ['assets/art/atlas.png', 'assets/art/atlas.json']) if (await cache.match(f)) hits[f] = true; }
    return { keys, hits };
  });
  ok(c.hits['assets/art/atlas.png'] && c.hits['assets/art/atlas.json'], 'sw.js cache holds atlas.png + atlas.json ' + JSON.stringify(c.keys));
  // offline: reload with the network cut -> game boots from the cache, art still loads
  await ctx.setOffline(true);
  await page.reload().catch(() => {});
  await page.waitForTimeout(2000);
  const off = await G(page, async () => { const A = await import('./js/render/art.js'); return { ready: await A.loadArt() && A.artReady() }; }).catch(() => ({ ready: false }));
  ok(off.ready, 'offline reload: atlas served from the service-worker cache');
  await ctx.setOffline(false);
  await ctx.close();
}

// ───────────── 5. perf: 60 agents ─────────────
async function perf(style, dpr) {
  const { ctx, page } = await open({ style, dpr, w: dpr > 1 ? 390 : 1280, h: dpr > 1 ? 844 : 720 });
  await G(page, async () => {
    const g = window.__game, P = await import('./js/sim/patients.js');
    g.state.money = 5e7; for (let i = 0; i < 64; i++) P.spawnPatient(g.state, ['elder', 'office', 'kid', 'sports'][i % 4]);
    g.bus.emit('speed:set', { speed: 3 });
  });
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); await clearModals(page); }
  const r = await G(page, async () => {
    const g = window.__game, R = await import('./js/render/renderer.js');
    g.bus.emit('speed:set', { speed: 0 });
    const n = g.state.patients.filter(p => p.stage !== 'gone').length + g.state.staff.length;
    for (let i = 0; i < 20; i++) R.render(g.state, g.ui, 1000 + i * 16);
    const t0 = performance.now(); for (let i = 0; i < 150; i++) R.render(g.state, g.ui, 5000 + i * 16);
    const ms = (performance.now() - t0) / 150;
    g.bus.emit('speed:set', { speed: 3 });
    const fps = await new Promise(rs => { let c = 0; const t = performance.now(); const f = () => { c++; performance.now() - t < 2500 ? requestAnimationFrame(f) : rs(c / 2.5); }; requestAnimationFrame(f); });
    return { n, ms, fps };
  });
  await ctx.close();
  return r;
}
{
  const c = await perf('classic', 1), n = await perf('new', 1);
  console.log(`perf desktop: classic ${c.ms.toFixed(2)} ms/frame (${c.fps.toFixed(0)} fps, ${c.n} agents) | new ${n.ms.toFixed(2)} ms/frame (${n.fps.toFixed(0)} fps, ${n.n} agents)`);
  ok(n.n >= 40, `perf scene has ${n.n} agents`);
  ok(n.ms < Math.max(8, c.ms * 1.6), 'new art render cost within budget vs classic');
  ok(n.fps >= Math.min(55, c.fps - 3), 'new art fps >= classic - 3 (cap 55)');
}

// ───────────── 6. soak: 3 runs, both styles ─────────────
async function soak(label, style, toggle) {
  const { ctx, page, problems } = await open({ style });
  await G(page, () => window.__game.bus.emit('speed:set', { speed: 3 }));
  const t0 = Date.now(); let n = 0, maxAgents = 0;
  while (Date.now() - t0 < minutes * 60000) {
    await page.waitForTimeout(2000);
    n++;
    const r = await G(page, async ([tog, n]) => {
      document.querySelectorAll('#modal-root button').forEach((b, i) => { if (i === 0) b.click(); });
      const g = window.__game, P = await import('./js/sim/patients.js'), A = await import('./js/render/art.js');
      g.state.money = Math.max(g.state.money, 1e6);
      if (g.state.patients.length < 40) P.spawnPatient(g.state, ['elder', 'office', 'kid', 'sports'][n % 4]);
      if (tog && n % 4 === 0) A.setArtEnabled(!A.artEnabled());
      if (n % 7 === 0) { const c = g.ui.cam; c.zoom = [0.5, 1, 1.6, 2.5, 0.8][(n / 7 | 0) % 5]; }
      return g.state.patients.length + g.state.staff.length;
    }, [toggle, n]);
    maxAgents = Math.max(maxAgents, r);
  }
  if (shotDir) await page.screenshot({ path: `${shotDir}/arttest_${label}.png` });
  ok(problems.length === 0, `soak ${label} (${minutes} min, <= ${maxAgents} agents): no console problems` + (problems.length ? ': ' + [...new Set(problems)].join(' | ') : ''));
  await ctx.close();
}
await soak('new', 'new', false);
await soak('classic', 'classic', false);
await soak('toggling', 'new', true);

await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
