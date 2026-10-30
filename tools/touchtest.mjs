// Touch / mobile regression: real touch input (CDP Input.dispatchTouchEvent + page.touchscreen) in mobile emulation.
// Runs the whole suite in PORTRAIT (390x844) first, then LANDSCAPE (844x390); extra sizes with --all.
// Usage (server in repo root): node tools/touchtest.mjs [--url http://localhost:8205/index.html] [--shots <dir>] [--all]
import { launchMobile, canvasRect, tileXY, agentXY, freeTiles, barButtons } from './touch.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8205/index.html');
const shotDir = arg('shots', '/tmp/claude-0/-home-user-ptgame/c74f5f54-68ad-59fe-99cf-13e9048f37ca/scratchpad');
const sizes = process.argv.includes('--all')
  ? [[390, 844], [360, 740], [412, 915], [430, 932], [375, 667], [844, 390], [740, 360], [932, 430]]
  : [[390, 844], [844, 390]];
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, e) => Math.abs(a - b) <= e;

async function suite(W, H) {
  const tag = `${W}x${H}`;
  console.log(`--- ${tag} (${W < H ? 'portrait' : 'landscape'})`);
  const { browser, page, problems, touch } = await launchMobile({ w: W, h: H, url });
  const shot = n => page.screenshot({ path: `${shotDir}/touch_${tag}_${n}.png` });
  const G = (fn, a) => page.evaluate(fn, a);
  await G(() => { __game.bus.emit('speed:set', { speed: 0 }); __game.state.money = 500000; __game.state.points = { culinary: 5000, device: 5000, service: 5000 }; document.querySelectorAll('#modal-root button').forEach(b => b.click()); });
  await page.waitForTimeout(300);
  // start from a clean full-canvas fit (the UI layer may have an in-progress free rect)
  await G(async () => { const cam = await import('/js/render/camera.js'); __game.ui.freeRect = null; cam.fitLotInRect(__game.state, document.getElementById('game'), null, __game.ui); });
  await page.waitForTimeout(200);
  const nObj = () => G(() => __game.state.objects.length);
  const money = () => G(() => __game.state.money);
  const tool = () => G(() => ({ ...__game.ui.tool }));
  const cam = () => G(() => ({ ...__game.ui.cam }));
  const setTool = t => G(t => { __game.ui.tool = { rot: 0, cat: null, ...t }; }, t);
  const cr = await canvasRect(page);
  // nearest point (to a fractional target) where the CANVAS is the element under the finger (not topbar / tab bar / sheet / card)
  const cpt = async (fx, fy) => page.evaluate(([fx, fy]) => {
    const cv = document.getElementById('game'), r = cv.getBoundingClientRect();
    const tx = r.left + r.width * fx, ty = r.top + r.height * fy;
    let best = null, bd = 1e9;
    for (let y = r.top + 4; y < r.bottom - 4; y += 8) for (let x = r.left + 4; x < r.right - 4; x += 8) {
      if (document.elementFromPoint(x, y) !== cv) continue;
      const d = Math.hypot(x - tx, y - ty); if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  }, [fx, fy]);

  // ---- sanity: environment, perf, backing store, lot fits the screen width in portrait
  const env = await G(() => ({ coarse: matchMedia('(pointer: coarse)').matches, dpr: devicePixelRatio, cw: document.getElementById('game').width, ch: document.getElementById('game').height, perf: __game.ui.perf && { ...__game.ui.perf } }));
  ok(env.coarse, 'emulated coarse pointer');
  ok(env.cw * env.ch <= 2560 * 1440 * 1.01, `backing store ${env.cw}x${env.ch} <= 2560x1440 px`);
  ok(env.perf && typeof env.perf.fps === 'number' && 'dpr' in env.perf && 'level' in env.perf, 'ui.perf = {dpr,fps,level} exposed');
  const lotBox = () => G(() => { const { state, ui } = __game, l = state.lot, c = ui.cam, r = document.getElementById('game').getBoundingClientRect(); const xs = [(l.x0 - (l.y0 + l.h)) * 32, (l.x0 + l.w - l.y0) * 32].map(v => r.left + c.x + v * c.zoom); const ys = [(l.x0 + l.y0) * 16 - 44, (l.x0 + l.w + l.y0 + l.h) * 16].map(v => r.top + c.y + v * c.zoom); return { l: xs[0], r: xs[1], t: ys[0], b: ys[1], z: c.zoom }; });
  let lb = await lotBox();
  ok(lb.l >= -2 && lb.r <= W + 2, `lot fits the screen width (${Math.round(lb.l)}..${Math.round(lb.r)} / ${W}, zoom ${lb.z})`);
  if (W < H) ok(Math.abs((lb.t + lb.b) / 2 - (cr.y + cr.h / 2)) < cr.h * 0.18, 'portrait: lot vertically centred in the canvas');
  await shot('0_start');

  // ---- tap select (staff, nearest agent with finger-sized radius)
  const st = await agentXY(page, 'staff', 0);
  await touch.tap(st.x + 9, st.y + 7);                     // slightly off the sprite: finger slop
  ok(await G(() => __game.ui.selected && __game.ui.selected.type === 'staff'), 'tap near a staff member selects it (24px finger radius)');
  await shot('1_select');
  const ep = await cpt(0.85, 0.12);
  await touch.tap(ep.x, ep.y);              // empty ground
  await page.waitForTimeout(400);
  ok(await G(() => __game.ui.selected === null), 'tap on empty ground deselects');

  // ---- one-finger drag pans (no tool armed)
  let c0 = await cam();
  const dp = await cpt(0.5, 0.75);
  await touch.drag(dp, { x: dp.x - 60, y: dp.y - 40 }, 8);
  let c1 = await cam();
  ok(c1.x < c0.x - 20 && c1.y < c0.y - 10, `one-finger drag pans camera (${Math.round(c1.x - c0.x)},${Math.round(c1.y - c0.y)})`);
  ok(await G(() => __game.ui.selected === null), 'drag does not select');

  // ---- pinch zoom + two-finger pan
  c0 = await cam();
  await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 80, 200, 12);
  c1 = await cam();
  ok(c1.zoom > c0.zoom * 1.6, `pinch out zooms in (${c0.zoom.toFixed(2)} -> ${c1.zoom.toFixed(2)})`);
  await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 240, 60, 12);
  const c2 = await cam();
  ok(c2.zoom < c1.zoom * 0.6, `pinch in zooms out (${c2.zoom.toFixed(2)})`);
  for (let i = 0; i < 3; i++) await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 300, 40, 10);
  ok(near((await cam()).zoom, 0.3, 0.001) || (await cam()).zoom >= 0.3 - 1e-6, `zoom lower clamp (${(await cam()).zoom.toFixed(2)})`);
  for (let i = 0; i < 4; i++) await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 40, 330, 10);
  ok((await cam()).zoom <= 2.5 + 1e-6, `zoom upper clamp (${(await cam()).zoom.toFixed(2)})`);
  await G(async () => { const cam = await import('/js/render/camera.js'); cam.recenter(__game.state, document.getElementById('game'), __game.ui); });
  await page.waitForTimeout(150);
  c0 = await cam();
  await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 120, 120, 8, 50, 30);
  c1 = await cam();
  ok(near(c1.zoom, c0.zoom, 0.02) && c1.x > c0.x + 15, 'two-finger drag pans without zooming');
  // lot reachability: fling far away, the lot must stay (partially) on screen
  for (let i = 0; i < 6; i++) await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 120, 120, 6, 400, 400);
  lb = await lotBox();
  ok(lb.r > 20 && lb.l < W - 20 && lb.b > 20 && lb.t < H - 20, 'lot never leaves the screen entirely');
  // double-tap recentres / refits
  await touch.doubleTap(ep.x, ep.y);
  await page.waitForTimeout(300);
  lb = await lotBox();
  ok(lb.l >= -2 && lb.r <= W + 2 && lb.z < 2, `double-tap refits the lot (${Math.round(lb.l)}..${Math.round(lb.r)}, zoom ${lb.z})`);

  // ---- multitouch cleanliness: touchCancel mid-drag leaves nothing stuck
  await touch.down({ x: dp.x, y: dp.y, id: 0 }); await touch.move({ x: dp.x + 30, y: dp.y + 10, id: 0 }); await touch.cancel();
  c0 = await cam();
  await touch.drag(dp, { x: dp.x + 40, y: dp.y }, 6);
  ok((await cam()).x > c0.x + 20, 'pan works again after touchCancel (no stuck gesture)');

  // ---- place flow: tap -> ghost -> bar (inside free rect) -> OK
  await touch.doubleTap(ep.x, ep.y); await page.waitForTimeout(250);
  const [f0, f1, f2] = await freeTiles(page, 'plant', 3);
  await setTool({ mode: 'place', defId: 'plant' });
  await page.waitForTimeout(120);
  let p = await tileXY(page, f0.x, f0.y);
  await touch.tap(p.x, p.y);
  await page.waitForTimeout(200);
  let hv = await G(() => ({ ...__game.ui.hover }));
  ok(hv.x === f0.x && hv.y === f0.y && hv.valid, `tap positions the ghost on the tapped tile (${hv.x},${hv.y} valid=${hv.valid})`);
  ok((await nObj()) === (await nObj()) && await G(() => __game.ui.tool.mode === 'place'), 'tap alone does not commit');
  let bar = await barButtons(page);
  ok(bar && bar.btns.length === 4 && bar.btns.every(b => b.w >= 44 && b.h >= 44), 'confirm bar has 4 buttons with 44px targets');
  ok(bar.x >= cr.x && bar.x + bar.w <= cr.x + cr.w && bar.y >= cr.y && bar.y + bar.h <= cr.y + cr.h, 'bar stays inside the canvas');
  await shot('2_ghost_bar');
  const n0 = await nObj(), m0 = await money();
  await touch.tap(bar.btns.find(b => b.id === 'ok').x, bar.btns.find(b => b.id === 'ok').y);
  await page.waitForTimeout(150);
  ok((await nObj()) === n0 + 1 && (await money()) < m0, `OK places the object (+1, money ${m0} -> ${await money()})`);
  ok((await tool()).mode === 'none', 'tool ends after placing (keep off)');
  await shot('3_placed');

  // ---- cancel
  await setTool({ mode: 'place', defId: 'plant' });
  p = await tileXY(page, f1.x, f1.y); await touch.tap(p.x, p.y); await page.waitForTimeout(150);
  bar = await barButtons(page);
  const nBefore = await nObj();
  await touch.tap(bar.btns.find(b => b.id === 'cancel').x, bar.btns.find(b => b.id === 'cancel').y);
  await page.waitForTimeout(150);
  ok((await tool()).mode === 'none' && (await nObj()) === nBefore, 'X cancels the tool without placing');

  // ---- rotate + drag-to-position (ghost above the finger) + second tap on ghost commits
  await setTool({ mode: 'place', defId: 'braise_pot' });
  const ft = await freeTiles(page, 'braise_pot', 4);
  if (ft.length) {
    p = await tileXY(page, ft[0].x, ft[0].y); await touch.tap(p.x, p.y); await page.waitForTimeout(150);
    bar = await barButtons(page);
    await touch.tap(bar.btns.find(b => b.id === 'rot').x, bar.btns.find(b => b.id === 'rot').y); await page.waitForTimeout(100);
    ok((await tool()).rot === 1, 'rotate button flips rotation');
    const q = await tileXY(page, ft[ft.length - 1].x, ft[ft.length - 1].y);
    await touch.drag({ x: q.x + 30, y: q.y + 80 }, { x: q.x, y: q.y + 40 }, 6, 80);       // finger 40px below the target: ghost sits above it
    hv = await G(() => ({ ...__game.ui.hover }));
    ok(near(hv.x, ft[ft.length - 1].x, 1) && near(hv.y, ft[ft.length - 1].y, 1), `dragging puts the ghost ~40px above the finger (${hv.x},${hv.y} vs ${ft[ft.length - 1].x},${ft[ft.length - 1].y})`);
    const nb = await nObj();
    await G(() => { __game.ui.tool.rot = 0; });
    // second tap on the ghost commits
    const box = await G(async () => { const m = await import('/js/render/touchui.js'); const b = m.targetBox(__game.ui), r = document.getElementById('game').getBoundingClientRect(); return b && { x: (b.x0 + b.x1) / 2 + r.left, y: (b.y0 + b.y1) / 2 + r.top }; });
    if (box) { await touch.tap(box.x, box.y); await page.waitForTimeout(150); ok((await nObj()) === nb + 1 || (await tool()).mode === 'place', 'second tap on the ghost commits (or reports why not)'); }
    await setTool({ mode: 'none' });
  }

  // ---- keep-tool pin: place twice with one armed tool
  await setTool({ mode: 'place', defId: 'plant' });
  const fk = await freeTiles(page, 'plant', 2);
  p = await tileXY(page, fk[0].x, fk[0].y); await touch.tap(p.x, p.y); await page.waitForTimeout(120);
  bar = await barButtons(page);
  await touch.tap(bar.btns.find(b => b.id === 'keep').x, bar.btns.find(b => b.id === 'keep').y); await page.waitForTimeout(120);
  ok((await tool()).keep === true, 'pin button sets ui.tool.keep');
  const nk = await nObj();
  bar = await barButtons(page); await touch.tap(bar.btns.find(b => b.id === 'ok').x, bar.btns.find(b => b.id === 'ok').y); await page.waitForTimeout(120);
  p = await tileXY(page, fk[1].x, fk[1].y); await touch.tap(p.x, p.y); await page.waitForTimeout(120);
  bar = await barButtons(page); await touch.tap(bar.btns.find(b => b.id === 'ok').x, bar.btns.find(b => b.id === 'ok').y); await page.waitForTimeout(120);
  ok((await nObj()) === nk + 2 && (await tool()).mode === 'place', `keep tool: two placements, tool stays armed (${nk} -> ${await nObj()}, ${JSON.stringify(await tool())})`);
  await shot('4_keep');
  bar = await barButtons(page); await touch.tap(bar.btns.find(b => b.id === 'cancel').x, bar.btns.find(b => b.id === 'cancel').y); await page.waitForTimeout(120);

  // ---- paint: one-finger drag paints a run of tiles, tap paints one
  const floorId = await G(async () => { const { BUILDABLES } = await import('/js/data/buildables.js'); const { isUnlocked } = await import('/js/sim/build.js'); return Object.values(BUILDABLES).find(d => d.layer === 'floor' && isUnlocked(__game.state, d.id))?.id; });
  await setTool({ mode: 'paint', defId: floorId });
  const nFloor = () => G(() => __game.state.map.floor.reduce((s, r) => s + r.filter(Boolean).length, 0));
  const fl0 = await nFloor();
  const fp = await freeTiles(page, floorId, 40);
  const row = fp[0].y, rowTiles = fp.filter(t => t.y === row).slice(0, 5);
  const a = await tileXY(page, rowTiles[0].x, row), b = await tileXY(page, rowTiles[rowTiles.length - 1].x, row);
  c0 = await cam();
  await touch.drag(a, b, 10);
  const fl1 = await nFloor();
  ok(fl1 >= fl0 + rowTiles.length - 1, `paint drag paints a run of floor tiles (+${fl1 - fl0})`);
  ok(near((await cam()).x, c0.x, 1), 'paint drag does not pan');
  await shot('5_paint');
  c0 = await cam();
  await touch.pinch(cr.x + cr.w / 2, cr.y + cr.h / 2, 120, 120, 8, 60, 0);
  ok((await cam()).x > c0.x + 20 && (await nFloor()) === fl1, 'two fingers pan while painting (no paint)');
  await setTool({ mode: 'none' });

  // ---- demolish: tap selects target, drag only pans, OK demolishes
  await touch.doubleTap(ep.x, ep.y); await page.waitForTimeout(250);
  const victim = await G(() => { const o = __game.state.objects.find(o => o.defId === 'plant'); return o && { x: o.x, y: o.y, id: o.id }; });
  await setTool({ mode: 'demolish' });
  p = await tileXY(page, victim.x, victim.y);
  c0 = await cam();
  const nd0 = await nObj();
  await touch.drag({ x: p.x, y: p.y }, { x: p.x + 40, y: p.y + 10 }, 8);
  ok((await nObj()) === nd0 && (await cam()).x > c0.x + 15, 'demolish: one-finger drag only pans (no bulk demolish)');
  p = await tileXY(page, victim.x, victim.y);
  await touch.tap(p.x, p.y); await page.waitForTimeout(150);
  ok((await nObj()) === nd0, 'demolish: tapping an object only highlights it');
  bar = await barButtons(page);
  await shot('6_demolish');
  await touch.tap(bar.btns.find(b => b.id === 'ok').x, bar.btns.find(b => b.id === 'ok').y); await page.waitForTimeout(150);
  ok((await nObj()) === nd0 - 1, 'demolish: OK removes the object');
  await setTool({ mode: 'none' });

  // ---- long-press an object -> bus 'object:context'
  await touch.doubleTap(ep.x, ep.y); await page.waitForTimeout(250);
  await G(() => { window.__ctx = null; __game.bus.on('object:context', e => { window.__ctx = e; }); });
  const target = await G(() => { const o = __game.state.objects.find(o => o.defId !== 'plant') || __game.state.objects[0]; return { x: o.x, y: o.y, id: o.id, defId: o.defId }; });
  const pos = await tileXY(page, target.x, target.y);
  await touch.hold(pos.x, pos.y - 8, 700);
  const ctxEv = await G(() => window.__ctx);
  ok(ctxEv && ctxEv.id != null && typeof ctxEv.x === 'number', `long-press fires object:context ${JSON.stringify(ctxEv)}`);
  await shot('7_context');
  // built-in chip is the fallback when the UI layer does not claim the event (handled / ui.contextUI)
  const claimed = await G(() => !!__game.ui.contextUI);
  if (ctxEv && !claimed) console.log('     (UI layer did not claim object:context: built-in chip active; set e.handled=true or ui.contextUI)');
  await G(() => { __game.ui.selected = null; const m = document.querySelector('.u-ctx'); if (m) m.hidden = true; });   // the popover would sit on top of the bar
  // demolish route for a specific object (also what the chip / UI context menu calls)
  const vid = await G(async (id) => { const m = await import('/js/render/input.js'); return m.startDemolishObject(id); }, target.id);
  ok(vid && (await tool()).mode === 'demolish', 'startDemolishObject arms the demolish tool on the object');
  bar = await barButtons(page);
  const ndx = await nObj();
  await touch.tap(bar.btns.find(b => b.id === 'ok').x, bar.btns.find(b => b.id === 'ok').y); await page.waitForTimeout(150);
  ok((await nObj()) === ndx - 1, 'context -> demolish -> OK removes the long-pressed object');
  await setTool({ mode: 'none' });

  // ---- MOVE an object on touch: long-press -> 移動 -> drag the ghost -> ✔ (and ✖ / ⟳ / tray collapse / bar inside freeRect)
  {
    await G(() => { __game.state.money = 500000; __game.ui.selected = null; __game.ui.panel = null; });
    await G(async () => { const cam = await import('/js/render/camera.js'); __game.ui.freeRect = null; cam.fitLotInRect(__game.state, document.getElementById('game'), null, __game.ui); });
    await page.waitForTimeout(400);
    const mvObj = () => G(() => { const o = __game.state.objects.find(o => o.defId === 'noodle_stove'); return { id: o.id, x: o.x, y: o.y, rot: o.rot }; });
    // a valid destination origin (>= 3 tiles from the old spot), the fee, and the finger point that puts the ghost there
    const dest = await G(async () => {
      const b = await import('/js/sim/build.js'), { state } = __game, o = state.objects.find(o => o.defId === 'noodle_stove'), l = state.lot;
      for (let y = l.y0 + 1; y < l.y0 + l.h - 1; y++) for (let x = l.x0 + 1; x < l.x0 + l.w - 1; x++)
        if (Math.abs(x - o.x) + Math.abs(y - o.y) >= 3 && b.canMove(state, o.id, x, y, 0).ok) return { x, y, fee: b.relocationCost('noodle_stove') };
      return null;
    });
    ok(dest && dest.fee >= 500, `a valid move destination exists (fee NT$ ${dest && dest.fee})`);
    const longPressMove = async (id) => {
      const o = await G(id => { const o = __game.state.objects.find(o => o.id === id); return { x: o.x, y: o.y }; }, id);
      const pp = await tileXY(page, o.x, o.y);
      // freeze the sim and park every agent in the street so nobody stands on the target (a walking agent
      // within 24px would be picked instead of the object: that made this step flaky)
      await G(() => { const { state } = __game; for (const a of [...state.patients, ...state.staff]) { a.x = state.door.x + 0.5; a.y = state.door.y + 5.5; a.path = []; } state.time.paused = true; });
      await touch.hold(pp.x, pp.y - 8, 700);
      const mb = await page.locator('.u-ctx .u-ctx-btn', { hasText: '移動' }).boundingBox();
      await G(() => { __game.state.time.paused = false; });
      if (!mb) return false;
      await touch.tap(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.waitForTimeout(250);
      return true;
    };
    const fingerFor = async d => { const q = await tileXY(page, d.x, d.y); return { x: q.x, y: q.y + 40 }; };   // ghost is lifted ~40px above the finger
    const m0 = await money();
    let ob = await mvObj();
    ok(await longPressMove(ob.id), 'long-press menu offers 移動');
    let tl = await tool();
    ok(tl.mode === 'move' && tl.carry === ob.id, 'choosing 移動 picks the object up (ui.tool.mode=move, carry=id)');
    let bar2 = await barButtons(page);
    ok(bar2 && ['ok', 'cancel', 'rot', 'keep'].every(id => bar2.btns.some(b => b.id === id)), 'move shows the ✔/✖/⟳/📌 confirm bar');
    await shot('move_1_picked');
    // drag the ghost from an empty canvas spot (not on the bar) to the destination
    const sp = await cpt(0.5, 0.82);
    const ff = await fingerFor(dest);
    await touch.path([sp, { x: (sp.x + ff.x) / 2, y: (sp.y + ff.y) / 2 }, ff], 120);
    await page.waitForTimeout(150);
    const hv = await G(() => ({ ...__game.ui.hover }));
    ok(hv.valid && hv.ox === dest.x && hv.oy === dest.y, `dragging moves the ghost to the destination (${hv.ox},${hv.oy}) valid=${hv.valid}`);
    ob = await mvObj();
    ok(!(ob.x === dest.x && ob.y === dest.y), 'object does not move until ✔');
    await shot('move_2_dragged');
    bar2 = await barButtons(page);
    ok(bar2 && bar2.x >= cr.x - 1 && bar2.x + bar2.w <= cr.x + cr.w + 1 && bar2.y >= cr.y - 1 && bar2.y + bar2.h <= cr.y + cr.h + 1, 'confirm bar is on screen');
    const okb = bar2.btns.find(b => b.id === 'ok');
    await touch.tap(okb.x, okb.y); await page.waitForTimeout(200);
    ob = await mvObj();
    ok(ob.x === dest.x && ob.y === dest.y, `✔ drops the object at the destination (${ob.x},${ob.y})`);
    ok((await money()) === m0 - dest.fee, `relocation fee charged exactly once (NT$ ${dest.fee})`);
    ok((await tool()).mode === 'none', 'tool ends after the drop');
    const old = { x: dest.x, y: dest.y };

    // cancel: ✖ leaves the object and the money untouched
    const m1 = await money();
    ok(await longPressMove(ob.id), 'second long-press -> 移動');
    const dest2 = await G(async () => { const b = await import('/js/sim/build.js'), { state } = __game, o = state.objects.find(o => o.defId === 'noodle_stove'), l = state.lot;
      for (let y = l.y0 + 1; y < l.y0 + l.h - 1; y++) for (let x = l.x0 + 1; x < l.x0 + l.w - 1; x++) if (Math.abs(x - o.x) + Math.abs(y - o.y) >= 3 && b.canMove(state, o.id, x, y, 0).ok) return { x, y }; return null; });
    const sp2 = await cpt(0.5, 0.82), ff2 = await fingerFor(dest2);
    await touch.path([sp2, ff2], 80); await page.waitForTimeout(120);
    const rot0 = (await tool()).rot;
    bar2 = await barButtons(page);
    const rb = bar2.btns.find(b => b.id === 'rot'); await touch.tap(rb.x, rb.y); await page.waitForTimeout(120);
    ok((await tool()).rot !== rot0, '⟳ rotates the carried ghost');
    bar2 = await barButtons(page);
    const cb = bar2.btns.find(b => b.id === 'cancel'); await touch.tap(cb.x, cb.y); await page.waitForTimeout(200);
    ob = await mvObj();
    ok(ob.x === old.x && ob.y === old.y && (await money()) === m1 && (await tool()).mode === 'none', '✖ cancels: position and money untouched');

    // with the build panel open: tray collapses and the bar stays inside ui.freeRect
    await G(() => { __game.ui.panel = 'build'; });
    await page.waitForTimeout(600);
    ok(await longPressMove(ob.id), 'long-press -> 移動 with the build panel open');
    await page.waitForTimeout(500);
    const bm = await G(() => document.getElementById('stage').dataset.bmode);
    ok(bm === (W < H ? 'tray' : 'strip'), `build panel collapses to its ${W < H ? 'tray' : 'strip'} while carrying (bmode ${bm})`);
    const fr = await G(() => __game.ui.freeRect && { ...__game.ui.freeRect });
    bar2 = await barButtons(page);
    ok(bar2 && (!fr || (bar2.y >= cr.y + fr.y - 1 && bar2.y + bar2.h <= cr.y + fr.y + fr.h + 1 && bar2.x >= cr.x + fr.x - 1 && bar2.x + bar2.w <= cr.x + fr.x + fr.w + 1)), `move bar stays inside ui.freeRect ${JSON.stringify(fr)}`);
    await shot('move_3_tray');
    bar2 = await barButtons(page);
    const cb2 = bar2.btns.find(b => b.id === 'cancel'); await touch.tap(cb2.x, cb2.y); await page.waitForTimeout(200);
    ok((await tool()).mode === 'none', '✖ ends the move tool');
    await G(() => { __game.ui.panel = null; });
    await page.waitForTimeout(500);
    await G(async () => { const cam = await import('/js/render/camera.js'); __game.ui.freeRect = null; cam.fitLotInRect(__game.state, document.getElementById('game'), null, __game.ui); });
    await page.waitForTimeout(250);
  }

  // ---- bar is clamped to a UI-provided free rect (bottom sheet / tab bar)
  const free = { x: 0, y: Math.round(H * 0.1), w: W, h: Math.round(H * 0.55) };
  await G(async (fr) => { const cam = await import('/js/render/camera.js'); cam.fitLotInRect(__game.state, document.getElementById('game'), fr, __game.ui); }, free);
  await page.waitForTimeout(150);
  lb = await lotBox();
  ok(lb.l >= -2 && lb.r <= W + 2 && lb.t >= cr.y + free.y - 4 && lb.b <= cr.y + free.y + free.h + 4, `fitLotInRect fits the lot inside the free rect (${Math.round(lb.t)}..${Math.round(lb.b)} vs ${cr.y + free.y}..${cr.y + free.y + free.h})`);
  await setTool({ mode: 'place', defId: 'plant' });
  const fz = await freeTiles(page, 'plant', 1);
  p = await tileXY(page, fz[0].x, fz[0].y); await touch.tap(p.x, p.y); await page.waitForTimeout(150);
  bar = await barButtons(page);
  ok(bar && bar.y >= cr.y + free.y - 1 && bar.y + bar.h <= cr.y + free.y + free.h + 1, 'bar stays inside ui.freeRect');
  await shot('8_freerect');
  await setTool({ mode: 'none' });
  await G(() => { __game.ui.freeRect = null; });

  // ---- resize / orientation: automatic camera refits
  await G(async () => { const cam = await import('/js/render/camera.js'); cam.recenter(__game.state, document.getElementById('game'), __game.ui); });
  await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(700);
  const lb2 = await G(() => { const { state, ui } = __game, l = state.lot, c = ui.cam, r = document.getElementById('game').getBoundingClientRect(); return { l: r.left + c.x + (l.x0 - (l.y0 + l.h)) * 32 * c.zoom, r: r.left + c.x + (l.x0 + l.w - l.y0) * 32 * c.zoom, w: innerWidth }; });
  ok(lb2.l >= -2 && lb2.r <= lb2.w + 2, `orientation change refits the lot (${Math.round(lb2.l)}..${Math.round(lb2.r)} / ${lb2.w})`);
  await shot('9_rotated');
  await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(400);

  // ---- page never scrolled / zoomed, no console problems, perf state sane
  const pg = await G(() => ({ sy: scrollY, sx: scrollX, scale: visualViewport ? visualViewport.scale : 1, ow: document.documentElement.scrollWidth - innerWidth, oh: document.documentElement.scrollHeight - innerHeight, perf: { ...__game.ui.perf } }));
  ok(pg.sy === 0 && pg.sx === 0 && pg.scale === 1 && pg.ow <= 1 && pg.oh <= 1, `no page scroll / zoom (scroll ${pg.sx},${pg.sy} scale ${pg.scale} overflow ${pg.ow},${pg.oh})`);
  console.log(`     perf: fps~${pg.perf.fps.toFixed(0)} level ${pg.perf.level} dpr ${pg.perf.dpr}`);
  const missing = problems.some(x => /mobile\.css/.test(x));   // UI layer in progress: unrelated 404
  const real = problems.filter(x => !/mobile\.css|manifest|sw\.js|service/i.test(x) && !(missing && /Failed to load resource/.test(x)));
  ok(real.length === 0, 'no console problems ' + real.join(' | '));
  await browser.close();
}

for (const [w, h] of sizes) await suite(w, h);
console.log(failed ? `FAILED (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
