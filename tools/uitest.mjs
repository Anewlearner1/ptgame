// UI / render robustness regression: resize refit, panel-beside-lot fit at small sizes, DPR 2, hotkeys with modals open/closed, focus ring.
// Usage: node tools/uitest.mjs [--url http://localhost:8201/index.html]   (server in repo root). Exit 1 on failure / console problems.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8201/index.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

async function open(w, h, dpr = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto(url); await page.waitForTimeout(1000);
  await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); __game.bus.emit('speed:set', { speed: 0 }); });
  await page.waitForTimeout(200);
  return { page, ctx, problems };
}
const geo = (page) => page.evaluate(() => {
  const { state, ui } = __game, l = state.lot, c = ui.cam, cv = document.getElementById('game').getBoundingClientRect();
  const pts = [[l.x0, l.y0], [l.x0 + l.w, l.y0], [l.x0, l.y0 + l.h], [l.x0 + l.w, l.y0 + l.h]].map(([gx, gy]) => ({ x: cv.left + c.x + (gx - gy) * 32 * c.zoom, y: cv.top + c.y + (gx + gy) * 16 * c.zoom }));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pe = document.getElementById('panel'), pr = pe.hidden ? null : pe.getBoundingClientRect();
  return { zoom: c.zoom, l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), panelRight: pr ? pr.right : 0, panelLeft: pr ? pr.left : 0, W: innerWidth, H: innerHeight, cvW: cv.width, cvH: cv.height };
});
// panel on the left (desktop layout) or a right-side drawer (short landscape / phone layout, panel.left > W/2)
const drawerRight = (g) => g.panelRight > 0 && g.panelLeft > g.W * 0.4;
const lotVisibleBesidePanel = (g) => (drawerRight(g) ? g.r <= g.panelLeft + 2 && g.l >= -2 : g.l >= g.panelRight - 2 && g.r <= g.W + 2) && g.t >= 0 && g.b <= g.H + 2;

// ---- 1. resize refit
{
  const { page, problems } = await open(900, 500);
  await page.keyboard.press('b'); await page.waitForTimeout(700);
  let g = await geo(page);
  ok(lotVisibleBesidePanel(g), `900x500 build panel open: lot fully visible beside panel (${Math.round(g.l)}..${Math.round(g.r)} vs panel ${Math.round(g.panelRight)}, W ${g.W})`);
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(700);
  g = await geo(page);
  ok(lotVisibleBesidePanel(g) && g.zoom >= 1.0, `resize to 1920x1080 re-fits (zoom ${g.zoom}) beside open panel`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  g = await geo(page);
  ok(Math.abs((g.l + g.r) / 2 - g.W / 2) < g.W * 0.1 && g.zoom >= 1.0, 'panel closed: lot recentred at full size');
  await page.setViewportSize({ width: 800, height: 450 }); await page.waitForTimeout(600);
  g = await geo(page);
  ok(g.l >= 0 && g.r <= g.W && g.t >= 0 && g.b <= g.H, `800x450 closed: lot inside viewport (${Math.round(g.l)}..${Math.round(g.r)}x${Math.round(g.t)}..${Math.round(g.b)})`);
  await page.keyboard.press('b'); await page.waitForTimeout(700);
  g = await geo(page);
  ok(lotVisibleBesidePanel(g), `800x450 build panel open: lot visible beside panel (${Math.round(g.l)}..${Math.round(g.r)} vs panel ${Math.round(g.panelRight)})`);
  for (const k of ['o', 'c', 'v', 'p', 'y']) { await page.keyboard.press(k); await page.waitForTimeout(450); g = await geo(page); ok((drawerRight(g) ? g.panelLeft > g.W * 0.4 && g.l < g.panelLeft - 40 : g.panelRight < g.W * 0.75 && g.r > g.panelRight - 40), `800x450 panel ${k}: map still partly visible (panel right ${Math.round(g.panelRight)}/${g.W})`); }
  // manual camera is NOT re-fitted by a resize
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => { __game.ui.cam.zoom = 2; });
  await page.mouse.move(400, 250); await page.mouse.wheel(0, -100); await page.waitForTimeout(200);
  const z0 = (await geo(page)).zoom;
  await page.setViewportSize({ width: 1000, height: 600 }); await page.waitForTimeout(400);
  ok(Math.abs((await geo(page)).zoom - z0) < 0.01, 'hand-zoomed camera keeps its zoom on resize');
  ok(problems.length === 0, 'no console problems (resize) ' + problems.join(' | '));
}

// ---- 2. DPR 2 + tiny window layout
for (const [w, h, dpr] of [[1280, 720, 2], [800, 450, 2], [800, 450, 1]]) {
  const { page, problems } = await open(w, h, dpr);
  const r = await page.evaluate(() => {
    const cv = document.getElementById('game');
    const over = document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1;
    const vis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 && b.left >= -1 && b.top >= -1; };
    return { over, dpr: devicePixelRatio, cw: cv.width, ch: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight, topbar: vis('#topbar'), sidebar: vis('#sidebar'), speedbar: vis('#speedbar') };
  });
  ok(!r.over, `${w}x${h}@${dpr}: no page scrollbars`);
  ok(Math.abs(r.cw - r.cssW * r.dpr) <= 1 && Math.abs(r.ch - r.cssH * r.dpr) <= 1, `${w}x${h}@${dpr}: canvas backing store = css x dpr (${r.cw}x${r.ch})`);
  ok(r.topbar && r.sidebar && r.speedbar, `${w}x${h}@${dpr}: topbar/sidebar/speedbar inside viewport`);
  // pixels really drawn (not blank)
  const nonBlank = await page.evaluate(() => { const cv = document.getElementById('game'), g = cv.getContext('2d'); const d = g.getImageData(cv.width / 2 | 0, cv.height / 2 | 0, 8, 8).data; let s = 0; for (const v of d) s += v; return s > 0; });
  ok(nonBlank, `${w}x${h}@${dpr}: canvas has content`);
  ok(problems.length === 0, 'no console problems ' + problems.join(' | '));
  await page.context().close();
}

// ---- 3. hotkeys
{
  const { page, problems } = await open(1280, 720);
  const S = () => page.evaluate(() => ({ panel: __game.ui.panel, paused: __game.state.time.paused, speed: __game.state.time.speed, grid: __game.ui.showGrid, tool: __game.ui.tool.mode, rot: __game.ui.tool.rot, modal: !!document.querySelector('#modal-root .modal') }));
  const press = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(120); };
  const map = { b: 'build', o: 'operate', c: 'clinic', v: 'overview', p: 'map', y: 'system' };
  for (const [k, id] of Object.entries(map)) {
    await press(k); ok((await S()).panel === id, `key ${k.toUpperCase()} opens ${id}`);
    await press(k); ok((await S()).panel === null, `key ${k.toUpperCase()} again closes it`);
  }
  await press('1'); ok((await S()).speed === 1 && !(await S()).paused, 'key 1 = x1');
  await press('2'); ok((await S()).speed === 2, 'key 2 = x2');
  await press('3'); ok((await S()).speed === 3, 'key 3 = x3');
  await press(' '); ok((await S()).paused, 'space pauses'); await press(' '); ok(!(await S()).paused && (await S()).speed === 3, 'space resumes at previous speed');
  await press('g'); const g1 = (await S()).grid; await press('g'); ok((await S()).grid !== g1, 'G toggles grid');
  await press('b'); await page.click('#panel .tab:text-is("候診與景觀")').catch(() => {}); await page.waitForTimeout(100);
  await page.click('#panel .u-item[data-id="plant"]').catch(() => {}); await page.waitForTimeout(100);
  ok((await S()).tool === 'place', 'picked plant tool'); const r0 = (await S()).rot; await press('r'); ok((await S()).rot !== r0, 'R rotates the placing tool');
  await press('Escape'); ok((await S()).tool === 'none', 'Esc cancels tool'); await press('Escape'); ok((await S()).panel === null, 'Esc closes panel');
  // modal open: hotkeys must not leak to the game
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await press('?'); ok((await S()).modal, 'help modal opens with ?');
  const before = await S();
  for (const k of ['b', 'o', 'g', '1', '2', '3', 'r']) await press(k);
  const after = await S();
  ok(after.panel === before.panel && after.speed === before.speed && after.grid === before.grid && after.paused === before.paused, 'hotkeys ignored while a modal is open');
  await press(' '); ok((await S()).paused === before.paused, 'space ignored while a modal is open');
  await press('Escape'); ok(!(await S()).modal, 'Esc closes the modal');
  await press('b'); ok((await S()).panel === 'build', 'hotkeys work again after the modal closes');
  ok(problems.length === 0, 'no console problems (hotkeys) ' + problems.join(' | '));
}

// ---- 4. keyboard focus ring
{
  const { page } = await open(1280, 720);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const f = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, cls: e.className, outline: cs.outlineStyle + ' ' + cs.outlineWidth, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; });
  ok(f.tag === 'BUTTON' && f.ring, `Tab focuses a button with a visible outline (${f.tag}.${f.cls} ${f.outline})`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!__game.ui.panel), 'Enter activates the focused sidebar button');
}
await browser.close();
console.log(failed ? `FAILED (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
