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
  ok(a.on >= 1 && a.names.some(n => /^face\.\w+\.(normal|tired|happy)$/.test(n)), `${tag} staff card shows the mood bust (${a.names})`);
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
  await page.evaluate(() => __game.bus.emit('month:settled', { year: 1, month: 3, points: 1200, cap: 9000, pointValue: 1, nhiIncome: 1200, income: 5000, expense: 4000, net: 1000 }));
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
  ok(a.names.filter(n => /^face\./.test(n)).length >= ids.st.length, `${tag} overview staff rows have mood busts (${a.names.length})`);
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

// ======================================================================= 4. mood faces (js/ui/moods.js + staff / patient / result UI)
{
  const { page, problems } = await open(390, 844, { mode: 'new' });
  const U = await page.evaluate(async () => {
    const M = await import('/js/ui/moods.js');
    const out = {};
    const st = (id, o) => ({ id, role: 'pt', stamina: 80, staminaMax: 100, morale: 60, state: 'idle', ...o });
    M.resetMoods();
    out.tiredStam = M.staffMood(st(1, { stamina: 20 }), 0);
    out.tiredStamEdge = M.staffMood(st(11, { stamina: 30 }), 0);          // exactly 0.30 is not below the threshold
    out.tiredMorale = M.staffMood(st(2, { morale: 20 }), 0);
    out.tiredMoraleEdge = M.staffMood(st(12, { morale: 35 }), 0);
    out.tiredFlag = M.staffMood(st(3, { tired: true }), 0);
    out.tiredWant = M.staffMood(st(13, { wantRest: true }), 0);
    out.happy = M.staffMood(st(4, { morale: 80, stamina: 90 }), 0);
    out.happyLowStam = M.staffMood(st(14, { morale: 80, stamina: 40 }), 0);  // stamina < 0.5: only normal
    out.happyHeavy = M.staffMood(st(15, { morale: 80, stamina: 60, state: 'working' }), 0);
    out.normal = M.staffMood(st(5, {}), 0);
    // hysteresis: happy at t=0, morale drops to 60 at t=3 -> still happy; at t=12 -> normal
    const h = st(6, { morale: 80, stamina: 90 });
    out.h0 = M.staffMood(h, 0); h.morale = 60;
    out.h3 = M.staffMood(h, 3); out.h12 = M.staffMood(h, 12);
    // ... but 'tired' is never delayed
    const t = st(7, { morale: 80, stamina: 90 });
    out.t0 = M.staffMood(t, 0); t.stamina = 10; out.t1 = M.staffMood(t, 1);
    // treatment glow: satisfied patient -> happy for 20 min even at morale 60
    const g = st(8, {});
    M.noteTreatment(8, 80, 100); out.g0 = M.staffMood(g, 100); out.g25 = M.staffMood(g, 125);
    out.faces = [M.staffFaceName('st', 'tired'), M.staffFaceName('tech', 'normal'), M.staffFaceName('pharmacist', 'happy'), M.staffFaceName('doctor', 'bogus')];
    // patients
    const P = (o) => ({ id: 900 + Math.random(), type: 'office', satisfaction: 60, patience: 80, patienceMax: 100, waitedMin: 5, hp: 0.2, stage: 'waiting', flags: {}, ...o });
    const pm = o => { const m = M.patientMood(P(o), 0, 0.7); return m.tier + ':' + m.key; };
    out.pat = {
      delighted: pm({ satisfaction: 92 }), content: pm({ satisfaction: 65 }), neutral: pm({ satisfaction: 45 }), angry: pm({ satisfaction: 15 }),
      impatient: pm({ satisfaction: 90, patience: 10 }), longWait: pm({ satisfaction: 60, waitedMin: 100 }), treating: pm({ satisfaction: 52, stage: 'treating' }),
      leaveAngry: pm({ satisfaction: 70, stage: 'leaving', reason: 'angry' }), leaveCured: pm({ satisfaction: 60, stage: 'leaving', reason: 'done', cured: true }),
      slippedOld: pm({ satisfaction: 55, flags: { slipped: true } }), slippedLow: pm({ satisfaction: 40, flags: { slipped: true } }), lowRecovery: pm({ satisfaction: 20, hp: 0.05 }),
    };
    const sl = P({ satisfaction: 80 }); M.noteSlip(sl.id, 50);
    out.pat.slipNow = (m => m.tier + ':' + m.key)(M.patientMood(sl, 60, 0.7));
    out.pat.slipLater = (m => m.tier + ':' + m.key)(M.patientMood(sl, 100, 0.7));
    out.table = Object.fromEntries(['elder', 'office', 'kid', 'sports'].map(ty => [ty, [0, 1, 2, 3].map(i => M.patientExprIndex(ty, i))]));
    out.exprNames = [0, 1, 2, 3].map(i => M.patientExprName('kid', i));
    out.outcome = [
      M.outcomeMood({ reputation: 5 }, [{ text: '聲譽 +5', good: true }]), M.outcomeMood({ money: -200000, reputation: -3 }, [{ text: '資金 -20萬', good: false }, { text: '聲譽 -3', good: false }]),
      M.outcomeMood({}, []), M.outcomeMood({ money: -200000 }, [{ text: 'a', good: false }, { text: 'b', good: true }, { text: 'c', good: true }]), M.outcomeMood({ sat: 4, reputation: 1 }, null),
    ];
    out.net = [M.netMood(500), M.netMood(-500), M.netMood(0)];
    return out;
  });
  ok(U.tiredStam === 'tired' && U.tiredStamEdge !== 'tired', `staffMood: tired by stamina < 30% (${U.tiredStam}/${U.tiredStamEdge})`);
  ok(U.tiredMorale === 'tired' && U.tiredMoraleEdge !== 'tired', `staffMood: tired by morale < 35 (${U.tiredMorale}/${U.tiredMoraleEdge})`);
  ok(U.tiredFlag === 'tired' && U.tiredWant === 'tired', 'staffMood: tired flag / wantRest => tired');
  ok(U.happy === 'happy' && U.happyLowStam === 'normal' && U.happyHeavy === 'normal', `staffMood: happy by morale >= 75 (stamina >= 50%, not heavy) (${U.happy}/${U.happyLowStam}/${U.happyHeavy})`);
  ok(U.normal === 'normal', 'staffMood: otherwise normal');
  ok(U.h0 === 'happy' && U.h3 === 'happy' && U.h12 === 'normal', `staffMood hysteresis holds 10 game min (${U.h0}/${U.h3}/${U.h12})`);
  ok(U.t0 === 'happy' && U.t1 === 'tired', 'staffMood: tired is never delayed by the hysteresis');
  ok(U.g0 === 'happy' && U.g25 === 'normal', `staffMood: satisfied treatment keeps them happy ~20 min (${U.g0}/${U.g25})`);
  ok(U.faces[0] === 'face.st.tired' && U.faces[1] === null && U.faces[2] === null && U.faces[3] === 'face.doctor.normal', `staffFaceName maps only game roles (${U.faces})`);
  const exp = { delighted: '3:delighted', content: '2:content', neutral: '1:neutral', angry: '0:angry', impatient: '0:angry', longWait: '1:neutral', treating: '2:content', leaveAngry: '0:angry', leaveCured: '3:delighted', slippedOld: '1:neutral', slippedLow: '0:pain', lowRecovery: '0:pain', slipNow: '0:pain', slipLater: '3:delighted' };
  for (const k of Object.keys(exp)) ok(U.pat[k] === exp[k], `patientMood ${k}: ${U.pat[k]} (want ${exp[k]})`);
  ok(JSON.stringify(U.table) === JSON.stringify({ elder: [0, 1, 2, 3], office: [0, 1, 2, 3], kid: [2, 1, 0, 3], sports: [1, 0, 2, 3] }), `verified expr tile order ${JSON.stringify(U.table)}`);
  ok(U.exprNames.join() === 'expr.kid.2,expr.kid.1,expr.kid.0,expr.kid.3', 'patientExprName follows the table');
  ok(U.outcome.join() === 'happy,tired,normal,tired,happy' && U.net.join() === 'happy,tired,normal', `outcome / net mood (${U.outcome} | ${U.net})`);
  await page.context().close();
  void problems;
}

for (const [w, hh] of VIEWPORTS) {
  const tag = `${w}x${hh}`;
  const shots = (w === 390 || w === 1280);
  const { page, problems } = await open(w, hh, { mode: 'new' });
  await settle(page);
  const sid = await page.evaluate(() => { const s = __game.state.staff.find(x => x.role === 'doctor') || __game.state.staff[0]; return { id: s.id, role: s.role }; });
  const set = (props) => page.evaluate(([id, p]) => { Object.assign(__game.state.staff.find(s => s.id === id), p); }, [sid.id, props]);
  const face = () => page.evaluate(() => { const e = document.querySelector('.u-selcard .u-shead .u-bust'); return e && e._art.name; });
  const hint = () => page.evaluate(() => { const e = document.querySelector('.u-selcard .u-moodhint'); return e && !e.hidden ? e.textContent : null; });
  await set({ stamina: 90, staminaMax: 100, morale: 60, tired: false, wantRest: false, state: 'idle' });
  await sel(page, 'staff', sid.id); await settle(page);
  ok(await face() === `face.${sid.role}.normal` && await hint() === '狀態平穩', `${tag} staff card: normal bust + hint (${await face()}, ${await hint()})`);
  await set({ morale: 20 }); await settle(page);
  ok(await face() === `face.${sid.role}.tired` && /心情|累|離職/.test(await hint() || ''), `${tag} staff card: low morale => tired bust (${await face()}, ${await hint()})`);
  if (shots) await shot(page, `mood_staff_tired_${tag}`);
  await set({ stamina: 10, morale: 60, tired: true }); await settle(page);
  ok(await hint() === '看起來很累', `${tag} staff card: exhausted hint (${await hint()})`);
  await set({ stamina: 95, morale: 90, tired: false, wantRest: false });
  await page.evaluate(async () => { (await import('/js/ui/moods.js')).resetMoods(); });
  await settle(page);
  ok(await face() === `face.${sid.role}.happy` && await hint() === '心情不錯', `${tag} staff card: high morale => happy bust (${await face()}, ${await hint()})`);
  if (shots) await shot(page, `mood_staff_happy_${tag}`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow with staff mood card: ${(await overflowX(page)).join(',')}`);
  await page.evaluate(() => { __game.ui.selected = null; __game.bus.emit('select:changed', { selected: null }); });

  // staff list: row bust follows the mood live, the row element is NOT rebuilt
  await page.keyboard.press('v'); await settle(page); await tab(page, '員工'); await settle(page);
  const row = () => page.evaluate(id => { const r = document.querySelector(`#panel .u-srow2[data-id="${id}"]`); if (!r) return null; r._mark = r._mark || Math.random(); const b = r.querySelector('.u-bust'); const hn = r.querySelector('.u-moodhint'); return { mark: r._mark, name: b && b._art.name, hint: hn && !hn.hidden ? hn.textContent : null }; }, sid.id);
  await set({ stamina: 90, morale: 60, tired: false }); await page.evaluate(async () => { (await import('/js/ui/moods.js')).resetMoods(); }); await settle(page);
  const r1 = await row();
  await set({ morale: 30 }); await settle(page);
  const r2 = await row();
  ok(r1 && r2 && r1.mark === r2.mark && r1.name === `face.${sid.role}.normal` && r2.name === `face.${sid.role}.tired`, `${tag} staff list bust updates in place (${r1 && r1.name} -> ${r2 && r2.name})`);
  ok(r2 && /心情|累|離職/.test(r2.hint || ''), `${tag} staff list mood hint (${r2 && r2.hint})`);
  const pool = await page.evaluate(() => [...document.querySelectorAll('#panel [data-cid] .u-bust')].map(e => e._art.name));
  ok(pool.length >= 1 && pool.every(n => /^face\.\w+\.normal$/.test(n)), `${tag} hire pool cards use the normal bust (${pool})`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in staff list / hire pool: ${(await overflowX(page)).join(',')}`);
  if (shots) {
    await set({ morale: 30 }); await settle(page);
    await shot(page, `mood_stafflist_${tag}`);
    await page.evaluate(() => document.querySelector('#panel [data-cid]')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
    await shot(page, `mood_hirepool_${tag}`);
  }
  await set({ morale: 70 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // result modal: doctor bust follows the applied effects
  const pending = (label, effects) => page.evaluate(async ([label, effects]) => {
    const d = { id: 'artui_t', title: '測試事件', text: '測試用決策。', choices: [{ label, effects, result: '結果文字。' }, { label: '略過', effects: {}, result: '什麼也沒發生。' }] };
    __game.state.events.pendingDilemma = d; __game.bus.emit('dilemma:show', { dilemma: d });
  }, [label, effects]);
  const resultFace = async (label, effects, nth = 0) => {
    await pending(label, effects); await page.waitForTimeout(250);
    await page.evaluate(i => document.querySelectorAll('.modal .u-choice')[i]?.click(), nth); await page.waitForTimeout(350);
    return page.evaluate(() => { const e = document.querySelector('.modal .u-resbody .u-bust'); return { name: e && e._art.name, title: document.querySelector('.modal-title')?.textContent }; });
  };
  let rf = await resultFace('好事', { reputation: 6, sat: 5 });
  ok(rf.name === 'face.doctor.happy', `${tag} result modal good outcome => doctor happy (${rf.name})`);
  if (shots) await shot(page, `mood_result_good_${tag}`);
  ok((await overflowX(page)).length === 0, `${tag} no overflow in result modal: ${(await overflowX(page)).join(',')}`);
  await closeAll(page); await page.waitForTimeout(250);
  rf = await resultFace('壞事', { money: -150000, reputation: -4 });
  ok(rf.name === 'face.doctor.tired', `${tag} result modal bad outcome => doctor tired (${rf.name})`);
  if (shots) await shot(page, `mood_result_bad_${tag}`);
  await closeAll(page); await page.waitForTimeout(250);
  rf = await resultFace('好事', {}, 1);
  ok(rf.name === 'face.doctor.normal', `${tag} result modal neutral outcome => doctor normal (${rf.name})`);
  await closeAll(page); await page.waitForTimeout(250);

  // staff event (resignation) -> tired face of the matching role
  await set({ morale: 10 });
  await page.evaluate(async ([role]) => {
    const d = { id: 'staff_resign', title: '員工遞出辭呈', text: '想休息一陣子。', choices: [{ label: '慰留', effects: { morale: { role, delta: 12 } }, result: 'ok' }, { label: '放行', effects: {}, result: 'bye' }] };
    __game.state.events.pendingDilemma = d; __game.bus.emit('dilemma:show', { dilemma: d });
  }, [sid.role]);
  await page.waitForTimeout(300);
  const sp = await page.evaluate(() => { const e = document.querySelector('.modal .u-speaker .u-art'); return e && e._art.name; });
  ok(sp === `face.${sid.role}.tired`, `${tag} resignation prompt shows the ${sid.role} tired face (${sp})`);
  if (shots) await shot(page, `mood_resign_${tag}`);
  await page.evaluate(() => document.querySelector('.modal .u-choice')?.click()); await page.waitForTimeout(300); await closeAll(page); await page.waitForTimeout(250);
  await set({ morale: 70 });

  // month report: doctor mood from the net
  for (const [net, want] of [[3000, 'happy'], [-3000, 'tired'], [0, 'normal']]) {
    await page.evaluate(n => __game.bus.emit('month:settled', { year: 1, month: 3, points: 1200, cap: 9000, pointValue: 1, nhiIncome: 1200, income: 5000, expense: 5000 - n, net: n }), net);
    await page.waitForTimeout(300);
    const nm = await page.evaluate(() => { const e = document.querySelector('.modal .u-rephead .u-bust'); return e && e._art.name; });
    ok(nm === `face.doctor.${want}`, `${tag} month report net ${net} => doctor ${want} (${nm})`);
    if (shots && net !== 0) await shot(page, `mood_report_${net > 0 ? 'profit' : 'loss'}_${tag}`);
    ok((await overflowX(page)).length === 0, `${tag} no overflow in month report (net ${net}): ${(await overflowX(page)).join(',')}`);
    await closeAll(page); await page.waitForTimeout(250);
  }

  // patient card at the four tiers
  const np = await ensurePatients(page);
  if (np) {
    const pid = await page.evaluate(() => __game.state.patients[0].id);
    const type = await page.evaluate(() => __game.state.patients[0].type);
    const table = { elder: [0, 1, 2, 3], office: [0, 1, 2, 3], kid: [2, 1, 0, 3], sports: [1, 0, 2, 3] }[type];
    const cases = [[10, 80, '焦躁', 0], [50, 80, '普通', 1], [68, 80, '滿意', 2], [95, 90, '超開心', 3]];
    for (const [satv, pat, label, tier] of cases) {
      await page.evaluate(([id, sv, pv]) => { const p = __game.state.patients.find(x => x.id === id); p.satisfaction = sv; p.patience = pv; p.hp = 0.4; p.waitedMin = 5; p.stage = 'waiting'; p.flags = {}; }, [pid, satv, pat]);
      await sel(page, 'patient', pid); await settle(page);
      const got = await page.evaluate(() => { const m = document.querySelector('.u-selcard .u-art-tile'); const l = document.querySelector('.u-selcard .u-moodlbl'); return { tile: m && m._art.name, label: l && !l.hidden ? l.textContent : null }; });
      ok(got.tile === `expr.${type}.${table[tier]}` && (got.label || '').includes(label), `${tag} patient card tier ${tier}: ${got.tile} / ${got.label} (want expr.${type}.${table[tier]} ${label})`);
      if (shots) await shot(page, `mood_patient_t${tier}_${tag}`);
      ok((await overflowX(page)).length === 0, `${tag} no overflow patient card tier ${tier}: ${(await overflowX(page)).join(',')}`);
    }
    await page.evaluate(() => { __game.ui.selected = null; __game.bus.emit('select:changed', { selected: null }); });
    await page.keyboard.press('v'); await settle(page); await tab(page, '病患').catch(() => {}); await settle(page);
    const rowTxt = await page.evaluate(() => [...document.querySelectorAll('#panel .u-prow .u-moodlbl')].filter(e => !e.hidden).map(e => e.textContent));
    ok(rowTxt.length >= 1 && rowTxt.every(t => /焦躁|痛|普通|滿意|超開心/.test(t)), `${tag} overview patient rows carry a mood label (${rowTxt.slice(0, 3)})`);
    if (shots) await shot(page, `mood_patientlist_${tag}`);
    ok((await overflowX(page)).length === 0, `${tag} no overflow in patient list: ${(await overflowX(page)).join(',')}`);
    await page.keyboard.press('Escape');
  } else console.log('note: no patient spawned');
  ok(problems.length === 0, `${tag} no console problems (moods) ` + problems.join(' | '));
  await page.context().close();
}

// classic style + blocked atlas: faces and mood texts vanish, the old emoji/text thumbnails stay
for (const mode of ['classic', 'blocked']) {
  const { page, problems } = await open(390, 844, { mode });
  await settle(page);
  const sid = await page.evaluate(() => __game.state.staff[0].id);
  await sel(page, 'staff', sid); await settle(page);
  const c = await page.evaluate(() => ({
    bust: document.querySelector('.u-selcard .u-bust')?.dataset.art, hint: !!document.querySelector('.u-selcard .u-moodhint:not([hidden])'),
    head: document.querySelector('.u-selcard .u-shead').textContent.length,
  }));
  ok(c.bust === 'off' || c.bust === 'none', `${mode}: staff card bust is not painted (${c.bust})`);
  ok(!c.hint && c.head > 2, `${mode}: staff card has no mood hint, keeps emoji + name`);
  await page.keyboard.press('v'); await settle(page); await tab(page, '員工'); await settle(page);
  const l = await page.evaluate(() => ({ on: document.querySelectorAll('#panel .u-bust[data-art="on"]').length, hint: document.querySelectorAll('#panel .u-moodhint:not([hidden])').length, off: document.querySelectorAll('#panel .u-bust[data-art="off"]').length }));
  ok(l.on === 0 && l.hint === 0 && l.off >= 1, `${mode}: staff list uses the emoji, no hints (${JSON.stringify(l)})`);
  ok((await overflowX(page)).length === 0, `${mode}: no overflow in staff list`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const d = { id: 'artui_t', title: '測試事件', text: '測試用決策。', choices: [{ label: '好事', effects: { reputation: 6 }, result: '結果文字。' }] };
    __game.state.events.pendingDilemma = d; __game.bus.emit('dilemma:show', { dilemma: d });
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.modal .u-choice')?.click()); await page.waitForTimeout(350);
  const rm = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.modal .u-bust')].some(e => e.dataset.art === 'on'), txt: document.querySelector('.modal-body')?.textContent.includes('你選擇了') }));
  ok(!rm.shown && rm.txt, `${mode}: result modal text intact, no bust`);
  await closeAll(page); await page.waitForTimeout(250);
  await page.evaluate(() => __game.bus.emit('month:settled', { year: 1, month: 3, points: 1200, cap: 9000, pointValue: 1, nhiIncome: 1200, income: 5000, expense: 4000, net: 1000 }));
  await page.waitForTimeout(300);
  const rep = await page.evaluate(() => { const e = document.querySelector('.modal .u-rephead'); return e ? getComputedStyle(e).display : 'none'; });
  ok(mode === 'classic' ? rep === 'none' : true, `${mode}: month report header hidden in classic (${rep})`);
  await closeAll(page);
  const bad = problems.filter(p => !(mode === 'blocked' && /Failed to load resource|net::ERR_FAILED|atlas/i.test(p)));
  ok(bad.length === 0, `${mode}: no console problems (moods) ` + bad.join(' | '));
  await page.context().close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
