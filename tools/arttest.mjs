// Sprite-atlas regression (S-L). Server must run: `python3 -m http.server 8208` in the repo root (or pass --url).
// Usage: node tools/arttest.mjs [--url http://localhost:8208/index.html] [--minutes 2] [--quick] [--shots <dir>]
// Asserts: atlas loads (artReady), classic/new toggle works + persists + swaps the sprites, atlas 404 (route abort) -> game
// still runs with no errors on the procedural art, the service worker caches the atlas, perf (60 agents) is not worse than
// classic, the speech-therapist sprite is the REAL atlas sprite (not the old recolour), 8-way directional frames are picked from the
// screen-space move vector (sector unit cases + idle persistence), treatment tableaux are chosen per patient type / absent in classic /
// absent without the atlas, and 3 soak runs (new / classic / toggling every 8 s) of --minutes each (default 2) have no console problems.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8208/index.html');
const quick = process.argv.includes('--quick');
const minutes = quick ? 0.25 : parseFloat(arg('minutes', '2'));
const shotDir = arg('shots', '');
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());

async function open({ style, w = 1280, h = 720, dpr = 1, route404 = false, fresh = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, serviceWorkers: route404 ? 'block' : 'allow' });
  if (style) await ctx.addInitScript(([s, fresh]) => { try { if (fresh && !sessionStorage.getItem('arttest')) { localStorage.clear(); sessionStorage.setItem('arttest', '1'); } if (s) localStorage.setItem('ptgame.art', s); } catch (e) { /* ignore */ } }, [style, fresh]);
  if (route404) await ctx.route(/assets\/art\/atlas\.(png|json)/, r => r.abort());
  const page = await ctx.newPage();
  const problems = [];
  const expectedFail = route404 ? /atlas\.(png|json)|Failed to load resource|Service Worker registration blocked/ : null;
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !(expectedFail && expectedFail.test(m.text() + (m.location().url || '')))) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('PAGEERR ' + e.message));
  if (!route404) {
    page.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
    page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  }
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#modal-root button')?.click());
  return { ctx, page, problems };
}

const G = (page, fn, a) => page.evaluate(fn, a);
const clearModals = page => page.evaluate(() => document.querySelectorAll('#modal-root button').forEach(b => b.click()));

// ───────────── 1. loads + API shape ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(async () => (await import('./js/render/art.js')).artReady(), null, { timeout: 8000 }).catch(() => {});
  const r = await G(page, async () => {
    const A = await import('./js/render/art.js');
    const rect = A.artRect('staff.doctor'), cv = A.artCanvas('patient.elder.stand');
    return { ready: A.artReady(), en: A.artEnabled(), rect, cw: cv && cv.width, ch: cv && cv.height, nil: A.artRect('nope.nope'), url: A.artUrl(), load: await A.loadArt(), load2: await A.loadArt() };
  });
  ok(r.ready && r.en, 'artReady() true after load (default style new)');
  ok(r.rect && r.rect.w > 50 && r.rect.facing === 'front' && r.rect.heightPx === 166 && r.rect.ax >= 0, 'artRect(staff.doctor) = {x,y,w,h,ax,ay,facing,heightPx}');
  ok(r.cw === 59 && r.ch === 113, `artCanvas native size (${r.cw}x${r.ch})`);
  ok(r.nil === null, 'unknown sprite -> null');
  ok(/\/assets\/art\/atlas\.png$/.test(r.url) && r.load === true && r.load2 === true, 'artUrl() absolute, loadArt() idempotent -> true');
  // the renderer really draws the atlas: art object sprite + a person
  const used = await G(page, async () => {
    const S = await import('./js/render/sprites.js');
    return { bed: !!S.getObjectSprite('bed', 0).art, bedRot: !!S.getObjectSprite('bed', 1).art, heat: !!S.getObjectSprite('heatbox', 0).art && !S.getObjectSprite('heatbox', 0).cobj };
  });
  ok(used.bed && used.bedRot && !used.heat, 'bed uses atlas art (both rotations), heatbox is not an atlas sprite (concept-style procedural)');
  ok(problems.length === 0, 'no console problems at load' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 2. toggle + persistence ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(async () => (await import('./js/render/art.js')).artReady(), null, { timeout: 8000 }).catch(() => {});
  const t = await G(page, async () => {
    const A = await import('./js/render/art.js'), S = await import('./js/render/sprites.js');
    const bus = window.__game.bus; const ev = []; bus.on('art:changed', e => ev.push(e));
    const out = {};
    A.setArtEnabled(false);
    out.off = { ready: A.artReady(), en: A.artEnabled(), ls: localStorage.getItem('ptgame.art'), rect: A.artRect('staff.doctor'), cv: A.artCanvas('staff.doctor'), bedArt: !!S.getObjectSprite('bed', 0).art };
    await new Promise(r => setTimeout(r, 300));
    out.recsClassic = true;
    A.setArtEnabled(true);
    out.on = { ready: A.artReady(), en: A.artEnabled(), ls: localStorage.getItem('ptgame.art'), bedArt: !!S.getObjectSprite('bed', 0).art };
    out.ev = ev.map(e => e.enabled);
    A.setArtEnabled(false);
    return out;
  });
  ok(!t.off.ready && !t.off.en && t.off.ls === 'classic' && t.off.rect === null && t.off.cv === null && !t.off.bedArt, 'setArtEnabled(false): classic, persisted, sprites procedural');
  ok(t.on.ready && t.on.en && t.on.ls === 'new' && t.on.bedArt, 'setArtEnabled(true): new, persisted, atlas sprites');
  ok(JSON.stringify(t.ev) === '[false,true]', 'bus art:changed emitted on each toggle ' + JSON.stringify(t.ev));
  await page.reload();
  await page.waitForTimeout(1500);
  const persisted = await G(page, async () => { const A = await import('./js/render/art.js'); return { en: A.artEnabled(), ready: A.artReady(), ls: localStorage.getItem('ptgame.art') }; });
  ok(!persisted.en && !persisted.ready && persisted.ls === 'classic', 'classic choice survives a reload');
  // the frame keeps rendering after a live toggle (classic -> new): objects and layer are rebuilt
  await G(page, async () => { (await import('./js/render/art.js')).setArtEnabled(true); });
  await page.waitForTimeout(600);
  const px = await G(page, () => { const c = document.getElementById('game'); const g = c.getContext('2d'); const d = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3]; });
  ok(px === 255, 'canvas still painting after live toggle');
  ok(problems.length === 0, 'no console problems while toggling' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 3. atlas missing ─────────────
{
  const { ctx, page, problems } = await open({ route404: true });
  await page.waitForTimeout(1500);
  const r = await G(page, async () => {
    const A = await import('./js/render/art.js'), S = await import('./js/render/sprites.js');
    const t0 = window.__game.state.time.clock;
    window.__game.bus.emit('speed:set', { speed: 3 });
    await new Promise(r => setTimeout(r, 2500));
    return { ready: A.artReady(), load: await A.loadArt(), bedArt: !!S.getObjectSprite('bed', 0).art && !S.getObjectSprite('bed', 0).cobj, adv: window.__game.state.time.clock !== t0 || window.__game.state.time.day !== undefined };
  });
  ok(!r.ready && r.load === false && !r.bedArt, 'atlas aborted -> artReady false, loadArt() resolves false, procedural sprites');
  const painted = await G(page, () => { const c = document.getElementById('game'); const g = c.getContext('2d'); return g.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]; });
  ok(painted === 255, 'game still renders without the atlas');
  ok(problems.length === 0, 'no console errors with the atlas missing' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 4. service worker caches the atlas ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(1500);
  const c = await G(page, async () => {
    const keys = await caches.keys();
    const hits = {};
    for (const k of keys) { const cache = await caches.open(k); for (const f of ['assets/art/atlas.png', 'assets/art/atlas.json']) if (await cache.match(f)) hits[f] = true; }
    return { keys, hits };
  });
  ok(c.hits['assets/art/atlas.png'] && c.hits['assets/art/atlas.json'], 'sw.js cache holds atlas.png + atlas.json ' + JSON.stringify(c.keys));
  // offline: reload with the network cut -> game boots from the cache, art still loads
  await ctx.setOffline(true);
  await page.reload().catch(() => {});
  await page.waitForTimeout(2000);
  const off = await G(page, async () => { const A = await import('./js/render/art.js'); return { ready: await A.loadArt() && A.artReady() }; }).catch(() => ({ ready: false }));
  ok(off.ready, 'offline reload: atlas served from the service-worker cache');
  await ctx.setOffline(false);
  await ctx.close();
}


// ───────────── helpers shared by the speech-therapist sections ─────────────
// Frozen scene (sim paused, render driven by hand). kind 'dirs': 8 STs + 1 PT each with a one-step path in one grid direction;
// kind 'tab': 5 ST/patient pairs (kid id 2, kid id 3, elder, office, sports) in state working/treating + 1 pair in 'waiting' (no tableau).
async function stScene(page, kind) {
  return G(page, async kind => {
    const g = window.__game, st = g.state, ui = g.ui; g.bus.emit('speed:set', { speed: 0 });
    const P = await import('./js/sim/patients.js'), S = await import('./js/sim/staff.js'), R = await import('./js/render/renderer.js');
    const H = await import('./js/render/iso.js'); H.hooks.refreshHover = null;
    st.time.paused = true; st.time.speed = 0; st.objects = []; st.staff = []; st.patients = [];
    const L = st.lot, out = { ids: [], pat: [] };
    const mkStaff = (role, x, y) => { const s = S.createStaff(st, role, null, Math.floor(x), Math.floor(y)); s.x = x; s.y = y; s.path = []; st.staff.push(s); return s; };
    if (kind === 'dirs') {
      const D8 = [[1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];       // d ld l lu u ru r rd (grid vectors)
      D8.forEach((v, i) => { const s = mkStaff('st', L.x0 + 2.5 + (i % 4) * 2, L.y0 + 2.5 + Math.floor(i / 4) * 3); s.path = [{ x: Math.floor(s.x) + v[0], y: Math.floor(s.y) + v[1] }]; s.state = 'walking'; out.ids.push(s.id); });
      out.pt = mkStaff('pt', L.x0 + 2.5, L.y0 + 8.5).id;
    } else {
      [['kid', 2], ['kid', 3], ['elder', 4], ['office', 5], ['sports', 6], ['kid', 8]].forEach(([type, id], i) => {
        const s = mkStaff('st', L.x0 + 2.5 + (i % 3) * 3.5, L.y0 + 2.5 + Math.floor(i / 3) * 4);
        P.spawnPatient(st, type); const q = st.patients[st.patients.length - 1];
        q.id = id; q.type = type; q.x = s.x + 1; q.y = s.y; q.path = []; q.seat = null; q.bubble = null; q.total = 10; q.remaining = 4; q.stage = i === 5 ? 'waiting' : 'treating';
        s.state = 'working'; s.task = { patientId: id, objId: null, treatmentId: 'speech', total: 10, remaining: 4 };
        out.ids.push(s.id); out.pat.push(id);
      });
    }
    ui.perf = { dpr: 1, fps: 60, level: 0, auto: false }; ui.selected = null;
    const cv = document.getElementById('game'), cam = ui.cam, Z = 1.6, gx = L.x0 + 6, gy = L.y0 + 5;
    cam.zoom = Z; cam.x = cv.clientWidth / 2 - (gx - gy) * 32 * Z; cam.y = cv.clientHeight / 2 - (gx + gy) * 16 * Z;
    window.__R = R;
    for (let i = 0; i < 3; i++) R.render(st, ui, 5000 + i * 16);
    return out;
  }, kind);
}
const stInfo = page => G(page, async () => { const R = window.__R || await import('./js/render/renderer.js'); const g = window.__game; R.render(g.state, g.ui, 6000); return R.artInfo(); });

// ───────────── 7. speech therapist: real sprite, directional frames, tableaux ─────────────
{
  const { ctx, page, problems } = await open({});
  await page.waitForFunction(async () => (await import('./js/render/art.js')).artReady(), null, { timeout: 8000 }).catch(() => {});
  // 7a. the real atlas sprite (155x301), not the old purple recolour of staff.pharmacist
  const r = await G(page, async () => {
    const A = await import('./js/render/art.js');
    const rect = A.artRect('staff.st'), cv = A.artCanvas('staff.st');
    const im = new Image(); im.src = A.artUrl(); await im.decode();
    const t = document.createElement('canvas'); t.width = rect.w; t.height = rect.h;
    const tg = t.getContext('2d', { willReadFrequently: true }); tg.drawImage(im, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const a = tg.getImageData(0, 0, rect.w, rect.h).data, b = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, rect.w, rect.h).data;
    let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    const ph = A.artRect('staff.pharmacist');
    const D = await import('./js/ui/artdom.js');
    const el = D.artEl('staff.st', { height: 40 }); document.body.appendChild(el);
    const img = el.querySelector('i');
    const out = { rect, diff, phh: ph.h, url: A.artStaffUrl('st') === cv.toDataURL('image/png'), canvasSame: A.artStaffCanvas('st') === cv, elArt: el.dataset.art, bg: img.style.backgroundImage, sx: img.style.getPropertyValue('--sx'), sw: img.style.getPropertyValue('--sw'), x: rect.x };
    el.remove();
    return out;
  });
  ok(r.rect.w === 155 && r.rect.h === 301 && r.rect.heightPx === 301 && r.rect.ax === 73 && r.rect.ay === 300, 'staff.st is the real 155x301 atlas sprite ' + JSON.stringify(r.rect));
  ok(r.diff === 0 && r.phh !== 301, 'artCanvas(staff.st) is pixel-identical to the atlas cut-out (no recolour)');
  ok(r.url && r.canvasSame, 'artStaffUrl/artStaffCanvas(st) still work and return the real sprite');
  ok(r.elArt === 'on' && r.bg === '' && r.sx === String(r.x) && r.sw === '155', 'UI thumbnail (artEl staff.st) is painted from the atlas background, not an own data URL');

  // 7b. dirSector unit cases: iso.js projection, 8 sectors, boundaries at 22.5 deg, idle (zero vector) keeps the fallback
  const u = await G(page, async () => {
    const A = await import('./js/render/artdraw.js'), art = await import('./js/render/art.js');
    const names = A.DIR_SUFFIX, bad = [];
    const grid = (sx, sy) => [sx / 64 + sy / 32, sy / 32 - sx / 64];           // screen vector -> grid vector (inverse of the iso projection)
    const T = (label, dg, want) => { const got = A.dirSector(dg[0], dg[1], -7); if (got !== want) bad.push(`${label}: got ${got} want ${want}`); };
    // the 4 grid axes and 4 grid diagonals
    [['+x', [1, 0], 7], ['+y', [0, 1], 1], ['-x', [-1, 0], 3], ['-y', [0, -1], 5], ['+x+y', [1, 1], 0], ['-x+y', [-1, 1], 2], ['-x-y', [-1, -1], 4], ['+x-y', [1, -1], 6]].forEach(([l, v, w]) => T(l, v, w));
    // screen angle sweep: the sector index grows with the screen angle (y down): d 90, ld 135, l 180, lu 225, u 270, ru 315, r 0, rd 45
    names.forEach((n, i) => {
      const c = 90 + 45 * i;
      for (const [dd, want] of [[0, i], [21, i], [-21, i], [24, (i + 1) % 8], [-24, (i + 7) % 8]]) {
        const a = (c + dd) * Math.PI / 180, dg = grid(Math.cos(a) * 3, Math.sin(a) * 3);
        const got = A.dirSector(dg[0], dg[1], -7);
        if (got !== want) bad.push(`${n} ${dd >= 0 ? '+' : ''}${dd}deg: got ${names[got]} want ${names[want]}`);
      }
    });
    // exact-ish boundary: 22.4 deg stays, 22.6 deg flips
    { const f = d => { const a = (90 + d) * Math.PI / 180, dg = grid(Math.cos(a), Math.sin(a)); return A.dirSector(dg[0], dg[1], -7); };
      if (f(22.4) !== 0 || f(22.6) !== 1 || f(-22.4) !== 0 || f(-22.6) !== 7) bad.push('boundary 22.5 deg: ' + [f(22.4), f(22.6), f(-22.4), f(-22.6)]); }
    const fb = [A.dirSector(0, 0, 5), A.dirSector(0.01, -0.01, 3), A.dirSector(0.03, 0, 3)];
    const fr = A.dirFrames('staff.st');
    return { bad, fb, fr, pt: A.dirFrames('staff.pt'), none: A.dirFrames('nope'), tab: [A.tableauFor('st', 'speech', 'kid', 2), A.tableauFor('st', 'speech', 'kid', 3), A.tableauFor('st', 'speech', 'elder', 9), A.tableauFor('st', 'speech', 'office', 1), A.tableauFor('st', 'speech', 'sports', 2), A.tableauFor('st', 'si', 'kid', 2), A.tableauFor('pt', 'speech', 'kid', 2)] };
  });
  ok(u.bad.length === 0, 'dirSector: 8 sectors, grid axes/diagonals, +-21/24 deg around each centre, 22.5 deg boundary' + (u.bad.length ? ' -> ' + u.bad.join('; ') : ''));
  ok(u.fb[0] === 5 && u.fb[1] === 3 && u.fb[2] !== 3, 'dirSector: (near) zero vector -> fallback (keep last direction); a 0.03 step counts as movement');
  ok(u.fr && u.fr.length === 8 && u.fr[0] === 'staff.st.dir.d' && u.fr[7] === 'staff.st.dir.rd' && u.pt === null && u.none === null, 'dirFrames: staff.st -> 8 frames, other kinds -> null (keep flip/tilt)');
  ok(JSON.stringify(u.tab) === JSON.stringify(['staff.st.act.speech', 'staff.st.act.cognitive', 'staff.st.act.swallow', 'staff.st.act.counsel', 'staff.st.act.counsel', null, null]), 'tableauFor: kid id parity -> speech/cognitive, elder -> swallow, office/sports -> counsel, unknown treatment/role -> none ' + JSON.stringify(u.tab));

  // 7c. renderer: frame per move vector + persistence while idle/working
  const sc = await stScene(page, 'dirs');
  const i1 = await stInfo(page);
  ok(sc.ids.every((id, i) => i1.dir8[id] === i) && i1.dir8[sc.pt] === undefined, 'renderer: each ST picks the frame of its screen-space move vector (d ld l lu u ru r rd); PT has no directional state ' + JSON.stringify(i1.dir8));
  await G(page, id => { const st = window.__game.state; for (const s of st.staff) { s.path = []; s.state = 'idle'; } }, 0);
  const i2 = await stInfo(page);
  ok(sc.ids.every((id, i) => i2.dir8[id] === i), 'renderer: direction persists while idle (path cleared)');
  await G(page, () => { const st = window.__game.state; st.staff[2].state = 'working'; st.staff[2].task = { patientId: -1, objId: null, treatmentId: 'x', total: 5, remaining: 3 }; });
  const i3 = await stInfo(page);
  ok(i3.dir8[sc.ids[2]] === 2, 'renderer: direction persists while working');
  await G(page, () => { const st = window.__game.state; st.staff[2].path = [{ x: Math.floor(st.staff[2].x) + 1, y: Math.floor(st.staff[2].y) - 1 }]; });
  const i4 = await stInfo(page);
  ok(i4.dir8[sc.ids[2]] === 6, 'renderer: starting to walk again switches the frame (l -> r)');
  const shot = async n => { if (shotDir) await page.screenshot({ path: `${shotDir}/${n}.png` }); };
  await shot('st_dirs');

  // 7d. tableaux
  await stScene(page, 'tab');
  const t1 = await stInfo(page);
  const by = Object.fromEntries(t1.tableaux.map(t => [t.patient, t.sprite]));
  ok(t1.tableaux.length === 5 && by[2] === 'staff.st.act.speech' && by[3] === 'staff.st.act.cognitive' && by[4] === 'staff.st.act.swallow' && by[5] === 'staff.st.act.counsel' && by[6] === 'staff.st.act.counsel' && by[8] === undefined,
    'tableaux per patient type (kid even/odd id, elder, office, sports); the waiting patient gets none ' + JSON.stringify(by));
  await shot('st_tableaux');
  // click on the tableau selects the STAFF member; the hidden patient is not pickable on its own
  const pk = await G(page, async () => {
    const R = window.__R, g = window.__game, st = g.state, ui = g.ui, cam = ui.cam, I = await import('./js/render/iso.js');
    const t = R.artInfo().tableaux[0], s = st.staff.find(q => q.id === t.staff), p = st.patients.find(q => q.id === t.patient);
    const at = (x, y) => R.pickAt(st, ui, I.isoX(x, y) * cam.zoom + cam.x, (I.isoY(x, y) - 14) * cam.zoom + cam.y);
    return { mid: at(t.x, t.y), staffId: s.id, patId: p.id, onPat: at(p.x, p.y), cnt: R.artInfo().tableaux.length };
  });
  ok(pk.mid && pk.mid.type === 'staff' && pk.mid.id === pk.staffId, 'click on the tableau picks the staff member ' + JSON.stringify(pk.mid));
  ok(!pk.onPat || pk.onPat.type !== 'patient' || pk.onPat.id !== pk.patId, 'the patient hidden inside a tableau is not picked separately');
  // immediate fallback: treatment ends / either agent moves -> no tableau in the very next frame
  await G(page, () => { const st = window.__game.state; st.patients.find(q => q.id === 2).stage = 'done'; st.staff[1].path = [{ x: Math.floor(st.staff[1].x) + 1, y: Math.floor(st.staff[1].y) }]; st.patients.find(q => q.id === 4).path = [{ x: 3, y: 3 }]; });
  const t2 = await stInfo(page);
  ok(!t2.tableaux.some(t => t.patient === 2 || t.patient === 3 || t.patient === 4) && t2.tableaux.length === 2, 'fallback to individual sprites the next frame (stage change, staff walking, patient walking) ' + JSON.stringify(t2.tableaux.map(t => t.patient)));
  // classic: no tableaux and no directional state
  await G(page, async () => { (await import('./js/render/art.js')).setArtEnabled(false); });
  const t3 = await stInfo(page);
  ok(t3.tableaux.length === 0, 'classic style: no tableaux');
  const bytes = await G(page, () => { const c = document.getElementById('game'); return c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3]; });
  ok(bytes === 255, 'classic frame still paints with the pairs in place');
  await G(page, async () => { (await import('./js/render/art.js')).setArtEnabled(true); });
  const t4 = await stInfo(page);
  ok(t4.tableaux.length === 2 || t4.tableaux.length === 5, 'art on again: tableaux come back');
  ok(problems.length === 0, 'no console problems in the speech-therapist checks' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}
{
  // atlas blocked: pairs + walking STs render with the procedural art, no tableaux, no errors
  const { ctx, page, problems } = await open({ route404: true });
  await page.waitForTimeout(800);
  await stScene(page, 'tab');
  const a = await stInfo(page);
  await stScene(page, 'dirs');
  const b = await stInfo(page);
  ok(a.tableaux.length === 0 && Object.keys(b.dir8).length === 0, 'atlas blocked: no tableaux / directional frames, procedural fallback');
  const painted = await G(page, () => { const c = document.getElementById('game'); return c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3]; });
  ok(painted === 255 && problems.length === 0, 'atlas blocked + ST scenes: frame painted, no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
  await ctx.close();
}

// ───────────── 5. perf: 60 agents ─────────────
async function perf(style, dpr) {
  const { ctx, page } = await open({ style, dpr, w: dpr > 1 ? 390 : 1280, h: dpr > 1 ? 844 : 720 });
  await G(page, async () => {
    const g = window.__game, P = await import('./js/sim/patients.js');
    g.state.money = 5e7; for (let i = 0; i < 64; i++) P.spawnPatient(g.state, ['elder', 'office', 'kid', 'sports'][i % 4]);
    g.bus.emit('speed:set', { speed: 3 });
  });
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); await clearModals(page); }
  const r = await G(page, async () => {
    const g = window.__game, R = await import('./js/render/renderer.js'), S = await import('./js/sim/staff.js');
    g.bus.emit('speed:set', { speed: 0 });
    // 4 speech therapists treating (in new style each one is drawn as a tableau with its patient)
    const L = g.state.lot, ps = g.state.patients.filter(p => p.stage !== 'gone'), nStaff0 = g.state.staff.length, saved = [];
    for (let i = 0; i < 4; i++) {
      const s = S.createStaff(g.state, 'st', null, L.x0 + 2 + i, L.y0 + 2); g.state.staff.push(s);
      const q = ps[i]; saved.push([q, { ...q, path: q.path, seat: q.seat }]); q.type = ['kid', 'kid', 'elder', 'office'][i]; q.x = s.x + 1; q.y = s.y; q.path = []; q.seat = null; q.stage = 'treating'; q.total = 10; q.remaining = 5;
      s.state = 'working'; s.task = { patientId: q.id, objId: null, treatmentId: 'speech', total: 10, remaining: 5 };
    }
    const n = g.state.patients.filter(p => p.stage !== 'gone').length + g.state.staff.length;
    for (let i = 0; i < 20; i++) R.render(g.state, g.ui, 1000 + i * 16);
    const t0 = performance.now(); for (let i = 0; i < 150; i++) R.render(g.state, g.ui, 5000 + i * 16);
    const ms = (performance.now() - t0) / 150;
    g.state.staff.length = nStaff0; for (const [q, o] of saved) Object.assign(q, o);     // undo the synthetic pairs before the sim runs again
    g.bus.emit('speed:set', { speed: 3 });
    const fps = await new Promise(rs => { let c = 0; const t = performance.now(); const f = () => { c++; performance.now() - t < 2500 ? requestAnimationFrame(f) : rs(c / 2.5); }; requestAnimationFrame(f); });
    return { n, ms, fps };
  });
  await ctx.close();
  return r;
}
{
  const c = await perf('classic', 1), n = await perf('new', 1);
  console.log(`perf desktop: classic ${c.ms.toFixed(2)} ms/frame (${c.fps.toFixed(0)} fps, ${c.n} agents) | new ${n.ms.toFixed(2)} ms/frame (${n.fps.toFixed(0)} fps, ${n.n} agents)`);
  ok(n.n >= 40, `perf scene has ${n.n} agents`);
  ok(n.ms < Math.max(8, c.ms * 1.6), 'new art render cost within budget vs classic');
  ok(n.fps >= Math.min(55, c.fps - 3), 'new art fps >= classic - 3 (cap 55)');
}

// ───────────── 6. soak: 3 runs, both styles ─────────────
async function soak(label, style, toggle) {
  const { ctx, page, problems } = await open({ style });
  // a speech room + a speech therapist so the real sim produces tableaux (kids / elders get 'speech' in their plans)
  await G(page, async () => {
    const g = window.__game, st = g.state, B = await import('./js/sim/build.js'), S = await import('./js/sim/staff.js'), L = st.lot;
    st.money = 5e7; for (const r of ['rs_ot', 'rs_st']) if (!st.research.done.includes(r)) st.research.done.push(r);
    outer: for (const id of ['speech_room', 'fine_table', 'exam_room']) for (let y = L.y0; y < L.y0 + L.h; y++) for (let x = L.x0; x < L.x0 + L.w; x++) if (B.canPlace(st, id, x, y, 0).ok) { B.placeObject(st, id, x, y, 0); continue outer; }
    for (const r of ['st', 'ot']) st.staff.push(S.createStaff(st, r, null, L.x0 + 2 + st.staff.length, L.y0 + 3));
    g.refreshDerived(); g.bus.emit('speed:set', { speed: 3 });
  });
  const t0 = Date.now(); let n = 0, maxAgents = 0, tabFrames = 0;
  while (Date.now() - t0 < minutes * 60000) {
    await page.waitForTimeout(2000);
    n++;
    const r = await G(page, async ([tog, n]) => {
      document.querySelectorAll('#modal-root button').forEach((b, i) => { if (i === 0) b.click(); });
      const g = window.__game, P = await import('./js/sim/patients.js'), A = await import('./js/render/art.js');
      g.state.money = Math.max(g.state.money, 1e6);
      if (g.state.patients.length < 40) P.spawnPatient(g.state, ['elder', 'office', 'kid', 'sports'][n % 4]);
      if (tog && n % 4 === 0) A.setArtEnabled(!A.artEnabled());
      if (n % 7 === 0) { const c = g.ui.cam; c.zoom = [0.5, 1, 1.6, 2.5, 0.8][(n / 7 | 0) % 5]; }
      const R = await import('./js/render/renderer.js');
      return [g.state.patients.length + g.state.staff.length, R.artInfo().tableaux.length];
    }, [toggle, n]);
    maxAgents = Math.max(maxAgents, r[0]); tabFrames += r[1];
  }
  if (shotDir) await page.screenshot({ path: `${shotDir}/arttest_${label}.png` });
  console.log(`     soak ${label}: ${tabFrames} sampled frames with a speech tableau`);
  ok(problems.length === 0, `soak ${label} (${minutes} min, <= ${maxAgents} agents): no console problems` + (problems.length ? ': ' + [...new Set(problems)].join(' | ') : ''));
  await ctx.close();
}
await soak('new', 'new', false);
await soak('classic', 'classic', false);
await soak('toggling', 'new', true);

await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
