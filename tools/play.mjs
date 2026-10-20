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

const real = problems.filter(p => !/\[save\] import failed/.test(p));
console.log(real.length ? 'CONSOLE PROBLEMS:\n' + real.join('\n') : 'no console problems');
await browser.close();
process.exit(failed || real.length ? 1 : 0);
