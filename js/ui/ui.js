// UI orchestrator. initUI(state, ui) once; updateUI(state, ui) every frame (DOM work throttled to ~5 Hz).
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import { h, clear } from './dom.js';
import { initTooltip, hideTooltip } from './tooltip.js';
import { initToast } from './toast.js';
import { initModal, isModalOpen, modalClosedRecently } from './modal.js';
import { initModals, showTutorial, showHelp, showPending, snapshotLedger, resetPendingKey } from './modals.js';
import { initTopbar, updateTopbar } from './topbar.js';
import { initSidebar, updateSidebar, PANELS } from './sidebar.js';
import { initSpeedbar, updateSpeedbar } from './speedbar.js';
import { initSelection, updateSelection } from './selection.js';
import { mountBuild } from './panels/build.js';
import { mountOperate } from './panels/operate.js';
import { mountClinic } from './panels/clinic.js';
import { mountOverview } from './panels/overview.js';
import { mountMap, sampleHeat } from './panels/map.js';
import { mountSystem, lsGet } from './panels/system.js';
import { TIPS } from '../data/texts.js';
import { zoomAt, centerOnLot, camManual, onViewResize, ZOOM_MIN } from '../render/camera.js';
import { TILE_W, TILE_H } from '../core/constants.js';

const MOUNTS = { build: mountBuild, operate: mountOperate, clinic: mountClinic, overview: mountOverview, map: mountMap, system: mountSystem };
const TITLES = { build: '🔨 建造', operate: '🔬 運作', clinic: '🏥 診所', overview: '📋 一覽', map: '🗺 地圖', system: '⚙ 系統' };

let panelEl, stageEl, hintEl;
let shown = null;        // panel id currently mounted
let live = null;         // {update}
let lastTick = 0;
let lastTool = 'none';
let hintIdx = 0, hintAt = 0;
let dirty = true;
let shiftCur = 0, shiftTarget = 0;   // px the camera is nudged right so the open panel doesn't hide the lot

export function initUI(state, ui) {
  ctx.state = state; ctx.ui = ui;
  panelEl = document.getElementById('panel');
  stageEl = document.getElementById('stage');

  initTooltip();
  initToast();
  initModal();
  initModals();
  initTopbar();
  initSidebar(ui, id => togglePanel(ui, id));
  initSpeedbar(state, () => showHelp());
  initSelection(state, ui);

  hintEl = h('div', { class: 'u-hint', 'aria-live': 'off' });
  stageEl.appendChild(hintEl);
  hintIdx = Math.floor(Math.random() * Math.max(1, (TIPS || []).length));

  // ---- global events
  bus.on('ui:escape', () => onEscape(state, ui));
  bus.on('state:loaded', () => {
    dirty = true; resetPendingKey();
    shiftCur = 0;                      // main.js re-centred the camera
    remount(state, ui, true);
    setTimeout(() => { if (!state.flags.tutorialDone) showTutorial(); }, 50);
  });
  bus.on('patient:slip', () => bus.emit('toast', { text: '⚠ 有病患滑倒了！地面記得鋪防滑墊', kind: 'bad' }));
  bus.on('week:start', () => { dirty = true; });
  bus.on('map:changed', () => { dirty = true; });
  document.addEventListener('keydown', e => onKey(e, state, ui));
  // window resized: while the camera is still in its automatic fit, re-fit the lot (beside the open panel, if any)
  onViewResize(() => {
    if (camManual()) return;
    centerOnLot(state, document.getElementById('game'), ui);
    shiftCur = 0; shiftTarget = 0;
    if (shown && !panelEl.hidden) placeBesidePanel(state, ui);
  });
  // after a mouse click, drop button focus so Space / number hotkeys go to the game, not the last-clicked button
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button, .card[role="button"]');
    if (b && e.detail > 0 && b.tagName !== 'INPUT') setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
  });

  // default speed preference (applied once on a fresh load)
  const ds = parseInt(lsGet('ptgame.defaultSpeed', '1'), 10);
  if (ds > 1 && ds <= 3) setTimeout(() => bus.emit('speed:set', { speed: ds }), 0);

  updateTopbar(state);
  if (!state.flags.tutorialDone) setTimeout(() => showTutorial(), 400);
  updateUI(state, ui, true);
}

function togglePanel(ui, id) {
  ui.panel = ui.panel === id ? null : id;
  dirty = true;
  syncPanel(ctx.state, ui);
}

function onEscape(state, ui) {
  if (isModalOpen() || modalClosedRecently()) return;   // modal.js handles its own Esc
  if (lastTool !== 'none' || ui.tool.mode !== 'none') {
    ui.tool = { mode: 'none', defId: null, rot: 0, cat: null };
    lastTool = 'none';
    return;
  }
  if (ui.selected) { ui.selected = null; bus.emit('select:changed', { selected: null }); return; }
  if (ui.panel) { ui.panel = null; syncPanel(state, ui); }
}

function onKey(e, state, ui) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'range' && t.type !== 'checkbox') return;
  if (isModalOpen()) return;
  const k = e.key;
  if (k === '?' || k === '/' && e.shiftKey || k === 'F1') { e.preventDefault(); showHelp(); return; }
  const p = PANELS.find(x => x.key.toLowerCase() === k.toLowerCase());
  if (p) { e.preventDefault(); togglePanel(ui, p.id); }
}

// Build the DOM of the active panel (once per open / tab change).
function syncPanel(state, ui) {
  if (ui.panel === shown) return;
  remount(state, ui, false);
}
function remount(state, ui, force) {
  if (!force && ui.panel === shown) return;
  shown = ui.panel;
  live = null;
  hideTooltip();
  clear(panelEl);
  if (!shown || !MOUNTS[shown]) {
    panelEl.hidden = true; stageEl.classList.remove('panel-open');
    shiftTarget = 0;
    if (!camManual() && !force) { centerOnLot(state, document.getElementById('game'), ui); shiftCur = 0; }   // give the lot its full view back
    return;
  }
  const close = h('button', { class: 'panel-close', type: 'button', 'aria-label': '關閉', onclick: () => { ui.panel = null; syncPanel(state, ui); } }, '✕');
  const body = h('div', { class: 'u-panelbody' });
  panelEl.append(h('h2', { class: 'panel-title' }, TITLES[shown], close), body);
  panelEl.hidden = false;
  panelEl.scrollTop = 0;
  stageEl.classList.add('panel-open');
  stageEl.dataset.panel = shown;
  live = MOUNTS[shown](body, state, ui);
  if (live && live.update) live.update(state, ui);
  if (!camManual() && !force) { centerOnLot(state, document.getElementById('game'), ui); shiftCur = 0; }   // re-fit from the clean full-stage view
  placeBesidePanel(state, ui);
}
// shift the view so the map's centre moves into the part of the stage the panel leaves free (and zoom out to fit)
function placeBesidePanel(state, ui) {
  const sr = stageEl.getBoundingClientRect(), pr = panelEl.getBoundingClientRect();
  shiftTarget = Math.max(0, Math.round((pr.right - sr.left) / 2));
  fitLotBesidePanel(state, ui, sr.width - (pr.right - sr.left));
}
// If the lot would not fit in the part of the stage the panel leaves free, zoom out about the lot centre.
function fitLotBesidePanel(state, ui, freeW) {
  const l = state.lot, cam = ui.cam, canvas = document.getElementById('game');
  const need = (l.w + l.h) * TILE_W / 2 + 140;
  const zFit = Math.max(ZOOM_MIN, Math.floor((freeW - 24) / need * 20) / 20);
  if (cam.zoom <= zFit) return;
  const gx = l.x0 + l.w / 2, gy = l.y0 + l.h / 2;
  const sx = cam.x + (gx - gy) * TILE_W / 2 * cam.zoom, sy = cam.y + (gx + gy) * TILE_H / 2 * cam.zoom;
  zoomAt(cam, sx, sy, zFit, canvas);
}
function stepCam(ui) {
  if (shiftCur === shiftTarget) return;
  const d = Math.abs(shiftTarget - shiftCur) < 1 ? shiftTarget - shiftCur : (shiftTarget - shiftCur) * 0.22;
  shiftCur += d;
  if (ui.cam) ui.cam.x += d;
}

export function updateUI(state, ui, force) {
  // cheap per-frame work: panel switching by other modules, Esc-tool bookkeeping
  if (ui.panel !== shown) remount(state, ui, false);
  stepCam(ui);
  const now = performance.now();
  if (!force && !dirty && now - lastTick < 200) { lastTool = ui.tool.mode; return; }
  lastTick = now; dirty = false;

  sampleHeat(state);
  snapshotLedger(state);
  updateTopbar(state);
  updateSidebar(ui);
  updateSpeedbar(state);
  updateSelection(state, ui);
  if (live && live.update) live.update(state, ui);
  lastTool = ui.tool.mode;

  // pending decision (event/dilemma) that we may have missed
  if (state.events && state.events.pendingDilemma) showPending();
  else resetPendingKey();

  // rotating tip
  if (TIPS && TIPS.length && now - hintAt > 14000) {
    hintAt = now;
    hintIdx = (hintIdx + 1) % TIPS.length;
    hintEl.textContent = '💡 ' + TIPS[hintIdx];
  }
  hintEl.hidden = !TIPS || !TIPS.length;
}
