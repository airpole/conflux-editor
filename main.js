// ============================================================
//  MAIN — entry point: init, autosave detection, action dispatch
// ============================================================
// All editor logic lives in dedicated modules. This file boots them, runs the
// data-action click dispatcher (Phase C), and still exposes the window shim
// for the inline `onclick="..."` handlers that haven't been migrated yet.
// As Phase C progresses, handlers move from the window shim into ACTION_MAP.

import { $, LS_PREFIX } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { compBPM } from './timing.js';

// Side-effect imports — wire pointer/keyboard/resize handlers.
import './fullscreen.js';
import './canvas-resize.js';
import './notes-input.js';
import './shape-input.js';
import './play.js';
import './keyboard.js';

import { loadChartData, updateTotalMs } from './load-chart.js';
import { clearHistoryBaseline, undo, redo } from './history.js';
import { goTab } from './tab-nav.js';
import { goFS } from './fullscreen.js';
import { setNT, nZ, doCopy, doPaste, doFlipSelected,
         cancelLN, cancelTE } from './notes-tools.js';
import { setST, sZ, pickEase, sMet,
         doShapeCopy, doShapePaste, doShapeFlipSelected,
         doShapeSelectionDelete, addShapeEvt } from './shape-tools.js';
import { toggleFollow, toggleSFollow, toggleMirror, cyclePosSnap, cancelArc } from './edit-options.js';
import { toggleGP, closeGP, pickNG, pickSG, buildGP } from './grid-picker.js';
import { toggleEdPlay, edSeek } from './edit-playback.js';
import { toggleMetronome, setOffsetHere, setPlaybackRate, loadAud } from './audio.js';
import { teNew, teSave, teDelete, teEditByIdx, tePickSelect } from './text-events.js';
import { syncMeta, addTempo, editTempo, delTempo,
         addTimeSig, editTS, delTS, renderTempoList, renderTSList,
         _afterAnyCommand } from './meta-ui.js';
import { onDispatch } from './commands.js';
import { playToggle, playRestart, playSeekTo, playSeekPreview, stopPlay } from './play.js';
import { togglePlayFullscreen, drawPlayIdle } from './play-render.js';
import { resetKeyBindings, loadKeyBindings, renderKeyCfg } from './key-config.js';
import { doExport, doImport } from './import-export.js';
import { showMod, closeMod, fmSave, fmSaveAs, fmLoad, fmDelete } from './file-manager.js';
import { autoSave, scheduleAutoSave } from './autosave.js';
import { loadJacket, clearJacket } from './jacket.js';
import { drawN } from './notes-render.js';
import { drawS } from './shape-render.js';
import { rszActiveCanvas } from './canvas-resize.js';

// ============================================================
//  GLOBAL EXPOSURE — for inline HTML onclick="..." handlers
// ============================================================
// Surface for handlers not yet migrated to ACTION_MAP. Each Phase C group
// removes its entries from here as the matching onclick= attributes in
// index.html become data-action="…". When this Object.assign is empty,
// Phase C is done and the whole block can be deleted.
Object.assign(window, {
  // Data + DOM helper accessed from inline handlers
  D, $,
  // Tool / fullscreen
  goFS,
  setNT, setST, pickEase,
  // Undo / redo
  undo, redo,
  // Notes editing
  doCopy, doPaste, doFlipSelected, nZ, toggleFollow, toggleGP, closeGP,
  // Shapes editing
  doShapeCopy, doShapePaste, doShapeFlipSelected, sZ,
  toggleSFollow, toggleMirror, cyclePosSnap,
  // Grid pickers (called from buildGP's template strings)
  pickNG, pickSG,
  // Editor playback
  toggleEdPlay, edSeek, toggleMetronome, setOffsetHere, setPlaybackRate, drawN,
  // Text events
  teNew, teSave, teDelete, teEditByIdx, tePickSelect,
  // Tempo / time sig
  addTempo, editTempo, delTempo, addTimeSig, editTS, delTS,
  // Play tab
  playToggle, playRestart, playSeekTo, playSeekPreview, togglePlayFullscreen,
  stopPlay, resetKeyBindings,
  // File / import / export / modal
  doExport, doImport, showMod, closeMod, fmSave, fmSaveAs, fmLoad, fmDelete,
  // Audio
  loadAud,
  // Jacket
  loadJacket, clearJacket,
  // Auto-save (referenced from jacket.js via window. for cycle-avoidance)
  scheduleAutoSave,
});

// ============================================================
//  ACTION DISPATCHER — Phase C migration target
// ============================================================
// Buttons with `data-action="<name>" data-arg="<value>"` route through here
// instead of an inline onclick. ACTION_MAP grows as each Phase C group
// migrates; once it's full and the window shim is empty, Phase C is done.
const ACTION_MAP = {
  goTab,
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handler = ACTION_MAP[el.dataset.action];
  if (handler) handler(el.dataset.arg, e);
});

// ============================================================
//  INITIALIZATION
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  onDispatch(_afterAnyCommand);

  // Defensive Still/Arc → Linear migration (in case storage skipped load-chart)
  D.shapeEvents.forEach(e => {
    if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear';
  });

  // Auto-save detection
  const autoKey = LS_PREFIX + '__autosave__';
  const autoRaw = localStorage.getItem(autoKey);
  if (autoRaw) {
    try {
      const d = JSON.parse(autoRaw);
      const savedAt = d._savedAt ? new Date(d._savedAt).toLocaleString('ko-KR') : '';
      if (confirm(`Auto-save found${savedAt ? ' (' + savedAt + ')' : ''}.\nLoad it?`)) {
        loadChartData(d);
      }
    } catch (e) {}
  }

  // ── Inputs that previously used inline handlers ─────────
  const hitVolInput = $('mHitVol');
  if (hitVolInput) hitVolInput.addEventListener('input', e => {
    ES.hitVol = e.target.value / 100;
    $('hitVolLbl').textContent = e.target.value + '%';
  });
  const spdInput = $('mSpd');
  if (spdInput) spdInput.addEventListener('change', e => { ES.pvSpd = +e.target.value; });
  const thkInput = $('mThk');
  if (thkInput) thkInput.addEventListener('change', e => { ES.nThk = +e.target.value; });

  const mOffInput = $('mMeasureOff');
  if (mOffInput) mOffInput.addEventListener('change', e => {
    D.metadata.measureLabelOffset = +e.target.value || 0;
    renderTempoList(); renderTSList();
    if (ES.activeTab === 'note') drawN();
    else if (ES.activeTab === 'shape') drawS();
    scheduleAutoSave();
  });

  // Phase 7-3 jacket inputs
  const jacketInput = $('jacketF');
  if (jacketInput) jacketInput.addEventListener('change', e => loadJacket(e.target));
  const jacketBrInput = $('mJacketBright');
  if (jacketBrInput) jacketBrInput.addEventListener('input', e => {
    const v = Math.max(0, Math.min(100, +e.target.value || 0));
    D.metadata.jacketBrightness = v;
    const lbl = $('jacketBrightLbl'); if (lbl) lbl.textContent = v + '%';
    if (ES.activeTab === 'play' && !PS.playActive) drawPlayIdle();
    scheduleAutoSave();
  });
  const jacketClear = $('jacketClearBtn');
  if (jacketClear) jacketClear.addEventListener('click', e => {
    e.stopPropagation();
    clearJacket();
  });

  // Autoplay toggle in Play tab
  const autoChk = $('playAutoChk');
  if (autoChk) autoChk.addEventListener('change', e => { PS.playAutoplay = e.target.checked; });

  // Long-press paste — Phase 4
  function initLongPressPaste(btnId, shortAction, longAction) {
    const btn = $(btnId);
    if (!btn) return;
    btn.removeAttribute('onclick');
    btn.onclick = null;

    let lpTimer = null;
    let startX = 0, startY = 0;

    const clearLP = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      btn.classList.remove('lp');
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      btn.classList.add('lp');
      lpTimer = setTimeout(() => {
        lpTimer = null;
        btn.classList.remove('lp');
        longAction();
      }, 500);
    });

    btn.addEventListener('pointermove', (e) => {
      if (!lpTimer) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (dx * dx + dy * dy > 100) clearLP();
    });

    btn.addEventListener('pointerup', () => {
      if (lpTimer) {
        clearTimeout(lpTimer); lpTimer = null;
        btn.classList.remove('lp');
        shortAction();
      }
    });

    btn.addEventListener('pointercancel', clearLP);
  }
  initLongPressPaste('nPasteBtn', () => doPaste(false),      () => doPaste(true));
  initLongPressPaste('sPasteBtn', () => doShapePaste(false), () => doShapePaste(true));

  compBPM(); updateTotalMs();
  clearHistoryBaseline();
  buildGP('ngp', ES.nGD, 'pickNG');
  buildGP('sgp', ES.sGD, 'pickSG');
  syncMeta(); renderTempoList(); renderTSList();
  loadKeyBindings(); renderKeyCfg();
  requestAnimationFrame(() => { rszActiveCanvas(); drawN(); });

  // Persistence
  window.addEventListener('beforeunload', () => { autoSave(); });
  setInterval(autoSave, 60000);
});
