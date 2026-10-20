// Touch emulation helpers for Playwright (chromium + CDP Input.dispatchTouchEvent). Global Playwright only.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Open the game in a mobile-emulated context. Returns {browser, ctx, page, problems, cdp, touch}.
export async function launchMobile({ w = 390, h = 844, dpr = 3, url = 'http://localhost:8205/index.html', dismissTutorial = true, ua = IPHONE_UA } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: ua });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.goto(url);
  await page.waitForTimeout(1200);
  if (dismissTutorial) await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  const cdp = await ctx.newCDPSession(page);
  return { browser, ctx, page, problems, cdp, touch: touchApi(page, cdp) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Multi-finger touch driver. Points are page (CSS viewport) coords. ids are stable finger ids.
export function touchApi(page, cdp) {
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 4, radiusY: 4, force: 0.5 })) });
  const api = {
    send,
    async down(...pts) { await send('touchStart', pts); },
    async move(...pts) { await send('touchMove', pts); },
    async up() { await send('touchEnd', []); },
    async cancel() { await send('touchCancel', []); },
    // real tap through the touchscreen
    async tap(x, y) { await page.touchscreen.tap(x, y); await sleep(60); },
    async doubleTap(x, y) { await page.touchscreen.tap(x, y); await sleep(70); await page.touchscreen.tap(x, y); await sleep(60); },
    // one-finger drag a -> b in `steps`
    async drag(a, b, steps = 10, holdEnd = 0) {
      await send('touchStart', [{ x: a.x, y: a.y, id: 0 }]);
      for (let i = 1; i <= steps; i++) { await send('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps, id: 0 }]); await sleep(8); }
      if (holdEnd) await sleep(holdEnd);
      await send('touchEnd', []);
      await sleep(60);
    },
    // polyline drag
    async path(pts, holdEnd = 0) {
      await send('touchStart', [{ x: pts[0].x, y: pts[0].y, id: 0 }]);
      for (let i = 1; i < pts.length; i++) { await send('touchMove', [{ x: pts[i].x, y: pts[i].y, id: 0 }]); await sleep(8); }
      if (holdEnd) await sleep(holdEnd);
      await send('touchEnd', []);
      await sleep(60);
    },
    async hold(x, y, ms) { await send('touchStart', [{ x, y, id: 0 }]); await sleep(ms); await send('touchEnd', []); await sleep(60); },
    // two-finger pinch about (cx,cy): finger distance d0 -> d1 (horizontal), optional pan (dx,dy) of the midpoint
    async pinch(cx, cy, d0, d1, steps = 10, dx = 0, dy = 0) {
      const f = t => {
        const d = d0 + (d1 - d0) * t, mx = cx + dx * t, my = cy + dy * t;
        return [{ x: mx - d / 2, y: my, id: 0 }, { x: mx + d / 2, y: my, id: 1 }];
      };
      await send('touchStart', f(0));
      for (let i = 1; i <= steps; i++) { await send('touchMove', f(i / steps)); await sleep(8); }
      await send('touchEnd', []);
      await sleep(80);
    },
  };
  return api;
}

// ---- page-side geometry helpers ----
export async function canvasRect(page) { return page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }); }
// page coords of the centre of tile (gx,gy)
export async function tileXY(page, gx, gy) {
  return page.evaluate(([gx, gy]) => {
    const { cam } = window.__game.ui, r = document.getElementById('game').getBoundingClientRect();
    return { x: r.left + cam.x + (gx - gy) * 32 * cam.zoom, y: r.top + cam.y + (gx + gy + 1) * 16 * cam.zoom };
  }, [gx, gy]);
}
// page coords of an agent's body
export async function agentXY(page, kind, idx = 0) {
  return page.evaluate(([kind, idx]) => {
    const { state, ui } = window.__game, a = (kind === 'staff' ? state.staff : state.patients)[idx];
    if (!a) return null;
    const r = document.getElementById('game').getBoundingClientRect(), z = ui.cam.zoom;
    return { id: a.id, x: r.left + ui.cam.x + (a.x - a.y) * 32 * z, y: r.top + ui.cam.y + (a.x + a.y) * 16 * z - 16 * z };
  }, [kind, idx]);
}
// first free lot tiles that accept a 1x1 floor / plant placement
export async function freeTiles(page, defId, n = 1) {
  return page.evaluate(async ([defId, n]) => {
    const { canPlace } = await import('/js/sim/build.js');
    const { state } = window.__game, l = state.lot, out = [];
    for (let y = l.y0 + 2; y < l.y0 + l.h - 2 && out.length < n; y += 2) for (let x = l.x0 + 2; x < l.x0 + l.w - 2 && out.length < n; x += 2) if (canPlace(state, defId, x, y, 0).ok) out.push({ x, y });
    return out;
  }, [defId, n]);
}
// current bar geometry (page coords) from the live module
export async function barButtons(page) {
  return page.evaluate(async () => {
    const m = await import('/js/render/touchui.js');
    const cv = document.getElementById('game'), r = cv.getBoundingClientRect();
    const bar = m.layoutBar(window.__game.ui, cv.clientWidth, cv.clientHeight);
    if (!bar) return null;
    return { x: bar.x + r.left, y: bar.y + r.top, w: bar.w, h: bar.h, btns: bar.btns.map(b => ({ id: b.id, x: b.x + r.left + b.w / 2, y: b.y + r.top + b.h / 2, w: b.w, h: b.h })) };
  });
}
