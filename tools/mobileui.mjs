// Mobile / responsive / PWA checks. Serve the repo first:  python3 -m http.server 8206   (or set URL=http://localhost:PORT/index.html)
//   node tools/mobileui.mjs                  run every viewport
//   SHOTS=/some/dir node tools/mobileui.mjs  also write a screenshot of every panel / tab / modal
//   ONLY=390x844 node tools/mobileui.mjs     just one viewport
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:8206/index.html';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
// [w, h, kind]  kind: portrait | landscape (compact) | tablet | desktop
const VIEWPORTS = [
  [390, 844, 'portrait'], [360, 740, 'portrait'], [412, 915, 'portrait'], [375, 667, 'portrait'], [430, 932, 'portrait'],
  [844, 390, 'compact'], [740, 360, 'compact'], [932, 430, 'compact'], [667, 375, 'compact'],
  [768, 1024, 'tablet-portrait'], [1024, 768, 'tablet-landscape'], [1280, 720, 'desktop'], [1100, 700, 'desktop'],
];
const PANELS = ['build', 'operate', 'clinic', 'overview', 'map', 'system'];

let failed = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { failed++; console.log('  FAIL ' + m); } else if (process.env.VERBOSE) console.log('  ok   ' + m); };
const pause = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------------ static: manifest, icons, service worker
{
  console.log('== PWA files');
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  await page.goto(URL); await pause(page, 1200);
  const base = URL.replace(/[^/]*$/, '');
  const mres = await page.evaluate(async u => { const r = await fetch(u + 'manifest.webmanifest'); return { status: r.status, text: await r.text() }; }, base);
  ok(mres.status === 200, 'manifest.webmanifest served');
  let mf = null;
  try { mf = JSON.parse(mres.text); } catch (e) { /* fallthrough */ }
  ok(!!mf, 'manifest parses as JSON');
  if (mf) {
    ok(mf.name === '復健科診所物語' && mf.short_name === '復健診所', 'manifest names');
    ok(mf.start_url === './' && mf.scope === './', 'manifest start_url / scope are relative ./');
    ok(mf.display === 'fullscreen' && (mf.display_override || []).includes('standalone'), 'display fullscreen with standalone fallback');
    ok(mf.orientation === 'any', 'orientation any (portrait + landscape)');
    ok(/^#[0-9a-f]{6}$/i.test(mf.theme_color) && /^#[0-9a-f]{6}$/i.test(mf.background_color), 'theme / background colours');
    const sizes = (mf.icons || []).map(i => i.sizes + ':' + (i.purpose || 'any'));
    ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), 'icons 192 / 512 / maskable declared');
    for (const ic of mf.icons || []) {
      ok(!ic.src.startsWith('/') && !/^https?:/.test(ic.src), `icon path relative: ${ic.src}`);
      const st = await page.evaluate(async u => { const r = await fetch(u); return { s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; }, base + ic.src);
      ok(st.s === 200 && st.n > 200, `icon file exists: ${ic.src} (${st.n} bytes, ${st.t})`);
    }
  }
  const head = await page.evaluate(() => ({
    viewport: document.querySelector('meta[name=viewport]')?.content, theme: !!document.querySelector('meta[name=theme-color]'),
    cap: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content, bar: !!document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]'),
    title: !!document.querySelector('meta[name=apple-mobile-web-app-title]'), manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'),
    touch: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'), noscript: !!document.querySelector('noscript'),
    hint: !!document.getElementById('rotate-hint'),
  }));
  ok(/viewport-fit=cover/.test(head.viewport) && /user-scalable=no/.test(head.viewport) && /interactive-widget=resizes-content/.test(head.viewport), 'viewport meta');
  ok(head.theme && head.cap === 'yes' && head.bar && head.title && head.manifest === 'manifest.webmanifest' && head.touch && head.noscript, 'head tags (theme-color, apple-*, manifest, touch icon, noscript)');
  ok(!head.hint, 'no rotate-hint overlay (portrait is the primary orientation)');
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 6000))]);
    return reg ? (reg.active ? 'active' : 'registered') : 'timeout';
  });
  ok(sw === 'active' || sw === 'registered', 'service worker registers on localhost (' + sw + ')');
  await pause(page, 600);
  const cached = await page.evaluate(async () => { const ks = await caches.keys(); return ks.length ? (await (await caches.open(ks[0])).keys()).length : 0; });
  ok(cached > 3, `service worker cache populated (${cached} entries)`);
  const swsrc = await page.evaluate(async u => (await fetch(u + 'sw.js')).text(), base);
  ok(/networkFirst/.test(swsrc) && /ptgame-v\d+/.test(swsrc), 'sw.js is network-first with a versioned cache name');
  ok(problems.length === 0, 'no console errors on desktop load ' + problems.join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------ per-viewport
for (const [w, h, kind] of VIEWPORTS) {
  if (ONLY && ONLY !== `${w}x${h}`) continue;
  const touch = kind !== 'desktop';
  console.log(`== ${w}x${h} (${kind})`);
  const ctx = await browser.newContext(touch
    ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }
    : { viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  await page.goto(URL); await pause(page, 1100);
  const shot = async name => { if (SHOTS) { await pause(page, 250); await page.screenshot({ path: `${SHOTS}/${w}x${h}-${name}.png` }); } };
  const click = sel => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  const expectMode = kind === 'portrait' || kind === 'tablet-portrait' ? 'portrait' : kind === 'compact' ? 'compact' : 'desktop';

  // ---- generic page audit; `scope` limits the element scan (selector list)
  const audit = async (label, { panel = false, modal = false } = {}) => {
    const r = await page.evaluate(({ touch, panel, modal }) => {
      const vw = innerWidth, vh = innerHeight, out = [];
      const vis = e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 14) + '"';
      const doc = document.documentElement;
      if (doc.scrollWidth > vw + 1 || doc.scrollHeight > vh + 1) out.push(`page scrolls (${doc.scrollWidth}x${doc.scrollHeight} > ${vw}x${vh})`);
      if (document.body.scrollWidth > vw + 1) out.push('body scrolls horizontally');
      const roots = [...document.querySelectorAll('#topbar, #sidebar, #speedbar, .u-selcard:not([hidden])' + (panel ? ', #panel' : '') + (modal ? ', .modal' : ''))];
      const hscroll = e => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; if (p.id === 'panel') break; } return false; };
      for (const root of roots) {
        const els = [root, ...root.querySelectorAll('*')];
        for (const e of els) {
          if (!vis(e)) continue;
          if (e.closest('.tb-pop') && document.querySelector('.tb-pop[hidden]')) continue;
          const b = e.getBoundingClientRect();
          if ((b.right > vw + 1 || b.left < -1 || b.bottom > vh + 1 || b.top < -1) && !hscroll(e) && !e.closest('.u-ctx')) {
            // content inside a vertically scrolling panel / modal may legitimately extend below the viewport only if the scroller clips it
            let clipped = false;
            for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p !== document.body && p !== document.documentElement) { const pb = p.getBoundingClientRect(); if (pb.bottom <= vh + 1 && pb.right <= vw + 1 && pb.top >= -1) { clipped = true; break; } } }
            if (!clipped || b.right > vw + 1 || b.left < -1) out.push('overflows viewport: ' + desc(e) + ` [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
          }
        }
        if (root.id === 'panel' || root.classList.contains('modal')) {
          const sc = root.id === 'panel' ? root : root.querySelector('.modal-body');
          if (sc && sc.scrollWidth > sc.clientWidth + 1) out.push(`${root.id || 'modal'} scrolls horizontally (${sc.scrollWidth} > ${sc.clientWidth})`);
        }
        // fonts
        for (const e of els) {
          if (!vis(e)) continue;
          let direct = '';
          for (const n of e.childNodes) if (n.nodeType === 3) direct += n.textContent;
          if (!direct.trim()) continue;
          const fs = parseFloat(getComputedStyle(e).fontSize);
          if (touch && fs < 11.9 && !e.closest('canvas')) out.push(`font ${fs}px: ` + desc(e));
        }
        // tap targets (touch only)
        if (touch) {
          const targets = root.querySelectorAll('button, [role="button"], select, .tab, input[type="range"], summary, a[href]');
          for (const e of targets) {
            if (!vis(e) || e.disabled && false) continue;
            const b = e.getBoundingClientRect();
            if (b.right < 0 || b.bottom < 0 || b.left > vw || b.top > vh) continue;
            const cx = Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(vh - 1, Math.max(0, b.top + b.height / 2));
            const at = document.elementFromPoint(cx, cy);
            if (!at || !(e === at || e.contains(at))) continue;          // clipped by a scroller / covered
            if (e.classList.contains('card') && !e.matches('button')) continue; // cards are large content tiles
            if (b.width < 39.5 || b.height < 39.5) out.push(`tap target ${Math.round(b.width)}x${Math.round(b.height)}: ` + desc(e));
          }
          for (const c of root.querySelectorAll('input[type="checkbox"]')) {
            if (!vis(c)) continue;
            const l = c.closest('label'); const b = (l || c).getBoundingClientRect();
            if (b.height < 39.5) out.push(`checkbox hit area ${Math.round(b.width)}x${Math.round(b.height)}`);
          }
        }
      }
      return out;
    }, { touch, panel, modal });
    ok(r.length === 0, `${label}: ${r.length ? r.slice(0, 6).join(' ; ') + (r.length > 6 ? ` ; +${r.length - 6} more` : '') : 'layout audit clean'}`);
  };

  // ---- 1. tutorial modal (first launch)
  const tut = await page.evaluate(() => { const m = document.querySelector('#modal-root .modal'); if (!m) return null; const b = m.getBoundingClientRect(); return { b: [b.left, b.top, b.right, b.bottom], vh: innerHeight, vw: innerWidth, act: !!m.querySelector('.modal-actions .btn') && m.querySelector('.modal-actions').getBoundingClientRect().bottom <= innerHeight + 1 }; });
  ok(!!tut, 'tutorial opens on first launch');
  if (tut) {
    ok(tut.b[3] - tut.b[1] <= tut.vh * 0.92 + 1 && tut.b[0] >= 0 && tut.b[2] <= tut.vw, 'tutorial fits (max 92dvh)');
    ok(tut.act, 'tutorial action buttons visible');
  }
  await audit('tutorial', { modal: true });
  await shot('00-tutorial');
  await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click()); await pause(page, 250);
  await page.evaluate(() => __game.bus.emit('speed:set', { speed: 0 }));   // keep random events / dilemmas from popping up mid-test

  // ---- 2. base layout
  const L = await page.evaluate(() => ({
    cls: document.documentElement.className, top: document.getElementById('topbar').getBoundingClientRect().height,
    sb: document.getElementById('sidebar').getBoundingClientRect().toJSON(), sp: document.getElementById('speedbar').getBoundingClientRect().toJSON(),
    cv: document.getElementById('game').getBoundingClientRect().toJSON(), vh: innerHeight, vw: innerWidth,
    items: [...document.querySelectorAll('#topbar .tb-item')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.className.replace('tb-item ', '').split(' ')[0]),
    pvIn: !!document.querySelector('.tb-pv') && getComputedStyle(document.querySelector('.tb-pv')).display !== 'none',
    stats: getComputedStyle(document.querySelector('.tb-stats')).display !== 'none',
  }));
  ok(L.cls.includes('lay-' + expectMode), `layout class lay-${expectMode} (${L.cls})`);
  await audit('base');
  await shot('01-base');
  if (expectMode === 'portrait') {
    ok(L.top >= 54 && L.top <= 80, `portrait topbar 2 rows (${Math.round(L.top)}px)`);
    ok(['tb-date', 'tb-weather', 'tb-money', 'tb-pt', 'tb-rep', 'tb-pv'].every(c => L.items.includes(c)), 'portrait topbar shows date, weather, money, 3 points, reputation, NHI value');
    ok(L.sb.width >= L.vw - 1 && L.sb.height >= 52 && Math.abs(L.sb.bottom - L.vh) < 1.5, `bottom tab bar (${Math.round(L.sb.width)}x${Math.round(L.sb.height)})`);
    ok(L.sp.bottom <= L.sb.top + 1 && L.sp.right <= L.vw, 'speed pill floats above the tab bar');
  } else if (expectMode === 'compact') {
    ok(L.top >= 34 && L.top <= 44, `compact topbar slim (${Math.round(L.top)}px)`);
    ok(L.items.includes('tb-date') && L.items.includes('tb-money') && L.items.filter(c => c === 'tb-pt').length === 3 && L.items.includes('tb-rep'), 'compact topbar shows date, money, 3 points, reputation');
    ok(!L.pvIn && L.stats, 'NHI value collapsed into the stats popover button');
    ok(L.sb.width <= 56 && L.sb.left < 20, `icon rail on the left (${Math.round(L.sb.width)}px wide)`);
    // popover
    await click('.tb-stats'); await pause(page, 300);
    const pop = await page.evaluate(() => { const p = document.querySelector('.tb-pop'); if (!p || p.hidden) return null; const b = p.getBoundingClientRect(); return { r: b.right <= innerWidth + 1 && b.bottom <= innerHeight, txt: p.textContent }; });
    ok(pop && pop.r && /健保點值/.test(pop.txt), 'stats popover opens with the NHI value');
    await audit('stats popover');
    await shot('02-stats');
    await click('.tb-stats'); await pause(page, 150);
  } else if (expectMode === 'desktop') {
    ok(Math.round(L.top) === (h <= 600 ? 44 : 48) || w <= 1100, `desktop topbar height unchanged (${Math.round(L.top)}px)`);
    ok(!L.stats && L.pvIn, 'desktop keeps the NHI chip in the topbar');
    ok(L.sb.width >= 66 && L.sb.width <= 80, `desktop sidebar width unchanged (${Math.round(L.sb.width)})`);
  } else {
    ok(L.sb.width <= 90, 'tablet landscape keeps the desktop sidebar');
  }

  // ---- 3. panels + tabs
  for (const id of PANELS) {
    await page.evaluate(i => { document.querySelectorAll('.sidebar-btn')[i].click(); }, PANELS.indexOf(id)); await pause(page, 300);
    const g = await page.evaluate(() => { const p = document.getElementById('panel'), b = p.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), sb = document.getElementById('sidebar').getBoundingClientRect(); return { hidden: p.hidden, b: b.toJSON(), stage: s.toJSON(), sb: sb.toJSON(), close: (() => { const c = p.querySelector('.panel-close'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, right: r.right }; })(), handle: !!p.querySelector('.sheet-handle') && getComputedStyle(p.querySelector('.sheet-handle')).display !== 'none' }; });
    ok(!g.hidden, `${id}: panel opens`);
    if (expectMode === 'portrait') {
      ok(g.b.left < 1 && g.b.right >= w - 1 && Math.abs(g.b.bottom - g.sb.top) < 2, `${id}: bottom sheet sits on the tab bar`);
      const frac = (g.b.height + g.sb.height) / g.stage.height;
      ok(frac > 0.48 && frac < 0.62, `${id}: sheet ~55% of the stage (${(frac * 100).toFixed(0)}%)`);
      ok(g.b.top > g.stage.top + g.stage.height * 0.3, `${id}: map stays visible above the sheet`);
      ok(g.handle, `${id}: drag handle visible`);
    } else if (expectMode === 'compact') {
      ok(Math.abs(g.b.right - w) < 1.5 && Math.abs(g.b.top - g.stage.top) < 1.5 && Math.abs(g.b.bottom - g.stage.bottom) < 1.5, `${id}: right drawer, full height under the topbar`);
      const exp = Math.min(w * 0.52, 460);
      ok(Math.abs(g.b.width - exp) < 3, `${id}: drawer width ≈ min(52%, 460px) (${Math.round(g.b.width)} vs ${Math.round(exp)})`);
    }
    if (expectMode !== 'desktop' && !expectMode.startsWith('tablet')) ok(g.close && g.close.w >= 43 && g.close.h >= 43 && g.close.top >= g.stage.top - 1, `${id}: ✕ close ≥44px`);
    await audit(`${id} panel`, { panel: true });
    await shot(`10-${id}`);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#panel .u-tabbed > .tabs > .tab:not(.u-demotab)')].map(t => t.textContent.trim()));
    for (let ti = 0; ti < tabs.length; ti++) {
      await page.evaluate(i => document.querySelectorAll('#panel .u-tabbed > .tabs > .tab:not(.u-demotab)')[i].click(), ti); await pause(page, 250);
      await audit(`${id} tab "${tabs[ti]}"`, { panel: true });
      await shot(`11-${id}-${ti}`);
    }
    if (id === 'build') {
      const subs = await page.evaluate(() => document.querySelectorAll('#panel .u-subtabs .tab').length);
      for (let si = 1; si < subs; si++) { await page.evaluate(i => document.querySelectorAll('#panel .u-subtabs .tab')[i].click(), si); await pause(page, 200); await audit(`build sub-tab ${si}`, { panel: true }); }
    }
    // close with ✕
    if (id === 'system') {
      const rf = await page.evaluate(() => ({ ta: !!document.querySelector('#panel textarea'), sel: getComputedStyle(document.querySelector('#panel textarea') || document.body).userSelect }));
      await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].find(t => t.textContent.includes('存檔'))?.click()); await pause(page, 200);
      const ta = await page.evaluate(() => { const t = document.querySelector('#panel textarea'); return t ? getComputedStyle(t).userSelect : null; });
      ok(ta === 'text' || ta === 'auto', `system: export/import textarea stays selectable (${ta})`);
      // export fills the textarea
      await page.evaluate(() => [...document.querySelectorAll('#panel .btn')].find(b => b.textContent.includes('匯出'))?.click()); await pause(page, 200);
      ok(await page.evaluate(() => (document.querySelector('#panel textarea')?.value || '').length > 100), 'system: 匯出 fills the textarea');
      await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].find(t => t.textContent.includes('設定'))?.click()); await pause(page, 200);
      const inst = await page.evaluate(() => /安裝與全螢幕/.test(document.getElementById('panel').textContent));
      ok(!touch || inst, 'system: install / fullscreen hint present on touch devices');
      await shot('12-system-install');
    }
    await page.evaluate(() => document.querySelector('#panel .panel-close')?.click()); await pause(page, 200);
    ok(await page.evaluate(() => document.getElementById('panel').hidden), `${id}: ✕ closes the panel`);
  }

  // ---- 4. build flow: pick an item -> tray / strip, map free, re-open via 🔨
  if (expectMode !== 'desktop' && !expectMode.startsWith('tablet')) {
    await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[0].click()); await pause(page, 250);
    await page.evaluate(() => document.querySelector('#panel .u-tabbed > .tabs > .tab').click()); await pause(page, 150);
    await page.evaluate(() => { [...document.querySelectorAll('#panel .u-subtabs .tab')].find(t => t.textContent.includes('候診'))?.click(); }); await pause(page, 150);
    await page.evaluate(() => document.querySelector('#panel .u-item[data-id="plant"]').click()); await pause(page, 400);
    const f = await page.evaluate(() => { const p = document.getElementById('panel').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return { bmode: document.getElementById('stage').dataset.bmode, tool: __game.ui.tool.mode, p: p.toJSON(), s: s.toJSON(), tray: document.querySelector('.u-tray') && getComputedStyle(document.querySelector('.u-tray')).display !== 'none' }; });
    ok(f.tool === 'place', 'build: picking an item arms the tool');
    if (expectMode === 'portrait') {
      ok(f.bmode === 'tray' && f.p.height < 80 && f.tray, `build: sheet collapsed to a slim tray (${Math.round(f.p.height)}px)`);
    } else {
      ok(f.bmode === 'strip' && f.p.bottom <= f.s.bottom + 1 && f.p.height < 170 && f.tray, `build: panel collapsed to a bottom strip (${Math.round(f.p.height)}px)`);
      const card = await page.evaluate(() => document.querySelector('#panel .u-item').getBoundingClientRect().width);
      ok(card >= 84 && card <= 100, `build: strip cards ~92px wide (${Math.round(card)})`);
    }
    await audit('build tray/strip', { panel: true });
    await shot('20-build-tray');
    // lot stays inside the free area
    const cam = await page.evaluate(() => { const c = __game.ui.cam; return { x: c.x, y: c.y, z: c.zoom }; });
    ok(cam.z >= 0.3, `build: camera zoom sane (${cam.z})`);
    await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[0].click()); await pause(page, 250);
    ok(await page.evaluate(() => document.getElementById('stage').dataset.bmode === 'full' && !document.getElementById('panel').hidden), 'build: tapping 🔨 again re-opens the full list');
    await page.evaluate(() => document.querySelector('#panel .u-item[data-id="plant"]').click()); await pause(page, 250);
    await page.evaluate(() => (document.querySelector('.u-tray-btn[aria-label="取消"]') || document.querySelectorAll('.u-tray-btn')[2]).click()); await pause(page, 250);
    ok(await page.evaluate(() => __game.ui.tool.mode === 'none' && document.getElementById('panel').hidden), 'build: 取消 clears the tool and closes the tray');
  }

  // ---- 5. modals
  const closeModals = async () => {
    for (let i = 0; i < 8; i++) {
      const open = await page.evaluate(() => { const bs = document.querySelectorAll('#modal-root .modal-actions .btn'); const c = document.querySelector('#modal-root .u-choice'); const b = c || bs[bs.length - 1]; if (b) b.click(); return !!document.querySelector('#modal-root .modal'); });
      await pause(page, 120);
      if (!open) break;
    }
  };
  const showModal = async (name, js) => {
    await page.evaluate(js); await pause(page, 350);
    const m = await page.evaluate(() => { const e = document.querySelector('#modal-root .modal'); if (!e) return null; const b = e.getBoundingClientRect(), a = e.querySelector('.modal-actions'); const ab = a && !a.hidden ? a.getBoundingClientRect() : null; return { b: b.toJSON(), vh: innerHeight, vw: innerWidth, act: ab ? ab.bottom <= innerHeight + 1 : true, scroll: e.querySelector('.modal-body').scrollHeight > e.querySelector('.modal-body').clientHeight + 1 }; });
    ok(!!m, `modal ${name}: opens`);
    if (m) {
      ok(m.b.height <= m.vh * 0.92 + 1 && m.b.left >= -0.5 && m.b.right <= m.vw + 0.5 && m.b.top >= -0.5, `modal ${name}: fits (≤92dvh) ${Math.round(m.b.height)}/${m.vh}`);
      ok(m.act, `modal ${name}: action buttons stay visible${m.scroll ? ' (body scrolls)' : ''}`);
      await audit(`modal ${name}`, { modal: true });
      await shot(`30-modal-${name}`);
    }
    await closeModals();
  };
  await showModal('settlement', () => __game.bus.emit('nhi:settled', { points: 31000, pointValue: 0.9, income: 60000, expense: 52000, net: 8000, cap: 28000, nhiIncome: 27900, selfIncome: 32100, salary: 30000, rent: 60000, maintain: 2000, year: 1, month: 1 }));
  await showModal('inspection', () => __game.bus.emit('inspection:result', { pass: false, score: 61, notes: ['走道寬度不足，輪椅進出有困難。', '缺少無障礙廁所。', '病歷保存良好。'], rewardOrFine: -20000 }));
  await showModal('event', () => __game.bus.emit('event:show', { event: { id: 'test_ev', title: '測試事件：里長來訪', text: '里長帶著一群長輩來參觀你的診所，問你能不能辦一場免費的衛教講座？這件事情很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長。', choices: [{ label: '好啊，歡迎', result: '大家都很開心。', effects: {} }, { label: '先婉拒，最近太忙了', result: '里長有點失望。', effects: {} }] } }));
  await closeModals();
  await showModal('help', () => { document.querySelector('.speed-btn.u-help')?.click(); });
  // 診所 panel -> achievements tab at this viewport
  await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[2].click()); await pause(page, 250);
  await page.evaluate(() => [...document.querySelectorAll('#panel .tab')].find(t => /稱號|徽章|成就/.test(t.textContent))?.click()); await pause(page, 300);
  const ach = await page.evaluate(() => { const l = document.querySelector('#panel .u-achlist'); if (!l) return null; const a = [...l.children].filter(c => c.getBoundingClientRect().width > 0); const xs = new Set(a.map(c => Math.round(c.getBoundingClientRect().left))); return { cols: xs.size, n: a.length }; });
  if (ach) ok(ach.cols === 1 || expectMode === 'desktop', `achievements cards stack in 1 column (${ach.cols})`);
  await audit('achievements', { panel: true });
  await shot('40-achievements');
  await page.evaluate(() => document.querySelector('#panel .panel-close')?.click()); await pause(page, 200);

  // ---- 6. selection card + context popover
  if (expectMode !== 'desktop') {
    const id = await page.evaluate(() => __game.state.objects.find(o => o.defId === 'plant')?.id ?? __game.state.objects[0].id);
    await page.evaluate(id => { __game.bus.emit('object:context', { id, x: innerWidth / 2, y: innerHeight / 2 }); }, id); await pause(page, 250);
    const c = await page.evaluate(() => { const m = document.querySelector('.u-ctx'); if (!m || m.hidden) return null; const b = m.getBoundingClientRect(); return { inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, btns: [...m.querySelectorAll('.u-ctx-btn')].map(x => [x.textContent.trim(), x.getBoundingClientRect().height]) }; });
    ok(c && c.inside && c.btns.length === 3 && c.btns.every(b => b[1] >= 44), 'context popover: 資訊 / 旋轉 / 拆除, ≥44px rows, inside the screen');
    await shot('50-context');
    await page.evaluate(() => [...document.querySelectorAll('.u-ctx-btn')].find(b => b.textContent.includes('資訊'))?.click()); await pause(page, 500);
    ok(await page.evaluate(() => __game.ui.selected && !document.querySelector('.u-selcard').hidden), 'context 資訊 opens the selection card');
    await audit('selection card');
    await shot('51-selection');
    await page.evaluate(() => { __game.ui.selected = null; __game.bus.emit('select:changed', { selected: null }); });
    // rotate + demolish entries
    await page.evaluate(id => __game.bus.emit('object:context', { id, x: 200, y: 200 }), id); await pause(page, 200);
    await page.evaluate(() => [...document.querySelectorAll('.u-ctx-btn')].find(b => b.textContent.includes('旋轉'))?.click()); await pause(page, 200);
    await page.evaluate(id => __game.bus.emit('object:context', { id, x: 200, y: 200 }), id); await pause(page, 200);
    await page.evaluate(() => [...document.querySelectorAll('.u-ctx-btn')].find(b => b.textContent.includes('拆除'))?.click()); await pause(page, 300);
    ok(await page.evaluate(() => !!document.querySelector('#modal-root .modal')), 'context 拆除 asks for confirmation');
    await page.evaluate(() => document.querySelector('#modal-root .modal-actions .btn')?.click()); await pause(page, 200);

    // toast placement
    await page.evaluate(() => __game.bus.emit('toast', { text: '測試提示：這是一則很長很長的提示訊息，用來檢查位置', kind: 'good' })); await pause(page, 250);
    const t = await page.evaluate(() => { const e = document.querySelector('.toast'); if (!e) return null; const b = e.getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect(); return { below: b.top >= tb.bottom - 1, inside: b.left >= 0 && b.right <= innerWidth }; });
    ok(t && t.below && t.inside, 'toast sits under the topbar, inside the screen');
    await shot('52-toast');
  }

  // ---- 7. gestures (portrait sheet drag / landscape swipe) via CDP touch
  if (expectMode === 'portrait' || expectMode === 'compact') {
    const cdp = await ctx.newCDPSession(page);
    const touchSeq = async pts => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await pause(page, 16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pause(page, 250);
    };
    const lerp = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[3].click()); await pause(page, 300);
    if (expectMode === 'portrait') {
      const hnd = await page.evaluate(() => { const r = document.querySelector('.sheet-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const h0 = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().height);
      await touchSeq(lerp(hnd, [hnd[0], hnd[1] - 260], 14));
      const h1 = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().height);
      ok(h1 > h0 + 100, `sheet: drag handle up expands it (${Math.round(h0)} -> ${Math.round(h1)})`);
      const stageH = await page.evaluate(() => document.getElementById('stage').getBoundingClientRect().height);
      ok((h1 + L.sb.height) / stageH > 0.8 && (h1 + L.sb.height) / stageH < 0.96, `sheet: expanded to ~88% (${Math.round((h1 + L.sb.height) / stageH * 100)}%)`);
      await shot('60-sheet-expanded');
      const hnd2 = await page.evaluate(() => { const r = document.querySelector('.sheet-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await touchSeq(lerp(hnd2, [hnd2[0], hnd2[1] + 200], 14));
      const h2 = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().height);
      ok(Math.abs(h2 - h0) < 6, `sheet: drag down snaps back to ~55% (${Math.round(h2)})`);
      const hnd3 = await page.evaluate(() => { const r = document.querySelector('.sheet-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await touchSeq(lerp(hnd3, [hnd3[0], hnd3[1] + 400], 16));
      ok(await page.evaluate(() => document.getElementById('panel').hidden), 'sheet: dragging far down dismisses it');
    } else {
      const pr = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().toJSON());
      const y = pr.top + pr.height * 0.5, x0 = pr.left + 40;
      await touchSeq(lerp([x0, y], [x0 + 160, y + 4], 10));
      ok(await page.evaluate(() => document.getElementById('panel').hidden), 'drawer: swipe right closes it');
    }
    await cdp.detach();
  }

  // ---- 7b. no hover dependency: tap-to-show tooltips
  if (touch) {
    await page.evaluate(() => { for (let i = 0; i < 6; i++) { const b = document.querySelector('#modal-root .u-choice, #modal-root .modal-actions .btn'); if (b) b.click(); } });
    await page.tap('.tb-money'); await pause(page, 250);
    const tip = await page.evaluate(() => { const t = document.getElementById('tooltip'); return t && !t.hidden ? t.textContent : null; });
    ok(tip && /資金/.test(tip), 'tooltip: tapping a topbar chip shows its info');
    await page.tap('#game', { position: { x: 20, y: 200 } }).catch(() => {}); await pause(page, 200);
    ok(await page.evaluate(() => document.getElementById('tooltip').hidden), 'tooltip: tapping elsewhere hides it');
    await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[0].click()); await pause(page, 250);
    await page.evaluate(() => document.querySelector('#panel .u-tabbed > .tabs > .tab').click()); await pause(page, 150);
    await page.tap('#panel .u-item .u-info'); await pause(page, 250);
    const tip2 = await page.evaluate(() => { const t = document.getElementById('tooltip'); return { shown: t && !t.hidden, tool: __game.ui.tool.mode, txt: t ? t.textContent : '' }; });
    ok(tip2.shown && /造價/.test(tip2.txt) && tip2.tool === 'none', 'tooltip: ⓘ on a build card shows details without arming the tool');
    await shot('80-info-tip');
    await page.evaluate(() => { document.querySelector('#panel .panel-close')?.click(); document.getElementById('tooltip').hidden = true; }); await pause(page, 150);
  }

  // ---- 7c. rotate the device mid-game: layout flips, state survives, no errors
  if (touch && expectMode !== 'desktop') {
    const before = await page.evaluate(() => ({ y: __game.state.time.year, money: Math.round(__game.state.money), n: __game.state.objects.length }));
    await page.evaluate(() => document.querySelectorAll('.sidebar-btn')[3].click()); await pause(page, 250);
    await page.setViewportSize({ width: h, height: w }); await pause(page, 500);
    const rot = await page.evaluate(() => ({ cls: document.documentElement.className, over: document.documentElement.scrollWidth > innerWidth + 1, panel: !document.getElementById('panel').hidden, n: __game.state.objects.length, y: __game.state.time.year, pb: document.getElementById('panel').getBoundingClientRect().toJSON() }));
    const wantCls = h > w ? (w <= 520 ? 'lay-compact' : 'lay-desktop') : (h <= 900 ? 'lay-portrait' : 'lay-desktop');   // viewport is now h x w
    ok(rot.cls.includes(wantCls), 'rotation flips the layout class (' + rot.cls + ')');
    ok(!rot.over && rot.panel && rot.n === before.n && rot.y === before.y, 'rotation: no horizontal scroll, open panel and game state survive');
    await audit('after rotation', { panel: true });
    await shot('90-rotated');
    await page.setViewportSize({ width: w, height: h }); await pause(page, 500);
    ok(await page.evaluate(() => document.documentElement.className.includes('lay-' + (innerHeight > innerWidth && innerWidth <= 900 ? 'portrait' : innerHeight <= 520 ? 'compact' : 'desktop'))), 'rotating back restores the original layout');
    await page.evaluate(() => document.querySelector('#panel .panel-close')?.click()); await pause(page, 200);
  }

  // ---- 8. safe-area insets are honoured (simulate a notch by overriding the CSS vars)
  if (expectMode !== 'desktop') {
    await page.addStyleTag({ content: ':root{--sat:24px;--sar:30px;--sab:20px;--sal:44px}' }); await pause(page, 300);
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await pause(page, 300);
    const s = await page.evaluate(() => { const tb = document.getElementById('topbar'), cs = getComputedStyle(tb); const sb = document.getElementById('sidebar').getBoundingClientRect(); return { pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight), pt: parseFloat(cs.paddingTop), sbLeft: sb.left, sbBottom: innerHeight - sb.bottom, sbH: sb.height, sbW: sb.width, vw: innerWidth, sbRight: innerWidth - sb.right }; });
    ok(s.pl >= 44 && s.pr >= 30, `safe-area: topbar side padding (${s.pl}/${s.pr})`);
    ok(expectMode === 'portrait' ? (s.pt >= 24 && s.sbH >= 70) : s.sbLeft >= 44, 'safe-area: ' + (expectMode === 'portrait' ? 'status-bar inset above the topbar, tab bar grows by the home-indicator inset' : 'rail clears the notch'));
    await audit('with safe-area insets');
    await shot('70-safe-area');
  }

  ok(problems.length === 0, `no console errors/warnings ${problems.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `FAILED ${failed}/${total}` : `PASS (${total} checks)`);
process.exit(failed ? 1 : 0);
