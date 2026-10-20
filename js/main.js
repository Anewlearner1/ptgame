// Bootstrap + game loop. Producer-owned: wires the modules together per docs/ARCHITECTURE.md.
import { state, ui } from './core/state.js';
import { bus } from './core/bus.js';
import { MIN_PER_REAL_SEC, SPEEDS } from './core/constants.js';
import { rebuildOccupancy } from './core/grid.js';

import { advanceClock } from './sim/calendar.js';
import { initEconomy } from './sim/economy.js';
import { initEvents } from './sim/events.js';
import { recomputeZones } from './sim/synergy.js';
import { recomputeMods } from './sim/modifiers.js';
import { updatePatients, closeUp } from './sim/patients.js';
import { updateStaff, refreshPool } from './sim/staff.js';
import { seedStarterClinic } from './sim/build.js';
import { initInspection } from './sim/inspection.js';
import { loadGame, listSaves } from './sim/save.js';
import { initResearch } from './sim/research.js';

import { initRenderer, render } from './render/renderer.js';
import { initCamera, centerOnLot } from './render/camera.js';
import { initInput } from './render/input.js';
import { initUI, updateUI } from './ui/ui.js';

const MAX_STEP_MIN = 1.0;     // sub-step size in game minutes (keeps sim stable at x3)
const MAX_FRAME_SEC = 0.1;    // clamp tab-switch hiccups

function refreshDerived() {
  rebuildOccupancy(state);
  recomputeZones(state);
  recomputeMods(state);
  ui.dirtyOcc = false;
}

function boot() {
  const canvas = document.getElementById('game');
  initRenderer(canvas);
  initCamera(canvas);
  initInput(canvas, state, ui);

  initEconomy();
  initEvents();
  initResearch();
  initInspection();

  bus.on('mods:dirty', () => recomputeMods(state));
  bus.on('map:changed', () => { ui.dirtyOcc = true; });
  bus.on('week:end', () => closeUp(state));
  bus.on('month:start', () => refreshPool(state));
  bus.on('state:loaded', () => { refreshDerived(); centerOnLot(state, canvas); });
  bus.on('speed:set', ({ speed }) => {
    if (!SPEEDS.includes(speed)) return;
    state.time.speed = speed;
    state.time.paused = speed === 0;
  });

  // Continue autosave if one exists, otherwise start a fresh starter clinic.
  let loaded = false;
  try { loaded = listSaves().some(s => s.slot === 'auto') && loadGame(state, 'auto'); } catch (e) { console.warn(e); }
  if (!loaded) {
    seedStarterClinic(state);
    refreshPool(state);
  }
  refreshDerived();
  centerOnLot(state, canvas);
  initUI(state, ui);

  window.__game = { state, ui, bus, refreshDerived };   // debugging + automated tests

  let last = performance.now();
  function frame(now) {
    const dtSec = Math.min((now - last) / 1000, MAX_FRAME_SEC);
    last = now;
    if (ui.dirtyOcc) refreshDerived();

    const blocked = !!state.events.pendingDilemma;   // a decision modal freezes the whole sim
    const speed = (state.time.paused || blocked) ? 0 : state.time.speed;
    if (speed > 0) {
      let remain = dtSec * speed * MIN_PER_REAL_SEC;
      while (remain > 1e-6) {
        const step = Math.min(remain, MAX_STEP_MIN);
        remain -= step;
        advanceClock(state, step);
        updateStaff(state, step);
        updatePatients(state, step);
        if (ui.dirtyOcc) refreshDerived();
        if (state.time.paused) break;     // a modal event paused the game mid-frame
      }
    }
    render(state, ui, now);
    updateUI(state, ui);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('error', e => console.error('[uncaught]', e.message));
boot();
