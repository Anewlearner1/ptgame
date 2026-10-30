// 封面 regression: shown with ?cover=1 (not under automation by default), freezes the sim, 開始／繼續 closes it,
// install/fullscreen box on the cover (touch viewports) and still in 系統 → 設定, no overflow, no console problems.
// Usage: python3 -m http.server 8218 & node tools/coverui.mjs [--shots <dir>]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:8218/index.html');
const shotDir = arg('shots', null);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };
for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [1280, 720, false]]) {
  for (const style of ['new', 'classic']) {
    const tag = `[${w}x${h} ${style}]`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage(); const problems = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
    page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
    await page.addInitScript(st => { try { if (!sessionStorage.getItem('c')) { sessionStorage.setItem('c', '1'); localStorage.clear(); } if (st === 'classic') localStorage.setItem('restgame.art', 'classic'); } catch (e) { /* ignore */ } }, style);
    await page.goto(base); await page.waitForTimeout(900);
    ok(await page.locator('#cover').count() === 0, `${tag} no cover under automation by default`);
    await page.goto(base + '?nocover'); await page.waitForTimeout(500);
    ok(await page.locator('#cover').count() === 0, `${tag} ?nocover hides it`);
    await page.goto(base + '?cover=1'); await page.waitForTimeout(1200);
    ok(await page.locator('#cover').count() === 1, `${tag} ?cover=1 shows the cover`);
    ok((await page.locator('.cover-go').innerText()).includes('開始遊戲'), `${tag} fresh start says 開始遊戲`);
    const t0 = await page.evaluate(() => __game.state.time.clock + __game.state.time.week * 1440);
    await page.waitForTimeout(1500);
    const t1 = await page.evaluate(() => __game.state.time.clock + __game.state.time.week * 1440);
    ok(t0 === t1, `${tag} sim frozen behind the cover (${t0}→${t1})`);
    const box = await page.locator('.cover-install').count();
    ok(box === 1 || !(await page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled))), `${tag} install / fullscreen box on the cover (${box})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag} no horizontal overflow`);
    const r = await page.locator('.cover-go').boundingBox();
    ok(r && r.height >= 40 && r.y >= 0 && r.y + r.height <= h, `${tag} start button reachable (${r && Math.round(r.y)}+${r && Math.round(r.height)})`);
    if (shotDir) await page.screenshot({ path: `${shotDir}/cover_${w}x${h}_${style}.png` });
    ok(await page.locator('.cover-support').count() === 0, `${tag} no 支持作者 button while no URL is configured`);
    ok(await page.locator('.modal-backdrop').count() === 0, `${tag} tutorial waits behind the cover`);
    // 支持作者: configure a URL at runtime, rebuild the cover
    await page.evaluate(async () => {
      const M = await import('/js/data/support.js'); M.SUPPORT.url = 'https://example.com/donate';
      const C = await import('/js/ui/cover.js'); document.getElementById('cover').remove(); __game.ui.coverOn = false; C.showCover(__game.ui);
    });
    await page.waitForTimeout(300);
    ok(await page.locator('.cover-support').count() === 1, `${tag} 支持作者 button appears once a URL is set`);
    await page.locator('.cover-support').click(); await page.waitForTimeout(400);
    ok(await page.locator('.support-page').count() === 1 && (await page.locator('.modal').innerText()).includes('支持作者'), `${tag} support page opens over the cover`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag} support page: no overflow`);
    const gb = await page.locator('.support-go').boundingBox();
    ok(gb && gb.y >= 0 && gb.y + gb.height <= h, `${tag} support button visible in the viewport`);
    if (shotDir) await page.screenshot({ path: `${shotDir}/support_${w}x${h}_${style}.png` });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ok(await page.locator('#cover').count() === 1, `${tag} Enter inside the support page does not start the game`);
    const [pop] = await Promise.all([page.waitForEvent('popup', { timeout: 4000 }).catch(() => null), page.locator('.support-go').click()]);
    ok(!!pop, `${tag} 前往贊助頁 opens the sponsor URL in a new tab (${pop && pop.url()}; the sandbox cannot reach it)`);
    if (pop) await pop.close().catch(() => {});
    await page.locator('.modal-actions button', { hasText: '關閉' }).click(); await page.waitForTimeout(300);
    ok(await page.locator('.support-page').count() === 0, `${tag} support page closes`);
    await page.locator('.cover-go').click(); await page.waitForTimeout(1500);
    ok(await page.locator('#cover').count() === 0, `${tag} start closes the cover`);
    ok(await page.locator('.modal-backdrop').count() >= 1, `${tag} tutorial shows after the cover`);
    await page.evaluate(() => { document.querySelector('#modal-root .modal-actions .btn')?.click(); });
    await page.waitForTimeout(1200);
    const t2 = await page.evaluate(() => __game.state.time.clock + __game.state.time.week * 1440);
    ok(t2 !== t1 || await page.evaluate(() => __game.state.time.paused), `${tag} sim runs after start (${t2}) ${JSON.stringify(await page.evaluate(() => [__game.state.time.paused, __game.state.time.speed, __game.ui.coverOn, document.querySelectorAll(".modal-backdrop").length]))}`);
    // settings still carry the install box
    if (touch) {
      await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); });
      await page.evaluate(() => { __game.ui.panel = 'system'; }); await page.waitForTimeout(800);
      await page.evaluate(() => { [...document.querySelectorAll('#panel .tab')].find(t => t.textContent.includes('設定'))?.click(); });
      await page.waitForTimeout(600);
      const pt = await page.locator('#panel').innerText(); ok(pt.includes('安裝與全螢幕'), `${tag} 設定 still has 安裝與全螢幕 ${JSON.stringify(pt.slice(0, 160))}`);
      ok((await page.locator('#panel .tab', { hasText: '支持' }).count()) === 1, `${tag} 系統 has the 支持 tab once a URL is set`);
    }
    // saved game -> 繼續遊戲
    await page.evaluate(async () => { const S = await import('/js/sim/save.js'); S.saveGame(__game.state, 'auto'); });
    await page.goto(base + '?cover=1'); await page.waitForTimeout(1200);
    ok((await page.locator('.cover-go').innerText()).includes('繼續遊戲'), `${tag} with an autosave it says 繼續遊戲`);
    ok(problems.length === 0, `${tag} no console problems: ${problems.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall coverui checks passed');
process.exit(failed ? 1 : 0);
