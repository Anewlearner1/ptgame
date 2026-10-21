// Concept-art UI regression: art-backed elements (selection card, event modal, tutorial banner, overview rows, build cards,
// system settings) appear when the art style is on and fall back cleanly when it is off or when the atlas is blocked;
// the style toggle persists; no console errors; no horizontal overflow at the four reference viewports.
// Usage: python3 -m http.server 8209 & node tools/artui.mjs [--shots <dir>] [--url http://localhost:8209/index.html]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8209/index.html');
const shotDir = arg('shots', null);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

// mode: 'new' (default style) | 'classic' (player picked the old style) | 'blocked' (atlas requests aborted)
async function open(w, h, { mode = 'new', tutorial = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  if (mode === 'blocked') await page.route(/assets\/art\/atlas\.(png|json)/, r => r.abort());
  await page.addInitScript(([m, first]) => {
    try { if (first && !sessionStorage.getItem('artui-init')) { sessionStorage.setItem('artui-init', '1'); localStorage.clear(); if (m === 'classic') localStorage.setItem('ptgame.art', 'classic'); } } catch (e) { /* ignore */ }
  }, [mode, true]);
  await page.goto(url); await page.waitForTimeout(1600);
  if (!tutorial) await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); });
  await page.evaluate(() => { try { __game.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } });
  await page.waitForTimeout(150);
  return { page, ctx, problems };
}
const shot = (page, n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` });
// count art elements by state inside a CSS scope
const arts = (page, scope) => page.evaluate(s => {
  const out = { on: 0, off: 0, wait: 0, none: 0, names: [] };
  for (const e of document.querySelectorAll(s + ' .u-art, ' + s + ' .u-banner')) {
    const k = e.dataset.art; out[k] = (out[k] || 0) + 1;
    if (k === 'on') out.names.push(e._art && e._art.name);
  }
  return out;
}, scope);
const overflowX = page => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + innerWidth);
  for (const s of ['#panel', '.modal', '.modal-body', '.u-selcard']) {
    const e = document.querySelector(s);
    if (e && !e.hidden && e.scrollWidth > e.clientWidth + 1) bad.push(s + ' ' + e.scrollWidth + '>' + e.clientWidth);
    if (e && !e.hidden) { const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) bad.push(s + ' outside viewport'); }
  }
  return bad;
});
const tab = async (page, name) => { await page.click(`#panel .tab:has-text("${name}")`); await page.waitForTimeout(180); };
const closeAll = page => page.evaluate(() => { for (let i = 0; i < 6; i++) document.querySelector('.modal .btn.primary, .modal .btn')?.click(); });
const sel = (page, type, id) => page.evaluate(([t, i]) => { __game.ui.selected = { type: t, id: i }; __game.bus.emit('select:changed', { selected: __game.ui.selected }); }, [type, id]);
const settle = page => page.waitForTimeout(600);

async function ensurePatients(page) {
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 3 }));
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => __game.state.patients.length >= 2)) break;
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await page.waitForTimeout(200);
  return page.evaluate(() => __game.state.patients.length);
}

// ======================================================================= 1. art ON at the four reference viewports
const VIEWPORTS = [[390, 844], [360, 740], [844, 390], [1280, 720]];
for (const [w, h] of VIEWPORTS) {
  const tag = `${w}x${h}`;
  const { page, problems } = await open(w, h, { mode: 'new', tutorial: true });
  await settle(page);
  // tutorial banner
  const tb = await page.evaluate(() => {
    const b = document.querySelector('.modal .u-banner'), m = document.querySelector('.modal');
    if (!b) return null;
    const rb = b.getBoundingClientRect(), rm = m.getBoundingClientRect();
    return { art: b.dataset.art, bh: rb.height, mh: rm.height, bw: rb.width, mw: rm.width, bg: getComputedStyle(b).backgroundImage.slice(0, 20) };
  });
  ok(tb && tb.art === 'on' && /url/.test(tb.bg), `${tag} tutorial scene banner is art-backed (${tb && tb.art})`);
  ok(tb && tb.bh <= tb.mh * 0.4 + 1, `${tag} banner height ${tb && Math.round(tb.bh)} <= 40% of modal ${tb && Math.round(tb.mh)}`);
  ok(tb && tb.bw <= tb.mw + 1, `${tag} banner fits modal width`);
  await shot(page, `tutorial_${tag}`);
  ok((await overflowX(page)).length === 0, `${tag} no horizontal overflow with tutorial: ${(await overflowX(page)).join(',')}`);
  await closeAll(page); await page.waitForTimeout(200);

  // selection card: staff + object (+ patient)
  const ids = await page.evaluate(() => ({ st: __game.state.staff.map(s => s.id), bed: (__game.state.objects.find(o => o.defId === 'tens') || {}).id, sofa: (__game.state.objects.find(o => o.defId === 'sofa') || {}).id }));
  await sel(page, 'staff', ids.st[0]); await settle(page);
  let a = await arts(page, '.u-selcard');
  ok(a.on >= 1 && a.names.some(n => /^staff\./.test(n)), `${tag} staff card shows a staff sprite (${a.names})`);
  await shot(page, `sel_staff_${tag}`);
  await sel(page, 'object', ids.bed); await settle(page);
  a = await arts(page, '.u-selcard');
  ok(a.names.includes('item.tens'), `${tag} tens card shows item.tens (${a.names})`);
  await shot(page, `sel_obj_${tag}`);
  if (ids.sofa) { await sel(page, 'object', ids.sofa); await settle(page); a = await arts(page, '.u-selcard'); ok(a.on === 0, `${tag} sofa card stays emoji (no art)`); }
  const np = await ensurePatients(page);
  if (np) {
    const pid = await page.evaluate(() => __game.state.patients[0].id);
    await sel(page, 'patient', pid); await settle(page);
    a = await arts(page, '.u-selcard');
    ok(a.names.some(n => /^expr\./.test(n)) && a.names.some(n => /^patient\./.test(n)), `${tag} patient card shows mood tile + sprite (${a.names})`);
    ok((await overflowX(page)).length === 0, `${tag} no overflow with patient card: ${(await overflowX(page)).join(',')}`);
    await shot(page, `sel_patient_${tag}`);
  } else console.log('note: no patient spawned');
  await page.evaluate(() => { __game.ui.selected = null; __game.bus.emit('select:changed', { selected: null }); });

  // decision modal
  await page.evaluate(async () => { const { DILEMMAS } = await import('/js/data/events.js'); __game.state.events.pendingDilemma = DILEMMAS[0]; __game.bus.emit('dilemma:show', { dilemma: DILEMMAS[0] }); });
  await settle(page);
  a = await arts(page, '.modal');
  const pr = await page.evaluate(() => { const e = document.querySelector('.modal .u-speaker .u-art'); return e && e.getBoundingClientRect().width; });
  ok(a.names.includes('portrait.doctor') && pr >= 56, `${tag} decision modal has the doctor portrait (${pr}px)`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in decision modal: ${(await overflowX(page)).join(',')}`);
  await shot(page, `event_${tag}`);
  await page.evaluate(() => document.querySelector('.modal .u-choice')?.click()); await page.waitForTimeout(300); await closeAll(page);

  // month report + inspection icons
  await page.evaluate(() => __game.bus.emit('nhi:settled', { year: 1, month: 3, points: 1200, cap: 9000, pointValue: 1, nhiIncome: 1200, income: 5000, expense: 4000, net: 1000 }));
  await settle(page);
  a = await arts(page, '.modal-title');
  ok(a.names.includes('role.record'), `${tag} month report title has role.record`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in month report: ${(await overflowX(page)).join(',')}`);
  await shot(page, `report_${tag}`);
  await closeAll(page);
  await page.evaluate(() => __game.bus.emit('inspection:result', { pass: true, score: 80, notes: ['ok'] }));
  await settle(page);
  a = await arts(page, '.modal-title');
  ok(a.names.includes('role.assess'), `${tag} inspection title has role.assess`);
  await closeAll(page); await page.waitForTimeout(200);

  // overview
  await page.keyboard.press('v'); await settle(page);
  a = await arts(page, '#panel');
  if (np) ok(a.names.some(n => /^expr\./.test(n)), `${tag} overview patient rows have mood tiles`);
  await tab(page, '員工'); await settle(page);
  a = await arts(page, '#panel');
  ok(a.names.filter(n => /^staff\./.test(n)).length >= ids.st.length, `${tag} overview staff rows have staff sprites (${a.names.length})`);
  const pool = await page.evaluate(() => document.querySelectorAll('#panel [data-cid] .u-art[data-art="on"]').length);
  ok(pool >= 1, `${tag} hiring pool cards have staff sprites (${pool})`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in overview staff: ${(await overflowX(page)).join(',')}`);
  await shot(page, `overview_staff_${tag}`);
  await tab(page, '設備'); await settle(page);
  a = await arts(page, '#panel');
  ok(a.names.some(n => /^item\./.test(n)), `${tag} equipment rows have item thumbnails (${a.names})`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in overview equipment: ${(await overflowX(page)).join(',')}`);
  await shot(page, `overview_equip_${tag}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // build panel
  await page.keyboard.press('b'); await settle(page);
  await tab(page, '設施').catch(() => {});
  await page.waitForTimeout(200);
  const subs = await page.evaluate(() => [...document.querySelectorAll('#panel .u-subtabs .tab')].map(t => t.textContent));
  let seen = new Set();
  for (const s of subs) {
    await page.click(`#panel .u-subtabs .tab:text-is("${s}")`); await page.waitForTimeout(150);
    (await arts(page, '#panel .u-buildgrid')).names.forEach(n => seen.add(n));
    if (s === subs[0]) await shot(page, `build_${tag}`);
  }
  ok(['item.bed', 'item.traction', 'item.tens'].every(n => seen.has(n)), `${tag} build cards use item sprites (${[...seen]})`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in build panel: ${(await overflowX(page)).join(',')}`);
  // arm a mapped item -> tray shows art on phones
  await page.evaluate(() => { document.querySelector('#panel .u-item[data-id="bed"], #panel .u-item[data-id="tens"], #panel .u-item[data-id="traction"]')?.click(); });
  await page.waitForTimeout(400);
  await shot(page, `build_armed_${tag}`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // clinic 衛教看板 + system
  await page.keyboard.press('c'); await settle(page);
  await tab(page, '衛教看板').catch(() => {});
  a = await arts(page, '#panel');
  ok(a.names.includes('role.educate') || a.on === 0, `${tag} clinic boards tab renders (${a.names.length} art)`);
  await shot(page, `clinic_${tag}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.keyboard.press('y'); await settle(page);
  await tab(page, '設定'); await settle(page);
  a = await arts(page, '#panel');
  ok(a.names.includes('scene.clinic'), `${tag} settings 關於 block has the clinic banner (${a.names})`);
  ok(await page.evaluate(() => !!document.querySelector('.u-artswitch') && /使用者提供的概念圖/.test(document.getElementById('panel').textContent)), `${tag} style switch + credit line present`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in settings: ${(await overflowX(page)).join(',')}`);
  await shot(page, `settings_${tag}`);
  await page.evaluate(() => document.getElementById('panel').querySelector('.u-artswitch')?.scrollIntoView());
  await shot(page, `settings_switch_${tag}`);
  ok(problems.length === 0, `${tag} no console problems ` + problems.join(' | '));
  await page.context().close();
}

// ======================================================================= 2. toggle: immediate, persistent
{
  const { page, problems } = await open(1280, 720, { mode: 'new' });
  await page.keyboard.press('y'); await settle(page);
  await tab(page, '設定'); await settle(page);
  await page.click('.u-artbtn[data-art="classic"]'); await page.waitForTimeout(300);
  let a = await arts(page, '#panel');
  ok(a.on === 0, 'toggle to classic: no art element is "on" immediately (banner hidden)');
  ok(await page.evaluate(() => localStorage.getItem('ptgame.art')) === 'classic', 'classic choice persisted to localStorage');
  ok(await page.evaluate(() => document.querySelector('.u-artbtn[data-art="classic"]').classList.contains('primary')), 'classic button shows as active');
  // selection card falls back to emoji
  const oid = await page.evaluate(() => __game.state.objects.find(o => o.defId === 'tens').id);
  await sel(page, 'object', oid); await settle(page);
  ok(await page.evaluate(() => /🛏|🛌|./.test(document.querySelector('.u-selcard .u-shead').textContent)) && (await arts(page, '.u-selcard')).on === 0, 'tens selection card falls back to the glyph when classic');
  await shot(page, 'classic_sel_1280x720');
  await page.keyboard.press('v'); await settle(page); await tab(page, '員工'); await settle(page);
  a = await arts(page, '#panel');
  ok(a.on === 0 && a.off >= 1, `classic overview staff rows use the emoji fallback (off=${a.off})`);
  await shot(page, 'classic_staff_1280x720');
  await page.keyboard.press('Escape');
  await page.keyboard.press('b'); await settle(page);
  ok((await arts(page, '#panel .u-buildgrid')).on === 0, 'classic build cards have no art');
  await page.reload(); await page.waitForTimeout(1600);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  ok(await page.evaluate(() => localStorage.getItem('ptgame.art')) === 'classic', 'classic persists after reload');
  await page.keyboard.press('v'); await settle(page); await tab(page, '員工'); await settle(page);
  a = await arts(page, '#panel');
  ok(a.on === 0 && a.off >= 1, 'after reload still classic (emoji fallback)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('y'); await settle(page); await tab(page, '設定'); await settle(page);
  await page.click('.u-artbtn[data-art="new"]'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => localStorage.getItem('ptgame.art')) === 'new', 'switching back stores "new"');
  a = await arts(page, '#panel');
  ok(a.names.includes('scene.clinic'), 'switching back to new shows art immediately');
  ok(problems.length === 0, 'no console problems (toggle) ' + problems.join(' | '));
  await page.context().close();
}

// ======================================================================= 3. atlas blocked => full fallback, nothing breaks
{
  const { page, problems } = await open(390, 844, { mode: 'blocked', tutorial: true });
  await settle(page);
  const tb = await page.evaluate(() => { const b = document.querySelector('.modal .u-banner'); return b ? { art: b.dataset.art, h: b.getBoundingClientRect().height } : 'none'; });
  ok(tb === 'none' || tb.art === 'none' || tb.h === 0, 'blocked atlas: no tutorial banner shown ' + JSON.stringify(tb));
  await closeAll(page); await page.waitForTimeout(200);
  const ids = await page.evaluate(() => ({ st: __game.state.staff[0].id, bed: __game.state.objects.find(o => o.defId === 'tens').id }));
  await sel(page, 'staff', ids.st); await settle(page);
  let a = await arts(page, '.u-selcard');
  ok(a.on === 0 && a.wait === 0, `blocked: staff card has no art, no reserved placeholders (${JSON.stringify(a)})`);
  ok(await page.evaluate(() => document.querySelector('.u-selcard .u-shead').textContent.length > 2), 'blocked: staff card still shows emoji + name');
  await sel(page, 'object', ids.bed); await settle(page);
  ok((await arts(page, '.u-selcard')).on === 0, 'blocked: object card falls back');
  await page.evaluate(async () => { const { DILEMMAS } = await import('/js/data/events.js'); __game.state.events.pendingDilemma = DILEMMAS[0]; __game.bus.emit('dilemma:show', { dilemma: DILEMMAS[0] }); });
  await settle(page);
  a = await arts(page, '.modal');
  ok(a.on === 0 && a.wait === 0, `blocked: decision modal has no portrait or placeholder (${JSON.stringify(a)})`);
  ok(await page.evaluate(() => document.querySelectorAll('.modal .u-choice').length > 0), 'blocked: decision modal still usable');
  await shot(page, 'blocked_event_390x844');
  await page.evaluate(() => document.querySelector('.modal .u-choice')?.click()); await page.waitForTimeout(300); await closeAll(page);
  for (const k of ['v', 'b', 'c', 'y']) {
    await page.keyboard.press(k); await settle(page);
    ok(await page.evaluate(() => !document.getElementById('panel').hidden), `blocked: panel ${k} opens`);
    a = await arts(page, '#panel');
    ok(a.on === 0 && a.wait === 0, `blocked: panel ${k} has no art / placeholders (${JSON.stringify(a)})`);
    ok((await overflowX(page)).length === 0, `blocked: panel ${k} no overflow`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  }
  await page.keyboard.press('v'); await settle(page); await tab(page, '員工'); await settle(page);
  await shot(page, 'blocked_staff_390x844');
  const bad = problems.filter(p => !/Failed to load resource|net::ERR_FAILED|atlas/i.test(p));
  ok(bad.length === 0, 'blocked: no console problems beyond the aborted request ' + bad.join(' | '));
  await page.context().close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
