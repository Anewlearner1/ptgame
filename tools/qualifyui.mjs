// 設施人員資格 UI regression: role chips on build cards / tray / tooltip, placement toast, 設備維護表 缺人 badge + required-role text,
// hire-pool tag, staff-role tooltip, object selection card (所需人員 / 狀態), ⚠ overlay on the map, both art styles, three viewports,
// no horizontal overflow, no console problems.
// Usage: python3 -m http.server 8215 & node tools/qualifyui.mjs [--shots <dir>] [--url http://localhost:8215/index.html]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8215/index.html');
const shotDir = arg('shots', null);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

async function open(w, h, style) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });     // (that warning comes from this test's own canvas readback)
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  await page.addInitScript((st) => { try { localStorage.clear(); if (st === 'classic') localStorage.setItem('ptgame.art', 'classic'); } catch (e) { /* ignore */ } }, style);
  await page.goto(url); await page.waitForTimeout(1400);
  await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); __game.bus.emit('speed:set', { speed: 0 }); });
  await page.waitForTimeout(250);
  return { page, ctx, problems };
}
const mods = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const f = new Function('S', 'B', 'Q', 'state', 'ui', 'a', 'return (async () => {' + src + '})()');
  const S = await import('/js/sim/staff.js'), B = await import('/js/sim/build.js'), Q = await import('/js/sim/qualify.js');
  return f(S, B, Q, __game.state, __game.ui, a);
}, [fn, arg]);
const shot = (page, n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const overflow = (page) => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + innerWidth);
  for (const s of ['#panel', '.u-selcard', '.u-tray', '#tooltip']) {
    const e = document.querySelector(s);
    if (e && !e.hidden && e.offsetWidth > 0 && e.scrollWidth > e.clientWidth + 2) bad.push(s + ' ' + e.scrollWidth + '>' + e.clientWidth);
  }
  return bad;
});
// yellow-ish (warn icon) pixels in a canvas rectangle around a tile column; compared before / after to prove the overlay exists
const warnPixels = (page, id) => page.evaluate((id) => {
  const { state, ui } = __game;
  const o = state.objects.find(x => x.id === id);
  const cv = document.getElementById('game'), g = cv.getContext('2d'), r = cv.getBoundingClientRect();
  const k = cv.width / r.width;
  const cx = (o.x + 0.5 - (o.y + 0.5)) * 32, cy = (o.x + 0.5 + o.y + 0.5) * 16;
  const sx = (ui.cam.x + cx * ui.cam.zoom) * k, sy = (ui.cam.y + cy * ui.cam.zoom) * k;
  const R = 70 * ui.cam.zoom * k;
  const x0 = Math.max(0, Math.floor(sx - R)), y0 = Math.max(0, Math.floor(sy - 2.2 * R)), w = Math.min(cv.width - x0, Math.floor(2 * R)), h = Math.min(cv.height - y0, Math.floor(2.4 * R));
  if (w <= 0 || h <= 0) return -1;
  const d = g.getImageData(x0, y0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 165 && d[i + 1] < 235 && d[i + 2] < 90) n++;
  return n;
}, id);

// open a panel with its hotkey unless it is already the open one (the hotkey toggles)
const ensurePanel = async (page, key, id) => {
  if ((await page.evaluate(() => __game.ui.panel)) !== id) { await page.keyboard.press(key); await settle(page, 700); }
};
// phones collapse the build panel to a tray / strip once an item is picked: bring the full list back
const expandBuild = async (page) => {
  await page.evaluate(() => { const b = document.querySelector('.u-tray-full'); if (b && b.offsetParent) b.click(); });
  await settle(page, 300);
};
const VIEWS = [[390, 844], [844, 390], [1280, 720]];
const STYLES = ['new', 'classic'];
for (const [w, h] of VIEWS) for (const style of STYLES) {
  const tag = `${w}x${h} ${style}`;
  if (ONLY.length && !ONLY.includes(`${w}x${h}`)) continue;
  console.log('---', tag);
  const { page, ctx, problems } = await open(w, h, style);
  const mobile = w < 700 || h < 500;

  // starter clinic: PT / nurse / doctor on the payroll -> nothing is unstaffed
  const base = await mods(page, `return { miss: Q.missingRoles(state).length, unst: Q.unstaffedIds(state).size, staff: state.staff.map(s => s.role) };`);
  ok(base.miss === 0 && base.unst === 0 && ['doctor', 'nurse', 'pt'].every(r => base.staff.includes(r)), `${tag}: starter clinic is fully staffed (${JSON.stringify(base)})`);

  // ---- build cards
  await ensurePanel(page, 'b', 'build');
  await page.click('.u-tabbed > .tabs .tab:has-text("設施")'); await settle(page, 250);
  const subTab = page.locator('.u-subtabs .tab:has-text("物理治療區")');
  if (await subTab.count()) { await subTab.first().click(); await settle(page, 250); }
  const cards = await page.evaluate(() => {
    const out = {};
    for (const id of ['heatbox', 'tens', 'traction', 'bed']) {
      const c = document.querySelector(`.u-item[data-id="${id}"]`);
      const r = c && c.querySelector('.u-roles');
      out[id] = r ? { text: r.textContent, chips: [...r.querySelectorAll('.u-role')].map(x => x.className + '|' + x.textContent) } : null;
    }
    return out;
  });
  ok(cards.tens && /需要/.test(cards.tens.text) && cards.tens.chips.length === 1 && /ok/.test(cards.tens.chips[0]) && /✔ 物理治療師/.test(cards.tens.chips[0]), `${tag}: tens card shows 「需要：✔ 物理治療師」 ${JSON.stringify(cards.tens)}`);
  ok(cards.heatbox && cards.heatbox.chips.length === 2 && cards.heatbox.chips.some(c => /護理師/.test(c)) && cards.heatbox.chips.some(c => /物理治療師/.test(c)), `${tag}: heatbox card lists nurse + PT chips ${JSON.stringify(cards.heatbox)}`);
  const subBasic = page.locator('.u-subtabs .tab:has-text("基礎門診")');
  if (await subBasic.count()) { await subBasic.first().click(); await settle(page, 250); }
  const basic = await page.evaluate(() => ({ exam: (document.querySelector('.u-item[data-id="exam_room"] .u-roles') || {}).textContent || null, rest: !!document.querySelector('.u-item[data-id="rest_room"] .u-roles'), rec: (document.querySelector('.u-item[data-id="reception"] .u-roles') || {}).textContent || null }));
  ok(basic.exam && /醫師/.test(basic.exam) && basic.rec && /護理師/.test(basic.rec) && !basic.rest, `${tag}: exam room card says 需要：醫師, reception 護理師, rest room nothing (${JSON.stringify(basic)})`);
  if (await subTab.count()) { await subTab.first().click(); await settle(page, 250); }
  await shot(page, `qual_${w}x${h}_${style}_build_ok`);

  // tooltip (desktop hover)
  if (!mobile) {
    await page.hover('.u-item[data-id="tens"]'); await settle(page, 350);
    const tip = await page.evaluate(() => { const t = document.getElementById('tooltip'); return t && !t.hidden ? t.textContent : ''; });
    ok(/需要：.*物理治療師/.test(tip), `${tag}: build tooltip carries the role line (${tip.slice(0, 80)})`);
    await page.mouse.move(5, 5);
  }

  // tray (phones): pick tens -> tray shows the role line
  await page.click('.u-item[data-id="tens"]'); await settle(page, 400);
  if (mobile) {
    const tray = await page.evaluate(() => { const t = document.querySelector('.u-tray-role'); return t && !t.hidden && t.offsetParent ? t.textContent : ''; });
    ok(/需要：.*物理治療師/.test(tray), `${tag}: tray shows 「需要：…」 (${tray})`);
    await shot(page, `qual_${w}x${h}_${style}_tray`);
  }
  await page.keyboard.press('Escape'); await settle(page, 200);

  // ---- fire the last PT: chips turn ⚠, placing a PT machine toasts once, objects get the ⚠ overlay
  const tens = await mods(page, `
    const pt = state.staff.find(s => s.role === 'pt'); S.fire(state, pt.id);
    const t = state.objects.find(o => o.defId === 'tens');
    return { id: t.id, x: t.x, y: t.y };`);
  await ensurePanel(page, 'b', 'build'); await expandBuild(page);
  await page.click('.u-tabbed > .tabs .tab:has-text("設施")'); await settle(page, 200);
  if (await subTab.count()) { await subTab.first().click(); await settle(page, 300); }
  const lack = await page.evaluate(() => { const c = document.querySelector('.u-item[data-id="tens"] .u-roles'); return c ? { cls: c.className, chips: [...c.querySelectorAll('.u-role')].map(x => x.className + '|' + x.textContent) } : null; });
  ok(lack && /lack/.test(lack.cls) && lack.chips.length === 1 && /lack/.test(lack.chips[0]) && /⚠ 物理治療師/.test(lack.chips[0]), `${tag}: with no PT the tens chip is ⚠ (${JSON.stringify(lack)})`);
  await shot(page, `qual_${w}x${h}_${style}_build_lack`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page, 250);

  // overlay: sample the warn pixels around the unstaffed tens and compare with the staffed state
  await mods(page, `ui.cam.zoom = Math.max(ui.cam.zoom, 1.4);`);
  await mods(page, `const o = state.objects.find(x => x.defId === 'tens'); const cv = document.getElementById('game'); const r = cv.getBoundingClientRect();
    ui.cam.x = r.width / 2 - ((o.x - o.y) * 32) * ui.cam.zoom; ui.cam.y = r.height / 2 - ((o.x + o.y + 1) * 16 - 20) * ui.cam.zoom;`);
  await settle(page, 400);
  let withWarn = 0;
  for (let i = 0; i < 6; i++) { withWarn = Math.max(withWarn, await warnPixels(page, tens.id)); await settle(page, 120); }
  await shot(page, `qual_${w}x${h}_${style}_overlay`);

  // toast on placing an unstaffed facility (once per role)
  const t1 = await mods(page, `
    const m = state.money; state.money = 9e6;
    let o = null;
    for (const [x, y] of [[19, 11], [20, 11], [21, 11], [19, 13], [20, 13]]) { o = B.placeObject(state, 'tens', x, y, 0); if (o) break; }
    state.money = m; return { id: o && o.id, unst: o ? Q.isUnstaffed(state, o) : null };`);
  await page.waitForFunction(() => /尚未僱用/.test(document.getElementById('toast-layer').textContent), null, { timeout: 4000 }).catch(() => {});
  const toast1 = await page.evaluate(() => document.getElementById('toast-layer').textContent);
  ok(t1.id && t1.unst === true && /尚未僱用物理治療師，這台設備無法運作/.test(toast1), `${tag}: placing an unstaffed PT machine toasts 「尚未僱用物理治療師，這台設備無法運作」 (${toast1.slice(0, 60)})`);
  await page.evaluate(() => { document.getElementById('toast-layer').replaceChildren(); });
  await mods(page, `const m = state.money; state.money = 9e6; for (const [x, y] of [[19, 15], [20, 15], [21, 13], [21, 11]]) { if (B.placeObject(state, 'tens', x, y, 0)) break; } state.money = m;`);
  await settle(page, 400);
  const toast2 = await page.evaluate(() => document.getElementById('toast-layer').textContent);
  ok(!/尚未僱用/.test(toast2), `${tag}: no second toast for the same role (${toast2.slice(0, 40)})`);

  // ---- 設備維護表 (overview, equipment tab)
  await ensurePanel(page, 'v', 'overview');
  await page.click('.u-tabbed > .tabs .tab:has-text("設備維護")'); await settle(page, 500);
  const eq = await page.evaluate((id) => {
    const tr = document.querySelector(`.u-eq tr[data-id="${id}"]`);
    if (!tr) return null;
    return { badge: [...tr.querySelectorAll('.u-eqb')].map(b => b.textContent), req: (tr.querySelector('.u-eqreq') || {}).textContent, cls: tr.className, sum: (document.querySelector('.u-eqsum') || {}).textContent };
  }, tens.id);
  ok(eq && eq.badge.includes('缺人') && /需要：⚠ 物理治療師/.test(eq.req || '') && /缺人/.test(eq.sum), `${tag}: 設備維護表 row shows 缺人 + 需要：⚠ 物理治療師 (${JSON.stringify(eq)})`);
  await page.evaluate((id) => { const tr = document.querySelector(`.u-eq tr[data-id="${id}"]`); if (tr) tr.scrollIntoView({ block: 'center' }); }, tens.id); await settle(page, 200);
  await shot(page, `qual_${w}x${h}_${style}_equip`);
  const ofl1 = await overflow(page);
  ok(ofl1.length === 0, `${tag}: no overflow in the equipment table (${ofl1.join('; ')})`);

  // ---- staff tab: hire pool tag + role tooltip
  await page.evaluate(() => {
    const { state } = __game;
    state.hirePool.length = 0;
    state.hirePool.push({ cid: 'qpt', role: 'pt', name: '測試治療師', skill: 6, charm: 5, salary: 60000, hireCost: 30000, trait: null, staminaMax: 100 },
      { cid: 'qdr', role: 'doctor', name: '測試醫師', skill: 6, charm: 5, salary: 150000, hireCost: 30000, trait: null, staminaMax: 100 });
  });
  await page.click('.u-tabbed > .tabs .tab:has-text("員工")'); await settle(page, 600);
  const pool = await page.evaluate(() => [...document.querySelectorAll('.u-row2[data-cid]')].map(c => ({ cid: c.dataset.cid, tag: !!c.querySelector('.u-need:not([hidden])'), txt: c.querySelector('.u-need') ? c.querySelector('.u-need').textContent : '' })));
  ok(pool.length === 2 && pool.find(c => c.cid === 'qpt').tag && /診所缺這個職類/.test(pool.find(c => c.cid === 'qpt').txt) && !pool.find(c => c.cid === 'qdr').tag, `${tag}: hire pool tags the PT candidate 「診所缺這個職類」, not the doctor (${JSON.stringify(pool)})`);
  const rtip = await page.evaluate(() => { const e = document.querySelector('.u-srow2 [data-tip*="護理師可操作的設施"]'); return e ? e.dataset.tip : ''; });
  ok(/可操作的設施/.test(rtip) && /熱敷箱/.test(rtip) && /掛號櫃檯/.test(rtip) && /只需開機設定/.test(rtip), `${tag}: staff row role label has the 「可操作的設施」 tooltip (${rtip.replace(/\n/g, ' / ').slice(0, 70)})`);
  await shot(page, `qual_${w}x${h}_${style}_hirepool`);
  ok((await overflow(page)).length === 0, `${tag}: no overflow in the staff tab (${(await overflow(page)).join('; ')})`);

  // hiring the PT clears every flag
  await mods(page, `state.money = 9e6; S.hire(state, 'qpt');`);
  await settle(page, 500);
  const after = await page.evaluate(() => ({ tags: [...document.querySelectorAll('.u-need')].filter(e => !e.hidden).length }));
  ok(after.tags === 0, `${tag}: after hiring the PT the 「診所缺這個職類」 tag is gone`);
  await page.click('.u-tabbed > .tabs .tab:has-text("設備維護")'); await settle(page, 500);
  const eq2 = await page.evaluate((id) => { const tr = document.querySelector(`.u-eq tr[data-id="${id}"]`); return tr ? { badge: [...tr.querySelectorAll('.u-eqb')].map(b => b.textContent), req: (tr.querySelector('.u-eqreq') || {}).textContent } : null; }, tens.id);
  ok(eq2 && !eq2.badge.includes('缺人') && /需要：✔ 物理治療師/.test(eq2.req || ''), `${tag}: equipment row is ✔ after the hire (${JSON.stringify(eq2)})`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page, 350);
  let noWarn = 0;
  for (let i = 0; i < 4; i++) { noWarn = Math.max(noWarn, await warnPixels(page, tens.id)); await settle(page, 120); }
  ok(withWarn >= 8 && withWarn > noWarn + 5, `${tag}: ⚠ overlay is drawn over the unstaffed machine and gone after the hire (warn-coloured pixels ${withWarn} vs ${noWarn})`);

  // ---- object selection card
  await mods(page, `S.fire(state, state.staff.find(s => s.role === 'pt').id); ui.selected = { type: 'object', id: ${tens.id} }; __game.bus.emit('select:changed', { selected: ui.selected });`);
  await settle(page, 600);
  const sel = await page.evaluate(() => { const c = document.querySelector('.u-selcard'); return c && !c.hidden ? c.textContent : ''; });
  ok(/所需人員/.test(sel) && /狀態/.test(sel) && /缺人，無法運作/.test(sel) && /⚠ 物理治療師/.test(sel), `${tag}: selection card shows 所需人員 + 狀態 (${sel.replace(/\s+/g, ' ').slice(0, 110)})`);
  await shot(page, `qual_${w}x${h}_${style}_selcard`);
  ok((await overflow(page)).length === 0, `${tag}: no overflow with the selection card (${(await overflow(page)).join('; ')})`);
  await mods(page, `state.money = 9e6; const c = state.hirePool.find(x => x.role === 'pt') || null; if (!c) { state.hirePool.push({ cid: 'qpt2', role: 'pt', name: '測試治療師二', skill: 6, charm: 5, salary: 60000, hireCost: 1000, trait: null, staminaMax: 100 }); } S.hire(state, (state.hirePool.find(x => x.role === 'pt')).cid);`);
  await settle(page, 600);
  const sel2 = await page.evaluate(() => { const c = document.querySelector('.u-selcard'); return c && !c.hidden ? c.textContent : ''; });
  ok(/✔ 物理治療師/.test(sel2) && !/缺人/.test(sel2), `${tag}: selection card follows the hire (${sel2.replace(/\s+/g, ' ').slice(0, 90)})`);

  ok(problems.length === 0, `${tag}: no console problems ${problems.join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
