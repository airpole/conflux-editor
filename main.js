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
import { playToggle, playRestart, playSeekTo, playSeekPreview } from './play.js';
import { togglePlayFullscreen, drawPlayIdle } from './play-render.js';
import { setPlayContext, makeEditorContext } from './play-context.js';
import { registerScene, goScene, resetSceneStack } from './scene-manager.js';
import { FEATURES, START_SCENE } from './config.js';
import { mountTitle, enterTitle, exitTitle } from './scene-title.js';
import { mountModeSelect, enterModeSelect, exitModeSelect } from './scene-modeselect.js';
import { loadSettings, applySettings } from './settings.js';
import { mountSettings, initSettingsScene, enterSettings, exitSettings } from './scene-settings.js';
import { setNoteSkin } from './renderer.js';
import { setVolumes, setAudioOffset } from './audio.js';
import { toast } from './utility.js';
import { setGauge, setLockTarget, setLockMode, toggleFastSlow, initPlayOptionsUI } from './play-options.js';
import { resultRetry, resultBack } from './play-result.js';
import { resetKeyBindings, loadKeyBindings, renderKeyCfg } from './key-config.js';
import { doExport, doImport } from './import-export.js';
import { showMod, closeMod, fmSave, fmSaveAs, fmLoad, fmDelete } from './file-manager.js';
import { autoSave, scheduleAutoSave } from './autosave.js';
import { loadJacket, clearJacket } from './jacket.js';
import { drawN } from './notes-render.js';
import { drawS } from './shape-render.js';
import { rszActiveCanvas } from './canvas-resize.js';

// ============================================================
//  ACTION DISPATCHER — single source of element→handler wiring
// ============================================================
// Every interactive element carries `data-action="<name>"` (+ optional
// `data-arg`); three delegated listeners on `document` route events here.
// The three event types use SEPARATE maps, keyed by the same action name, so
// one element can declare a single `data-action` and still get distinct
// click / change / input behaviour (e.g. a range slider previews on `input`,
// commits on `change`; an editable input must not fire its edit handler
// merely because a click focused it).
//
// Phase C (v18–v26) migrated all 64 inline onclick handlers, every named
// onchange/oninput handler, and four modules' template strings onto this
// dispatcher. The old `Object.assign(window, …)` shim is gone.

// Shared handler — registered in both INPUT_ACTIONS and CHANGE_ACTIONS so that
// metadata fields update live (was oninput) and the <select> commits (was
// onchange). The input's own `type` drives coercion: number → Number, else
// String. data-arg is the D.metadata key.
const setMetaField = (arg, e) => {
  D.metadata[arg] = e.target.type === 'number' ? +e.target.value : e.target.value;
};

// Leave the editor and return to the Title screen. Stops any active play
// session, snapshots work via autoSave, and resets the back stack so Title is
// a fresh root (editor→title shouldn't be unwound by goBack).
function exitToTitle() {
  // Tear down any live play + fullscreen so nothing overlays the next scene.
  // playFS is a z-index:9999 fixed overlay; if it stays shown it covers the
  // logo and swallows clicks, which is why exiting could appear "stuck".
  if (PS.playActive) import('./play.js').then(m => m.stopPlay());
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (exitFs) exitFs.call(document).catch(() => {});
  }
  const fs = $('playFS');
  if (fs) fs.classList.remove('show');
  PS.playFullscreen = false;
  autoSave();
  resetSceneStack();
  goScene('modeselect');
}

const CLICK_ACTIONS = {
  // Tab nav (C-1)
  goTab,
  exitToTitle,
  // Notes toolbar (C-2)
  setNT,
  nZ: arg => nZ(+arg),                  // data-arg is a string; coerce to number
  toggleFollow, toggleGP,
  doCopy, doFlipSelected,
  undo, redo,                           // shared with shape toolbar (C-3)
  // Shape toolbar (C-3)
  setST, pickEase,
  sZ: arg => sZ(+arg),
  cyclePosSnap, toggleSFollow, toggleMirror,
  doShapeCopy, doShapeFlipSelected,
  // Meta tab — tempo / time signature (C-4)
  addTempo, addTimeSig,
  delTempo: arg => delTempo(+arg),
  delTS:    arg => delTS(+arg),
  // Edit playback + Play tab + File modal (C-5)
  goFS, toggleEdPlay,
  playToggle, playRestart, togglePlayFullscreen,
  // Play-tab gauge / lock options (test controls)
  setGauge, setLockTarget, setLockMode, toggleFastSlow,
  // Result overlay
  resultRetry, resultBack,
  showMod, closeMod,
  fmSave, fmSaveAs, fmLoad, fmDelete, doExport,
  clickInput: arg => $(arg).click(),    // trigger a hidden <input type=file>
  // Text event modals (C-6)
  teNew: arg => teNew(+arg),            // data-arg is a tick
  teSave, teDelete,
  teEditByIdx:  arg => teEditByIdx(+arg),
  tePickSelect: arg => tePickSelect(+arg),
  // Audio / Jacket / key config (C-7)
  setOffsetHere, toggleMetronome, resetKeyBindings,
  // Grid picker dropdown items (C-8) — data-arg is "<pickerId>:<divisor>"
  pickGrid: arg => {
    const [id, d] = arg.split(':');
    (id === 'ngp' ? pickNG : pickSG)(+d);
    closeGP(id);
  },
};

const CHANGE_ACTIONS = {
  // Meta tab — tempo / time signature number inputs (C-4).
  // data-arg holds the row index; the new value comes off the input itself.
  editTempo: (arg, e) => editTempo(+arg, null, +e.target.value),
  editTSNum: (arg, e) => editTS(+arg, +e.target.value, null),
  editTSDen: (arg, e) => editTS(+arg, null, +e.target.value),
  // Play tab + File modal (C-5)
  playSeek:  (arg, e) => playSeekTo(+e.target.value),   // commit on release
  doImport:  (arg, e) => doImport(e.target),            // file <input> element
  // Audio (C-7)
  loadAud:   (arg, e) => loadAud(e.target),             // file <input> element
  // Metadata fields (C-9)
  setMeta: setMetaField,
  setOffset: (arg, e) => {
    const raw = e.target.value;
    D.metadata.offset = +raw;
    $('mOff').value = raw;
    $('syncOff').value = raw;
    drawN();
  },
};

const INPUT_ACTIONS = {
  // Range sliders fire `input` continuously while dragging (C-5).
  edSeek:   (arg, e) => edSeek(arg, +e.target.value),   // arg = 'n' | 's' scope
  playSeek: (arg, e) => playSeekPreview(+e.target.value),
  // Audio (C-7)
  setPlaybackRate: (arg, e) => setPlaybackRate(+e.target.value),
  // Metadata text fields update live as you type (C-9)
  setMeta: setMetaField,
};

function dispatchAction(map, e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handler = map[el.dataset.action];
  if (handler) handler(el.dataset.arg, e);
}

document.addEventListener('click',  e => dispatchAction(CLICK_ACTIONS, e));
document.addEventListener('change', e => dispatchAction(CHANGE_ACTIONS, e));
document.addEventListener('input',  e => dispatchAction(INPUT_ACTIONS, e));

// ============================================================
//  INITIALIZATION
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  onDispatch(_afterAnyCommand);

  // Bind the shared play engine to editor state. From here on the engine
  // reads/writes ES through CTX; game mode will swap this for a game context.
  // redrawPlayIdle reproduces the original idle-repaint (resize then redraw),
  // which the engine now triggers via CTX.redrawIdle() after a session ends.
  setPlayContext(makeEditorContext(ES, {
    redrawPlayIdle() { rszActiveCanvas(); drawPlayIdle(); },
  }));

  // Load persisted player settings and apply them to the engine. `settingsDeps`
  // bundles the live engine objects so settings.js imports none of them itself.
  loadSettings();
  const settingsDeps = {
    ES, PS,
    setNoteSkin,
    audio: { setVolumes },
    setAudioOffset,
    openKeyConfig() { toast('키 설정은 에디터 Meta 탭에서 (추후 이동 예정)'); },
  };
  applySettings(settingsDeps);
  initSettingsScene(settingsDeps);

  // Register top-level scenes. The editor is one scene among several; title and
  // mode-select are the new entry flow. Settings/music-select/game register in
  // later stages. Boot lands on START_SCENE (config) — 'title' for real builds,
  // flippable to 'editor' during development.
  registerScene('editor', {
    el: $('app'),
    display: 'flex',          // #app is a flex column; preserve that when shown
    // Redraw the active tab on every entry. The canvas has zero size while the
    // scene is hidden, so the initial draw must happen here (not at boot) and
    // again whenever the editor is re-entered from Title/Mode-select.
    onEnter() {
      requestAnimationFrame(() => {
        rszActiveCanvas();
        if (ES.activeTab === 'note') drawN();
        else if (ES.activeTab === 'shape') drawS();
        else if (ES.activeTab === 'play' && !PS.playActive) drawPlayIdle();
      });
    },
  });
  registerScene('title', {
    el: $('scene-title'),
    mount: mountTitle,
    onEnter() { enterTitle($('scene-title')); },
    onExit()  { exitTitle($('scene-title')); },
  });
  registerScene('modeselect', {
    el: $('scene-modeselect'),
    mount: mountModeSelect,
    onEnter() { enterModeSelect($('scene-modeselect')); },
    onExit()  { exitModeSelect(); },
  });
  registerScene('settings', {
    el: $('scene-settings'),
    mount: mountSettings,
    onEnter() { enterSettings(); },
    onExit()  { exitSettings(); },
  });

  // START_SCENE may be 'editor' (dev) even when the public default is 'title'.
  // Guard the editor route behind FEATURES.editor so a game-only build can't
  // boot into it by a stale config value.
  const boot = (START_SCENE === 'editor' && !FEATURES.editor) ? 'title' : START_SCENE;
  goScene(boot);

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

  // Paint the gauge/lock option bar to reflect PS defaults.
  initPlayOptionsUI();

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
  buildGP('ngp', ES.nGD);
  buildGP('sgp', ES.sGD);
  syncMeta(); renderTempoList(); renderTSList();
  loadKeyBindings(); renderKeyCfg();
  // Initial canvas draw is handled by the editor scene's onEnter (the canvas
  // has no size until the scene is visible). See registerScene('editor').

  // Persistence
  window.addEventListener('beforeunload', () => { autoSave(); });
  setInterval(autoSave, 60000);
});
