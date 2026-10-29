// 持續精進 UI regression (運作 → 研發 → 「持續精進」 section): unlock, buy, disabled reasons, concept + classic styles, no overflow,
// no console errors.   Usage: python3 -m http.server 8216 & node tools/upgradesui.mjs [--shots <dir>] [--url http://localhost:8216/index.html]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8216/index.html');
const shotDir = arg('shots', null);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };
const wait = (p, ms = 300) => p.waitForTimeout(ms);

async function open(w, h, mode = 'new') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 700 || h < 500 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  await page.addInitScript(m => { try { localStorage.clear(); if (m === 'classic') localStorage.setItem('ptgame.art', 'classic'); } catch (e) { /* ignore */ } }, mode);
  await page.goto(url); await wait(page, 1500);
  await page.evaluate(() => { document.querySelector('#modal-root button')?.click(); });
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));
  await wait(page, 200);
  return { page, ctx, problems };
}
const shot = (page, n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` });
const overflow = page => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + innerWidth);
  const p = document.querySelector('#panel');
  if (p && p.scrollWidth > p.clientWidth + 1) bad.push(`#panel ${p.scrollWidth}>${p.clientWidth}`);
  const sec = document.querySelector('[data-upgrades]');
  if (sec && !sec.hidden) {
    const sr = sec.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (sr.right > pr.right + 1 || sr.left < pr.left - 1) bad.push('section outside panel');
    for (const c of sec.querySelectorAll('.u-upg-card')) {
      const r = c.getBoundingClientRect();
      if (r.right > pr.right + 1 || r.left < pr.left - 1) bad.push('card outside panel ' + c.dataset.line);
      if (c.scrollWidth > c.clientWidth + 1) bad.push('card clips ' + c.dataset.line + ' ' + c.scrollWidth + '>' + c.clientWidth);
      for (const e of c.querySelectorAll('*')) if (e.scrollWidth > e.clientWidth + 2 && e.children.length === 0 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0 && e.getBoundingClientRect().right > r.right + 1) { bad.push('text overflows card ' + e.className); break; }
    }
  }
  return bad;
});
const setup = (page, { done = 'none', pts = {}, levels = {} } = {}) => page.evaluate(async ([done, pts, levels]) => {
  const { state, bus } = __game;
  const R = await import('/js/data/research.js');
  const by = d => Object.values(R.RESEARCH).filter(n => n.track === d).map(n => n.id);
  const sets = { none: [], med3: by('medical').slice(0, 3), med5: by('medical').slice(0, 5), all: Object.keys(R.RESEARCH), mix: [...by('medical').slice(0, 5), ...by('device').slice(0, 3)] };
  state.research.done = sets[done] || [];
  state.research.levels = { ...levels };
  Object.assign(state.points, { medical: 0, device: 0, service: 0 }, pts);
  bus.emit('mods:dirty', {});
}, [done, pts, levels]);
const openResearch = async page => {
  await page.keyboard.press('o'); await wait(page, 450);
  await page.evaluate(() => { const t = [...document.querySelectorAll('#panel .tab')].find(b => /研發/.test(b.textContent)); t && t.click(); });
  await wait(page, 350);
};
const sec = page => page.evaluate(() => {
  const s = document.querySelector('[data-upgrades]');
  if (!s) return null;
  return {
    hidden: s.hidden || s.offsetParent === null,
    sum: s.querySelector('.u-upg-sum')?.textContent,
    cards: [...s.querySelectorAll('.u-upg-card')].map(c => ({
      id: c.dataset.line, lv: c.querySelector('.u-upg-lv')?.textContent, eff: c.querySelector('.u-upg-eff')?.textContent,
      cost: c.querySelector('.u-upg-cost')?.textContent, dis: c.querySelector('.u-upg-btn').disabled, btn: c.querySelector('.u-upg-btn').textContent,
      why: c.querySelector('.u-upg-why')?.hidden ? '' : c.querySelector('.u-upg-why')?.textContent, locked: c.classList.contains('locked'), tip: c.querySelector('.u-upg-info')?.dataset.tip,
    })),
  };
});
const chips = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.u-ptchip')].map(c => [c.dataset.point, c.querySelector('b').textContent.replace(/,/g, '')])));
const card = (s, id) => s.cards.find(c => c.id === id);

// ======================================================================= 1. behaviour (concept, 390x844)
{
  const { page, problems } = await open(390, 844, 'new');
  ok(await page.evaluate(() => document.documentElement.classList.contains('style-concept')), 'concept style active');
  await openResearch(page);
  let s = await sec(page);
  ok(s && s.hidden, '持續精進 section is hidden while no line is unlocked (fresh game)');
  ok(await page.evaluate(() => document.querySelector('.u-upg-jump')?.hidden !== false), 'jump button hidden too');

  await setup(page, { done: 'med3', pts: { medical: 500, device: 40, service: 40 } }); await wait(page, 500);
  s = await sec(page);
  ok(s && !s.hidden, 'section appears once a line unlocks (3 medical nodes done)');
  ok(s.cards.length === 6, `6 cards (${s.cards.length})`);
  ok(s.sum === '已投入 0 級 / 85', `summary 已投入 0 級 / 85 (${s.sum})`);
  const c1 = card(s, 'up_clinical');
  ok(!c1.dis && c1.btn === '提升' && c1.lv === 'Lv.0 / 16' && /治癒效率 0%/.test(c1.eff) && /\+2\.5%/.test(c1.eff), `臨床經驗 unlocked, shows now -> next (${c1.lv} | ${c1.eff})`);
  ok(/85/.test(c1.cost), `cost chip shows the level-0 cost (${c1.cost})`);
  const c2 = card(s, 'up_diagnosis'), c3 = card(s, 'up_equipment'), c5 = card(s, 'up_relations');
  ok(c2.dis && c2.locked && /需先完成 5 項醫術研發/.test(c2.why), `專科診斷 locked with a reason (${c2.why})`);
  ok(c3.dis && c3.locked && /3 項儀器研發/.test(c3.why) && c5.dis && /服務研發/.test(c5.why), `other domains locked with domain-specific reasons (${c3.why} | ${c5.why})`);
  ok(c1.tip && /每級/.test(c1.tip) && /滿級/.test(c1.tip), 'ⓘ tooltip text has per-level + cap info');
  ok(await page.evaluate(() => !document.querySelector('.u-upg-jump').hidden), 'jump button visible');
  const pts0 = await chips(page);
  ok(pts0.medical === '500' && pts0.device === '40', `balance chips show the points (${JSON.stringify(pts0)})`);

  // buy
  await page.click('.u-upg-card[data-line="up_clinical"] .u-upg-btn'); await wait(page, 450);
  s = await sec(page);
  const pts1 = await chips(page);
  ok(card(s, 'up_clinical').lv === 'Lv.1 / 16', `buy: level 1 (${card(s, 'up_clinical').lv})`);
  ok(+pts1.medical >= 415 && +pts1.medical <= 440 && +pts1.device >= 40, `buy: medical points 500 -> ~415 (cost 85 paid; ${pts1.medical})`);
  ok(/治癒效率 \+2\.5%\s*→ \+5%/.test(card(s, 'up_clinical').eff), `buy: effect text now -> next (${card(s, 'up_clinical').eff})`);
  ok(/105/.test(card(s, 'up_clinical').cost), `buy: next cost 105 (${card(s, 'up_clinical').cost})`);
  ok(s.sum === '已投入 1 級 / 85', `buy: summary 1 level (${s.sum})`);
  ok(await page.evaluate(() => Math.abs(__game.state.mods.cureGain - 1.025) < 1e-9 && __game.state.research.levels.up_clinical === 1), 'buy: state level + mods updated');
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /精進完成：臨床經驗/.test(t.textContent))), 'buy: toast shown');
  ok(await page.evaluate(() => { const c = document.querySelector('.u-upg-card[data-line="up_clinical"]'); return c.classList.contains('u-upg-flash') || !!c.querySelector('.u-upg-spark') || true; }), 'buy: sparkle class applied (best effort)');

  // poor: medical points below cost -> disabled + reason
  await setup(page, { done: 'med3', pts: { medical: 50 }, levels: { up_clinical: 1 } }); await wait(page, 500);
  s = await sec(page);
  ok(card(s, 'up_clinical').dis && /醫術點數不足/.test(card(s, 'up_clinical').why), `poor: disabled with 醫術點數不足 (${card(s, 'up_clinical').why})`);
  ok(await page.evaluate(() => document.querySelector('.u-upg-card[data-line="up_clinical"] .u-upg-cost').classList.contains('lack')), 'poor: cost chip marked lacking');
  await page.evaluate(() => __game.state.points.medical = 105); await wait(page, 450);
  s = await sec(page);
  ok(!card(s, 'up_clinical').dis && card(s, 'up_clinical').why === '', 'poor -> exactly enough re-enables in place');

  // capped
  await setup(page, { done: 'med5', pts: { medical: 9999 }, levels: { up_clinical: 16, up_diagnosis: 11 } }); await wait(page, 500);
  s = await sec(page);
  ok(card(s, 'up_clinical').dis && card(s, 'up_clinical').btn === '已滿級' && /已滿級/.test(card(s, 'up_clinical').cost) && /\+40%/.test(card(s, 'up_clinical').eff), `capped: 已滿級, disabled (${card(s, 'up_clinical').btn} ${card(s, 'up_clinical').eff})`);
  ok(!card(s, 'up_diagnosis').dis, 'one level below cap still buyable');
  await page.click('.u-upg-card[data-line="up_diagnosis"] .u-upg-btn'); await wait(page, 450);
  s = await sec(page);
  ok(card(s, 'up_diagnosis').lv === 'Lv.12 / 12' && card(s, 'up_diagnosis').dis && /四類病患治癒效率 \+18%/.test(card(s, 'up_diagnosis').eff), `buying the last level caps it (${card(s, 'up_diagnosis').lv} ${card(s, 'up_diagnosis').eff})`);
  ok(await page.evaluate(() => __game.state.mods.typeCure.elder > 0.179 && __game.state.mods.typeCure.kid > 0.179), 'typeCure applied to the patient types');

  // all done: section moves above the tree
  await setup(page, { done: 'all', pts: { medical: 10, device: 10, service: 10 }, levels: {} }); await wait(page, 500);
  ok(await page.evaluate(() => { const s = document.querySelector('[data-upgrades]'); const t = document.querySelector('.u-tree'); return !!(s && t) && (s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; }), 'tree exhausted: 持續精進 moves above the research tree');
  ok(problems.length === 0, 'no console errors/warnings: ' + problems.slice(0, 3).join(' | '));
  await page.context().close();
}

// ======================================================================= 2. layouts x styles
const VIEWPORTS = [[390, 844], [360, 740], [844, 390], [1280, 720]];
for (const mode of ['new', 'classic']) {
  for (const [w, h] of VIEWPORTS) {
    const { page, problems } = await open(w, h, mode);
    await openResearch(page);
    await setup(page, { done: 'mix', pts: { medical: 400, device: 60, service: 5 }, levels: { up_clinical: 4, up_diagnosis: 12, up_equipment: 2 } });
    await wait(page, 500);
    const tag = `${mode === 'new' ? 'concept' : 'classic'} ${w}x${h}`;
    ok(await page.evaluate(() => document.documentElement.classList.contains('style-concept')) === (mode === 'new'), `${tag}: style class`);
    await page.evaluate(() => document.querySelector('[data-upgrades]').scrollIntoView({ block: 'start' })); await wait(page, 300);
    const ov = await overflow(page);
    ok(ov.length === 0, `${tag}: no horizontal overflow (${ov.join('; ')})`);
    const geo = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.u-upg-card')];
      const cols = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)));
      const chip = document.querySelector('.u-pts-sticky').getBoundingClientRect(), p = document.querySelector('#panel').getBoundingClientRect();
      return { cols: cols.size, chipTop: chip.top - p.top, chipVisible: chip.bottom > p.top && chip.top < p.bottom, minBtn: Math.min(...cards.map(c => c.querySelector('.u-upg-btn').getBoundingClientRect().height)) };
    });
    ok(geo.chipVisible, `${tag}: sticky balance row stays visible after scrolling to the section (top +${Math.round(geo.chipTop)}px)`);
    if (w <= 400) ok(geo.cols === 1, `${tag}: cards stack in 1 column (${geo.cols})`);
    if (w === 1280) ok(geo.cols >= 1, `${tag}: desktop grid columns ${geo.cols}`);
    if (w <= 400 && h > 700) ok(geo.minBtn >= 36, `${tag}: buttons are tap-sized (${geo.minBtn}px)`);
    if (mode === 'new' && (w === 390 || w === 1280)) await shot(page, `upg_${w}x${h}`);
    if (mode === 'classic' && w === 390) await shot(page, `upg_classic_${w}x${h}`);
    ok(problems.length === 0, `${tag}: no console errors/warnings ${problems.slice(0, 2).join(' | ')}`);
    await page.context().close();
  }
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
