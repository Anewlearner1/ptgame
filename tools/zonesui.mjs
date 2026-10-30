// 專區組合辭典 (overview → ✨ 專區辭典) UI regression + screenshots.
//   python3 -m http.server 8217 & node tools/zonesui.mjs [--shots <dir>] [--url http://localhost:8217/index.html] [--vp 390x844,1280x720] [--styles new,classic]
// Checks per style x viewport: header 「已啟動 n / 共 N 個專區」, filter chips (status + group), card contents (tier chip, 效果 chips, requirement
// chips with ✔/✘/🔒 and 「坡道 2/3」), live update at <= 5 Hz, 「在地圖上看」 pans/zooms the camera onto the zone and pulses its glow ~2 s
// (inactive zone -> back to the whole clinic), no horizontal overflow, no console errors. Screenshots: dictionary + a built zone with glow.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://localhost:8217/index.html');
const SHOTS = arg('shots', '');
const STYLES = arg('styles', 'new,classic').split(',');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ALL_VP = [[390, 844, true], [360, 740, true], [844, 390, true], [1280, 720, false]];
const VPS = arg('vp', '') ? arg('vp').split(',').map(s => ALL_VP.find(v => `${v[0]}x${v[1]}` === s)).filter(Boolean) : ALL_VP;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
let failed = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { failed++; console.log('FAIL', m); } else if (process.env.VERBOSE) console.log('ok  ', m); };

async function open(w, h, touch, style) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA }
    : { viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.addInitScript((st) => {
    try { if (!sessionStorage.getItem('zui-init')) { sessionStorage.setItem('zui-init', '1'); localStorage.clear(); if (st === 'classic') localStorage.setItem('restgame.art', 'classic'); } } catch (e) { /* ignore */ }
    let s = 777; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let g; Object.defineProperty(window, '__game', { configurable: true, get() { return g; }, set(v) { g = v; try { v.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } } });
  }, style);
  await page.goto(URL_); await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('#modal-root .modal-actions .btn')?.click(); });
  await page.evaluate(() => { try { __game.bus.emit('speed:set', { speed: 0 }); } catch (e) { /* ignore */ } });
  await page.waitForTimeout(250);
  return { page, ctx, problems };
}
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const openDict = async (page) => {
  await page.evaluate(() => { __game.ui.panel = 'overview'; });
  await wait(page, 600);
  await page.evaluate(() => { const t = [...document.querySelectorAll('#panel .tabs .tab')].find(b => /專區/.test(b.textContent)); t && t.click(); });
  await wait(page, 500);
};
const closePanel = async (page) => { await page.evaluate(() => { __game.ui.panel = null; }); await wait(page, 500); };
// build things through the real game modules (same module instances as the page)
const build = (page, spec) => page.evaluate(async (spec) => {
  const B = await import('/js/sim/build.js'), ZL = await import('/tools/zonelayouts.mjs'), RS = await import('/js/data/research.js');
  const g = __game; g.state.money = 9e7;
  if (spec.research) g.state.research.done = Object.keys(RS.RESEARCH);
  if (spec.clear) { g.state.objects = []; g.state.map.floor = g.state.map.floor.map(r => r.map(() => null)); g.refreshDerived && g.refreshDerived(); }
  const out = {};
  for (const [id, x, y, flip] of spec.zones || []) out[id] = !!ZL.placeTemplate(B, g.state, id, x, y, !!flip);
  if (spec.combo) out.combo = ZL.placeCombo(B, g.state);
  if (spec.paint) for (const [f, x, y] of spec.paint) B.paintFloor(g.state, f, x, y);
  if (spec.remove) for (const [x, y] of spec.remove) B.removeAt(g.state, x, y);
  g.refreshDerived && g.refreshDerived();
  return out;
}, spec);
const cards = page => page.evaluate(() => [...document.querySelectorAll('#panel .u-syn')].map(c => ({
  id: c.dataset.zone, hidden: c.hidden, name: c.querySelector('.u-synname')?.textContent, tier: c.querySelector('.u-syntier')?.textContent,
  badge: c.querySelector('.u-synbadge')?.dataset.st, badgeText: c.querySelector('.u-synbadge')?.textContent,
  effects: [...c.querySelectorAll('.u-efrow .u-chip')].map(e => e.textContent),
  reqs: [...c.querySelectorAll('.u-need')].map(e => ({ t: e.textContent, m: e.dataset.mark, cls: e.className })),
  hint: c.querySelector('.u-synhint')?.textContent || '', status: c.querySelector('.u-synstat')?.textContent || '',
  btn: !!c.querySelector('.u-synmap'),
})));
const head = page => page.evaluate(() => document.querySelector('#panel .u-syn-title')?.textContent || '');
const chips = page => page.evaluate(() => [...document.querySelectorAll('#panel .u-fchip')].map(c => ({ kind: c.dataset.kind, val: c.dataset.val, t: c.textContent, on: c.classList.contains('on') })));
const clickChip = (page, kind, val) => page.evaluate(([k, v]) => document.querySelector(`#panel .u-fchip[data-kind="${k}"][data-val="${v}"]`).click(), [kind, val]);
const overflow = page => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('doc ' + document.documentElement.scrollWidth + '>' + innerWidth);
  const pn = document.getElementById('panel');
  if (pn && !pn.hidden) {
    const pr = pn.getBoundingClientRect();
    for (const e of pn.querySelectorAll('.u-syn, .u-syn *, .u-fchips, .u-synhead')) {
      const r = e.getBoundingClientRect();
      if (r.width && (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) && !e.closest('.tabs')) { bad.push((e.className || e.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' vs ' + Math.round(pr.left) + '..' + Math.round(pr.right)); if (bad.length > 4) break; }
    }
    if (pn.scrollWidth > pn.clientWidth + 1) bad.push('panel scrollW ' + pn.scrollWidth + '>' + pn.clientWidth);
  }
  return bad;
});
// where on screen is the zone, and is it clear of the panel?
const zoneScreen = (page, id) => page.evaluate((id) => {
  const g = __game, z = g.state.zones.find(q => q.id === id);
  if (!z) return null;
  const cv = document.getElementById('game'), r = cv.getBoundingClientRect(), cam = g.ui.cam;
  let sx = 0, sy = 0;
  for (const c of z.cells) { const wx = (c.x + 0.5 - (c.y + 0.5)) * 32, wy = (c.x + 0.5 + c.y + 0.5) * 16; sx += r.left + cam.x + wx * cam.zoom; sy += r.top + cam.y + wy * cam.zoom; }
  sx /= z.cells.length; sy /= z.cells.length;
  const pn = document.getElementById('panel'), pr = pn.hidden ? null : pn.getBoundingClientRect();
  const covered = !!pr && sx > pr.left && sx < pr.right && sy > pr.top && sy < pr.bottom;
  return { sx, sy, W: innerWidth, H: innerHeight, covered, zoom: cam.zoom, pulse: g.ui.zonePulse ? g.ui.zonePulse.id : null, panelTop: pr ? pr.top : null, panelRight: pr ? pr.right : null, panelLeft: pr ? pr.left : null };
}, id);
const camOf = page => page.evaluate(() => ({ ...__game.ui.cam }));

for (const style of STYLES) for (const [w, h, touch] of VPS) {
  const tag = `${w}x${h}-${style}`;
  const { page, ctx, problems } = await open(w, h, touch, style);
  const isConcept = await page.evaluate(() => document.documentElement.classList.contains('style-concept'));
  ok(isConcept === (style === 'new'), `${tag}: style class matches (${isConcept})`);

  // ---- 1. fresh game: only the starter shop's 黃金爐火區 (golden3) is active, research not done -> locked zones
  await openDict(page);
  const N = await page.evaluate(async () => (await import('/js/data/synergies.js')).SYNERGIES.length);
  ok(await head(page) === `已啟動 1 / 共 ${N} 個專區`, `${tag}: header 「已啟動 1 / 共 ${N} 個專區」 (${await head(page)})`);
  let cs = await cards(page);
  ok(cs.length === N && cs.every(c => c.name && c.tier && c.effects.length && c.reqs.length && c.hint && c.btn), `${tag}: ${cs.length} cards each with name, tier chip, effects, requirements, hint, button`);
  const lockedExpected = await page.evaluate(async () => { const Sy = await import('/js/sim/synergy.js'); const D = await import('/js/data/synergies.js'); return D.SYNERGIES.filter(s => Sy.zoneLocks(__game.state, s).length).map(s => s.id); });
  ok(lockedExpected.length >= 5 && cs.filter(c => c.badge === 'lock').map(c => c.id).sort().join() === lockedExpected.sort().join(), `${tag}: 🔒 badges == zones with unfinished research (${lockedExpected.length})`);
  const sp = cs.find(c => c.id === 'sportsRehab');
  ok(sp.reqs.some(r => r.m === '🔒' && /需研發「冰品設備」/.test(r.t)) && /先研發/.test(sp.status), `${tag}: locked requirement chip names the research node (${sp.reqs.map(r => r.m + r.t).join(' | ')})`);
  ok(sp.effects.some(e => /放學學生族來客 \+10%/.test(e)) && sp.effects.some(e => /放學學生族熟客化效率 \+6%/.test(e)), `${tag}: effect chips use Chinese type names (${sp.effects.join(' | ')})`);
  const ep = cs.find(c => c.id === 'elderPath');
  ok(ep.reqs.some(r => /坡道 0\/3/.test(r.t)) && ep.effects.some(e => /滑倒風險 −15%/.test(e)), `${tag}: ramp requirement shows a tile count 坡道 0/3; slipRisk chip (${ep.reqs.map(r => r.t).join(' | ')})`);
  let ch = await chips(page);
  ok(ch.filter(c => c.kind === 'status').length === 4 && ch.filter(c => c.kind === 'group').length >= 7, `${tag}: filter chips (status ${ch.filter(c => c.kind === 'status').map(c => c.t).join('/')}, groups ${ch.filter(c => c.kind === 'group').length})`);
  ok(ch.find(c => c.val === 'all' && c.kind === 'status').on, `${tag}: 全部 selected by default`);
  ok(!(await overflow(page)).length, `${tag}: dictionary (fresh) has no overflow ${JSON.stringify(await overflow(page))}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-dict-fresh.png` });

  // filters
  await clickChip(page, 'status', 'on'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).map(c => c.id).join() === 'golden3', `${tag}: 已啟動 filter -> only the starter shop's golden3 (${cs.filter(c => !c.hidden).map(c => c.id)})`);
  await clickChip(page, 'status', 'lock'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).length === lockedExpected.length, `${tag}: 🔒需研發 filter shows ${cs.filter(c => !c.hidden).length}/${lockedExpected.length}`);
  await clickChip(page, 'status', 'off'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).length === N - lockedExpected.length - 1, `${tag}: 未啟動 filter shows the ${N - lockedExpected.length - 1} buildable-now, inactive zones`);
  await clickChip(page, 'status', 'all'); await clickChip(page, 'group', 'elder'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).map(c => c.id).join() === 'elderPath', `${tag}: group chip 長者 -> only elderPath (${cs.filter(c => !c.hidden).map(c => c.id)})`);
  await clickChip(page, 'group', 'kids'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).map(c => c.id).sort().join() === 'kidCorner,kidLearn,kidpark', `${tag}: group chip 兒童 -> kidpark, kidCorner, kidLearn`);
  await clickChip(page, 'group', 'all'); await wait(page, 120);

  // ---- 2. build zones live: dictionary updates by itself (<= 5 Hz)
  await build(page, { research: true, clear: true, zones: [['hotCold', 11, 11], ['elderPath', 15, 14], ['golden3', 17, 11]] });
  await wait(page, 450);
  ok(await head(page) === `已啟動 3 / 共 ${N} 個專區`, `${tag}: live update after building 3 zones -> ${await head(page)}`);
  cs = await cards(page);
  const hc = cs.find(c => c.id === 'hotCold'), el = cs.find(c => c.id === 'elderPath');
  ok(hc.badge === 'on' && hc.reqs.every(r => r.m === '✔') && /已啟動/.test(hc.status), `${tag}: hotCold active, all requirement chips ✔`);
  ok(el.badge === 'on' && el.reqs.some(r => /坡道 3\/3/.test(r.t) && r.m === '✔'), `${tag}: elderPath chip 坡道 3/3 ✔ (${el.reqs.map(r => r.m + r.t).join(' | ')})`);
  ok(cs.find(c => c.id === 'sportsRehab').badge === 'off', `${tag}: with research done, unbuilt zones are 未啟動 (not 🔒)`);
  await build(page, { remove: [[15, 15]] }); await wait(page, 450);
  cs = await cards(page);
  const el2 = cs.find(c => c.id === 'elderPath');
  ok(el2.badge === 'off' && el2.reqs.some(r => /坡道 2\/3/.test(r.t) && r.m === '✘'), `${tag}: removing a ramp -> 坡道 2/3 ✘, zone off`);
  await build(page, { paint: [['ramp', 15, 15]] }); await wait(page, 450);
  ok((await head(page)) === `已啟動 3 / 共 ${N} 個專區`, `${tag}: painting the ramp back reactivates (${await head(page)})`);
  await clickChip(page, 'status', 'on'); await wait(page, 120);
  cs = await cards(page);
  ok(cs.filter(c => !c.hidden).map(c => c.id).sort().join() === 'elderPath,golden3,hotCold', `${tag}: 已啟動 filter lists the 3 active zones (${cs.filter(c => !c.hidden).map(c => c.id)})`);
  ok(!(await overflow(page)).length, `${tag}: dictionary (3 active) has no overflow ${JSON.stringify(await overflow(page))}`);
  if (SHOTS && (w === 390 || w === 1280)) await page.screenshot({ path: `${SHOTS}/${tag}-dict-active.png` });

  // ---- 3. 「在地圖上看」
  const before = await camOf(page);
  await page.evaluate(() => { __game.ui.cam.x += 500; __game.ui.cam.y += 400; });        // wander off first
  await page.evaluate(() => document.querySelector('#panel .u-syn[data-zone="hotCold"] .u-synmap').click());
  await wait(page, 450);
  let zs = await zoneScreen(page, 'hotCold');
  ok(zs && zs.sx > 0 && zs.sx < zs.W && zs.sy > 0 && zs.sy < zs.H && !zs.covered, `${tag}: 在地圖上看 brings hotCold on screen, not under the panel (${zs && Math.round(zs.sx)},${zs && Math.round(zs.sy)} of ${w}x${h}; zoom ${zs && zs.zoom.toFixed(2)})`);
  ok(zs && zs.pulse === 'hotCold', `${tag}: glow pulse armed for hotCold`);
  if (zs && !zs.covered) {
    const drawerRight = zs.panelLeft != null && zs.panelLeft > zs.W * 0.4, portrait = h > w;
    const free = portrait ? (zs.panelTop == null || zs.sy < zs.panelTop) : drawerRight ? zs.sx < zs.panelLeft : zs.sx > (zs.panelRight || 0);
    ok(free, `${tag}: zone centre lies in the part of the map the panel leaves free`);
  }
  if (SHOTS && (w === 390 || w === 1280)) await page.screenshot({ path: `${SHOTS}/${tag}-dict-pulse.png` });
  await wait(page, 2300);
  ok(await page.evaluate(() => !__game.ui.zonePulse), `${tag}: pulse ends after ~2 s`);
  // inactive zone -> whole clinic
  await page.evaluate(() => { __game.ui.cam.x += 300; __game.ui.cam.zoom = 2; });
  await page.evaluate(() => document.querySelector('#panel .u-syn[data-zone="flagship"]')?.querySelector('.u-synmap')?.click());
  await clickChip(page, 'status', 'all'); await wait(page, 100);
  await page.evaluate(() => document.querySelector('#panel .u-syn[data-zone="flagship"] .u-synmap').click());
  await wait(page, 500);
  const cam2 = await camOf(page);
  ok(cam2.zoom < 1.9 && !(await page.evaluate(() => !!__game.ui.zonePulse)), `${tag}: inactive zone -> camera back to the clinic overview (zoom ${cam2.zoom.toFixed(2)}), no pulse`);
  ok(await page.evaluate(() => !!document.querySelector('.toast, #toast-layer *')), `${tag}: info toast explains the zone is not active yet`);

  // ---- 4. the combo layout (every zone except 宵夜熱炒廊 flagship) on the start lot: label stagger + dictionary count
  await closePanel(page);
  await build(page, { research: true, clear: true, combo: true }); await wait(page, 300);
  await page.evaluate(() => { __game.ui.zonePulse = null; });
  await openDict(page);
  ok((await head(page)).startsWith(`已啟動 ${N - 1} /`), `${tag}: combo layout -> ${await head(page)}`);
  ok(!(await overflow(page)).length, `${tag}: dictionary (combo active) has no overflow ${JSON.stringify(await overflow(page))}`);
  await closePanel(page);
  await page.evaluate(() => { const c = __game.ui.cam; });
  await wait(page, 500);
  if (SHOTS && (w === 390 || w === 1280)) await page.screenshot({ path: `${SHOTS}/${tag}-map-13zones.png` });
  await build(page, { clear: true, zones: [['elderPath', 12, 12], ['cafeNook', 12, 15]] }); await wait(page, 400);
  if (SHOTS && (w === 390 || w === 1280)) await page.screenshot({ path: `${SHOTS}/${tag}-map-glow.png` });

  const bad = problems.filter(p => !/favicon|Failed to load resource.*(404)/.test(p));
  ok(bad.length === 0, `${tag}: no console errors / failed requests ${bad.slice(0, 3).join(' ; ')}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed}/${total} FAILED` : `\nall ${total} zonesui checks passed`);
process.exit(failed ? 1 : 0);
