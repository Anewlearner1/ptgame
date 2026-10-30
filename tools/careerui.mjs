// Career UI (目標 tab, red dot, toasts, year-review modal, ending modal, bankrupt ending) regression.
// The sim module js/sim/career.js is replaced by a fake served through page.route, so these checks are independent of the real sim
// (pass --real to run the smoke section against the real module as well).
// Usage: python3 -m http.server 8214 & node tools/careerui.mjs [--shots <dir>] [--url http://localhost:8214/index.html] [--real]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8214/index.html');
const shotDir = arg('shots', null);
const REAL = process.argv.includes('--real');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

// ---------------------------------------------------------------- fixtures
const FAKE_MODULE = `
const F = () => window.__careerFake || {};
export const CAREER_YEARS = 10;
export function initCareer() {}
export function ensureCareer(s) { return s.career; }
export function onboardingList() { return F().onboarding || []; }
export function currentGoals() { return F().goals || []; }
export function yearReviews() { return F().reviews || []; }
export function careerSummary(s) { return F().summary || { year: s.time.year, yearsLeft: 10, endless: !!(s.career && s.career.endless), ending: null, projected: null, avgGrade: '' }; }
export function computeYearScore() { return 55; }
export function computeEnding(s, o) { const f = F(); return o && o.bankrupt ? f.bankrupt : f.ending; }
export function setEndless(s, on) { s.career.endless = !!on; window.__endlessCalls = (window.__endlessCalls || 0) + 1; }
export function markExpandTabOpened() { window.__expandOpened = (window.__expandOpened || 0) + 1; }
export function careerCardText() { return F().card || ''; }
`;
const ONB = (n, done, o = {}) => ({ id: 'ob' + n, name: `任務${n}：${['讓第一位客人治療完畢', '擺一組候位座位', '鋪防滑地墊', '湊成黃金三寶區', '完成第一次月結算', '開始一項研發', '僱用第二位物理治療師', '調整一項自費價格', '辦一次社區活動', '查看年度評鑑條件'][n - 1]}`, desc: '把這件事做起來，就能學到一個核心系統。', hint: '到建造面板找找看', done, progress: done ? 1 : 0, target: 1, reward: { money: 20000 }, rewardText: '資金 +NT$ 20,000', ...o });
const FAKE = {
  onboarding: [ONB(1, true), ONB(2, true), ONB(3, false, { target: 6, progress: 2 }), ONB(4, false), ONB(5, false), ONB(6, false), ONB(7, false), ONB(8, false), ONB(9, false), ONB(10, false)],
  goals: [
    { id: 'core1', kind: 'core', name: '站穩腳步', desc: '年底聲譽 ≥ 60 且資金 ≥ 開局資金', progress: 42, target: 60, pct: 0.7, done: false, claimed: false, rewardText: '資金 +NT$ 60,000、聲譽 +3',
      conds: [{ key: 'rep', label: '年底聲譽', value: 42, target: 60, cmp: '>=', ok: false }, { key: 'money', label: '資金不低於開局', value: 1250000, target: 1200000, cmp: '>=', ok: true }] },
    { id: 'b1', kind: 'bonus', name: '零滑倒的一年', desc: '全年沒有客人滑倒', progress: 0, target: 1, pct: 1, done: true, claimed: true, rewardText: '資金 +NT$ 20,000', conds: [] },
    { id: 'b2', kind: 'bonus', name: '治癒 30 位客人', desc: '本年累計治癒人數', progress: 12, target: 30, pct: 0.4, done: false, claimed: false, rewardText: '醫術點 +8', conds: [{ key: 'cured', label: '治癒人數', value: 12, target: 30, cmp: '>=', ok: false }] },
  ],
  reviews: [
    { year: 1, grade: 'B', score: 66, dims: { fin: 70, rep: 64, care: 72, team: 55, local: 60 }, stats: { moneyDelta: 180000, patients: 820, repDelta: 55, cured: 310, events: 9, bogus: 5 }, goals: [{ id: 'core1', name: '站穩腳步', done: true }, { id: 'b1', name: '零滑倒的一年', done: false }], line: '第一年站穩了，繼續加油！', journal: '開業第一年，每天都像在打仗，但看到病人笑著走出去，一切都值得。' },
    { year: 2, grade: 'D', score: 33, dims: { fin: 20, rep: 40, care: 55, team: 30, local: 22 }, stats: { moneyDelta: -250000, patients: 700, repDelta: -4, cured: 200, events: 11 }, goals: [{ id: 'c2', name: '擴大門面', done: false }, { id: 'b3', name: '零離職', done: false }], line: '這一年很辛苦，穩住現金流最重要。' },
    { year: 3, grade: 'S', score: 93, dims: { fin: 95, rep: 98, care: 90, team: 88, local: 94 }, stats: { moneyDelta: 900000, patients: 1500, repDelta: 120, cured: 800, events: 14 }, goals: [{ id: 'c3', name: '通過督導', done: true }, { id: 'b4', name: '平均士氣 ≥ 70', done: true }], line: '漂亮的一年！餐廳成了街坊的招牌。', journal: '第三年，餐廳擴建完成，我終於敢說這是一間「正式」的復健中心。' },
  ],
  summary: { year: 4, yearsLeft: 7, endless: false, ending: null, scoreSoFar: 64, projected: { id: 'steady', title: '穩健的社區餐廳', emoji: '🏥' }, avgGrade: 'B' },
  ending: { id: 'steady', title: '穩健的社區餐廳', emoji: '🏥', thanks: ['十年了，這間餐廳陪著整個社區一起變老也變健康。', '謝謝每一位病人，也謝謝每一位夥伴。'], score: 71, grade: 'B',
    stats: { totalIncome: 123456789, totalPatients: 18234, totalCured: 9120, eventsHandled: 88, achievementsDone: 21, peakReputation: 412, finalLot: 2, topTreatment: 'heat', unknownKey: 1 } },
  bankrupt: { id: 'bankrupt', title: '提早收攤', emoji: '🪧', thanks: '資金見底了，但這段經驗是寶貴的。下一次，一定能更穩。', score: 31, grade: 'D', stats: { totalIncome: 4567890, totalPatients: 1200, totalCured: 500, eventsHandled: 12, peakReputation: 90, finalLot: 0 } },
  card: '🏥 幸福復健科餐廳｜穩健的社區餐廳\n最終評等 B（71 分）\n歷年評等：1B 2D 3S\n— 餐廳物語',
};
const REV = (year, grade, score, extra = {}) => ({ year, grade, score, dims: { fin: 60, rep: 50, care: 70, team: 40, local: 55 }, stats: { moneyDelta: 120000, patients: 900, repDelta: 20, cured: 300, events: 8 }, goals: [{ id: 'g', name: '站穩腳步', done: true }, { id: 'h', name: '零滑倒', done: false }], line: '本年評語。', ...extra });

// mode: 'new' | 'classic' | 'blocked'
async function open(w, h, { mode = 'new', tutorial = false, fake = FAKE, real = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  if (mode === 'blocked') await page.route(/assets\/art\/atlas\.(png|json)/, r => r.abort());
  if (!real) await page.route(/\/js\/sim\/career\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_MODULE }));
  await page.addInitScript(([m, first, fk]) => {
    window.__careerFake = JSON.parse(JSON.stringify(fk));
    window.__clip = null;
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } });
    } catch (e) { /* ignore */ }
    try { if (first && !sessionStorage.getItem('careerui-init')) { sessionStorage.setItem('careerui-init', '1'); localStorage.clear(); if (m === 'classic') localStorage.setItem('restgame.art', 'classic'); } } catch (e) { /* ignore */ }
  }, [mode, true, fake]);
  await page.goto(url); await page.waitForTimeout(1500);
  if (!tutorial) await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); });
  await page.evaluate(() => { try { __game.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } });
  await page.waitForTimeout(200);
  return { page, ctx, problems };
}
const shot = (page, n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const overflow = page => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + innerWidth);
  for (const s of ['#panel', '.modal', '.modal-body']) {
    const e = document.querySelector(s);
    if (!e || e.hidden) continue;
    if (e.scrollWidth > e.clientWidth + 1) bad.push(`${s} ${e.scrollWidth}>${e.clientWidth}`);
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(s + ' outside viewport');
  }
  const m = document.querySelector('.modal');
  if (m && m.getBoundingClientRect().height > innerHeight * 0.92 + 2) bad.push('modal taller than 92dvh ' + Math.round(m.getBoundingClientRect().height));
  // any element wider than its scroll container
  for (const e of document.querySelectorAll('.modal *, #panel *')) { if (e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.children.length === 0 && e.clientWidth > 0 && !e.closest('.tabs')) { bad.push('clip ' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth); break; } }
  return bad;
});
const emit = (page, ev, p) => page.evaluate(([e, x]) => __game.bus.emit(e, x), [ev, p]);
const closeAll = page => page.evaluate(() => { for (let i = 0; i < 8; i++) { const b = document.querySelector('.modal .modal-actions .btn.primary, .modal .modal-actions .btn'); if (!b) break; b.click(); } });
const modalTitle = page => page.evaluate(() => document.querySelector('.modal .modal-title')?.textContent || '');
const panelOpen = async (page, key = 'c') => { await page.keyboard.press(key); await wait(page, 400); };
const goalsTab = async page => { await page.click('#panel .tab:has-text("目標")'); await wait(page, 350); };
const gradeOf = page => page.evaluate(() => document.querySelector('.modal .u-grade')?.textContent);
const bustName = page => page.evaluate(() => { const e = document.querySelector('.modal .u-bust'); return e && e._art && e._art.name; });
const REALISH = problems => problems.filter(p => !/goals\.js|status of 404/.test(p));

const VIEWPORTS = [[390, 844], [360, 740], [844, 390], [1280, 720]];

// ======================================================================= 1. 目標 tab content / behaviour (concept style, 390x844)
{
  const fresh = { ...FAKE, onboarding: FAKE.onboarding.map(t => ({ ...t, done: false, progress: 0 })) };
  const { page, problems } = await open(390, 844, { mode: 'new', fake: fresh });
  ok(await page.evaluate(() => document.documentElement.classList.contains('style-concept')), 'concept style active');
  // red dot: fresh game with undone onboarding tasks -> visible on 餐廳 button
  await wait(page, 900);
  ok(await page.evaluate(() => { const d = document.querySelector('#sidebar .sidebar-btn[data-p="clinic"] .u-dot'); return !!d && !d.hidden; }), 'red dot visible on 餐廳 button for unseen tasks');
  await shot(page, 'dot_390x844');
  await panelOpen(page);
  await page.evaluate(src => { window.__careerFake.onboarding = src; __game.bus.emit('career:changed', {}); }, FAKE.onboarding);
  ok((await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].map(t => t.textContent)))[0].includes('目標'), '目標 is the first clinic tab');
  ok(await page.evaluate(() => /經營方針/.test(document.querySelector('#panel .tab.active')?.textContent || '')), 'default tab stays 經營方針 (existing flows unchanged)');
  await goalsTab(page);
  ok(await page.evaluate(() => /目標/.test(document.querySelector('#panel .tab.active')?.textContent || '')), '目標 tab active');
  const c = await page.evaluate(() => ({
    tasks: document.querySelectorAll('#panel .u-obtask').length,
    todo: document.querySelectorAll('#panel .u-ob-list:not(details *) > .u-obtask').length,
    doneIn: document.querySelectorAll('#panel .u-ob-donebox .u-obtask').length,
    count: document.querySelector('#panel .u-ob-count')?.textContent,
    prog: [...document.querySelectorAll('#panel .u-obtask')].filter(e => e.querySelector('.u-ob-prog') && !e.querySelector('.u-ob-prog').hidden).length,
    goals: document.querySelectorAll('#panel .u-goal').length,
    core: document.querySelectorAll('#panel .u-goal.core').length,
    firstIsCore: document.querySelector('#panel .u-goal')?.classList.contains('core'),
    conds: document.querySelectorAll('#panel .u-cond').length, condOk: document.querySelectorAll('#panel .u-cond.ok').length,
    hint: document.querySelector('#panel .u-career')?.textContent.match(/(還剩|剩餘) \d+ 個月|年底前最後一個月/)?.[0],
    pills: document.querySelectorAll('#panel .u-tl-pill').length,
    pillGrades: [...document.querySelectorAll('#panel .u-tl-pill')].slice(0, 4).map(p => p.textContent.replace(/\d+/, '')),
    cur: document.querySelector('#panel .u-tl-pill.cur')?.dataset.year,
    rev: document.querySelectorAll('#panel .u-rev').length, firstRev: document.querySelector('#panel .u-rev')?.dataset.year,
    sum: document.querySelector('#panel .u-cs')?.textContent,
    rewardChips: document.querySelectorAll('#panel .u-ob-rew:not([hidden])').length,
  }));
  ok(c.tasks === 10 && c.doneIn === 2 && c.todo === 8, `onboarding: 10 tasks, 2 collapsed as done (${c.tasks}/${c.doneIn}/${c.todo})`);
  ok(c.count === '2/10', `counter 2/10 (${c.count})`);
  ok(c.prog === 1, `progress bar only for target>1 task (${c.prog})`);
  ok(c.goals === 3 && c.core === 1 && c.firstIsCore, `3 goals, core first/highlighted (${c.goals}/${c.core})`);
  ok(c.conds === 3 && c.condOk === 1, `condition rows with ✔/✘ (${c.conds}/${c.condOk})`);
  ok(!!c.hint, `months-left hint (${c.hint})`);
  ok(c.pills === 10 && c.pillGrades.join(',') === 'B,D,S,·' || c.pills === 10 && c.pillGrades.join(',') === 'B,D,S,…', `timeline 10 pills with grades (${c.pillGrades})`);
  ok(c.cur === '4', `current year pill (${c.cur})`);
  ok(c.rev === 3 && c.firstRev === '3', `review list newest first (${c.rev}/${c.firstRev})`);
  ok(/生涯第 4 年 \/ 共 10 年/.test(c.sum) && /穩健的社區餐廳/.test(c.sum) && /🏥/.test(c.sum) && /平均評等 B/.test(c.sum), `career summary line (${c.sum.slice(0, 60)})`);
  ok((await overflow(page)).length === 0, 'no overflow in 目標 tab: ' + (await overflow(page)).join(','));
  // red dot cleared by viewing
  await wait(page, 700);
  ok(await page.evaluate(() => document.querySelector('#sidebar .sidebar-btn[data-p="clinic"] .u-dot').hidden), 'red dot cleared while the 目標 tab is viewed');
  await page.evaluate(async () => { document.querySelector('#panel').scrollTop = 0; });
  await wait(page, 150);
  await shot(page, 'goals_390x844');
  await page.evaluate(async () => { const { layout } = await import('/js/ui/layout.js'); const { applySheet } = await import('/js/ui/sheet.js'); layout.sheetFrac = 0.9; applySheet(); document.querySelector('#panel').scrollTop = 0; });
  await wait(page, 300);
  await shot(page, 'goals_full_390x844');
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 560; });
  await wait(page, 150);
  await shot(page, 'goals_full2_390x844');
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 1200; });
  await wait(page, 150);
  await shot(page, 'goals_full3_390x844');
  await page.evaluate(async () => { const { layout } = await import('/js/ui/layout.js'); const { applySheet } = await import('/js/ui/sheet.js'); layout.sheetFrac = 0.55; applySheet(); });
  // expand a review via timeline pill
  await page.click('#panel .u-tl-pill[data-year="3"]'); await wait(page, 300);
  ok(await page.evaluate(() => document.querySelector('#panel .u-rev[data-year="3"]').open && !!document.querySelector('#panel .u-rev[data-year="3"] .u-dim')), 'tap pill expands that year review (dims shown)');
  ok(await page.evaluate(() => document.querySelectorAll('#panel .u-rev[data-year="3"] .u-dim.best').length === 1 && document.querySelectorAll('#panel .u-rev[data-year="3"] .u-dim.worst').length === 1), 'strongest / weakest highlighted');
  await shot(page, 'goals_review_390x844');
  // hide onboarding
  await page.evaluate(() => document.querySelector('#panel')?.scrollTo(0, 0));
  await page.click('#panel .u-ob-hide'); await wait(page, 300);
  ok(await page.evaluate(() => document.querySelector('#panel .u-ob').hidden && __game.state.career.onboarding.hidden === true && !document.querySelector('#panel .u-ob-show').hidden), '隱藏 hides the checklist and keeps a 顯示 button');
  await page.click('#panel .u-ob-show'); await wait(page, 300);
  ok(await page.evaluate(() => !document.querySelector('#panel .u-ob').hidden), '顯示新手任務 restores it');

  // in-place update: progress change + goal done, no row rebuild
  const before = await page.evaluate(() => { const e = document.querySelector('#panel .u-goal[data-goal="b2"]'); e.__mark = 1; return document.querySelector('#panel .u-goal[data-goal="b2"] .u-gptxt').textContent; });
  await page.evaluate(() => { const f = window.__careerFake; f.goals[2].progress = 30; f.goals[2].done = true; f.goals[2].pct = 1; f.goals[2].conds[0].value = 30; f.goals[2].conds[0].ok = true; __game.bus.emit('career:changed', {}); });
  await wait(page, 450);
  const after = await page.evaluate(() => ({ same: document.querySelector('#panel .u-goal[data-goal="b2"]').__mark === 1, stat: document.querySelector('#panel .u-goal[data-goal="b2"] .u-gstat').textContent, txt: document.querySelector('#panel .u-goal[data-goal="b2"] .u-gptxt').textContent }));
  ok(after.same && /已達成/.test(after.stat), `in-place goal update, no rebuild (${before} -> ${after.txt}, ${after.stat})`);

  // toast on goal-done (no sim toast) and on onboarding-done
  await emit(page, 'career:goal-done', { goal: { id: 'b2', name: '治癒 30 位客人' }, rewardText: '醫術點 +8' }); await wait(page, 250);
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /目標達成/.test(t.textContent) && /治癒 30 位客人/.test(t.textContent) && /醫術點 \+8/.test(t.textContent) && t.classList.contains('good'))), 'toast on career:goal-done (good, with reward)');
  await emit(page, 'career:onboarding-done', { task: { id: 'ob3', name: '鋪防滑地墊' }, rewardText: '資金 +NT$ 20,000' }); await wait(page, 250);
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /新手任務完成/.test(t.textContent) && /鋪防滑地墊/.test(t.textContent))), 'toast on career:onboarding-done');
  // no duplicate when the sim already toasted (same tick)
  await page.evaluate(() => { for (const t of document.querySelectorAll('.toast')) t.remove(); });
  await page.evaluate(() => { __game.bus.emit('toast', { text: '🎯 目標達成：零滑倒的一年　資金 +NT$ 20,000', kind: 'good' }); __game.bus.emit('career:goal-done', { goal: { id: 'b1', name: '零滑倒的一年' }, rewardText: '資金 +NT$ 20,000' }); });
  await wait(page, 300);
  ok(await page.evaluate(() => document.querySelectorAll('.toast').length) === 1, 'no duplicate toast when the sim already announced the goal');
  await page.evaluate(() => { for (const t of document.querySelectorAll('.toast')) t.remove(); });
  await page.evaluate(() => { __game.bus.emit('career:goal-done', { goal: { id: 'b1', name: '零滑倒的一年' }, rewardText: 'x' }); __game.bus.emit('toast', { text: '🎯 目標達成：零滑倒的一年　x', kind: 'good' }); });
  await wait(page, 300);
  ok(await page.evaluate(() => document.querySelectorAll('.toast').length) === 1, 'no duplicate when the sim toast comes right after the event');

  // red dot comes back for a new item when the tab is not being viewed
  await page.click('#panel .tab:has-text("經營方針")'); await wait(page, 300);
  await page.evaluate(() => { const f = window.__careerFake; f.onboarding[3].done = true; f.onboarding[3].progress = 1; __game.bus.emit('career:changed', {}); });
  await wait(page, 900);
  ok(await page.evaluate(() => { const d = document.querySelector('#sidebar .sidebar-btn[data-p="clinic"] .u-dot'); const t = document.querySelector('#panel .u-dot-tab'); return !d.hidden && t && !t.hidden; }), 'red dot returns (button + tab) for a newly finished task');
  await page.click('#panel .tab:has-text("擴建")'); await wait(page, 300);
  ok(await page.evaluate(() => window.__expandOpened >= 1), 'opening 擴建 tab calls markExpandTabOpened');
  ok(REALISH(problems).length === 0, 'no console problems on the 目標 tab: ' + REALISH(problems).slice(0, 3).join(' | '));
  await page.context().close();
}

// ======================================================================= 2. year-review modal: S and D, both styles
for (const mode of ['new', 'classic']) {
  for (const [w, h] of [[390, 844], [1280, 720]]) {
    const tag = `${mode}-${w}x${h}`;
    const { page, problems } = await open(w, h, { mode });
    // S
    await emit(page, 'career:year-review', { review: FAKE.reviews[2] }); await wait(page, 500);
    ok(/第 3 年 年度總結/.test(await modalTitle(page)), `${tag} review modal title`);
    ok(await gradeOf(page) === 'S', `${tag} grade badge S`);
    const s = await page.evaluate(() => ({
      mood: document.querySelector('.u-review')?.dataset.mood, bust: document.querySelector('.modal .u-bust')?._art?.name, bustShown: !!document.querySelector('.modal .u-rv-bust') && getComputedStyle(document.querySelector('.modal .u-rv-bust')).display !== 'none',
      banner: document.querySelector('.modal .u-banner')?.dataset.art,
      stats: [...document.querySelectorAll('.modal .u-rv-stat')].map(e => e.dataset.stat), dims: document.querySelectorAll('.modal .u-dim').length,
      up: document.querySelectorAll('.modal .u-dim .u-dl-up').length, dn: document.querySelectorAll('.modal .u-dim .u-dl-dn').length,
      best: document.querySelector('.modal .u-dim.best')?.dataset.dim, worst: document.querySelector('.modal .u-dim.worst')?.dataset.dim,
      goals: [...document.querySelectorAll('.modal .u-rv-goals .u-check')].map(e => e.textContent.trim().charAt(0)).join(''),
      quotes: document.querySelectorAll('.modal .u-quote').length, line: document.querySelector('.modal .u-quote-t')?.textContent,
      btns: [...document.querySelectorAll('.modal-actions .btn')].map(b => b.textContent), actionsInView: (() => { const a = document.querySelector('.modal-actions').getBoundingClientRect(); return a.bottom <= innerHeight + 1; })(),
    }));
    ok(s.mood === 'happy', `${tag} S mood happy`);
    if (mode === 'new') { ok(s.bust === 'face.doctor.happy' && s.bustShown, `${tag} S doctor bust happy (${s.bust})`); ok(s.banner === 'on', `${tag} banner art on`); }
    else ok(!s.bustShown, `${tag} classic hides the bust`);
    ok(s.stats.join() === 'moneyDelta,patients,repDelta,cured,events', `${tag} stats grid keeps known keys only (${s.stats})`);
    ok(s.dims === 5 && s.up === 5 && s.dn === 0, `${tag} five dims with ↑ deltas vs previous review (${s.dims}/${s.up}/${s.dn})`);
    ok(s.best === 'rep' && s.worst === 'team', `${tag} strongest/weakest (${s.best}/${s.worst})`);
    ok(s.goals === '✔✔', `${tag} plan results (${s.goals})`);
    ok(s.quotes === 2 && /漂亮的一年/.test(s.line), `${tag} evaluation line + journal quote (${s.quotes})`);
    ok(s.btns.join() === '看生涯進度,下一年', `${tag} buttons (${s.btns})`);
    ok(s.actionsInView, `${tag} actions visible without scrolling the page`);
    ok((await overflow(page)).length === 0, `${tag} review overflow: ` + (await overflow(page)).join(','));
    await shot(page, `review_S_${tag}`);
    await closeAll(page); await wait(page, 200);
    // D (previous = year 1? no: year 2 has previous year 1)
    await emit(page, 'career:year-review', { review: FAKE.reviews[1] }); await wait(page, 500);
    ok(await gradeOf(page) === 'D', `${tag} grade badge D`);
    const d = await page.evaluate(() => ({ mood: document.querySelector('.u-review')?.dataset.mood, bust: document.querySelector('.modal .u-bust')?._art?.name, dn: document.querySelectorAll('.modal .u-dim .u-dl-dn').length, color: getComputedStyle(document.querySelector('.modal .u-grade')).backgroundColor }));
    ok(d.mood === 'tired', `${tag} D mood tired`);
    if (mode === 'new') ok(d.bust === 'face.doctor.tired', `${tag} D bust tired (${d.bust})`);
    ok(d.dn >= 3, `${tag} ↓ deltas for a worse year (${d.dn})`);
    ok(d.color === 'rgb(210, 78, 102)', `${tag} D badge coloured red (${d.color})`);
    ok((await overflow(page)).length === 0, `${tag} review D overflow: ` + (await overflow(page)).join(','));
    await shot(page, `review_D_${tag}`);
    // 看生涯進度 opens the 目標 tab
    await page.click('.modal-actions .btn:has-text("看生涯進度")'); await wait(page, 600);
    ok(await page.evaluate(() => !document.querySelector('.modal') && __game.ui.panel === 'clinic' && /目標/.test(document.querySelector('#panel .tab.active')?.textContent || '')), `${tag} 看生涯進度 closes the modal and opens 餐廳 > 目標`);
    ok(REALISH(problems).length === 0, `${tag} no console problems: ` + REALISH(problems).slice(0, 3).join(' | '));
    await page.context().close();
  }
}

// ======================================================================= 3. modal order + pause semantics
{
  const { page } = await open(390, 844, { mode: 'new' });
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 2 }));
  await wait(page, 100);
  // settlement + inspection + review emitted in the sim order, and in a "wrong" order (review before inspection) in the same tick
  await page.evaluate(() => {
    __game.bus.emit('month:settled', { year: 3, month: 12, points: 1000, cap: 9000, pointValue: 1, nhiIncome: 1000, income: 5000, expense: 4000, net: 1000 });
    __game.bus.emit('career:year-review', { review: window.__careerFake.reviews[2] });
    __game.bus.emit('inspection:result', { pass: true, score: 80, notes: ['ok'] });
  });
  await wait(page, 300);
  const order = [];
  for (let i = 0; i < 4; i++) {
    const t = await modalTitle(page); if (!t) break;
    order.push(/營運報告/.test(t) ? 'settle' : /督導/.test(t) ? 'inspection' : /年度總結/.test(t) ? 'review' : t);
    await page.evaluate(() => document.querySelector('.modal .modal-actions .btn.primary').click()); await wait(page, 200);
  }
  ok(order.join() === 'settle,inspection,review', `modal order settle -> inspection -> review even when the review event is first (${order})`);
  ok(await page.evaluate(() => __game.state.time.speed) === 2, 'closing the last modal resumes the previous speed (2)');
  // review then ending queue (ending last)
  await page.evaluate(() => { __game.bus.emit('career:ending', { ending: window.__careerFake.ending }); __game.bus.emit('career:year-review', { review: { ...window.__careerFake.reviews[2], year: 10 } }); __game.bus.emit('inspection:result', { pass: true, score: 80, notes: [] }); });
  await wait(page, 300);
  const o2 = [];
  for (let i = 0; i < 4; i++) {
    const t = await modalTitle(page); if (!t) break;
    o2.push(/督導/.test(t) ? 'inspection' : /年度總結/.test(t) ? 'review' : /生涯結算/.test(t) ? 'ending' : t);
    await page.evaluate(() => { const b = document.querySelector('.modal .modal-actions .btn.primary'); b.click(); }); await wait(page, 200);
  }
  ok(o2.slice(0, 3).join() === 'inspection,review,ending', `inspection -> review -> ending (${o2})`);
  await page.context().close();
}

// ======================================================================= 4. ending modal (normal) + continue / copy / restart
for (const mode of ['new', 'classic']) {
  for (const [w, h] of [[390, 844], [1280, 720]]) {
    const tag = `${mode}-${w}x${h}`;
    const { page, problems } = await open(w, h, { mode });
    await page.evaluate(() => __game.bus.emit('speed:set', { speed: 3 }));
    await emit(page, 'career:year-review', { review: { ...FAKE.reviews[2], year: 10 } });
    await emit(page, 'career:ending', { ending: FAKE.ending }); await wait(page, 500);
    ok(/年度總結/.test(await modalTitle(page)), `${tag} year-10 review first`);
    ok(await page.evaluate(() => document.querySelector('.modal-actions .btn.primary').textContent) === '看生涯結局', `${tag} year-10 review primary = 看生涯結局`);
    await page.evaluate(() => document.querySelector('.modal .modal-actions .btn.primary').click()); await wait(page, 400);
    ok(/生涯結算/.test(await modalTitle(page)), `${tag} ending modal after the review`);
    const e = await page.evaluate(() => ({
      title: document.querySelector('.modal .u-end-title')?.textContent, emoji: document.querySelector('.modal .u-end-emoji')?.textContent,
      quote: document.querySelector('.modal .u-quote-t')?.textContent, stats: [...document.querySelectorAll('.modal .u-end-stat')].map(s => s.dataset.stat + '=' + s.querySelector('b').textContent),
      grade: document.querySelector('.modal .u-grade')?.textContent, pills: document.querySelectorAll('.modal .u-tl-pill').length, note: !!document.querySelector('.modal .u-end-note'),
      btns: [...document.querySelectorAll('.modal-actions .btn')].map(b => b.textContent), bust: document.querySelector('.modal .u-bust')?._art?.name,
    }));
    ok(e.title === '穩健的社區餐廳' && e.emoji === '🏥', `${tag} ending title/emoji`);
    ok(/十年了/.test(e.quote), `${tag} 老闆感言 shown`);
    ok(e.stats.length === 8 && e.stats[0] === 'totalIncome=NT$ 123,456,789' && e.stats.includes('finalLot=地區復健中心') && e.stats.some(s => s.startsWith('topTreatment=') && !s.endsWith('=heat')), `${tag} stats card formatted (${e.stats.join(' | ')})`);
    ok(e.grade === 'B' && e.pills === 10, `${tag} grade + 10-year strip`);
    ok(e.note, `${tag} endless note`);
    ok(e.btns.includes('繼續經營') && e.btns.includes('重新開始') && e.btns.includes('複製生涯卡'), `${tag} buttons (${e.btns})`);
    if (mode === 'new') ok(e.bust === 'face.doctor.normal', `${tag} bust mood for B (${e.bust})`);
    ok((await overflow(page)).length === 0, `${tag} ending overflow: ` + (await overflow(page)).join(','));
    await shot(page, `ending_${tag}`);
    // copy card
    await page.click('.modal-actions .btn:has-text("複製生涯卡")'); await wait(page, 300);
    const clip = await page.evaluate(() => window.__clip);
    ok(clip === FAKE.card, `${tag} 複製生涯卡 writes careerCardText to the clipboard`);
    ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /已複製/.test(t.textContent))) && !!(await modalTitle(page)), `${tag} copy toasts and keeps the modal open`);
    // restart needs a second press
    await page.click('.modal-actions .btn:has-text("重新開始")'); await wait(page, 150);
    ok(await page.evaluate(() => /再按一次/.test([...document.querySelectorAll('.modal-actions .btn')].map(b => b.textContent).join('|')) && !!document.querySelector('.modal')), `${tag} 重新開始 asks for confirmation`);
    // continue
    await page.click('.modal-actions .btn.primary'); await wait(page, 400);
    const c = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), endless: __game.state.career.endless, calls: window.__endlessCalls, speed: __game.state.time.speed }));
    ok(!c.modal && c.endless === true && c.calls === 1 && c.speed === 3, `${tag} 繼續經營 sets endless, closes and resumes speed (${JSON.stringify(c)})`);
    ok(REALISH(problems).length === 0, `${tag} no console problems: ` + REALISH(problems).slice(0, 3).join(' | '));
    await page.context().close();
  }
}

// ======================================================================= 5. copy fallback (no clipboard API), restart confirm, bankrupt ending
{
  const { page, problems } = await open(390, 844, { mode: 'new' });
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); document.execCommand = () => { window.__execCopied = document.activeElement && document.activeElement.value; return true; }; });
  await emit(page, 'career:ending', { ending: FAKE.ending }); await wait(page, 400);
  await page.click('.modal-actions .btn:has-text("複製生涯卡")'); await wait(page, 300);
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /已複製/.test(t.textContent))), 'copy falls back to the textarea + execCommand path');
  // restart: two presses -> newGame (clock back to year 1)
  await page.evaluate(() => { __game.state.time.year = 7; });
  await page.click('.modal-actions .btn:has-text("重新開始")'); await wait(page, 100);
  await page.click('.modal-actions .btn:has-text("再按一次")'); await wait(page, 500);
  ok(await page.evaluate(() => __game.state.time.year === 1 && !document.querySelector('.modal')), '重新開始 (confirmed) starts a new game');
  await page.context().close();
  void problems;
}
{
  const { page, problems } = await open(390, 844, { mode: 'new' });
  await page.evaluate(() => { __game.state.flags.gameOver = true; });
  await emit(page, 'game:over', { reason: '資金低於 NT$ -300,000，餐廳宣告破產。' }); await wait(page, 500);
  const b = await page.evaluate(() => ({ title: document.querySelector('.modal .u-end-title')?.textContent, mt: document.querySelector('.modal .modal-title')?.textContent, btns: [...document.querySelectorAll('.modal-actions .btn')].map(x => x.textContent), reason: document.querySelector('.modal .u-end-reason')?.textContent, tag: !!document.querySelector('.u-endmodal') }));
  ok(b.title === '提早收攤' && /遊戲結束/.test(b.mt) && /提早收攤/.test(b.mt) && b.tag, `bankrupt: game:over shows the career ending (${b.title})`);
  ok(!b.btns.includes('繼續經營') && b.btns.includes('重新開業') && b.btns.includes('複製生涯卡'), `bankrupt buttons (${b.btns})`);
  ok(/破產/.test(b.reason || ''), 'bankrupt reason line');
  ok((await overflow(page)).length === 0, 'bankrupt overflow: ' + (await overflow(page)).join(','));
  await shot(page, 'bankrupt_390x844');
  // the career:ending (bankrupt) event arriving after game:over must not stack a second modal
  await emit(page, 'career:ending', { ending: FAKE.bankrupt }); await wait(page, 300);
  ok(await page.evaluate(() => document.querySelectorAll('.modal').length) === 1, 'bankrupt event after game:over does not stack a second modal');
  await page.evaluate(() => { __game.state.time.year = 5; });
  await page.click('.modal-actions .btn:has-text("重新開業")'); await wait(page, 500);
  ok(await page.evaluate(() => __game.state.time.year === 1 && !document.querySelector('.modal')), 'bankrupt 重新開業 restarts with a single click (old game-over flow)');
  await page.context().close();
  void problems;
}
{
  // career data missing (no computeEnding result): the plain game-over modal still works
  const fake = { ...FAKE, bankrupt: null };
  const { page, problems } = await open(390, 844, { mode: 'new', fake });
  await emit(page, 'game:over', { reason: '資金低於 NT$ -300,000，餐廳宣告破產。' }); await wait(page, 400);
  ok(await page.evaluate(() => /遊戲結束/.test(document.querySelector('.modal .modal-title')?.textContent || '') && /重新開業/.test(document.querySelector('.modal-actions').textContent)), 'game over falls back to the classic modal when career data is missing');
  await emit(page, 'career:ending', { ending: FAKE.bankrupt }); await wait(page, 400);
  ok(await page.evaluate(() => /提早收攤/.test(document.querySelector('.modal .modal-title')?.textContent || '')), 'a later bankrupt career:ending replaces the plain game-over modal');
  ok(await page.evaluate(() => document.querySelectorAll('.modal').length) === 1, 'only one modal on screen');
  await page.context().close();
  void problems;
}

// ======================================================================= 6. tutorial hint
{
  const { page } = await open(390, 844, { mode: 'new', tutorial: true });
  await wait(page, 600);
  const n = await page.evaluate(() => { let k = 0; while (k < 12) { const nx = [...document.querySelectorAll('.modal-actions .btn')].find(b => /下一步/.test(b.textContent)); if (!nx) break; nx.click(); k++; } return k; });
  await wait(page, 200);
  const t = await page.evaluate(() => { const e = document.querySelector('.modal .u-intro-goal'); return e && { on: e.classList.contains('on'), vis: getComputedStyle(e).visibility, txt: e.textContent }; });
  ok(t && t.on && t.vis === 'visible' && /目標/.test(t.txt), `tutorial last step shows the 目標 hint after ${n} steps (${t && t.txt})`);
  await shot(page, 'tutorial_hint_390x844');
  await page.context().close();
}

// ======================================================================= 7. overflow matrix: 目標 tab + modals at 4 viewports x 2 styles; atlas blocked
for (const mode of ['new', 'classic', 'blocked']) {
  for (const [w, h] of VIEWPORTS) {
    const tag = `${mode}-${w}x${h}`;
    const { page, problems } = await open(w, h, { mode });
    await panelOpen(page); await goalsTab(page);
    await page.click('#panel .u-tl-pill[data-year="2"]').catch(() => {}); await wait(page, 300);
    let bad = await overflow(page);
    ok(bad.length === 0, `${tag} 目標 tab no overflow` + (bad.length ? ': ' + bad.join(',') : ''));
    if (mode === 'new') await shot(page, `goals_${w}x${h}`);
    await page.keyboard.press('Escape'); await wait(page, 200);
    await emit(page, 'career:year-review', { review: FAKE.reviews[2] }); await wait(page, 500);
    bad = await overflow(page);
    ok(bad.length === 0, `${tag} year review no overflow` + (bad.length ? ': ' + bad.join(',') : ''));
    if (mode === 'blocked') {
      const f = await page.evaluate(() => ({ fb: document.querySelector('.modal .u-rv-fb')?.textContent, vis: !!document.querySelector('.modal .u-rv-bust') && getComputedStyle(document.querySelector('.modal .u-rv-bust')).display !== 'none' }));
      ok(f.vis && !!f.fb, `${tag} blocked atlas: emoji face fallback (${f.fb})`);
    }
    if (mode === 'new' && w === 844) await shot(page, `review_S_${w}x${h}_${mode}`);
    await closeAll(page); await wait(page, 200);
    await emit(page, 'career:ending', { ending: FAKE.ending }); await wait(page, 500);
    bad = await overflow(page);
    ok(bad.length === 0, `${tag} ending no overflow` + (bad.length ? ': ' + bad.join(',') : ''));
    if (mode === 'new' && w === 844) await shot(page, `ending_${w}x${h}_${mode}`);
    const probs = REALISH(problems).filter(p => !(mode === 'blocked' && /atlas|ERR_FAILED|Failed to load resource/.test(p)));
    ok(probs.length === 0, `${tag} no console problems` + (probs.length ? ': ' + probs.slice(0, 3).join(' | ') : ''));
    await page.context().close();
  }
}

// ======================================================================= 8. real sim integration (js/sim/career.js + data/goals.js) - runs with --real
if (REAL) {
  const { page, problems } = await open(390, 844, { mode: 'new', real: true });
  await page.evaluate(async () => { (await import('/js/sim/events.js')).EVENT_TUNE.CHANCE = 0; });
  ok(await page.evaluate(() => { const d = document.querySelector('#sidebar .sidebar-btn[data-p="clinic"] .u-dot'); return !!d && !d.hidden; }), 'real: red dot on a brand-new game');
  await panelOpen(page); await goalsTab(page);
  const r = await page.evaluate(() => ({ tasks: document.querySelectorAll('#panel .u-obtask').length, goals: document.querySelectorAll('#panel .u-goal').length, core: document.querySelectorAll('#panel .u-goal.core').length, pills: document.querySelectorAll('#panel .u-tl-pill').length, count: document.querySelector('#panel .u-ob-count')?.textContent }));
  ok(r.tasks === 10 && r.goals === 3 && r.core === 1 && r.pills === 10, `real: tab shows 10 tasks, 3 goals (1 core), 10 pills (${JSON.stringify(r)})`);
  // 擴建 tab -> onboarding #10 done: exactly one toast (the sim's), counter moves
  await page.click('#panel .tab:has-text("擴建")'); await wait(page, 500);
  const t10 = await page.evaluate(() => [...document.querySelectorAll('.toast')].filter(t => /新手任務完成/.test(t.textContent)).length);
  ok(t10 === 1, `real: finishing onboarding #10 by opening 擴建 gives exactly one toast (${t10})`);
  await page.click('#panel .tab:has-text("目標")'); await wait(page, 400);
  ok(await page.evaluate(() => /1\/10/.test(document.querySelector('#panel .u-ob-count').textContent) && document.querySelectorAll('#panel .u-ob-donebox .u-obtask').length === 1), 'real: counter 1/10 and the done task collapsed');
  await page.keyboard.press('Escape');
  // real year end: settle -> inspection -> review (order) and a real grade
  await page.evaluate(() => { const s = __game.state; s.time.month = 12; s.time.week = 4; s.time.clock = 1185; __game.bus.emit('speed:set', { speed: 3 }); });
  await wait(page, 3000);
  const seq = [];
  for (let i = 0; i < 5; i++) {
    const t = await modalTitle(page); if (!t) break;
    seq.push(/營運報告/.test(t) ? 'settle' : /督導/.test(t) ? 'inspection' : /年度總結/.test(t) ? 'review' : t);
    if (/年度總結/.test(t)) {
      const rv = await page.evaluate(() => ({ g: document.querySelector('.modal .u-grade')?.textContent, mood: document.querySelector('.u-review')?.dataset.mood, dims: document.querySelectorAll('.modal .u-dim').length, stats: document.querySelectorAll('.modal .u-rv-stat').length, goals: document.querySelectorAll('.modal .u-rv-goals .u-check').length, ov: document.documentElement.scrollWidth <= innerWidth }));
      ok(/^[SABCD]$/.test(rv.g) && rv.dims === 5 && rv.stats >= 5 && rv.goals === 3 && rv.ov, `real: review modal content (${JSON.stringify(rv)})`);
      await shot(page, 'real_review_390x844');
    }
    await page.evaluate(() => document.querySelector('.modal .modal-actions .btn.primary').click()); await wait(page, 250);
  }
  ok(seq.join() === 'settle,inspection,review', `real: modal order at year end (${seq})`);
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await panelOpen(page); await goalsTab(page);
  ok(await page.evaluate(() => document.querySelectorAll('#panel .u-rev').length === 1 && /1B|1A|1C|1D|1S/.test(document.querySelector('#panel .u-tl').textContent.replace(/\s/g, ''))), 'real: review appears in the tab list and timeline');
  await page.keyboard.press('Escape');
  // real ending at year 10 -> continue endless
  await page.evaluate(() => { const s = __game.state; s.time.year = 10; s.time.month = 12; s.time.week = 4; s.time.clock = 1185; __game.bus.emit('speed:set', { speed: 3 }); });
  await wait(page, 3000);
  const seq2 = [];
  for (let i = 0; i < 6; i++) {
    const t = await modalTitle(page); if (!t) break;
    if (/生涯結算/.test(t)) {
      seq2.push('ending');
      const e = await page.evaluate(() => ({ title: document.querySelector('.modal .u-end-title')?.textContent, stats: document.querySelectorAll('.modal .u-end-stat').length, quote: document.querySelector('.modal .u-quote-t')?.textContent.length, pills: document.querySelectorAll('.modal .u-tl-pill').length }));
      ok(e.title && e.stats === 8 && e.quote > 20 && e.pills === 10, `real: ending modal content (${JSON.stringify(e)})`);
      await shot(page, 'real_ending_390x844');
      await page.click('.modal-actions .btn:has-text("繼續經營")'); await wait(page, 300);
      ok(await page.evaluate(() => __game.state.career.endless === true && !document.querySelector('.modal')), 'real: 繼續經營 -> endless');
      break;
    }
    seq2.push(/營運報告/.test(t) ? 'settle' : /督導/.test(t) ? 'inspection' : /年度總結/.test(t) ? 'review' : t);
    await page.evaluate(() => document.querySelector('.modal .modal-actions .btn.primary').click()); await wait(page, 250);
  }
  ok(seq2.join() === 'settle,inspection,review,ending', `real: year-10 order settle,inspection,review,ending (${seq2})`);
  // real bankruptcy
  await page.evaluate(() => { const s = __game.state; s.money = -9e6; s.time.week = 4; s.time.clock = 1185; __game.bus.emit('speed:set', { speed: 3 }); });
  await wait(page, 3000);
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.querySelector('.u-endmodal[class*="modal"]') || [...document.querySelectorAll('.modal-title')].some(t => /遊戲結束/.test(t.textContent)))); i++) { await page.evaluate(() => document.querySelector('.modal .modal-actions .btn.primary')?.click()); await wait(page, 300); }
  const bk = await page.evaluate(() => ({ t: document.querySelector('.modal .modal-title')?.textContent, ending: document.querySelector('.u-ending')?.dataset.ending, n: document.querySelectorAll('.modal').length }));
  ok(/遊戲結束/.test(bk.t) && bk.ending === 'bankrupt' && bk.n === 1, `real: bankruptcy shows the career ending (${JSON.stringify(bk)})`);
  await shot(page, 'real_bankrupt_390x844');
  ok(REALISH(problems).length === 0, 'real: no console problems ' + REALISH(problems).slice(0, 3).join(' | '));
  await page.context().close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall careerui checks passed');
process.exit(failed ? 1 : 0);
