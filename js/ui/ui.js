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
import { BUILDABLES } from '../data/buildables.js';
import * as CAM from '../render/camera.js';
import { zoomAt, centerOnLot, camManual, onViewResize, ZOOM_MIN } from '../render/camera.js';
import { TILE_W, TILE_H } from '../core/constants.js';
import { layout, initLayout, computeLayout, setBMode } from './layout.js';
import { initSheet, applySheet, syncDock } from './sheet.js';
import { initPwa } from './pwa.js';
import { initCtxMenu } from './ctxmenu.js';

const MOUNTS = { build: mountBuild, operate: mountOperate, clinic: mountClinic, overview: mountOverview, map: mountMap, system: mountSystem };
const TITLES = { build: '🔨 建造', operate: '🔬 運作', clinic: '🏥 診所', overview: '📋 一覽', map: '🗺 地圖', system: '⚙ 系統' };

let panelEl, stageEl, hintEl;
let shown = null;        // panel id currently mounted
let live = null;         // {update}
let lastTick = 0;
let lastTool = 'none';
let hintIdx = 0, hintAt = 0;
let dirty = true;
let shiftCur = 0, shiftTarget = 0;   // px the camera is nudged right so the open panel doesn't hide the lot (desktop layout only)
let chipEl = null;

export function initUI(state, ui) {
  ctx.state = state; ctx.ui = ui;
  panelEl = document.getElementById('panel');
  stageEl = document.getElementById('stage');

  initLayout();
  initPwa();
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
  // landscape: collapsed build panel while a tool is armed -> small chip that re-opens it
  chipEl = h('button', { class: 'u-chip-build', type: 'button', hidden: true, onclick: () => setBMode('strip') }, '🔨');
  stageEl.appendChild(chipEl);
  stageEl.dataset.bmode = layout.bmode;
  initSheet({ panel: panelEl, stage: stageEl, hooks: { close: () => { ui.panel = null; syncPanel(state, ui); }, refit: () => refit(state, ui) } });
  initCtxMenu(state, ui);
  bus.on('ui:bmode', () => { stageEl.dataset.bmode = layout.bmode; applySheet(); refit(state, ui); dirty = true; });
  bus.on('layout:changed', () => {
    if (!layout.mobile || layout.mode === 'desktop') layout.bmode = 'full';
    else if (layout.portrait && layout.bmode === 'strip') layout.bmode = 'tray';
    else if (layout.compact && layout.bmode === 'tray') layout.bmode = 'strip';
    stageEl.dataset.bmode = layout.bmode;
    shiftCur = 0; shiftTarget = 0;
    applySheet();
    if (!layout.mobile) ui.freeRect = null;
    if (!camManual()) {                // a hand-placed camera is left alone (it is only clamped)
      centerOnLot(state, document.getElementById('game'), ui);
      if (layout.mobile) refit(state, ui); else if (shown && !panelEl.hidden) placeBesidePanel(state, ui);
    } else if (layout.mobile) refit(state, ui);
    dirty = true;
  });
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
  bus.on('tool:changed', () => { dirty = true; lastTick = 0; });
  document.addEventListener('keydown', e => onKey(e, state, ui));
  // window resized: while the camera is still in its automatic fit, re-fit the lot (beside the open panel, if any)
  onViewResize(() => {
    if (computeLayout()) { bus.emit('layout:changed', { mode: layout.mode }); return; }   // rotation / mode switch: handled there
    applySheet();
    if (camManual()) return;
    if (layout.mobile) { refit(state, ui); return; }
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
  if (layout.mobile) { applySheet(); refit(state, ui); }
}

function togglePanel(ui, id) {
  // build panel collapsed to its tray / strip / chip: tapping 🔨 again re-opens the full panel instead of closing it
  if (layout.mobile && id === 'build' && ui.panel === 'build' && layout.bmode !== 'full') { setBMode('full'); return; }
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
  if (layout.bmode !== 'full' && (!shown || shown !== 'build')) { layout.bmode = 'full'; stageEl.dataset.bmode = 'full'; }
  if (!shown || !MOUNTS[shown]) {
    panelEl.hidden = true; stageEl.classList.remove('panel-open');
    layout.sheetFrac = 0.55;
    shiftTarget = 0;
    if (layout.mobile) { applySheet(); placeBesidePanel(state, ui); return; }
    if (!camManual() && !force) { centerOnLot(state, document.getElementById('game'), ui); shiftCur = 0; }   // give the lot its full view back
    return;
  }
  const close = h('button', { class: 'panel-close', type: 'button', 'aria-label': '關閉', onclick: () => { ui.panel = null; syncPanel(state, ui); } }, '✕');
  const body = h('div', { class: 'u-panelbody' });
  panelEl.append(h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }, h('i')), h('h2', { class: 'panel-title' }, TITLES[shown], close), body);
  panelEl.hidden = false;
  panelEl.scrollTop = 0;
  stageEl.classList.add('panel-open');
  stageEl.dataset.panel = shown;
  live = MOUNTS[shown](body, state, ui);
  if (live && live.update) live.update(state, ui);
  if (layout.mobile) { applySheet(); placeBesidePanel(state, ui); return; }
  if (!camManual() && !force) { centerOnLot(state, document.getElementById('game'), ui); shiftCur = 0; }   // re-fit from the clean full-stage view
  placeBesidePanel(state, ui);
}
// shift the view so the map's centre moves into the part of the stage the panel leaves free (and zoom out to fit)
function placeBesidePanel(state, ui) {
  if (layout.mobile) { shiftTarget = 0; shiftCur = 0; syncDock(); if (!camManual()) fitMobile(state, ui); return; }
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

// ---- mobile: fit the iso lot into the FREE rect (stage minus tab bar / rail, minus bottom sheet / tray / side drawer) ----
function refit(state, ui) {
  syncDock();
  if (!layout.mobile) return;
  if (camManual() || (layout.portrait && !panelEl.hidden && layout.bmode === 'full' && layout.sheetFrac > 0.7)) {
    // hand-placed camera (or a sheet dragged up over the map): leave it, but keep ui.freeRect current for the canvas touch bar
    const r = freeRect(); ui.freeRect = r.w >= 100 && r.h >= 90 ? r : null;
    return;
  }
  fitMobile(state, ui);
}
function freeRect() {
  const sr = stageEl.getBoundingClientRect(), pr = panelEl.getBoundingClientRect();
  const side = document.getElementById('sidebar').getBoundingClientRect();
  const open = !panelEl.hidden && pr.width > 0 && pr.height > 0;
  let x0 = 0, y0 = 0, x1 = sr.width, y1 = sr.height;
  if (layout.portrait) {
    y1 = side.top - sr.top;
    if (open) y1 = Math.min(y1, pr.top - sr.top);
    const sp = document.getElementById('speedbar').getBoundingClientRect();     // keep the lot clear of the floating speed pill
    if (sp.height > 0 && sp.top - sr.top > sr.height * 0.35) y1 = Math.min(y1, sp.top - sr.top - 4);
    y0 = 4;
  } else {
    x0 = Math.max(0, side.right - sr.left + 4);
    if (open) { if (layout.bmode === 'strip') y1 = pr.top - sr.top; else x1 = pr.left - sr.left; }
  }
  return { x: x0, y: y0, w: Math.max(80, x1 - x0), h: Math.max(60, y1 - y0) };
}
function fitMobile(state, ui) {
  CAM.fitLotInRect(state, document.getElementById('game'), freeRect(), ui);   // also publishes ui.freeRect for the touch bar
}

function stepCam(ui) {
  if (shiftCur === shiftTarget) return;
  const d = Math.abs(shiftTarget - shiftCur) < 1 ? shiftTarget - shiftCur : (shiftTarget - shiftCur) * 0.22;
  shiftCur += d;
  if (ui.cam) ui.cam.x += d;
}

function updateChip(ui) {
  const show = layout.compact && layout.bmode === 'chip' && ui.panel === 'build';
  if (chipEl.hidden === show) chipEl.hidden = !show;
  if (show) {
    const d = ui.tool.defId && BUILDABLES[ui.tool.defId];
    const t = '🔨 ' + (d ? d.name : ui.tool.mode === 'demolish' ? '拆除' : '建造');
    if (chipEl._t !== t) { chipEl._t = t; chipEl.textContent = t; }
  }
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
  updateChip(ui);
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
