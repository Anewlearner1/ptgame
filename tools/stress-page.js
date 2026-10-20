// In-page helpers for tools/stress.mjs (classic script, injected with page.addScriptTag). Defines window.__st.
// Everything goes through dynamic import() of the SAME module instances the game uses (same URLs).
(() => {
  const st = (window.__st = { problems: new Set(), stuckSince: new Map(), insideSince: new Map(), frameMs: [], inconsist: new Map() });

  st.init = async () => {
    const R = '/js/';
    st.P = await import(R + 'sim/patients.js');
    st.S = await import(R + 'sim/staff.js');
    st.B = await import(R + 'sim/build.js');
    st.Save = await import(R + 'sim/save.js');
    st.PF = await import(R + 'sim/pathfinding.js');
    st.G = await import(R + 'core/grid.js');
    st.D = {
      B: (await import(R + 'data/buildables.js')).BUILDABLES,
      L: (await import(R + 'data/lots.js')).LOTS,
      R: (await import(R + 'data/research.js')).RESEARCH,
      T: (await import(R + 'data/treatments.js')).TREATMENTS,
      PT: (await import(R + 'data/patients.js')).PATIENT_TYPES,
      LINES: (await import(R + 'data/texts.js')).LINES,
    };
    // time every game frame (sim + render + ui) by wrapping rAF callbacks
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const a = performance.now();
      try { cb(t); } finally { const d = performance.now() - a; st.frameMs.push(d); if (st.frameMs.length > 4000) st.frameMs.splice(0, 2000); }
    });
    return true;
  };

  st.g = () => window.__game;
  st.refresh = () => { const g = st.g(); g.refreshDerived(); };

  // Unlock everything, big lot, lots of money.
  st.bigClinic = ({ lot = 3, nStations = 1, nStaff = 12 } = {}) => {
    const { state } = st.g();
    state.research.done = Object.keys(st.D.R);
    state.money = 5e8;
    state.lotLevel = lot;
    const L = st.D.L[lot];
    state.lot = { ...L.lot }; state.door = { ...L.door };
    st.refresh();
    return st;
  };

  // greedy placement: scan lot, keep a 2-wide corridor x=14..15 (inside) and every 4th row free of blockers
  st.fill = (defId, count, opts = {}) => {
    const { state } = st.g();
    const L = state.lot;
    let placed = 0;
    const cand = [];
    for (let y = L.y0; y < L.y0 + L.h; y++) for (let x = L.x0; x < L.x0 + L.w; x++) for (let rot = 0; rot < 2; rot++) cand.push({ x, y, rot });
    if (opts.shuffle) cand.sort(() => Math.random() - 0.5);
    for (const c of cand) {
      if (placed >= count) break;
      const def = st.D.B[defId];
      const w = c.rot ? def.h : def.w, h = c.rot ? def.w : def.h;
      if (opts.corridor !== false) {
        let bad = false;
        for (let dx = 0; dx < w; dx++) { const cx = c.x + dx; if (cx === 14 || cx === 15) bad = true; }
        if (bad) continue;
        if (c.y + h - 1 >= L.y0 + L.h - 2 && !opts.low) continue;     // keep the 2 bottom rows free
      }
      if (st.B.canPlace(state, defId, c.x, c.y, c.rot).ok) {
        if (st.B.placeObject(state, defId, c.x, c.y, c.rot)) placed++;
      }
    }
    st.refresh();
    return placed;
  };

  st.hireAll = (roles) => {
    const { state } = st.g();
    for (const r of roles) {
      const s = st.S.createStaff(state, r, null, state.door.x, state.door.y - 1);
      state.staff.push(s);
    }
  };

  st.setup100 = () => {
    st.bigClinic({ lot: 3 });
    const plan = [['reception', 3], ['sofa', 14], ['water', 2], ['tv', 1], ['plant', 3], ['exam_room', 3], ['us_room', 1], ['rest_room', 1],
      ['heatbox', 8], ['tens', 8], ['traction', 4], ['ir_lamp', 4], ['bed', 6], ['redcord', 1], ['shockwave_room', 1], ['laser_room', 1], ['manual_room', 1],
      ['si_room', 1], ['fine_table', 2], ['speech_room', 1], ['coffee', 1]];
    const res = {};
    for (const [d, n] of plan) res[d] = st.fill(d, n);
    st.hireAll(['doctor', 'doctor', 'doctor', 'pt', 'pt', 'pt', 'pt', 'pt', 'pt', 'nurse', 'nurse', 'nurse', 'ot', 'ot', 'st']);
    st.refresh();
    return res;
  };

  // keep `target` patients on the floor by force-spawning
  st.keepFull = (target, planOverride) => {
    const { state } = st.g();
    st.P.TUNE.MAX_PATIENTS = Math.max(st.P.TUNE.MAX_PATIENTS, target + 20);
    const types = Object.keys(st.D.PT);
    clearInterval(st._fillT);
    st._fillT = setInterval(() => {
      const s = st.g().state;
      if (s.time.paused) return;
      let guard = 0;
      while (s.patients.length < target && guard++ < 6) { const p = st.P.spawnPatient(s, planOverride ? 'sports' : types[Math.floor(Math.random() * types.length)]); if (p && planOverride) { p.plan = planOverride.slice(); p.selfPaySteps = []; } }
    }, 250);
  };
  st.stopFill = () => clearInterval(st._fillT);

  // ---------------- consistency checker ----------------
  // Returns list of strings; transient ones (seen once) are reported only if they persist (see st.watch).
  st.check = () => {
    const { state } = st.g();
    const out = [];
    const pat = new Map(state.patients.map(p => [p.id, p]));
    const stf = new Map(state.staff.map(s => [s.id, s]));
    const obj = new Map(state.objects.map(o => [o.id, o]));
    const occ = state.map.occ;
    const now = performance.now();
    const agents = [...state.patients.map(p => ['P', p]), ...state.staff.map(s => ['S', s])];
    for (const [k, a] of agents) {
      const id = k + a.id;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) out.push(`NaN pos ${id}`);
      if (a.path && a.path.some(t => !Number.isFinite(t.x) || !Number.isFinite(t.y))) out.push(`NaN path ${id}`);
      if (a.x < 0 || a.y < 0 || a.x > 32 || a.y > 32) out.push(`out of map ${id} ${a.x},${a.y}`);
      // inside blocking object (seated patients legitimately stand on their seat; chatting/queue do not)
      const tx = Math.floor(a.x), ty = Math.floor(a.y);
      const blocked = occ && occ[ty] && occ[ty][tx];
      const seated = k === 'P' && a.seat && a.seat.x === tx && a.seat.y === ty;
      if (blocked && !seated) {
        if (!st.insideSince.has(id)) st.insideSince.set(id, now);
        else if (now - st.insideSince.get(id) > 20000) out.push(`INSIDE-OBJ>20s ${id} ${a.stage || a.state} at ${tx},${ty} obj ${blocked}`);
      } else st.insideSince.delete(id);
    }
    for (const id of [...st.insideSince.keys()]) { const a = id[0] === 'P' ? pat.get(+id.slice(1)) : stf.get(+id.slice(1)); if (!a) st.insideSince.delete(id); }
    for (const o of state.objects) {
      if (o.usedBy != null && !pat.has(o.usedBy)) out.push(`obj ${o.id}(${o.defId}) usedBy missing patient ${o.usedBy}`);
      if (o.staffId != null && !stf.has(o.staffId)) out.push(`obj ${o.id}(${o.defId}) staffId missing staff ${o.staffId}`);
      if ((o.busy) && o.usedBy == null && o.staffId == null) {
        // rest room reserved by resting staff is busy w/o usedBy; check the staff still points at it
        if (!state.staff.some(s => s.restObj === o.id)) out.push(`obj ${o.id}(${o.defId}) busy with no owner`);
      }
      if (o.usedBy != null && !o.busy) out.push(`obj ${o.id}(${o.defId}) usedBy but not busy`);
    }
    for (const p of state.patients) {
      if (p.targetObj != null && !obj.has(p.targetObj)) out.push(`P${p.id} targetObj missing ${p.targetObj}`);
      if (p.staffId != null && !stf.has(p.staffId)) out.push(`P${p.id} staffId missing ${p.staffId}`);
      if (p.seat && !obj.has(p.seat.objId)) out.push(`P${p.id} seat obj missing`);
      if (p.chat && !stf.has(p.chat.staffId)) out.push(`P${p.id} chat staff missing`);
      if (p.stage === 'treating' && (!p.targetObj)) out.push(`P${p.id} treating without station`);
      if (p.targetObj != null && ['to_station', 'treating'].includes(p.stage) && !p.pre) {
        const o = obj.get(p.targetObj);
        if (o && o.usedBy !== p.id) out.push(`P${p.id} ${p.stage} but obj ${o.id}.usedBy=${o.usedBy}`);
      }
    }
    for (const s of state.staff) {
      if (s.task && s.task.patientId != null && s.task.treatmentId !== '__chat' && !pat.has(s.task.patientId)) out.push(`S${s.id} task for missing patient ${s.task.patientId}`);
      if (s.task && s.task.objId != null && !obj.has(s.task.objId)) out.push(`S${s.id} task obj missing`);
      if (s.restObj != null && !obj.has(s.restObj)) out.push(`S${s.id} restObj missing`);
      if (s.restObj != null) { const o = obj.get(s.restObj); if (o && o.staffId !== s.id) out.push(`S${s.id} restObj ${o.id}.staffId=${o.staffId}`); }
    }
    for (const s of state.staff) {
      if (s.state === 'working' && s.task && s.task.treatmentId !== '__chat') {
        const p = pat.get(s.task.patientId);
        if (p && p.staffId !== s.id) out.push(`S${s.id} working for P${p.id} but P.staffId=${p.staffId}`);
        if (p && !['treating', 'registering', 'to_station', 'to_reception'].includes(p.stage)) out.push(`S${s.id} working for P${p.id} in stage ${p.stage}`);
      }
      if (s.state === 'resting' && !s.restObj) out.push(`S${s.id} resting without restObj`);
      if (s.state === 'working' && !s.task) out.push(`S${s.id} working without task`);
    }
    for (const p of state.patients) {
      if (p.staffId != null && ['treating', 'registering'].includes(p.stage) && !p.selfReg) {
        const s = stf.get(p.staffId);
        if (s && (!s.task || s.task.patientId !== p.id)) out.push(`P${p.id} ${p.stage} with S${s.id} whose task is ${s.task ? s.task.patientId : 'null'}`);
      }
    }
    // queue ids
    for (const id of state.queue) if (!pat.has(id)) out.push(`queue has missing patient ${id}`);
    // dup ids
    if (pat.size !== state.patients.length) out.push('duplicate patient ids');
    if (stf.size !== state.staff.length) out.push('duplicate staff ids');
    return out;
  };

  // call every few seconds: an inconsistency is only reported if it was also present on the previous check (>=300 ms ago)
  st.watch = () => {
    const cur = new Set(st.check());
    const bad = [];
    for (const m of cur) if (st.inconsist.has(m)) bad.push(m);
    st.inconsist = cur;
    for (const m of bad) st.problems.add(m);
    return bad;
  };

  // stuck detector: agent not moving for > ms real time while in a stage that implies it should be moving/progressing
  st.stuck = (limitMs, okStates) => {
    const { state } = st.g();
    const now = performance.now();
    const out = [];
    const seen = new Set();
    for (const [k, a] of [...state.patients.map(p => ['P', p]), ...state.staff.map(s => ['S', s])]) {
      const id = k + a.id;
      seen.add(id);
      const stg = a.stage || a.state;
      const sig = a.x.toFixed(2) + ',' + a.y.toFixed(2) + ',' + stg + ',' + (a.remaining != null ? Math.round(a.remaining) : '');
      const prev = st.stuckSince.get(id);
      if (!prev || prev.sig !== sig) st.stuckSince.set(id, { sig, t: now, stg });
      else if (now - prev.t > limitMs && !state.time.paused && !(okStates || []).includes(stg)) {
        out.push(`${id} ${a.type || a.role} stage=${stg} pos=${a.x.toFixed(1)},${a.y.toFixed(1)} plan=${a.plan ? a.plan.join('>') + '@' + a.planIdx : ''} tgt=${a.targetObj || ''} staff=${a.staffId || ''} age=${a.age ? Math.round(a.age) : ''} for ${Math.round((now - prev.t) / 1000)}s`);
      }
    }
    for (const id of [...st.stuckSince.keys()]) if (!seen.has(id)) st.stuckSince.delete(id);
    return out;
  };


  // ---------------- chaos ----------------
  st.log = [];
  const note = (m) => { st.log.push(m); if (st.log.length > 40) st.log.shift(); };
  const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
  const objAtAgent = () => {
    const { state } = st.g();
    const a = pickOf([...state.patients, ...state.staff]);
    return a ? { x: Math.floor(a.x), y: Math.floor(a.y), a } : null;
  };
  st.chaosAct = (kind) => {
    const g = st.g(), state = g.state, B = st.B, D = st.D;
    const L = state.lot;
    if (state.money < 1e7) state.money = 5e8;
    const defs = Object.keys(D.B).filter(d => D.B[d].layer === 'object');
    const kinds = ['demolish', 'demolishUsed', 'demolishSeat', 'demolishReception', 'demolishRest', 'place', 'place', 'place', 'place', 'placeOnAgent', 'placeOnAgent', 'rotate', 'floor', 'floor', 'floorErase', 'hire', 'hire', 'hire', 'fire', 'fireWorking', 'saveLoad', 'speed', 'panel', 'panel', 'esc', 'key', 'key', 'pause', 'refill', 'refill', 'expand'];
    kind = kind || pickOf(kinds);
    switch (kind) {
      case 'demolish': { const o = pickOf(state.objects); if (o) { B.removeAt(state, o.x, o.y); note('demolish ' + o.defId); } break; }
      case 'demolishUsed': { const o = pickOf(state.objects.filter(o => o.usedBy != null || o.staffId != null)); if (o) { B.removeAt(state, o.x, o.y); note('demolish in-use ' + o.defId); } break; }
      case 'demolishSeat': { const p = pickOf(state.patients.filter(p => p.seat)); if (p) { const o = state.objects.find(o => o.id === p.seat.objId); if (o) { B.removeAt(state, o.x, o.y); note('demolish sofa under P' + p.id); } } break; }
      case 'demolishReception': { const o = pickOf(state.objects.filter(o => o.defId === 'reception')); if (o) { B.removeAt(state, o.x, o.y); note('demolish reception'); } break; }
      case 'demolishRest': { const o = pickOf(state.objects.filter(o => o.defId === 'rest_room')); if (o) { B.removeAt(state, o.x, o.y); note('demolish rest_room'); } break; }
      case 'place': {
        for (let i = 0; i < 12; i++) {
          const d = pickOf(defs), x = L.x0 + Math.floor(Math.random() * L.w), y = L.y0 + Math.floor(Math.random() * L.h), rot = Math.random() < 0.5 ? 0 : 1;
          if (B.canPlace(state, d, x, y, rot).ok && B.placeObject(state, d, x, y, rot)) { note(`place ${d}@${x},${y}r${rot}`); break; }
        }
        break;
      }
      case 'placeOnAgent': {
        const t = objAtAgent(); if (!t) break;
        for (const d of ['plant', 'water', 'tv', 'sofa', 'tens', 'bed', 'reception', 'exam_room', 'rest_room', 'si_room']) {
          for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [-2, -2], [-2, 0], [0, -2]]) for (const rot of [0, 1]) {
            if (B.canPlace(state, d, t.x + dx, t.y + dy, rot).ok && B.placeObject(state, d, t.x + dx, t.y + dy, rot)) { note(`placeOnAgent ${d}@${t.x + dx},${t.y + dy}`); return kind; }
          }
        }
        break;
      }
      case 'rotate': { const o = pickOf(state.objects.filter(o => D.B[o.defId].w !== D.B[o.defId].h)); if (o) { const { defId, x, y, rot } = o; B.removeAt(state, x, y); const ok = B.canPlace(state, defId, x, y, rot ^ 1).ok && B.placeObject(state, defId, x, y, rot ^ 1); if (!ok) B.placeObject(state, defId, x, y, rot); note('rotate ' + defId); } break; }
      case 'floor': { const f = pickOf(['floor_mat', 'floor_wood', 'ramp']); const x = L.x0 + Math.floor(Math.random() * L.w), y = L.y0 + Math.floor(Math.random() * L.h); B.paintFloor(state, f, x, y); note('floor ' + f); break; }
      case 'floorErase': { const x = L.x0 + Math.floor(Math.random() * L.w), y = L.y0 + Math.floor(Math.random() * L.h); if (state.map.floor[y][x]) { state.map.floor[y][x] = null; ui_dirty(); note('floor erase'); } break; }
      case 'hire': { st.S.refreshPool(state); const c = pickOf(state.hirePool); if (c && st.S.hire(state, c.cid)) note('hire ' + c.role); break; }
      case 'fire': { const s = pickOf(state.staff); if (s && state.staff.length > 2) { st.S.fire(state, s.id); note('fire ' + s.role); } break; }
      case 'fireWorking': { const s = pickOf(state.staff.filter(s => s.state === 'working' || s.state === 'resting' || s.task)); if (s) { st.S.fire(state, s.id); note('fire working ' + s.role + ' ' + s.state); } break; }
      case 'saveLoad': { st.Save.saveGame(state, '1'); if (Math.random() < 0.7) { const ok = st.Save.loadGame(g.state, '1'); note('save+load ' + ok); } else note('save'); break; }
      case 'speed': { const sp = pickOf([1, 2, 3, 3, 3]); g.bus.emit('speed:set', { speed: sp }); note('speed ' + sp); break; }
      case 'pause': { g.bus.emit('speed:set', { speed: 0 }); setTimeout(() => g.bus.emit('speed:set', { speed: 3 }), 400); note('pause'); break; }
      case 'panel': { const b = document.querySelectorAll('#sidebar .sidebar-btn'); if (b.length) pickOf([...b]).click(); note('panel'); break; }
      case 'esc': { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); note('esc'); break; }
      case 'key': { const k = pickOf(['b', 'o', 'c', 'v', 'm', 'y', 'g', 'r', '1', '2', '3']); document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); note('key ' + k); break; }
      case 'refill': { if (state.objects.filter(o => o.defId === 'reception').length === 0) st.fill('reception', 1, { shuffle: true }); if (state.staff.length < 5) st.hireAll(['pt', 'nurse', 'doctor']); break; }
      case 'expand': { const lv = Math.min(3, (state.lotLevel || 0) + 1); if (state.lotLevel < lv) { state.lotLevel = lv; state.lot = { ...D.L[lv].lot }; state.door = { ...D.L[lv].door }; g.bus.emit('map:changed', {}); note('expand ' + lv); } break; }
    }
    return kind;
  };
  function ui_dirty() { st.g().ui.dirtyOcc = true; st.g().bus.emit('map:changed', {}); }

  st.setupChaos = () => {
    st.bigClinic({ lot: 1 });
    const plan = [['reception', 2], ['sofa', 6], ['water', 1], ['plant', 2], ['exam_room', 2], ['rest_room', 1], ['heatbox', 4], ['tens', 4], ['traction', 2], ['ir_lamp', 2], ['bed', 3], ['redcord', 1], ['si_room', 1], ['fine_table', 1], ['speech_room', 1]];
    for (const [d, n] of plan) st.fill(d, n);
    st.hireAll(['doctor', 'pt', 'pt', 'pt', 'nurse', 'nurse', 'ot', 'st']);
    st.refresh();
  };


  // ---------------- staff rest scenario ----------------
  st.setupRest = (withRest) => {
    const { state } = st.g();
    state.objects.length = 0; state.staff.length = 0; state.patients.length = 0; state.queue.length = 0;
    st.bigClinic({ lot: 1 });
    const plan = [['reception', 1], ['sofa', 4], ['water', 1], ['bed', 3]];
    if (withRest) plan.push(['rest_room', 1]);
    for (const [d, n] of plan) st.fill(d, n);
    st.hireAll(['nurse', 'nurse', 'pt', 'pt']);
    st.refresh();
    st.rest = { byStaff: {}, tiredBubble: 0, slow: 0 };
    clearInterval(st._restT);
    const tiredLines = new Set(st.D.LINES.staff.tired);
    st._restT = setInterval(() => {
      const s = st.g().state;
      const R = st.rest;
      for (const m of s.staff) {
        const r = R.byStaff[m.id] || (R.byStaff[m.id] = { role: m.role, minFrac: 1, headedRest: 0, arrivedRest: 0, recovered: 0, returned: 0, phase: 'work', rooms: new Set(), tiredFlag: 0, maxFactor: 1 });
        const f = m.stamina / m.staminaMax;
        r.minFrac = Math.min(r.minFrac, f);
        if (m.tired) r.tiredFlag++;
        if (m.bubble && tiredLines.has(m.bubble.text)) { if (!m._tb) { R.tiredBubble++; m._tb = 1; } } else m._tb = 0;
        const fac = st.S.tiredFactor(m); r.maxFactor = Math.max(r.maxFactor, fac);
        if (m.restObj && m.state === 'walking' && r.phase === 'work') { r.phase = 'toRest'; r.headedRest++; r.rooms.add(m.restObj); r.restStartFrac = f; }
        if (m.state === 'resting' && (r.phase === 'toRest' || r.phase === 'work')) { if (r.phase === 'work') r.headedRest++; r.phase = 'resting'; r.arrivedRest++; }
        if (r.phase === 'resting' && m.state !== 'resting') { r.phase = f >= 0.8 ? 'recovered' : 'abort'; if (r.phase === 'recovered') r.recovered++; }
        if (r.phase === 'recovered' && (m.task || m.state === 'walking' || m.state === 'working')) { r.returned++; r.phase = 'work'; }
        if (r.phase === 'abort') r.phase = 'work';
      }
    }, 150);
  };
  st.restReport = () => {
    const out = {};
    for (const [id, r] of Object.entries(st.rest.byStaff)) out[id] = { ...r, rooms: [...r.rooms], minFrac: +r.minFrac.toFixed(2), maxFactor: +r.maxFactor.toFixed(2) };
    return { staff: out, tiredBubble: st.rest.tiredBubble };
  };

  st.stats = () => {
    const { state } = st.g();
    const f = st.frameMs.slice(-300).sort((a, b) => a - b);
    const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    const stages = {};
    for (const p of state.patients) stages[p.stage] = (stages[p.stage] || 0) + 1;
    return { pat: state.patients.length, staff: state.staff.length, objs: state.objects.length, avgMs: +avg.toFixed(2), p95Ms: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(2), stages,
      t: `${state.time.year}-${state.time.month}-${state.time.week}`, money: Math.round(state.money), rep: Math.round(state.reputation),
      clk: Math.round(state.time.clock), pd: !!state.events.pendingDilemma, paused: state.time.paused, spd: state.time.speed, hist: state.history.length, evlog: state.events.log.length, ledgerKeys: Object.keys(state.ledger.expense).length };
  };

  st.fps = (ms = 2000) => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); });
})();
