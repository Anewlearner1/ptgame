// Concept-style interface chrome (html.style-concept, css/*.css §concept) regression + screenshot tool.
//   python3 -m http.server 8212 &  node tools/stylecss.mjs                       run the assertions
//   node tools/stylecss.mjs --shots <dir> [--styles classic,new] [--vp 390x844,1280x720] [--nocanvas]
//        screenshot every panel / tab / modal / selection card / build tray / toast / tooltip / menu into <dir>
//        (names: <WxH>-<style>-<scene>.png). --nocanvas hides the map canvas so UI-only pixel diffs are stable.
// The sim is frozen at boot (speed 0) and Math.random is seeded, so two runs of the same style produce the same UI pixels.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);
const URL_ = arg('url', 'http://localhost:8212/index.html');
const SHOTS = arg('shots', '');
const STYLES = (arg('styles', 'classic,new')).split(',');
const NOCANVAS = has('nocanvas');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ALL_VP = [[390, 844, true], [360, 740, true], [844, 390, true], [1280, 720, false]];
const VPS = arg('vp', '') ? arg('vp').split(',').map(s => ALL_VP.find(v => `${v[0]}x${v[1]}` === s)).filter(Boolean) : ALL_VP;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { failed++; console.log('FAIL', m); } else if (process.env.VERBOSE) console.log('ok  ', m); };

// ------------------------------------------------------------------------------------------------ page factory
async function open(w, h, touch, style, { dpr = 1, init = true, tutorial = false } = {}) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: UA }
    : { viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  if (init) {
    await page.addInitScript(([st, nc]) => {
      try { if (!sessionStorage.getItem('sc-init')) { sessionStorage.setItem('sc-init', '1'); localStorage.clear(); if (st === 'classic') localStorage.setItem('restgame.art', 'classic'); } } catch (e) { /* ignore */ }
      // deterministic UI: seeded Math.random, sim frozen the moment the game object exists
      let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      let g; Object.defineProperty(window, '__game', { configurable: true, get() { return g; }, set(v) { g = v; try { v.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } } });
      if (nc) document.addEventListener('DOMContentLoaded', () => { const el = document.createElement('style'); el.textContent = '#game{visibility:hidden !important}'; document.head.appendChild(el); });
    }, [style, NOCANVAS]);
  }
  await page.goto(URL_); await page.waitForTimeout(1500);
  if (!tutorial) await page.evaluate(() => { document.querySelector('#modal-root .modal-actions .btn')?.click(); });
  await page.evaluate(() => { try { __game.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } });
  await page.waitForTimeout(250);
  return { page, ctx, problems };
}
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const closeModals = p => p.evaluate(() => { for (let i = 0; i < 8; i++) { const b = document.querySelector('.modal .modal-actions .btn:not(.primary), .modal .modal-actions .btn'); if (!b) break; b.click(); } });
const press = async (p, k) => { await p.keyboard.press(k); await wait(p, 420); };
const sel = (p, type, id) => p.evaluate(([t, i]) => { __game.ui.selected = { type: t, id: i }; __game.bus.emit('select:changed', { selected: __game.ui.selected }); }, [type, id]);
const unsel = p => p.evaluate(() => { __game.ui.selected = null; __game.bus.emit('select:changed', { selected: null }); });
const PANELS = [['b', 'build'], ['o', 'operate'], ['c', 'clinic'], ['v', 'overview'], ['p', 'map'], ['y', 'system']];

// ------------------------------------------------------------------------------------------------ audits
const overflowX = page => page.evaluate(() => {
  const bad = [], vw = innerWidth;
  if (document.documentElement.scrollWidth > vw + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + vw);
  if (document.body.scrollWidth > vw + 1) bad.push('body scrolls horizontally');
  for (const s of ['#topbar', '#sidebar', '#speedbar', '#panel', '.modal', '.modal-body', '.u-selcard', '#toast-layer', '.u-ctx']) {
    const e = document.querySelector(s);
    if (!e || e.hidden || !e.getBoundingClientRect().width) continue;
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible') bad.push(s + ' content ' + e.scrollWidth + '>' + e.clientWidth);
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) bad.push(s + ' outside viewport [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
  }
  return bad;
});
const tapAudit = page => page.evaluate(() => {
  const out = [], vw = innerWidth, vh = innerHeight;
  const vis = e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const root of document.querySelectorAll('#topbar, #sidebar, #speedbar, #panel, .modal, .u-selcard:not([hidden]), .u-ctx:not([hidden])')) {
    if (root.hidden || !vis(root)) continue;
    for (const e of root.querySelectorAll('button, [role="button"], select, .tab, input[type="range"], summary')) {
      if (!vis(e)) continue;
      const b = e.getBoundingClientRect();
      if (b.right < 0 || b.bottom < 0 || b.left > vw || b.top > vh) continue;
      const at = document.elementFromPoint(Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), Math.min(vh - 1, Math.max(0, b.top + b.height / 2)));
      if (!at || !(e === at || e.contains(at))) continue;
      if (e.classList.contains('card') && !e.matches('button')) continue;
      if (b.width < 39.5 || b.height < 39.5) out.push(`${Math.round(b.width)}x${Math.round(b.height)} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.textContent || '').trim().slice(0, 10)}"`);
    }
  }
  return out;
});
// WCAG contrast of text against its nearest opaque background (approximation good enough for flat chrome)
const contrastAudit = (page, scopes) => page.evaluate(sc => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = e => { let c = { r: 255, g: 255, b: 255 }; const chain = []; for (let p = e; p; p = p.parentElement) chain.push(p); for (const p of chain.reverse()) { const cs = parseCol(getComputedStyle(p).backgroundColor); if (cs && cs.a > 0) c = { r: c.r * (1 - cs.a) + cs.r * cs.a, g: c.g * (1 - cs.a) + cs.g * cs.a, b: c.b * (1 - cs.a) + cs.b * cs.a }; if (getComputedStyle(p).backgroundImage !== 'none') return null; } return c; };
  const parseCol = parse;
  const bad = [];
  for (const root of document.querySelectorAll(sc)) {
    if (root.hidden || !root.getBoundingClientRect().width) continue;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      let direct = ''; for (const n of e.childNodes) if (n.nodeType === 3) direct += n.textContent;
      if (!direct.trim()) continue;
      const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
      if (!b.width || cs.visibility === 'hidden' || +cs.opacity < 0.9 || e.closest('[disabled], .locked, .u-locked, .u-dim, .u-glyph, .u-tray-glyph')) continue;   // build-tile pictographs are icons, not text
      const fg = parse(cs.color), bg = bgOf(e);
      if (!fg || !bg) continue;
      const l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const fs = parseFloat(cs.fontSize), big = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (big ? 3 : 4.5)) bad.push(`${ratio.toFixed(2)} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${direct.trim().slice(0, 12)}" ${cs.color}/${bg.r | 0},${bg.g | 0},${bg.b | 0}`);
    }
  }
  return bad;
}, scopes);

// ------------------------------------------------------------------------------------------------ scenes
// Walks every surface of the UI; `shot(name)` is called at each one. Returns nothing; audits are done through `visit`.
async function scenes(page, { shot, visit }) {
  const info = await page.evaluate(() => ({ st: __game.state.staff.map(s => s.id), objs: __game.state.objects.map(o => ({ id: o.id, d: o.defId, x: o.x, y: o.y })) }));
  await shot('base'); await visit('base');
  // tooltips / popover / hover
  const mobile = await page.evaluate(() => document.documentElement.classList.contains('lay-mobile'));
  if (!mobile) {
    await page.hover('.tb-money'); await wait(page, 450); await shot('tooltip'); await page.mouse.move(5, 300); await wait(page, 150);
  }
  if (await page.evaluate(() => document.documentElement.classList.contains('lay-compact'))) {
    await page.click('.tb-stats'); await wait(page, 300); await shot('stats-popover'); await visit('stats-popover'); await page.click('.tb-stats'); await wait(page, 150);
  }
  // toasts
  await page.evaluate(() => { const b = __game.bus; b.emit('toast', { text: '已存入「存檔 1」', kind: 'good' }); b.emit('toast', { text: '資金不足，無法建造', kind: 'bad' }); b.emit('toast', { text: '新的一週開始了', kind: 'info' }); });
  await wait(page, 380); await shot('toasts'); await visit('toasts'); await wait(page, 3300);
  // selection card
  await sel(page, 'staff', info.st[0]); await wait(page, 450); await shot('sel-staff'); await visit('sel-staff');
  const tens = info.objs.find(o => o.d === 'fryer') || info.objs[0];
  await sel(page, 'object', tens.id); await wait(page, 450); await shot('sel-object'); await visit('sel-object');
  // context menu
  await page.evaluate(o => { __game.bus.emit('object:context', { id: o.id, x: innerWidth / 2, y: innerHeight / 2 }); }, tens); await wait(page, 300); await shot('ctxmenu'); await visit('ctxmenu');
  await page.keyboard.press('Escape'); await unsel(page); await wait(page, 200);
  // panels
  for (const [key, id] of PANELS) {
    await press(page, key);
    if (!(await page.evaluate(() => !document.getElementById('panel').hidden))) { ok(false, `panel ${id} did not open`); continue; }
    await shot(`panel-${id}`); await visit(`panel-${id}`);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#panel .u-tabbed > .tabs > .tab')].map(t => t.textContent));
    for (let ti = 0; ti < tabs.length; ti++) {
      await page.evaluate(i => document.querySelectorAll('#panel .u-tabbed > .tabs > .tab')[i].click(), ti); await wait(page, 300);
      await shot(`panel-${id}-t${ti}`); await visit(`panel-${id}-t${ti}`);
      const subs = await page.evaluate(() => document.querySelectorAll('#panel .tabs.u-subtabs .tab').length);
      for (let si = 1; si < subs; si++) {
        await page.evaluate(i => document.querySelectorAll('#panel .tabs.u-subtabs .tab')[i].click(), si); await wait(page, 250);
        await shot(`panel-${id}-t${ti}-s${si}`); await visit(`panel-${id}-t${ti}-s${si}`);
      }
      if (subs > 1) await page.evaluate(() => document.querySelectorAll('#panel .tabs.u-subtabs .tab')[0].click());
    }
    if (id === 'build') {
      await page.evaluate(() => document.querySelectorAll('#panel .u-tabbed > .tabs > .tab')[0].click()); await wait(page, 250);
      await page.evaluate(() => document.querySelector('#panel .u-item[data-id="table2"], #panel .u-item[data-id="fryer"], #panel .u-item')?.click()); await wait(page, 450);
      await shot('build-armed'); await visit('build-armed');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(page, 250);
    }
    if (id === 'system') {   // settings tab: art-style switch + install section
      await page.evaluate(() => { const a = document.querySelector('.u-artswitch'); if (a) a.scrollIntoView(); }); await wait(page, 250); await shot('panel-system-switch');
    }
    if (await page.evaluate(() => !document.getElementById('panel').hidden)) await press(page, key);
    if (await page.evaluate(() => !document.getElementById('panel').hidden)) { await page.keyboard.press('Escape'); await wait(page, 250); }
  }
  // modals
  const modal = async (name, fn) => { await fn(); await wait(page, 500); await shot(name); await visit(name, true); await closeModals(page); await wait(page, 250); };
  await modal('modal-help', () => press(page, '?'));
  await modal('modal-confirm', () => page.evaluate(async () => { const m = await import('/js/ui/modal.js'); m.confirmDialog({ title: '出售設備', text: '確定拆除「電療機」？將退回約 NT$ 4,000。', okLabel: '拆除', danger: true }); }));
  await modal('modal-report', () => page.evaluate(() => __game.bus.emit('month:settled', { year: 1, month: 3, points: 1200, cap: 9000, pointValue: 1, nhiIncome: 1200, income: 5000, expense: 4000, net: 1000 })));
  await modal('modal-inspection', () => page.evaluate(() => __game.bus.emit('inspection:result', { pass: true, score: 80, notes: ['環境整潔', '病歷完整'] })));
  await modal('modal-event', async () => {
    await page.evaluate(async () => { const { DILEMMAS } = await import('/js/data/events.js'); __game.state.events.pendingDilemma = DILEMMAS[0]; __game.bus.emit('dilemma:show', { dilemma: DILEMMAS[0] }); });
  });
  await page.evaluate(() => { __game.state.events.pendingDilemma = null; });
  await page.evaluate(async () => { const { showTutorial } = await import('/js/ui/modals.js'); showTutorial(true); });
  await wait(page, 500); await shot('modal-tutorial'); await visit('modal-tutorial', true);
  await page.evaluate(() => document.querySelector('.modal .modal-actions .btn:nth-child(3)')?.click()); await wait(page, 200); await closeModals(page); await wait(page, 200);
}

// ------------------------------------------------------------------------------------------------ mode 1: screenshots
if (SHOTS) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, touch] of VPS) for (const style of STYLES) {
    const tag = `${w}x${h}-${style}`;
    const { page, ctx, problems } = await open(w, h, touch, style, { dpr: +arg('dpr', 1), tutorial: true });
    await page.screenshot({ path: `${SHOTS}/${tag}-tutorial.png` });
    await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click()); await wait(page, 300);
    await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
    await scenes(page, { shot: n => page.screenshot({ path: `${SHOTS}/${tag}-${n}.png` }), visit: async () => {} });
    console.log(tag, 'done', problems.length ? 'PROBLEMS ' + problems.join(' | ') : '');
    await ctx.close();
  }
  await browser.close();
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ mode 2: assertions
const htmlCls = page => page.evaluate(() => document.documentElement.className);
const css = (page, sel, prop) => page.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
const theme = page => page.evaluate(() => document.querySelector('meta[name=theme-color]')?.content);

// ---- A. activation: default = concept, classic after switching, persists across reload, no class flash before first paint
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  // class must exist before the module scripts run (= before first paint)
  await page.addInitScript(() => { window.__earlyCls = null; document.addEventListener('DOMContentLoaded', () => { window.__earlyCls = document.documentElement.className; }); });
  await page.goto(URL_); await page.waitForTimeout(1400);
  ok(/\bstyle-concept\b/.test(await htmlCls(page)), 'default: html.style-concept present');
  ok(/\bstyle-concept\b/.test(await page.evaluate(() => window.__earlyCls || '')), 'class set before DOMContentLoaded (first paint)');
  ok(/lay-(desktop|portrait|compact)/.test(await htmlCls(page)), 'layout classes still present alongside style-concept');
  ok((await theme(page)) === '#1e365a', `theme-color meta navy in concept (${await theme(page)})`);
  const tbN = { bg: await css(page, '#topbar', 'backgroundColor'), img: await css(page, '#topbar', 'backgroundImage') };
  ok(tbN.bg === 'rgb(30, 54, 90)' && tbN.img === 'none', `concept topbar background navy (${tbN.bg} ${tbN.img})`);
  ok(await css(page, 'body', 'backgroundColor') === 'rgb(30, 54, 90)', 'concept body/page background navy');
  await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click());
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await page.keyboard.press('y'); await wait(page, 400);
  await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].find(t => /設定/.test(t.textContent))?.click()); await wait(page, 300);
  ok(await page.evaluate(() => !!document.querySelector('.u-artbtn[data-art="classic"]')), 'settings has the style switch');
  const panelBandN = await css(page, '#panel .panel-title', 'backgroundColor');
  await page.click('.u-artbtn[data-art="classic"]'); await wait(page, 400);
  ok(!/\bstyle-concept\b/.test(await htmlCls(page)), 'switch to classic removes html.style-concept (live)');
  ok((await theme(page)) === '#7a2a1c', `theme-color meta back to the classic red in classic (${await theme(page)})`);
  const tbC = { bg: await css(page, '#topbar', 'backgroundColor'), img: await css(page, '#topbar', 'backgroundImage') };
  ok(/gradient/.test(tbC.img) && tbC.bg !== tbN.bg, `classic topbar keeps the old classic gradient (${tbC.img.slice(0, 40)})`);
  ok(await css(page, 'body', 'backgroundColor') === 'rgb(38, 70, 83)', 'classic body background unchanged (#264653)');
  ok((await css(page, '#panel .panel-title', 'backgroundColor')) !== panelBandN, 'panel title colours differ between styles');
  ok(await page.evaluate(() => localStorage.getItem('restgame.art')) === 'classic', 'classic persisted');
  await page.reload(); await page.waitForTimeout(1400);
  ok(!/\bstyle-concept\b/.test(await htmlCls(page)), 'after reload: still classic (no style-concept)');
  ok((await theme(page)) === '#7a2a1c', 'after reload: classic theme-color');
  await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click());
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await page.keyboard.press('y'); await wait(page, 400);
  await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].find(t => /設定/.test(t.textContent))?.click()); await wait(page, 300);
  await page.click('.u-artbtn[data-art="new"]'); await wait(page, 400);
  ok(/\bstyle-concept\b/.test(await htmlCls(page)), 'switch back to new re-applies html.style-concept (live)');
  ok((await theme(page)) === '#1e365a', 'theme-color navy again');
  await page.reload(); await page.waitForTimeout(1400);
  ok(/\bstyle-concept\b/.test(await htmlCls(page)), 'after reload: concept persists');
  ok(problems.length === 0, 'no console problems (activation) ' + problems.join(' | '));
  await ctx.close();
}

// ---- B. every surface, both styles, four viewports: no errors, no horizontal overflow, tap targets, contrast (concept)
for (const style of STYLES) for (const [w, h, touch] of VPS) {
  const tag = `${w}x${h} ${style}`;
  const { page, ctx, problems } = await open(w, h, touch, style, { dpr: 1, tutorial: true });
  ok(/\bstyle-concept\b/.test(await htmlCls(page)) === (style === 'new'), `${tag}: html class matches style`);
  ok(/\btouch\b/.test(await htmlCls(page)) === touch, `${tag}: touch class matches the pointer type`);
  const bad = { of: [], tap: [], con: [] };
  const visit = async (name, modal) => {
    const o = await overflowX(page); if (o.length) bad.of.push(name + ': ' + o.join(','));
    if (touch) { const t = await tapAudit(page); if (t.length) bad.tap.push(name + ': ' + t.slice(0, 3).join(' ; ')); }
    if (style === 'new') { const c = await contrastAudit(page, '#topbar, #sidebar, #speedbar, #panel, .modal, .u-selcard:not([hidden]), .toast, .u-ctx:not([hidden]), #tooltip:not([hidden])'); if (c.length) bad.con.push(name + ': ' + c.slice(0, 3).join(' ; ')); }
  };
  await visit('tutorial', true);
  await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click()); await wait(page, 300);
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await scenes(page, { shot: async () => {}, visit });
  ok(bad.of.length === 0, `${tag}: no horizontal overflow on any surface ${bad.of.slice(0, 4).join(' | ')}`);
  if (touch) ok(bad.tap.length === 0, `${tag}: tap targets >= 40px ${bad.tap.slice(0, 4).join(' | ')}`);
  if (style === 'new') ok(bad.con.length === 0, `${tag}: text contrast >= AA ${bad.con.slice(0, 5).join(' | ')}`);
  ok(problems.length === 0, `${tag}: no console problems ` + problems.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`${total - failed}/${total} checks passed`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
