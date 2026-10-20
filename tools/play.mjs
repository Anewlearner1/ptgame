// UI play-through regression: drives the game with REAL mouse clicks and asserts outcomes.
// Usage (server running: `python3 -m http.server 8201` in repo root):  node tools/play.mjs [--shots <dir>]
// Covers: build panel placement / rotate / floor drag-paint / demolish, golden3 zone, research via UI, pricing,
// community, focus, hire/train/fire, save/load/export/import, month-end + inspection + event/dilemma modals,
// sim-freeze while a decision is pending, expansion, game over. Exit code 1 on failed assertion or console problem.
import { launch, clickTile, dragTiles } from './lib.mjs';

const shotDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const { browser, page, problems } = await launch({ w: 1400, h: 800 });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const shot = n => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` });
const G = (fn, a) => page.evaluate(fn, a);
const side = async n => { await page.click(`#sidebar .sidebar-btn:nth-child(${n})`); await page.waitForTimeout(250); };
const tab = async (cls, name) => { await page.click(`#panel ${cls} :text-is("${name}")`).catch(() => page.click(`#panel .tab:text-is("${name}")`)); await page.waitForTimeout(120); };
const pick = async id => { await page.click(`#panel .u-item[data-id="${id}"]`); await page.waitForTimeout(80); };
const confirm = async () => { await page.waitForTimeout(150); await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].filter(b => !/取消/.test(b.textContent)).pop().click()); await page.waitForTimeout(200); };
const money = () => G(() => __game.state.money);
const nObj = () => G(() => __game.state.objects.length);
const closeModals = () => G(() => { for (let i = 0; i < 5; i++) document.querySelector('.modal .btn.primary, .modal .btn')?.click(); });

await G(() => { __game.bus.emit('speed:set', { speed: 0 }); __game.state.points = { medical: 5000, device: 5000, service: 5000 }; });

// --- build / paint / rotate / demolish
await side(1);
let m0 = await money(), o0 = await nObj();
await tab('.tabs', '候診與景觀'); await pick('plant'); await clickTile(page, 11, 18);
ok(await nObj() === o0 + 1 && await money() < m0, 'plant placed and paid');
await tab('.tabs', '設施'); await tab('.tabs', '物理治療區');
await pick('traction'); await page.keyboard.press('r'); await clickTile(page, 20, 12);
ok(await G(() => __game.state.zones.some(z => z.id === 'golden3')), 'golden3 zone active (heatbox+tens+traction, rotated with R)');
ok(await G(() => __game.state.mods.nhiTurnover > 1.19), 'golden3 raises nhiTurnover');
await tab('.tabs', '環境'); await tab('.tabs', '地板與通道');
m0 = await money(); await pick('floor_mat'); await dragTiles(page, [14, 18], [14, 13]);
ok(await G(() => __game.state.map.floor.filter((r, y) => r[14] === 'floor_mat').length) >= 5, 'floor drag-paint covers a line');
ok(await money() < m0, 'floor paint costs money');
await page.click('#panel .btn:has-text("拆除")'); o0 = await nObj(); m0 = await money();
await clickTile(page, 11, 18);
ok(await nObj() === o0 - 1 && await money() > m0, 'demolish refunds');
await page.keyboard.press('Escape');
await shot('play_build');

// --- research via UI + premium zone
await side(2);
await page.evaluate(async () => {
  const RS = await import('/js/sim/research.js');
  for (let i = 0; i < 40; i++) { const b = [...document.querySelectorAll('#panel .u-node .btn')].find(x => !x.disabled && !x.hidden); if (!b) { await new Promise(r => setTimeout(r, 250)); if (![...document.querySelectorAll('#panel .u-node .btn')].some(x => !x.disabled && !x.hidden)) break; continue; } b.click(); for (let k = 0; k < 6 && __game.state.research.current; k++) RS.tickWeek(__game.state); await new Promise(r => setTimeout(r, 220)); }
});
ok(await G(() => __game.state.research.done.length) >= 15, 'research started via UI and completed');
await tab('.tabs', '💲 自費定價'); await tab('.tabs', '🎪 社區衛教');
await page.click('#panel .btn.primary:text-is("舉辦")'); await page.waitForTimeout(200);
ok(await G(() => __game.state.events.active.some(a => a.kind === 'community')), 'community outreach started');
await side(1); await G(() => { __game.state.money = 3e6; });
await tab('.tabs', '設施'); await tab('.tabs', '運動與自費'); await pick('manual_room'); await clickTile(page, 11, 15);
await tab('.tabs', '特殊'); await pick('shockwave'); await clickTile(page, 13, 15); await pick('coffee'); await clickTile(page, 13, 16);
ok(await G(() => __game.state.zones.some(z => z.id === 'premium')), 'premium zone active');
await side(4); await tab('.tabs', '✨ 專區辭典');
ok(await G(() => document.querySelectorAll('#panel .card.selected').length) >= 2, 'zone dictionary shows active zones');

// --- staff / focus
await tab('.tabs', '🩺 員工');
const s0 = await G(() => __game.state.staff.length);
await page.click('#panel .btn.primary:text-is("雇用")'); await page.waitForTimeout(200);
ok(await G(() => __game.state.staff.length) === s0 + 1, 'hire');
await page.click('#panel .btn:text-is("訓練")'); await page.waitForTimeout(150);
await page.click('#panel .btn.danger:text-is("解僱")'); await confirm();
ok(await G(() => __game.state.staff.length) === s0, 'fire');
await side(3); await page.click('#panel .u-focus[data-id="ltc"]');
ok(await G(() => __game.state.policy.focus) === 'ltc', 'focus changed');

// --- save / load / export / import
// (achievements are re-evaluated on every load and pay their reward once: settle them BEFORE taking the money snapshot)
await G(async () => { const A = await import(new URL('./js/sim/achievements.js', location.href).href); A.evaluateAll(__game.state); });
await side(6); await G(() => { __game.state.money = 777777; });
await page.click('#panel .card:nth-of-type(2) .btn.primary:text-is("存檔")'); await page.waitForTimeout(150);
await G(() => { __game.state.money = 1; });
await (await page.$$('#panel .card .btn:text-is("讀取")'))[1].click(); await confirm();
ok(await money() === 777777, 'save slot 1 + load');
await page.click('#panel .btn:text-is("匯出目前存檔")');
await G(() => { __game.state.money = 2; });
await page.click('#panel .btn.primary:text-is("匯入")'); await confirm();
ok(await money() === 777777, 'export + import');
await page.fill('#panel textarea', '{"state":{"objects":"x"}}'); await page.click('#panel .btn.primary:text-is("匯入")'); await confirm();
ok(await money() === 777777, 'garbage import rejected');
await page.click('#panel .panel-close');

// --- modals: month end, event freeze, year-end inspection, game over
await G(() => { const s = __game.state; s.time.week = 4; s.time.clock = 1185; s.nhi.monthPoints = 9e5; __game.bus.emit('speed:set', { speed: 3 }); });
await page.waitForTimeout(2500);
ok(await G(() => /營運報告/.test(document.querySelector('.modal-title')?.textContent || '')), 'month-end report modal');
ok(await G(() => /點值被稀釋/.test(document.querySelector('.modal')?.textContent || '')), 'NHI dilution explained');
await shot('play_month'); await closeModals();
await G(async () => { const E = await import('/js/sim/events.js'); __game.state.events.cooldowns = {}; E.triggerEvent(__game.state, 'li_chief'); });
await page.waitForTimeout(400);
const c1 = await G(() => __game.state.time.clock); await page.waitForTimeout(800);
ok(await G(() => __game.state.time.clock) === c1, 'sim frozen while event pending');
await page.keyboard.press('1'); await page.waitForTimeout(200); await closeModals();
ok(await G(() => !__game.state.events.pendingDilemma && !__game.state.time.paused), 'event resolved, sim resumes');
await G(() => { const s = __game.state; s.time.month = 12; s.time.week = 4; s.time.clock = 1185; __game.bus.emit('speed:set', { speed: 3 }); });
await page.waitForTimeout(2500);
let titles = []; for (let i = 0; i < 4; i++) { titles.push(await G(() => document.querySelector('.modal-title')?.textContent)); await G(() => document.querySelector('.modal .btn.primary')?.click()); await page.waitForTimeout(250); }
ok(titles.some(t => /督導/.test(t || '')), 'year-end inspection modal');
await G(() => { const s = __game.state; s.money = -9e6; s.time.week = 4; s.time.clock = 1185; __game.bus.emit('speed:set', { speed: 3 }); });
await page.waitForTimeout(2500);
ok(await G(() => [...document.querySelectorAll('.modal-title')].some(t => /遊戲結束/.test(t.textContent))), 'game over modal');
await shot('play_gameover');
await G(() => [...document.querySelectorAll('.modal .btn')].find(b => /重新開業/.test(b.textContent))?.click()); await page.waitForTimeout(600);
ok(await G(() => __game.state.objects.length === 7 && __game.state.money > 1e6), 'new game after game over');


// =====================================================================================================
// --- 成就 / 稱號與徽章 (S-F: UI + signboard). Kept in its own section; docs/ACHIEVEMENTS.md §5.4/§5.5
// =====================================================================================================
await closeModals();
await G(() => { __game.bus.emit('speed:set', { speed: 0 }); __game.state.reputation = 300; const A = __game.state.achv; A.title = null; A.badges = []; A.unlocked = {}; });
const unlockIds = ['m_first_month', 'm_cash_2m', 'm_pat_100', 'm_rep_100', 'm_rep_250', 'm_lot1', 'm_year3', 'c_zone_golden', 'c_zone_premium', 'c_zone_kidpark', 't_cold_week'];
await G(ids => { ids.forEach((id, i) => { __game.state.achv.unlocked[id] = { year: 1, month: 1 + (i % 12), week: 1 + (i % 4) }; }); }, unlockIds);
await page.keyboard.press('Escape');
await G(() => { __game.ui.panel = null; });
await page.waitForTimeout(250);
await side(3);
await page.click('#panel .tab:has-text("稱號與徽章")'); await page.waitForTimeout(350);
ok(await G(() => /11 \/ 41/.test(document.querySelector('#panel .u-achcount')?.textContent || '')), 'achv panel: unlocked counter 11 / 41');
ok(await G(() => document.querySelectorAll('#panel .u-ach').length) === 41, 'achv panel: 41 cards');
ok(await G(() => document.querySelectorAll('#panel .u-achtabs .tab').length) === 4, 'achv panel: category tabs (全部 + 3)');
await page.click('#panel .u-achtabs .tab:has-text("在地")'); await page.waitForTimeout(150);
ok(await G(() => [...document.querySelectorAll('#panel .u-ach')].filter(c => !c.hidden).every(c => c.dataset.cat === 'taiwan')), 'achv panel: category tab filters cards');
await page.click('#panel .u-achtabs .tab:has-text("挑戰")'); await page.waitForTimeout(150);
ok(await G(() => [...document.querySelectorAll('#panel .u-ach.u-masked')].filter(c => !c.hidden).length) >= 3
  && await G(() => [...document.querySelectorAll('#panel .u-ach.u-masked .u-achname')].every(n => n.textContent === '？？？')), 'achv panel: hidden achievements masked as ？？？');
await page.click('#panel .u-achtabs .tab:has-text("全部")'); await page.waitForTimeout(150);
const card = id => `#panel [data-ach="${id}"]`;
const canvasShot = async () => (await page.locator('#game').screenshot()).toString('base64');
await G(() => { __game.ui.panel = null; }); await page.waitForTimeout(250);
const sig0 = await canvasShot();
await side(3); await page.click('#panel .tab:has-text("稱號與徽章")'); await page.waitForTimeout(250);
// equip a title
await page.click(`${card('t_cold_week')} .btn:text-is("配戴稱號")`); await page.waitForTimeout(250);
ok(await G(() => __game.state.achv.title) === 't_cold_week', 'achv: equip title via button');
ok(await G(() => document.querySelector('#topbar .tb-title') && !document.querySelector('#topbar .tb-title').hidden && /〔寒流守護者〕/.test(document.querySelector('#topbar .tb-title').textContent)), 'achv: topbar shows 〔稱號〕');
ok(await G(() => /〔寒流守護者〕/.test(document.querySelector('#panel .u-curtitle').textContent)), 'achv panel: current title shows displayTitle');
ok(await G(() => document.querySelector('#panel [data-ach="t_cold_week"] .btn:not([hidden])').textContent) === '取消配戴', 'achv: equip button toggles to 取消配戴');
await page.click(`${card('t_cold_week')} .btn:text-is("取消配戴")`); await page.waitForTimeout(250);
ok(await G(() => __game.state.achv.title) === null && await G(() => document.querySelector('#topbar .tb-title').hidden), 'achv: unequip removes title from topbar');
await page.click(`${card('t_cold_week')} .btn:text-is("配戴稱號")`); await page.waitForTimeout(150);
// hang badges (max 3, 4th refused with a message)
for (const id of ['m_first_month', 'm_cash_2m', 'm_pat_100']) { await page.click(`${card(id)} .btn:text-is("掛上招牌")`); await page.waitForTimeout(120); }
ok(await G(() => __game.state.achv.badges.length) === 3, 'achv: 3 badges hung');
await page.click(`${card('m_rep_100')} .btn:text-is("掛上招牌")`); await page.waitForTimeout(200);
ok(await G(() => __game.state.achv.badges.length) === 3 && await G(() => !document.querySelector('#panel .u-achnote').hidden), 'achv: 4th badge refused with a notice');
await page.click(`${card('m_pat_100')} .btn:text-is("取下招牌")`); await page.waitForTimeout(150);
ok(await G(() => __game.state.achv.badges.join()) === 'm_first_month,m_cash_2m', 'achv: badge removed');
await page.click(`${card('m_pat_100')} .btn:text-is("掛上招牌")`); await page.waitForTimeout(150);
// signboard re-rendered with badges (canvas differs once the panel is closed again)
await G(() => { __game.ui.panel = null; }); await page.waitForTimeout(500);
ok(await canvasShot() !== sig0, 'achv: signboard / canvas changed after hanging badges');
await shot('play_achv');
// in-place refresh: a card keeps its DOM identity while an unlock event arrives
await side(3); await page.click('#panel .tab:has-text("稱號與徽章")'); await page.waitForTimeout(250);
await G(() => { document.querySelector('#panel [data-ach="c_zone_all"]')._keep = 1; __game.state.achv.unlocked.c_zone_all = { year: 1, month: 2, week: 2 }; __game.bus.emit('achievement:unlocked', { id: 'c_zone_all' }); });
await page.waitForTimeout(400);
ok(await G(() => document.querySelector('#panel [data-ach="c_zone_all"]')._keep === 1 && /已於/.test(document.querySelector('#panel [data-ach="c_zone_all"] .u-achwhen').textContent)), 'achv panel: unlock event refreshes cards in place');
// persistence across reload
await G(async () => { const S = await import('/js/sim/save.js'); S.saveGame(__game.state, 'auto'); });
await page.reload(); await page.waitForTimeout(1200); await closeModals();
ok(await G(() => __game.state.achv.title === 't_cold_week' && __game.state.achv.badges.length === 3), 'achv: title + badges survive reload');
ok(await G(() => /〔寒流守護者〕/.test(document.querySelector('#topbar .tb-title')?.textContent || '')), 'achv: topbar title after reload');
await G(() => { const A = __game.state.achv; A.title = null; A.badges = []; });

const real = problems.filter(p => !/\[save\] import failed/.test(p));
console.log(real.length ? 'CONSOLE PROBLEMS:\n' + real.join('\n') : 'no console problems');
await browser.close();
process.exit(failed || real.length ? 1 : 0);
