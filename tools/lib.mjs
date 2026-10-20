// Shared helpers for tools/*.mjs (global Playwright only). Server: `python3 -m http.server 8201` from the repo root.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

export async function launch({ w = 1280, h = 720, dpr = 1, url = 'http://localhost:8201/index.html', dismissTutorial = true } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  if (dismissTutorial) await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  return { browser, ctx, page, problems };
}

// Screen position (page coords) of the centre of tile (gx,gy), from the live camera.
export async function tileXY(page, gx, gy) {
  return page.evaluate(([gx, gy]) => {
    const { cam } = window.__game.ui, r = document.getElementById('game').getBoundingClientRect();
    const wx = (gx + 0.5 - (gy + 0.5)) * 32, wy = (gx + 0.5 + gy + 0.5) * 16;
    return { x: r.left + cam.x + wx * cam.zoom, y: r.top + cam.y + wy * cam.zoom };
  }, [gx, gy]);
}
export async function clickTile(page, gx, gy, opts = {}) {
  const p = await tileXY(page, gx, gy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y, opts);
}
export async function dragTiles(page, a, b) {
  const p = await tileXY(page, a[0], a[1]), q = await tileXY(page, b[0], b[1]);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  const n = 8;
  for (let i = 1; i <= n; i++) await page.mouse.move(p.x + (q.x - p.x) * i / n, p.y + (q.y - p.y) * i / n);
  await page.mouse.up();
}
export const G = (page, fn, arg) => page.evaluate(fn, arg);
