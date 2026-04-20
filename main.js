// ============================================================
//  MAIN — top-level module; entry point for the app.
//  Phase 1 migration: modules extracted for constants, state,
//  timing, shape. Everything else remains here.
// ============================================================

import {
  $, TPB, CHL, KEY2LINE, OVERLAP_CHANNELS,
  WIDE_COLOR, WIDE_BODY, OVERLAP_COLOR, OVERLAP_BODY, NORMAL_BODY, TEXT_COLOR,
  GDIVS, LEAD_IN_MS, TAB_MAP,
  DEFAULT_KEYS,
  JUDGE_SYNC, JUDGE_PERFECT, JUDGE_GOOD, JUDGE_WIDE_SYNC,
  LS_PREFIX, sPosSnapVals
} from './constants.js';

import { D } from './state.js';

import {
  compBPM, t2ms, ms2t, getBPMAt,
  getTimeSig, getSortedTS, invalidateTSCache,
  getMinTick, tickToMeasure, measureToTick, getGridLines
} from './timing.js';

import {
  ease,
  invalidateShapeCache, invalidateLinesCache,
  getStepTicks, getShapeEventTicks, countShapeEventsInRange,
  buildShapePointArrays, isStepTick, resolveArcEasing, normalizeShapeChain,
  getShape, getLines, sp2f
} from './shape.js';

import {
  invalidateNoteOverlaps, computeNoteOverlaps, classifyNotesForZOrder
} from './overlaps.js';

import {
  dispatch, undoCmd, redoCmd, hasUndo as hasCmdUndo, hasRedo as hasCmdRedo,
  onDispatch,
  AddTempo, DeleteTempo, EditTempoBpm,
  AddTimeSig, DeleteTimeSig, EditTimeSig
} from './commands.js';

import {
  resolveNoteColor, headColorAtTick, splitBodyByOverlap, drawNoteHead,
} from './renderer.js';

import {
  resetHitScheduler, scheduleHitsounds,
  resetMissChecker, checkPlayMisses,
  resetAutoJudger, autoJudge,
} from './scheduler.js';


/** Show a brief toast notification */
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1200);
}

/** Load chart data from a parsed JSON object into the global state D */
function loadChartData(d) {
  if (d.metadata) {
    D.metadata = {...D.metadata, ...d.metadata};
    if (d.metadata.chart && !d.metadata.charter) D.metadata.charter = d.metadata.chart;
  }
  if (d.tempo) D.tempo = d.tempo;
  if (!D.tempo || D.tempo.length === 0) D.tempo = [{tick: 0, bpm: 120}];
  if (d.timeSignatures) D.timeSignatures = d.timeSignatures;
  if (!D.timeSignatures || D.timeSignatures.length === 0) D.timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];
  if (d.shapeEvents) {
    D.shapeEvents = d.shapeEvents;
    D.shapeEvents.forEach(e => {
      if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear';
    });
    invalidateShapeCache();
  }
  if (d.lineEvents) { D.lineEvents = d.lineEvents; invalidateLinesCache(); }
  if (d.notes) {
    D.notes = d.notes;
    // Migrate old 6-channel format → new 4-channel format
    // Old: ch1-3=L, ch4-6=R, wide=ch3/ch4 ; New: ch1-4=lines, wide=ch0
    const OLD_TO_NEW = {1:1, 2:2, 3:3, 4:2, 5:3, 6:4};
    const hasOldChannels = D.notes.some(n => !n.isWide && n.channel > 4);
    D.notes.forEach(n => {
      if (n.isWide) n.channel = 0;
      else if (hasOldChannels && OLD_TO_NEW[n.channel]) n.channel = OLD_TO_NEW[n.channel];
    });
  }
  D.textEvents = d.textEvents || []; // Always reset — don't carry over from previous file
  pvHitEffects = [];
  playHitMap.clear(); playMissSet.clear(); playEffects = [];
  playJudgQueue = []; playCombo = 0; playMaxCombo = 0;
  invalidateNoteOverlaps();
  invalidateTSCache();
  compBPM(); updateTotalMs();
}


// ============================================================
//  EDITOR STATE
// ============================================================
// Tab & tool state
let activeTab = 'note';
let nTool = 'sel', sTool = 'L';
let nGD = 2, sGD = 2;           // Grid division for notes/shapes
let nScr = 0, edZm = 1;          // Notes scroll position & shared zoom
let sScr = 0;                     // Shapes scroll position (zoom shared with edZm)
let nFollow = true, sFollow = true; // Auto-follow playback

// Preview settings
let pvSpd = 3.0, nThk = 12, hitVol = 1.0;

// Pending operations
let pendLN = null;               // Pending long note start
let pendTE = null;               // Pending text event start {startTick, pos}
let pendArc = null;              // Pending Arc two-click: {tick, pos, isRight}
let savedLNDur = TPB;            // Saved long note duration for quick-LN (default: 1 beat)

// 4-line note editor mode (6-line mode removed in v15; retained as invariant flag)
let nUse4Line = true;

// Shape editor settings
let sPosSnapLevel = 0;           // 0=1, 1=0.5, 2=0.25 (external units)
let sMirror = false;             // Mirror mode for symmetric editing

// Computed BPM segments
let totalMs = 60000;
let audioMs = 0; // Audio file duration (0 if no audio)

// Effective total duration: max of audio and chart data
function getChartEndMs() {
  let maxTk = 0;
  for (const n of D.notes) { const e = n.startTick + (n.duration || 0); if (e > maxTk) maxTk = e; }
  for (const te of D.textEvents) { const e = te.startTick + (te.duration || 0); if (e > maxTk) maxTk = e; }
  for (const se of D.shapeEvents) { const e = se.startTick + (se.duration || 0); if (e > maxTk) maxTk = e; }
  return maxTk > 0 ? t2ms(maxTk) + 2000 : 0;
}
function updateTotalMs() {
  totalMs = Math.max(audioMs || 0, getChartEndMs(), 5000);
}

// Audio engine
let actx = null, abuf = null, asrc = null, aOff = 0;
let waveData = null, waveSR = 44100;
let globalOffset = 0;            // System latency compensation (ms)
let isMetronomeOn = false;
let musicGain = null, hitGain = null;

// Editor playback state
let edPlay = {n: false, s: false};
let edT0 = {n: 0, s: 0};
let edMs0 = {n: 0, s: 0};
let edRAF = {n: null, s: null};
let edHitSet = {n: new Set(), s: new Set()};
let edLastBeat = {n: -1, s: -1};

// Preview playback state
// Preview/Play hit tracking (unified since v21 — Play tab has inline controls)
let pvHitEffects = [];           // Active hit effect animations (shared buffer)

// File management
let currentFileName = '';
let autoSaveTimer = null;

// ============================================================
//  PLAY MODE STATE
// ============================================================
let keyBindings = {...DEFAULT_KEYS};
let codeToChannel = {}; // inverse of keyBindings; rebuilt on mutation
function rebuildCodeToChannel() {
  codeToChannel = {};
  for (const [ch, code] of Object.entries(keyBindings)) codeToChannel[code] = +ch;
}
rebuildCodeToChannel();
let keyConfigMode = null; // null | 1-6

let playActive = false, playFullscreen = false;
let playAutoplay = false;      // v21: autoplay toggle (auto-SYNC instead of key input)
let playT0 = 0, playOffMs = 0;
let playAudioStarted = false;  // Lead-in: has audio started yet?
let playHitMap = new Map();   // note → {diff, type, hitMs}
let playMissSet = new Set();
let playEffects = [];         // active hit effect animations (play mode)
let playCombo = 0, playMaxCombo = 0;
let playJudgQueue = [];       // [{type, diff, t}] for on-screen display
let playHoldState = {};       // channel → note (active hold)
let playKeyHeld = new Set();  // currently held channel numbers
let playRAF = null;

// Selection & clipboard (Notes)
let selectedNotes = new Set();
let clipboard = [];

// Selection & clipboard (Shapes)
let selectedShapeEvts = new Set();
let shapeClipboard = [];

// ============================================================
//  UNDO / REDO
// ============================================================
// Scope table: each scope defines what state it captures/restores.
// 'n' = notes + textEvents, 's' = shapeEvents + lineEvents, 'm' = tempo + timeSignatures + metadata
const histScopes = {
  n: {
    capture: () => ({notes: D.notes, textEvents: D.textEvents}),
    restore: (d) => {
      if (d && d.notes) { D.notes = d.notes; D.textEvents = d.textEvents || []; }
      else { D.notes = d; D.textEvents = []; } // back-compat: older snapshots stored notes array directly
      invalidateNoteOverlaps();
      selectedNotes.clear();
      if (activeTab === 'note') drawN();
    }
  },
  s: {
    capture: () => ({shapeEvents: D.shapeEvents, lineEvents: D.lineEvents}),
    restore: (d) => {
      if (d && d.shapeEvents) {
        D.shapeEvents = d.shapeEvents;
        if (d.lineEvents) D.lineEvents = d.lineEvents;
      } else {
        D.shapeEvents = d; // back-compat: older snapshots stored shapeEvents array directly
      }
      invalidateShapeCache(); invalidateLinesCache();
      selectedShapeEvts.clear();
      if (activeTab === 'shape') drawS();
    }
  },
  m: {
    capture: () => ({tempo: D.tempo, timeSignatures: D.timeSignatures, metadata: {...D.metadata}}),
    restore: (d) => {
      if (!d || !d.tempo) return;
      D.tempo = d.tempo;
      D.timeSignatures = d.timeSignatures;
      D.metadata = d.metadata;
      invalidateTSCache();
      compBPM(); updateTotalMs();
      if (typeof syncMeta === 'function') syncMeta();
      // Meta changes affect tick→ms mapping used by all canvases; redraw active one
      if (activeTab === 'note') drawN();
      else if (activeTab === 'shape') drawS();
      else if (activeTab === 'play' && !playActive) drawPlayIdle();
    }
  }
};

const hist = {n: [], s: [], m: []};
const histIdx = {n: -1, s: -1, m: -1};

function saveHist(w) {
  const scope = histScopes[w]; if (!scope) return;
  if (w === 'n') invalidateNoteOverlaps();
  const data = JSON.stringify(scope.capture());
  // Dedup: don't save if identical to current position
  if (histIdx[w] >= 0 && hist[w][histIdx[w]] === data) return;
  hist[w] = hist[w].slice(0, histIdx[w] + 1);
  hist[w].push(data);
  if (hist[w].length > 60) { hist[w].shift(); histIdx[w]--; }
  histIdx[w] = hist[w].length - 1;
  scheduleAutoSave();
  updateTotalMs();
}

function undo(w) {
  // Phase 3: for the 'm' scope (tempo/TS/metadata), try the command stack first.
  // Tempo/TS edits now dispatch commands instead of using saveHist('m'), so Ctrl+Z
  // in the Meta tab should prefer command-undo. Falls back to the legacy snapshot
  // stack when no commands remain (keeps the startup baseline snapshot reachable).
  if (w === 'm' && hasCmdUndo()) {
    undoCmd();
    return;
  }
  const scope = histScopes[w]; if (!scope) return;
  // Save current state first if it differs from last saved
  saveHist(w);
  if (histIdx[w] <= 0) return;
  histIdx[w]--;
  scope.restore(JSON.parse(hist[w][histIdx[w]]));
}

function redo(w) {
  if (w === 'm' && hasCmdRedo()) {
    redoCmd();
    return;
  }
  const scope = histScopes[w]; if (!scope) return;
  if (histIdx[w] >= hist[w].length - 1) return;
  histIdx[w]++;
  scope.restore(JSON.parse(hist[w][histIdx[w]]));
}

// ============================================================
//  HITSOUND & METRONOME
// ============================================================
let hitBuf = null;

function initAud() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  if (!musicGain) {
    musicGain = actx.createGain();
    musicGain.gain.value = 0.7; // reduce music volume
    musicGain.connect(actx.destination);
  }
  if (!hitGain) {
    hitGain = actx.createGain();
    hitGain.gain.value = 1.0;
    // Use compressor to prevent clipping but keep hitsounds punchy
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    hitGain.connect(comp);
    comp.connect(actx.destination);
  }
  if (!hitBuf) {
    const sr = actx.sampleRate, len = Math.floor(sr * 0.025);
    hitBuf = actx.createBuffer(1, len, sr);
    const d = hitBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 160);
      d[i] = env * (Math.sin(2 * Math.PI * 2400 * t) * 0.35 + Math.sin(2 * Math.PI * 4200 * t) * 0.15 + Math.sin(2 * Math.PI * 1200 * t) * 0.1) * 0.8;
    }
  }
}

function playHit() {
  if (!actx || !hitBuf || hitVol <= 0) return;
  const s = actx.createBufferSource(); s.buffer = hitBuf;
  const g = actx.createGain(); g.gain.value = hitVol * 1.5;
  s.connect(g); g.connect(hitGain || actx.destination); s.start();
}

// Pre-scheduled hitsound: play at exact AudioContext time
function playHitAt(when) {
  if (!actx || !hitBuf || hitVol <= 0) return;
  const s = actx.createBufferSource(); s.buffer = hitBuf;
  const g = actx.createGain(); g.gain.value = hitVol * 1.5;
  s.connect(g); g.connect(hitGain || actx.destination);
  s.start(Math.max(actx.currentTime, when));
}

// Hitsound scheduling moved to scheduler.js (binary-search + pointer).
// main.js uses it via imported resetHitScheduler / scheduleHitsounds.

// Playback speed (0.5 - 1.0)
let playbackRate = 1.0;

function setPlaybackRate(val) {
  const newRate = Math.max(0.5, Math.min(1.0, val / 100));
  // Re-anchor audio timing if currently playing
  if (asrc && actx) {
    const elapsed = actx.currentTime - _audStartCtxTime;
    _audStartSec = _audStartSec + elapsed * playbackRate;
    _audStartCtxTime = actx.currentTime;
    try { asrc.playbackRate.value = newRate; } catch (e) {}
  }
  // Re-anchor play session timing
  if (playActive) {
    const curMs = playOffMs + (performance.now() - playT0) * playbackRate;
    playOffMs = curMs;
    playT0 = performance.now();
  }
  playbackRate = newRate;
  $('rateLbl').textContent = playbackRate.toFixed(2) + 'x';
}

function playMetronome(isDownbeat) {
  if (!isMetronomeOn || !actx) return;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.connect(gain); gain.connect(actx.destination);
  osc.frequency.value = isDownbeat ? 1000 : 600;
  gain.gain.setValueAtTime(0.4, actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.08);
  osc.start(); osc.stop(actx.currentTime + 0.08);
}

function toggleMetronome() {
  isMetronomeOn = !isMetronomeOn;
  $('metroBtn').style.background = isMetronomeOn ? 'var(--green)' : '';
  $('metroBtn').style.color = isMetronomeOn ? '#000' : '';
  if (isMetronomeOn) initAud();
  toast(isMetronomeOn ? 'Metronome ON' : 'Metronome OFF');
}


// ============================================================
//  SYNC: Audio-driven time
// ============================================================
// Returns current CHART ms during playback (not audio ms)
function getPlayMs(w) {
  if (!edPlay[w]) return edMs0[w];
  if (actx && asrc && abuf) {
    const audioSec = _audStartSec + (actx.currentTime - _audStartCtxTime) * playbackRate;
    const audioMs = audioSec * 1000;
    return Math.max(0, audioMs - D.metadata.offset + globalOffset);
  }
  return edMs0[w] + (performance.now() - edT0[w]) * playbackRate;
}


// ============================================================
//  OFFSET MANAGEMENT
// ============================================================
// Sets chart offset so that the current scroll position aligns with audio
function setOffsetHere() {
  // Current tick at the bottom of the visible area
  const curTk = nScr;
  const chartMs = t2ms(curTk);
  const newOff = Math.round(chartMs);
  D.metadata.offset = newOff;
  $('syncOff').value = newOff;
  $('mOff').value = newOff;
  toast('Offset set: ' + newOff + 'ms');
}

function setGlobalPreset(val) {
  globalOffset = val;
  $('mGlobalOff').value = val;
  toast('Global offset: ' + val + 'ms');
}



function addShapeEvt(tick, pos, isRight, easing) {
  if (easing === 'Step') {
    // Step = instant jump at tick, stored as duration=0, easing='Step'
    const exist = D.shapeEvents.find(e => {
      const dest = e.startTick + e.duration;
      return Math.abs(dest - tick) < 1 && e.isRight === isRight && e.easing !== null && e.duration === 0;
    });
    if (exist) { exist.targetPos = pos; exist.easing = 'Step'; }
    else D.shapeEvents.push({startTick: tick, duration: 0, isRight, targetPos: pos, easing: 'Step'});
    normalizeShapeChain(isRight);
    return;
  }
  // Check if event already exists at this destination tick
  const exist = D.shapeEvents.find(e => {
    const dest = e.startTick + e.duration;
    return Math.abs(dest - tick) < 1 && e.isRight === isRight && e.easing !== null;
  });
  if (exist) { exist.targetPos = pos; exist.easing = easing; }
  else D.shapeEvents.push({startTick: 0, duration: tick, isRight, targetPos: pos, easing});
  normalizeShapeChain(isRight);
}

// ============================================================
//  TAB NAVIGATION
// ============================================================
// Shared playback position (in ms) across tabs
let sharedMs = 0;

function syncSharedFromTab(tab) {
  if (tab === 'note') {
    sharedMs = t2ms(nScr);
  } else if (tab === 'shape') {
    sharedMs = t2ms(sScr);
  }
  // 'play' tab: sharedMs is already updated by playSeekTo; nothing to pull here.
  // Update all seek bars
  const frac = totalMs > 0 ? Math.max(0, (sharedMs / totalMs) * 1000) : 0;
  $('nSeek').value = frac; $('nTime').textContent = fmtMs(sharedMs);
  $('sSeek').value = frac; $('sTime').textContent = fmtMs(sharedMs);
  const playSeekEl = $('playSeek');
  if (playSeekEl) { playSeekEl.value = frac; $('playTime').textContent = fmtMs(sharedMs); }
}

function applySharedToTab(tab) {
  const tk = ms2t(sharedMs);
  if (tab === 'note') { nScr = tk; }
  else if (tab === 'shape') { sScr = tk; }
  // 'play' reads sharedMs directly in drawPlayIdle; no per-tab mutation needed.
}

function goTab(t) {
  if (activeTab === t) return;
  // Save current position from outgoing tab
  syncSharedFromTab(activeTab);
  if (t !== 'note' && edPlay.n) stopEdPlay('n');
  if (t !== 'shape' && edPlay.s) stopEdPlay('s');
  if (t !== 'play' && playActive) stopPlay();
  // Cancel any pending key rebind when leaving the meta tab
  if (activeTab === 'meta' && t !== 'meta' && keyConfigMode !== null) {
    keyConfigMode = null;
    if (typeof renderKeyCfg === 'function') renderKeyCfg();
  }
  cancelLN(); cancelArc(); cancelTE();
  activeTab = t;
  // Apply shared position to incoming tab
  applySharedToTab(t);
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  document.querySelector(`.nb[onclick="goTab('${t}')"]`).classList.add('on');
  for (const key in TAB_MAP) $(TAB_MAP[key]).classList.toggle('on', key === t);
  requestAnimationFrame(() => {
    rszActiveCanvas();
    if (t === 'note') drawN();
    else if (t === 'shape') drawS();
    else if (t === 'play') drawPlayIdle();
  });
}

// ============================================================
//  FULLSCREEN
// ============================================================
function goFS() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}
function onFullscreenChange() {
  setTimeout(() => {
    // Handle play fullscreen exit via native gesture
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (playFullscreen && playActive) stopPlay();
    }
    rszActiveCanvas(); redrawActiveTab();
  }, 150);
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// ============================================================
//  CANVAS RESIZE
// ============================================================
function rszActiveCanvas() {
  const dpr = devicePixelRatio;
  const ids = activeTab === 'note' ? ['nCv'] : activeTab === 'shape' ? ['sCv'] : activeTab === 'play' ? ['plCv'] : [];
  for (const id of ids) {
    const cv = $(id); if (!cv) continue;
    const p = cv.parentElement;
    const r = p.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  if (playFullscreen) rszPlayFSCanvas();
}

function redrawActiveTab() {
  if (activeTab === 'note') drawN();
  else if (activeTab === 'shape') drawS();
  else if (activeTab === 'play' && !playActive) drawPlayIdle();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeTimer = null; rszActiveCanvas(); redrawActiveTab(); }, 80);
});

// ============================================================
//  GRID PICKER
// ============================================================
function buildGP(id, cur, cb) {
  $(id).innerHTML = GDIVS.map(d => {
    const l = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`;
    return `<div class="gi${d === cur ? ' on' : ''}" onclick="event.stopPropagation();${cb}(${d});closeGP('${id}')">${l}</div>`;
  }).join('');
}
function toggleGP(id) { $(id).classList.toggle('show'); }
function closeGP(id) { $(id).classList.remove('show'); }
function pickNG(d) { nGD = d; $('ngBtn').textContent = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`; buildGP('ngp', nGD, 'pickNG'); drawN(); }
function pickSG(d) { sGD = d; $('sgBtn').textContent = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`; buildGP('sgp', sGD, 'pickSG'); drawS(); }
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.gpop') && !e.target.closest('#ngBtn') && !e.target.closest('#sgBtn')) { closeGP('ngp'); closeGP('sgp'); }
});
function snap(tk, div) { const u = TPB / div; return Math.round(tk / u) * u; }

// ============================================================
//  FOLLOW & EDITOR OPTIONS
// ============================================================
function toggleFollow() { nFollow = !nFollow; $('nFollowBtn').classList.toggle('on', nFollow); }
function toggleSFollow() { sFollow = !sFollow; $('sFollowBtn').classList.toggle('on', sFollow); }

// Mirror mode toggle for shape editing
function toggleMirror() { sMirror = !sMirror; $('sMirrorBtn').classList.toggle('on', sMirror); toast(sMirror ? 'Mirror ON' : 'Mirror OFF'); }

// Position snap for shape editing
function cyclePosSnap() {
  sPosSnapLevel = (sPosSnapLevel + 1) % 3;
  const labels = ['V:1', 'V:0.5', 'V:0.25'];
  $('sPosSnapBtn').textContent = labels[sPosSnapLevel];
  cancelArc();
  toast('Pos snap: ' + ['1', '0.5', '0.25'][sPosSnapLevel]);
}
function snapPos(rawInternal) {
  const unit = sPosSnapVals[sPosSnapLevel];
  return Math.max(0, Math.min(64, Math.round(rawInternal / unit) * unit));
}
function posToExt(internal) { return (internal / 4 - 8); }
function posToExtStr(internal) { return posToExt(internal).toFixed(2).replace(/\.?0+$/, ''); }

// Arc pending (two-click for Arc easing)
function cancelArc() { pendArc = null; $('arcPendUI').style.display = 'none'; }

// ============================================================
//  COPY / PASTE (Notes)
// ============================================================
function doCopy() {
  if (selectedNotes.size === 0) { toast('No notes selected'); return; }
  const sel = [...selectedNotes];
  const minTick = Math.min(...sel.map(n => n.startTick));
  clipboard = sel.map(n => ({
    channel: n.channel,
    relTick: n.startTick - minTick,
    duration: n.duration || 0,
    isWide: !!n.isWide
  }));
  toast(`Copied ${clipboard.length} note(s)`);
}

function doPaste(mirror) {
  // Sel + Flip combo: if mirror mode and notes are selected, flip them in place
  if (mirror && nTool === 'sel' && selectedNotes.size > 0) {
    const MIRROR_CH = {1:4, 2:3, 3:2, 4:1, 0:0};
    for (const n of selectedNotes) {
      if (!n.isWide) {
        n.channel = MIRROR_CH[n.channel] !== undefined ? MIRROR_CH[n.channel] : n.channel;
      }
    }
    saveHist('n');
    toast(`${selectedNotes.size}개 노트 뒤집기`);
    drawN();
    return;
  }
  if (clipboard.length === 0) { toast('Clipboard empty'); return; }
  const baseTick = snap(nScr, nGD);
  const MIRROR_CH = {1:4, 2:3, 3:2, 4:1, 0:0};
  const newNotes = [];
  for (const c of clipboard) {
    let ch = c.channel, isW = c.isWide;
    if (mirror) {
      ch = MIRROR_CH[ch] !== undefined ? MIRROR_CH[ch] : ch;
    }
    const n = { channel: ch, startTick: baseTick + c.relTick, duration: c.duration, isWide: isW };
    if (!D.notes.find(x => x.channel === n.channel && x.startTick === n.startTick && x.isWide === n.isWide)) {
      D.notes.push(n);
      newNotes.push(n);
    }
  }
  selectedNotes.clear();
  newNotes.forEach(n => selectedNotes.add(n));
  saveHist('n');
  toast(`${mirror ? 'Flip-' : ''}Pasted ${newNotes.length} note(s)`);
  drawN();
}

// ============================================================
//  NOTES TAB
// ============================================================
function setNT(t) {
  // Sel + Del combo: if currently in sel mode with selection, delete selected notes
  if (t === 'del' && nTool === 'sel' && selectedNotes.size > 0) {
    const count = selectedNotes.size;
    D.notes = D.notes.filter(n => !selectedNotes.has(n));
    selectedNotes.clear();
    saveHist('n'); drawN();
    toast(`${count}개 노트 삭제`);
    return;
  }
  nTool = t; cancelLN(); cancelTE();
  if (t !== 'sel') selectedNotes.clear();
  document.querySelectorAll('#ntb .t[data-t]').forEach(b => {
    b.classList.remove('on', 'sel-on');
    if (b.dataset.t === t) {
      b.classList.add(t === 'sel' ? 'sel-on' : 'on');
    }
  });
  drawN();
}

function nZ(d) { edZm = Math.max(0.25, Math.min(8, edZm * (d > 0 ? 1.35 : 1 / 1.35))); drawN(); drawS(); }
function cancelLN() { pendLN = null; $('lnPendUI').style.display = 'none'; }
function cancelTE() { pendTE = null; $('tePendUI').style.display = 'none'; }

// Map 4-line column index (0-3) to channel
// Normal: line 0→ch1, 1→ch2, 2→ch3, 3→ch4
// Wide: channel 0 (full width)
function line4ToChannel(lineIdx, isWide) {
  if (isWide) return 0;
  return lineIdx + 1;
}

// Get line index for a channel
function channelToLine4(ch) { return CHL[ch]; }

// ============================================================
//  OVERLAP HIGHLIGHTING (Lines 2/3 multi-input)
// ============================================================
// Extracted to overlaps.js; see that module for the caching and logic.

function nMet() {
  const cv = $('nCv'), dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch = cv.height / dpr;
  if (cw < 1 || ch < 1) return null;
  const nCols = 4;
  const colW = Math.min(cw * 0.18, 60);
  const gw = colW * nCols, padL = (cw - gw) / 2;
  const tpp = (TPB * 16) / (ch * edZm);
  return {cw, ch, colW, gw, padL, tpp, dpr, nCols};
}

function drawN() {
  const cv = $('nCv'), ctx = cv.getContext('2d');
  const m = nMet();
  if (!m) return;
  const {cw, ch, colW, gw, padL, tpp, dpr} = m;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08080d'; ctx.fillRect(0, 0, cw, ch);

  const stT = nScr, visTk = ch * tpp, enT = stT + visTk;

  // Background channel tint
  {
    const tint = '#ffffff06';
    for (let i = 0; i < 4; i++) { ctx.fillStyle = tint; ctx.fillRect(padL + i * colW, 0, colW, ch); }
  }

  // Grid subdivisions
  const tpd = TPB / nGD, f = Math.floor(stT / tpd) * tpd;

  // Measure 0 tint (virtual, non-gameplay area below tick 0)
  if (stT < 0) {
    const y0 = ch - (0 - stT) / tpp;
    const yClamp = Math.min(y0, ch);
    if (yClamp > 0) {
      ctx.fillStyle = '#1a0a2218';
      ctx.fillRect(0, 0, cw, yClamp);
      // Diagonal stripes for measure 0
      ctx.save(); ctx.beginPath(); ctx.rect(padL, 0, gw, yClamp); ctx.clip();
      ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 0.5;
      for (let s = -yClamp; s < gw + yClamp; s += 12) {
        ctx.beginPath(); ctx.moveTo(padL + s, yClamp); ctx.lineTo(padL + s + yClamp, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }

  for (let tk = f; tk <= enT; tk += tpd) {
    const y = ch - (tk - stT) / tpp;
    if (y < -1 || y > ch + 1) continue;
    if (tk % TPB !== 0) { ctx.strokeStyle = '#1e1e30'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke(); }
  }

  // Beat/measure lines
  const gLines = getGridLines(stT - TPB, enT + TPB);
  for (const gl of gLines) {
    const y = ch - (gl.tick - stT) / tpp;
    if (y < -1 || y > ch + 1) continue;
    ctx.strokeStyle = gl.isMeasure ? '#555' : '#383850';
    ctx.lineWidth = gl.isMeasure ? 1.5 : 0.7;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    if (gl.isMeasure) {
      ctx.fillStyle = gl.measureNum <= 0 ? '#a855f7' : '#888';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(gl.measureNum <= 0 ? `m${gl.measureNum}` : gl.measureNum, padL - (gl.measureNum <= 0 ? 22 : 16), y + 4);
    }
    else { ctx.fillStyle = '#444'; ctx.font = '8px sans-serif'; ctx.fillText(gl.beatInMeasure, padL - 10, y + 3); }
  }

  // Tick 0 boundary (measure 0 / measure 1 divider)
  {
    const y0 = ch - (0 - stT) / tpp;
    if (y0 >= -5 && y0 <= ch + 5) {
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(cw, y0); ctx.stroke();
    }
  }

  // Wide note LN bodies (drawn behind channel separators)
  {
    const _wideNotes = D.notes.filter(n => n.isWide && n.duration > 0);
    for (const n of _wideNotes) {
      const ne = n.startTick + n.duration;
      if (ne < stT - TPB || n.startTick > enT + TPB) continue;
      const nx = padL, nw = colW * 4, px = 1;
      const y1 = ch - (n.startTick - stT) / tpp, y2 = ch - (ne - stT) / tpp;
      ctx.fillStyle = WIDE_BODY;
      ctx.fillRect(nx + px, Math.min(y1, y2), nw - px * 2, Math.abs(y1 - y2));
    }
  }

  // Channel separators
  const nCols = 4;
  for (let i = 0; i <= nCols; i++) {
    const x = padL + i * colW;
    if (i === 2) { ctx.strokeStyle = '#667'; ctx.lineWidth = 1; }
    else if (i === 0 || i === 4) { ctx.strokeStyle = '#445'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = '#334'; ctx.lineWidth = 0.7; }
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, ch); ctx.stroke();
  }

  // Channel labels
  ctx.font = 'bold 7px sans-serif';
  {
    const lb4 = ['L1','L2','L3','L4'];
    const lc4 = '#ffffff44';
    for (let i = 0; i < 4; i++) { ctx.fillStyle = lc4; ctx.fillText(lb4[i], padL + i * colW + colW / 2 - 5, ch - 2); }
  }

  // BPM change markers (purple)
  for (const t of D.tempo) {
    if (t.tick < stT - TPB || t.tick > enT + TPB) continue;
    const y = ch - (t.tick - stT) / tpp;
    if (y < -5 || y > ch + 5) continue;
    ctx.strokeStyle = '#b060ff66'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    ctx.fillStyle = '#b060ff'; ctx.font = 'bold 8px sans-serif';
    ctx.fillText(`♩${t.bpm}`, padL + gw + 3, y + 3);
  }

  // Time signature change markers (purple)
  for (const ts of D.timeSignatures) {
    if (ts.tick < stT - TPB || ts.tick > enT + TPB) continue;
    const y = ch - (ts.tick - stT) / tpp;
    if (y < -5 || y > ch + 5) continue;
    if (!D.tempo.some(t => t.tick === ts.tick)) {
      ctx.strokeStyle = '#b060ff44'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    }
    ctx.fillStyle = '#d080ff'; ctx.font = '7px sans-serif';
    ctx.fillText(`${ts.numerator}/${ts.denominator}`, padL + gw + 3, y + (D.tempo.some(t => t.tick === ts.tick) ? 12 : 3));
  }

  // Waveform
  if (waveData && abuf) {
    const waveL = padL, waveR = padL + gw, centerX = padL + gw / 2, maxW = gw * 0.45;
    const stMs = t2ms(stT) + D.metadata.offset;
    const enMs = t2ms(enT) + D.metadata.offset;
    const stSamp = Math.max(0, Math.floor(stMs / 1000 * waveSR));
    const enSamp = Math.min(waveData.length, Math.ceil(enMs / 1000 * waveSR));
    if (enSamp > stSamp) {
      const sampPerPx = Math.max(1, Math.floor((enSamp - stSamp) / ch));
      ctx.save(); ctx.beginPath(); ctx.rect(waveL, 0, waveR - waveL, ch); ctx.clip();
      ctx.strokeStyle = '#ffffff38'; ctx.lineWidth = 1; ctx.beginPath();
      for (let py = 0; py < ch; py += 1.5) {
        const tk = enT - (enT - stT) * (py / ch);
        const ms_ = t2ms(tk) + D.metadata.offset;
        const si = Math.floor(ms_ / 1000 * waveSR);
        if (si < 0 || si >= waveData.length) continue;
        let peak = 0;
        for (let j = 0; j < sampPerPx && si + j < waveData.length; j++) peak = Math.max(peak, Math.abs(waveData[si + j]));
        const w = peak * maxW;
        ctx.moveTo(centerX - w, py); ctx.lineTo(centerX + w, py);
      }
      ctx.stroke(); ctx.restore();
    }
  }

  // Text events — left margin for pos=left, right margin for others (line:N shown on grid instead)
  for (const te of D.textEvents) {
    if ((te.pos || '').startsWith('line:')) continue; // rendered on grid
    const teEnd = te.startTick + te.duration;
    if (teEnd < stT - TPB || te.startTick > enT + TPB) continue;
    const yTop = ch - (teEnd - stT) / tpp;
    const yBot = ch - (te.startTick - stT) / tpp;
    if (yTop > ch + 5 || yBot < -5) continue;
    const isLeft = (te.pos === 'left');
    const txW = Math.min(isLeft ? (padL - 4) : (cw - padL - gw - 4), 80);
    if (txW < 10) continue;
    const txL = isLeft ? Math.max(2, padL - txW - 2) : (padL + gw + 2);
    const clampTop = Math.max(yTop, -1);
    const clampBot = Math.min(yBot, ch + 1);
    const clampH = clampBot - clampTop;
    // Background bar
    ctx.fillStyle = TEXT_COLOR + '10';
    ctx.fillRect(txL, clampTop, txW, clampH);
    // Start tick marker — solid bottom edge + small triangle
    const startY = Math.min(yBot, ch + 1);
    if (startY >= -1 && startY <= ch + 5) {
      ctx.strokeStyle = TEXT_COLOR + 'aa'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(txL, startY); ctx.lineTo(txL + txW, startY); ctx.stroke();
      // Small triangle pointing at start
      const triH = 5, triW = 4;
      ctx.fillStyle = TEXT_COLOR + 'aa';
      if (isLeft) {
        ctx.beginPath(); ctx.moveTo(txL + txW, startY); ctx.lineTo(txL + txW + triW, startY - triH / 2); ctx.lineTo(txL + txW, startY - triH); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(txL, startY); ctx.lineTo(txL - triW, startY - triH / 2); ctx.lineTo(txL, startY - triH); ctx.closePath(); ctx.fill();
      }
    }
    // End tick — thin dashed line
    const endY = Math.max(yTop, -1);
    if (endY >= -1 && endY <= ch + 5) {
      ctx.strokeStyle = TEXT_COLOR + '44'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(txL, endY); ctx.lineTo(txL + txW, endY); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Tick indicator lines across the grid (start tick only — solid thin)
    if (startY >= 0 && startY <= ch) {
      ctx.strokeStyle = TEXT_COLOR + '33'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(padL, startY); ctx.lineTo(padL + gw, startY); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Side border
    ctx.strokeStyle = TEXT_COLOR + '33'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(isLeft ? txL + txW : txL, clampTop); ctx.lineTo(isLeft ? txL + txW : txL, clampBot); ctx.stroke();
    // Text content — show all lines that fit
    const posLabel = (te.pos || 'middle');
    const fontSize = 8;
    const lineH = fontSize + 2;
    ctx.fillStyle = TEXT_COLOR; ctx.font = `${fontSize}px sans-serif`;
    ctx.save(); ctx.beginPath(); ctx.rect(txL, clampTop, txW, clampH); ctx.clip();
    const contentLines = (te.content || '').split('\n');
    // Position label at top
    ctx.fillStyle = TEXT_COLOR + '88'; ctx.font = `bold 7px sans-serif`;
    ctx.fillText(posLabel, txL + 3, clampTop + 8);
    ctx.fillStyle = TEXT_COLOR; ctx.font = `${fontSize}px sans-serif`;
    // Calculate max chars per line based on available width
    const maxChars = Math.floor((txW - 6) / 4.5);
    // Draw from bottom (start tick) upward
    let curY = startY - 4;
    for (let li = contentLines.length - 1; li >= 0; li--) {
      const line = contentLines[li];
      if (curY < clampTop + 10) break; // leave room for position label
      if (line.length <= maxChars) {
        ctx.fillText(line, txL + 3, curY);
        curY -= lineH;
      } else {
        // Word-wrap long lines
        const chunks = [];
        for (let c = 0; c < line.length; c += maxChars) {
          chunks.push(line.slice(c, c + maxChars));
        }
        for (let ci = chunks.length - 1; ci >= 0; ci--) {
          if (curY < clampTop + 10) break;
          ctx.fillText(chunks[ci], txL + 3, curY);
          curY -= lineH;
        }
      }
    }
    ctx.restore();
  }

  // Pending long note marker
  if (pendLN) {
    const y = ch - (pendLN.startTick - stT) / tpp;
    ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    if (pendLN.isWide) {
      ctx.strokeRect(padL + 1, y - 4, colW * 4 - 2, 8);
    } else {
      const li = CHL[pendLN.channel];
      ctx.strokeRect(padL + li * colW + 1, y - 4, colW - 2, 8);
    }
    ctx.setLineDash([]);
  }

  // Pending text event marker (first click indicator)
  if (pendTE) {
    const y = ch - (pendTE.startTick - stT) / tpp;
    if (y >= -10 && y <= ch + 10) {
      const isLeft = (pendTE.pos === 'left');
      const isLineN = (pendTE.pos || '').startsWith('line:');
      if (isLineN) {
        const lineNum = parseInt(pendTE.pos.split(':')[1]) - 1;
        const lx = padL + lineNum * colW;
        ctx.strokeStyle = '#4ae0ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.strokeRect(lx + 1, y - 4, colW - 2, 8);
        ctx.setLineDash([]);
      } else {
        const txW = Math.min(isLeft ? (padL - 4) : (cw - padL - gw - 4), 80);
        const txL = isLeft ? Math.max(2, padL - txW - 2) : (padL + gw + 2);
        ctx.strokeStyle = TEXT_COLOR; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(txL, y); ctx.lineTo(txL + txW, y); ctx.stroke();
        ctx.setLineDash([]);
        // Small diamond marker
        ctx.fillStyle = TEXT_COLOR;
        const cx = isLeft ? txL + txW : txL;
        ctx.beginPath(); ctx.moveTo(cx, y - 5); ctx.lineTo(cx + 5, y); ctx.lineTo(cx, y + 5); ctx.lineTo(cx - 5, y); ctx.closePath(); ctx.fill();
      }
    }
  }

  // Draw notes with overlap highlighting (solid body colors, w-y single rendering)
  const _ovm = computeNoteOverlaps();
  const {wide: wideNotes, normW, normY} = classifyNotesForZOrder(D.notes, _ovm);

  // Helper: draw a rect body segment between two ticks
  function drawBodySeg(nx_, padX_, nw_, tkFrom, tkTo, bCol) {
    const y1 = ch - (tkFrom - stT) / tpp, y2 = ch - (tkTo - stT) / tpp;
    ctx.fillStyle = bCol;
    ctx.fillRect(nx_ + padX_, Math.min(y1, y2), nw_ - padX_ * 2, Math.abs(y1 - y2));
  }

  function drawNoteOnCanvas(n, isWide, mode) {
    // mode: 'body' = body only, 'head' = head + selection only
    const ne = n.startTick + (n.duration || 0);
    if (ne < stT - TPB || n.startTick > enT + TPB) return;
    const ov = !isWide ? _ovm.get(n) : undefined;
    if (ov && ov.type === 'hidden') return;

    const {headCol, bodyCol} = resolveNoteColor(n, ov);

    let nx, nw;
    if (isWide) { nx = padL; nw = colW * 4; }
    else { nx = padL + CHL[n.channel] * colW; nw = colW; }
    const noteH = Math.max(3, 6) * (isWide ? 1 : 0.9);
    const padX = isWide ? 1 : nw * 0.05;
    const y = ch - (n.startTick - stT) / tpp;

    // Body pass (normal holds only; wide hold bodies drawn separately earlier)
    if (mode === 'body' && n.duration > 0 && !isWide) {
      for (const seg of splitBodyByOverlap(n, ov, n.startTick, ne, bodyCol)) {
        drawBodySeg(nx, padX, nw, seg.tkFrom, seg.tkTo, seg.col);
      }
    }

    // Head pass (all note types)
    if (mode === 'head') {
      const hc = headColorAtTick(headCol, ov, n.startTick);
      drawNoteHead(ctx, isWide, nx + padX, y, nw - padX * 2, noteH, hc);

      const isSel = selectedNotes.has(n);
      if (isSel) {
        ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 2;
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.shadowColor = '#4aff8a'; ctx.shadowBlur = 6;
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.shadowBlur = 0;
      }
    }
  }

  // Z-order: 2-pass rendering
  // Pass 1 — Bodies: normal white/clipped → normal yellow/merged (wide hold bodies already drawn above)
  for (const n of normW) drawNoteOnCanvas(n, false, 'body');
  for (const n of normY) drawNoteOnCanvas(n, false, 'body');
  // Pass 2 — Heads: wide (behind) → normal white/clipped → normal yellow/merged (front)
  for (const n of wideNotes) drawNoteOnCanvas(n, true, 'head');
  for (const n of normW) drawNoteOnCanvas(n, false, 'head');
  for (const n of normY) drawNoteOnCanvas(n, false, 'head');

  // Line:N indicators on grid (arrow markers above each line column)
  for (const te of D.textEvents) {
    const pos = te.pos || '';
    if (!pos.startsWith('line:')) continue;
    const teEnd = te.startTick + te.duration;
    if (teEnd < stT - TPB || te.startTick > enT + TPB) continue;
    const lineNum = parseInt(pos.split(':')[1]) - 1; // 0-3
    if (lineNum < 0 || lineNum > 3) continue;
    const yTop = ch - (teEnd - stT) / tpp;
    const yBot = ch - (te.startTick - stT) / tpp;
    if (yTop > ch + 5 || yBot < -5) continue;
    const clampTop = Math.max(yTop, 0);
    const clampBot = Math.min(yBot, ch);
    const lx = padL + lineNum * colW;
    // Tinted background strip
    ctx.fillStyle = '#4ae0ff12';
    ctx.fillRect(lx + 1, clampTop, colW - 2, clampBot - clampTop);
    // Small arrow at bottom of range (start tick)
    const arrowY = Math.min(clampBot, ch - 2);
    const arrowX = lx + colW / 2;
    const arrowH = Math.min(8, (clampBot - clampTop) * 0.3);
    const arrowW = Math.min(6, colW * 0.25);
    ctx.fillStyle = '#4ae0ff88';
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - arrowW, arrowY - arrowH);
    ctx.lineTo(arrowX + arrowW, arrowY - arrowH);
    ctx.closePath(); ctx.fill();
      // Top/bottom tick lines
      ctx.strokeStyle = '#4ae0ff44'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(lx, clampBot); ctx.lineTo(lx + colW, clampBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, clampTop); ctx.lineTo(lx + colW, clampTop); ctx.stroke();
      ctx.setLineDash([]);
      // Content label if any
      if (te.content && te.content !== '.') {
        ctx.fillStyle = '#4ae0ffcc'; ctx.font = '7px sans-serif';
        ctx.fillText(te.content.split('\n')[0].slice(0, 6), lx + 2, clampTop + 8);
      }
    }

  // Playback line
  if (edPlay.n) {
    const ms_ = getPlayMs('n');
    const tk = ms2t(ms_);
    if (nFollow) { const fixedY = ch * 0.8; nScr = tk - (ch - fixedY) * tpp; if (nScr < getMinTick()) nScr = getMinTick(); }
    const y = ch - (tk - nScr) / tpp;
    ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    ctx.fillStyle = '#ffe44a';
    ctx.beginPath(); ctx.moveTo(padL - 6, y - 4); ctx.lineTo(padL, y); ctx.lineTo(padL - 6, y + 4); ctx.fill();
  }

  // Selection count indicator
  const selCount = selectedNotes.size;
  const lnInfo = (nTool === 'n' || nTool === 'w' || nTool === 'ln' || nTool === 'wl') ? ` | LN: ${savedLNDur}t` : '';
  $('botI').textContent = `Notes: ${D.notes.length} | Shape: ${D.shapeEvents.length} | Txt: ${D.textEvents.length}${selCount > 0 ? ' | Sel: ' + selCount + ' [DEL]' : ''}${lnInfo}`;
}

// ============================================================
//  NOTES TOUCH INPUT
// ============================================================
(function() {
  let ty0, sc0, moved;
  let dragSel = false; // true if doing drag-select rectangle
  let dragX0, dragY0; // start position for drag-select (in canvas coords)
  let dragRect = null; // {x0, y0, x1, y1} in canvas coords during drag
  let dragMove = false; // true if dragging to move selected notes
  let dragMoveTk0 = 0; // start tick for drag-move
  let longPressTimer = null; // long press timer for quick-LN
  let longPressFired = false; // true if long press already placed a note

  function cancelLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function onDown(e) {
    e.preventDefault();
    ty0 = e.clientY; sc0 = nScr; moved = false;
    dragSel = false; dragRect = null; dragMove = false;
    cancelLongPress(); longPressFired = false;

    // Long press: start timer for 'n'/'w' tools to place quick-LN
    if (nTool === 'n' || nTool === 'w') {
      const evCopy = {clientX: e.clientX, clientY: e.clientY};
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (moved) return;
        // Place LN with savedLNDur
        const cv = $('nCv'), rect = cv.getBoundingClientRect();
        const x = evCopy.clientX - rect.left, y = evCopy.clientY - rect.top;
        const m = nMet(); if (!m) return;
        const rx = x - m.padL;
        if (rx < 0 || rx > m.colW * 4) return;
        const ci = Math.floor(rx / m.colW);
        const clickTk = nScr + (m.ch - y) * m.tpp;
        const snp = snap(clickTk, nGD);
        const isW = nTool === 'w';
        let ch_n = isW ? 0 : line4ToChannel(ci, isW);
        // On overlap channels, only remove a tap if at max capacity (preserve coexisting tap+hold)
        if (!isW) {
          const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
          const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
          if (atPos.length >= maxN) {
            const existTap = atPos.find(n => !n.duration);
            if (existTap) D.notes = D.notes.filter(n => n !== existTap);
            else return;
          }
          const atPos2 = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
          if (atPos2.length >= maxN) return;
          const holdCount = atPos2.filter(n => n.duration > 0).length;
          if (holdCount >= maxN) return;
        } else {
          // Wide: remove existing wide tap (only 1 wide per tick)
          const existWide = D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && !n.duration);
          if (existWide) D.notes = D.notes.filter(n => n !== existWide);
          if (D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && n.duration > 0)) return;
        }
        D.notes.push({channel: ch_n, startTick: snp, duration: savedLNDur, isWide: isW});
        longPressFired = true;
        saveHist('n'); drawN();
      }, 300);
    }

    // Check if sel tool and pointer is inside the lane area
    if (nTool === 'sel') {
      const cv = $('nCv'), rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const m = nMet(); if (m) {
        const rx = x - m.padL;
        if (rx >= 0 && rx <= m.colW * 4) {
          const clickTk = nScr + (m.ch - y) * m.tpp;
          // Check if clicking on an already-selected note (for drag-move)
          if (selectedNotes.size > 0) {
            const ci = Math.floor(rx / m.colW);
            const ch_n = line4ToChannel(ci, false);
            if (ch_n) {
              const found = findNoteAt(clickTk, ci, ch_n, m.tpp, true);
              if (found && selectedNotes.has(found)) {
                dragMove = true;
                dragMoveTk0 = snap(clickTk, nGD);
                return;
              }
            }
          }
          // Start drag-select
          dragSel = true;
          dragX0 = x;
          dragY0 = e.clientY - rect.top;
        }
      }
    }
  }
  function onMove(e) {
    if (!e.buttons) return;

    if (dragMove) {
      cancelLongPress();
      const cv = $('nCv'), rect = cv.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const m = nMet(); if (!m) return;
      const dy = e.clientY - ty0;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) {
        const curTk = snap(nScr + (m.ch - y) * m.tpp, nGD);
        const delta = curTk - dragMoveTk0;
        if (delta !== 0) {
          for (const n of selectedNotes) {
            n.startTick += delta;
            if (n.startTick < 0) n.startTick = 0;
          }
          invalidateNoteOverlaps();
          dragMoveTk0 = curTk;
          drawN();
        }
      }
      return;
    }

    if (dragSel) {
      const cv = $('nCv'), rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const dx = x - dragX0, dy = y - dragY0;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      dragRect = {x0: Math.min(dragX0, x), y0: Math.min(dragY0, y), x1: Math.max(dragX0, x), y1: Math.max(dragY0, y)};
      // Update selection in real time
      updateDragSelection();
      drawN();
      // Draw green rectangle overlay
      drawDragRect();
      return;
    }

    const dy = e.clientY - ty0;
    if (Math.abs(dy) > 4) { moved = true; cancelLongPress(); }
    const m = nMet(); if (!m) return;
    nScr = Math.max(getMinTick(), sc0 + dy * m.tpp); drawN();
  }
  function onUp(e) {
    cancelLongPress();
    if (longPressFired) { longPressFired = false; return; }
    if (dragMove && moved) { saveHist('n'); dragMove = false; drawN(); return; }
    dragMove = false;
    if (dragSel && dragRect && moved) {
      // Finalize drag selection
      updateDragSelection();
      dragSel = false; dragRect = null;
      drawN();
      return;
    }
    dragSel = false; dragRect = null;
    if (!moved) handleNTap(e);
  }

  function updateDragSelection() {
    if (!dragRect) return;
    const m = nMet(); if (!m) return;
    const {ch, colW, padL, tpp, nCols} = m;
    // Convert rectangle to tick range and channel range
    const tkTop = nScr + (ch - dragRect.y0) * tpp;
    const tkBot = nScr + (ch - dragRect.y1) * tpp;
    const tkMin = Math.min(tkTop, tkBot), tkMax = Math.max(tkTop, tkBot);
    const ciMin = Math.max(0, Math.floor((dragRect.x0 - padL) / colW));
    const ciMax = Math.min(nCols - 1, Math.floor((dragRect.x1 - padL) / colW));

    selectedNotes.clear();
    for (const n of D.notes) {
      // Long notes: only select if START tick is within range
      if (n.startTick < tkMin || n.startTick > tkMax) continue;
      // Check column overlap
      if (n.isWide) {
        // Wide spans all 4 columns — always in range if tick matches
      } else {
        const li = CHL[n.channel];
        if (li < ciMin || li > ciMax) continue;
      }
      selectedNotes.add(n);
    }
  }

  function drawDragRect() {
    if (!dragRect) return;
    const cv = $('nCv'), ctx = cv.getContext('2d');
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const {x0, y0, x1, y1} = dragRect;
    ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4aff8a18';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cv = $('nCv');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const m = nMet(); if (!m) return;
      nScr = Math.max(getMinTick(), nScr - e.deltaY * m.tpp * 0.8);
      drawN();
    }, {passive: false});
  });
})();

function findNoteAt(clickTk, ci, ch_n, tpp, selMode) {
  const tol = tpp * 15;
  let best = null, bd = 1e9;
  for (const n of D.notes) {
    let inRange = false;
    if (n.isWide) {
      // Wide spans all 4 columns
      inRange = true;
    } else {
      const li = CHL[n.channel];
      inRange = (li === ci);
    }
    if (!inRange) continue;
    let d;
    if (selMode) {
      d = Math.abs(n.startTick - clickTk);
    } else {
      const ne = n.startTick + (n.duration || 0);
      if (n.duration > 0 && clickTk >= n.startTick && clickTk <= ne) d = 0;
      else d = Math.min(Math.abs(n.startTick - clickTk), Math.abs(ne - clickTk));
    }
    if (d < tol && d < bd) { bd = d; best = n; }
  }
  return best;
}

function handleNTap(e) {
  const cv = $('nCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const m = nMet(); if (!m) return;
  const {ch, colW, padL, tpp, gw} = m;
  const rx = x - padL;
  const clickTk = nScr + (ch - y) * tpp;
  const snp = snap(clickTk, nGD);

  // Text event tool — 2-click workflow (like LN)
  if (nTool === 'txt') {
    // Check if clicking on a line column for line:N events
    if (rx >= 0 && rx < colW * 4) {
      const lineIdx = Math.floor(rx / colW); // 0-3
      const lineNum = lineIdx + 1; // 1-4
      const linePos = `line:${lineNum}`;
      // Check existing event at this tick
      const lineEvts = D.textEvents.filter(te => {
        if (te.pos !== linePos) return false;
        const st = te.startTick, en = te.startTick + te.duration;
        return clickTk >= st - TPB * 0.5 && clickTk <= en + TPB * 0.5;
      });
      if (lineEvts.length > 1) { showTePicker(lineEvts); return; }
      if (lineEvts.length === 1) { teEdit(lineEvts[0]); return; }
      // 2-click: first click = start, second = end
      if (pendTE && pendTE.pos === linePos) {
        const startTk = Math.min(pendTE.startTick, snp);
        const endTk = Math.max(pendTE.startTick, snp);
        if (endTk <= startTk) { cancelTE(); return; }
        cancelTE();
        teNewRange(startTk, endTk, linePos);
      } else {
        pendTE = {startTick: snp, pos: linePos};
        $('tePendUI').style.display = '';
        $('tePendUI').textContent = `Txt: ${linePos} start ${tickToMeasure(snp)} — click end`;
        drawN();
      }
      return;
    }
    // Sidebar click (left/right/middle)
    const gridCenter = padL + gw / 2;
    const clickSide = x < gridCenter ? 'left' : 'right';
    // Check existing event
    const found = findTextEvtAt(clickTk, tpp, clickSide);
    if (found.length > 1) { showTePicker(found); return; }
    if (found.length === 1) { teEdit(found[0]); return; }
    // 2-click: first = start, second = end
    if (pendTE && pendTE.pos === clickSide) {
      const startTk = Math.min(pendTE.startTick, snp);
      const endTk = Math.max(pendTE.startTick, snp);
      if (endTk <= startTk) { cancelTE(); return; }
      cancelTE();
      teNewRange(startTk, endTk, clickSide);
    } else {
      pendTE = {startTick: snp, pos: clickSide};
      $('tePendUI').style.display = '';
      $('tePendUI').textContent = `Txt: ${clickSide} start ${tickToMeasure(snp)} — click end`;
      drawN();
    }
    return;
  }

  if (rx < 0 || rx > colW * 4) return;
  const ci = Math.floor(rx / colW);
  let ch_n = line4ToChannel(ci, nTool === 'w' || nTool === 'wl');

  // === SEL TOOL: toggle selection on tap ===
  if (nTool === 'sel') {
    const found = findNoteAt(clickTk, ci, ch_n, tpp, true);
    if (found) {
      if (selectedNotes.has(found)) selectedNotes.delete(found);
      else selectedNotes.add(found);
    } else {
      selectedNotes.clear();
    }
    drawN();
    return;
  }

  if (nTool === 'n' || nTool === 'w') {
    const isW = nTool === 'w';
    if (isW) ch_n = 0;
    if (isW) {
      // Wide: one wide tap per tick
      if (D.notes.find(n => n.startTick === snp && n.isWide && !n.duration)) return;
    } else {
      // Normal: per-channel limit (overlap channels 2,3 allow 2 notes, others allow 1)
      const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
      const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
      if (atPos.length >= maxN) return;
      // Block exact duplicate (same duration type)
      if (atPos.some(n => !n.duration)) {
        // Already has a tap; for overlap channels allow 2nd, non-overlap block
        const tapCount = atPos.filter(n => !n.duration).length;
        if (tapCount >= maxN) return;
      }
    }
    D.notes.push({channel: ch_n, startTick: snp, duration: 0, isWide: isW}); saveHist('n'); drawN();
  } else if (nTool === 'ln' || nTool === 'wl') {
    const isW = nTool === 'wl';
    if (isW) ch_n = 0;
    if (pendLN) {
      if (pendLN.isWide !== isW || (!isW && pendLN.channel !== ch_n)) { cancelLN(); return; }
      const startTk = Math.min(pendLN.startTick, snp), endTk = Math.max(pendLN.startTick, snp);
      if (endTk <= startTk) { cancelLN(); return; }
      const dur = endTk - startTk;
      // On overlap channels, only remove a tap if at max capacity (preserve coexisting tap+hold)
      if (!isW) {
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === startTk && !n.isWide);
        if (atPos.length >= maxN) {
          const existTap = atPos.find(n => !n.duration);
          if (existTap) D.notes = D.notes.filter(n => n !== existTap);
          else { cancelLN(); return; }
        }
        const atPos2 = D.notes.filter(n => n.channel === ch_n && n.startTick === startTk && !n.isWide);
        if (atPos2.length >= maxN) { cancelLN(); return; }
      }
      D.notes.push({channel: ch_n, startTick: startTk, duration: dur, isWide: isW});
      savedLNDur = dur;
      saveHist('n'); cancelLN(); drawN();
    } else {
      if (isW) {
        if (D.notes.find(n => n.startTick === snp && n.isWide)) return;
      } else {
        // Per-channel limit for LN first click
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
        if (atPos.length >= maxN) return;
      }
      pendLN = {channel: ch_n, startTick: snp, isWide: isW}; drawN();
    }
  } else if (nTool === 'del') {
    const best = findNoteAt(clickTk, ci, ch_n, tpp);
    if (best) { D.notes = D.notes.filter(n => n !== best); selectedNotes.delete(best); saveHist('n'); drawN(); }
  }
}

// ============================================================
//  TEXT EVENT MANAGEMENT
// ============================================================
let editingTextEvt = null; // null or reference to text event being edited

function teNew(tick, defaultPos) {
  editingTextEvt = null;
  $('txtModTitle').textContent = 'New Text Event';
  $('teContent').value = '';
  $('teStart').value = tickToMeasure(tick);
  // Default end = start + 2 beats
  $('teEnd').value = tickToMeasure(tick + TPB * 2);
  $('tePos').value = defaultPos || 'middle';
  $('teTrans').value = 'fade';
  $('teMode').value = 'tutorial';
  $('teDelBtn').style.display = 'none';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

function teNewRange(startTk, endTk, pos) {
  editingTextEvt = null;
  $('txtModTitle').textContent = 'New Text Event';
  $('teContent').value = '';
  $('teStart').value = tickToMeasure(startTk);
  $('teEnd').value = tickToMeasure(endTk);
  $('tePos').value = pos || 'middle';
  $('teTrans').value = 'fade';
  $('teMode').value = 'tutorial';
  $('teDelBtn').style.display = 'none';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

function teEdit(evt) {
  editingTextEvt = evt;
  $('txtModTitle').textContent = 'Edit Text Event';
  $('teContent').value = evt.content || '';
  $('teStart').value = tickToMeasure(evt.startTick);
  $('teEnd').value = tickToMeasure(evt.startTick + evt.duration);
  $('tePos').value = evt.pos || 'middle';
  $('teTrans').value = evt.transition || 'fade';
  $('teMode').value = evt.mode || 'tutorial';
  $('teDelBtn').style.display = '';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

function teSave() {
  const content = $('teContent').value.trim();
  const pos = $('tePos').value;
  const startTk = parseMeasureInput($('teStart').value);
  const endTk = parseMeasureInput($('teEnd').value);
  if (startTk === null || endTk === null) { toast('Invalid tick format'); return; }
  if (endTk <= startTk) { toast('End must be after start'); return; }
  const evt = {
    startTick: startTk,
    duration: endTk - startTk,
    content,
    pos: $('tePos').value,
    transition: $('teTrans').value,
    mode: $('teMode').value
  };
  if (editingTextEvt) {
    const idx = D.textEvents.indexOf(editingTextEvt);
    if (idx >= 0) D.textEvents[idx] = evt;
  } else {
    D.textEvents.push(evt);
  }
  editingTextEvt = null;
  closeMod('txtMod');
  saveHist('n'); drawN(); renderTeList();
  toast('Text event saved');
}

function teDelete() {
  if (!editingTextEvt) return;
  D.textEvents = D.textEvents.filter(e => e !== editingTextEvt);
  editingTextEvt = null;
  closeMod('txtMod');
  saveHist('n'); drawN(); renderTeList();
  toast('Text event deleted');
}

function findTextEvtAt(clickTk, tpp, side) {
  const results = [];
  for (const te of D.textEvents) {
    const teIsLeft = (te.pos === 'left');
    const teIsLine = (te.pos || '').startsWith('line:');
    if (side === 'left' && !teIsLeft) continue;
    if (side === 'right' && (teIsLeft || teIsLine)) continue;
    const st = te.startTick, en = te.startTick + te.duration;
    if (clickTk >= st - TPB * 0.25 && clickTk <= en + TPB * 0.25) {
      const center = st + te.duration / 2;
      const dist = Math.abs(clickTk - center);
      results.push({te, dist});
    }
  }
  results.sort((a, b) => a.dist - b.dist);
  return results.map(r => r.te);
}

function showTePicker(list) {
  const el = $('tePickList');
  el.innerHTML = list.map((te, i) => {
    const pos = (te.pos || 'middle').replace('line:', 'L');
    const txt = (te.content || '(empty)').split('\n')[0].slice(0, 30);
    return `<div class="te-pick-item" onclick="tePickSelect(${i})">${pos}: ${txt}</div>`;
  }).join('');
  window._tePickList = list;
  showMod('tePickMod');
}

function tePickSelect(idx) {
  closeMod('tePickMod');
  const te = window._tePickList[idx];
  if (te) teEdit(te);
}

/** Parse measure input: delegates to the existing measureToTick(str) */
function parseMeasureInput(str) {
  return measureToTick(str);
}

function renderTeList() {
  const el = $('teList');
  if (!el) return;
  const sorted = [...D.textEvents].sort((a, b) => a.startTick - b.startTick);
  if (sorted.length === 0) { el.innerHTML = '<div style="font-size:9px;color:var(--tx2)">No text events</div>'; return; }
  el.innerHTML = sorted.map((te, i) => {
    const pos = (te.pos || 'middle').replace('line:', 'L');
    const mode = '📖';
    const trn = te.transition === 'fade' ? '◐' : '■';
    const txt = (te.content || '').slice(0, 25) + ((te.content || '').length > 25 ? '…' : '');
    return `<div class="te-item" onclick="teEditByIdx(${i})">
      <span style="color:${TEXT_COLOR};font-size:8px;min-width:36px">${tickToMeasure(te.startTick)}</span>
      <span class="te-txt">${mode}${trn} ${txt}</span>
      <span class="te-pos">${pos}</span>
    </div>`;
  }).join('');
}

function teEditByIdx(sortedIdx) {
  const sorted = [...D.textEvents].sort((a, b) => a.startTick - b.startTick);
  const te = sorted[sortedIdx];
  if (te) teEdit(te);
}

// ============================================================
//  SHAPE TAB
// ============================================================
/**
 * Delete the current Shape selection via saveHist snapshot. Shared by the
 * toolbar sel+del combo (setST('del')) and the Delete/Backspace keyboard
 * handler. Init events (easing === null) are kept silently — the Left/Right
 * anchor rows are not user-deletable.
 *
 * Returns true if at least one non-init event was removed.
 */
function doShapeSelectionDelete() {
  if (selectedShapeEvts.size === 0) return false;
  const count = selectedShapeEvts.size;
  const initSkipped = [...selectedShapeEvts].filter(e => e.easing === null).length;
  const actualCount = count - initSkipped;
  if (actualCount === 0) {
    toast(`Init 이벤트는 삭제할 수 없습니다`);
    return false;
  }
  D.shapeEvents = D.shapeEvents.filter(e => !selectedShapeEvts.has(e) || e.easing === null);
  selectedShapeEvts.clear();
  normalizeShapeChain(false); normalizeShapeChain(true);
  saveHist('s'); drawS();
  toast(`${actualCount}개 shape 삭제${initSkipped ? ` (Init ${initSkipped}개 유지)` : ''}`);
  return true;
}

function setST(t) {
  // Phase 3-1: Sel + Del combo on the Shape toolbar mirrors the Notes tab.
  // In sel mode with an active selection, tapping Del deletes instead of
  // switching tools.
  if (t === 'del' && sTool === 'sel' && selectedShapeEvts.size > 0) {
    doShapeSelectionDelete();
    return;
  }
  sTool = t; cancelArc();
  if (t !== 'sel') selectedShapeEvts.clear();
  document.querySelectorAll('#stb .t[data-t]').forEach(b => {
    b.classList.remove('on', 'sel-on');
    if (b.dataset.t === t) {
      b.classList.add(t === 'sel' ? 'sel-on' : 'on');
    }
  });
}
function pickEase(name) {
  $('easeS').value = name;
  $('easeRS').value = name;
  const easeNames = ['Linear','Arc','Out-Sine','In-Sine','Step'];
  easeNames.forEach(n => {
    const btn = $('easeBtn_' + n);
    if (btn) { 
      btn.classList.remove('on', 'ease-on');
      if (n === name) btn.classList.add('ease-on');
    }
  });
}
function updateEaseR() { if (sTool !== 'P') $('easeRS').value = $('easeS').value; }

// Shape selection helpers
function findShapeEvtAt(x, y, met) {
  const {gw, gh, gx, gy, tpp} = met;
  let best = null, bd = 35;
  for (let i = 0; i < D.shapeEvents.length; i++) {
    const ev = D.shapeEvents[i];
    const dotTk = ev.startTick + ev.duration;
    const ey = gy + gh - (dotTk - sScr) / tpp;
    const ex = gx + sp2f(ev.targetPos) * gw;
    const d = Math.hypot(x - ex, y - ey);
    if (d < bd) { bd = d; best = ev; }
  }
  return best;
}

function doShapeCopy() {
  if (selectedShapeEvts.size === 0) { toast('No shapes selected'); return; }
  const sel = [...selectedShapeEvts];
  const minDest = Math.min(...sel.map(e => e.startTick + e.duration));
  shapeClipboard = sel.map(e => ({
    relDestTick: (e.startTick + e.duration) - minDest,
    targetPos: e.targetPos,
    isRight: e.isRight,
    easing: e.easing,
    isStep: e.duration === 0
  }));
  toast(`Copied ${shapeClipboard.length} shape(s)`);
}

function doShapePaste(flip) {
  if (shapeClipboard.length === 0) { toast('Shape clipboard empty'); return; }
  const baseTick = snap(sScr, sGD);
  const newEvts = [];
  for (const c of shapeClipboard) {
    const destTick = baseTick + c.relDestTick;
    let pos = c.targetPos, isR = c.isRight;
    if (flip) {
      pos = 64 - pos; // mirror around internal pos 32 (external 0)
      isR = !isR;
    }
    const ne = {
      startTick: c.isStep ? destTick : 0,
      duration: c.isStep ? 0 : destTick,
      isRight: isR,
      targetPos: pos,
      easing: c.easing
    };
    D.shapeEvents.push(ne);
    newEvts.push(ne);
  }
  normalizeShapeChain(false);
  normalizeShapeChain(true);
  selectedShapeEvts.clear();
  newEvts.forEach(e => selectedShapeEvts.add(e));
  saveHist('s');
  toast(`${flip ? 'Flip-' : ''}Pasted ${newEvts.length} shape(s)`);
  drawS();
}
function sZ(d) { edZm = Math.max(0.25, Math.min(8, edZm * (d > 0 ? 1.35 : 1 / 1.35))); drawN(); drawS(); }

function sMet() {
  const cv = $('sCv'), dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch = cv.height / dpr;
  if (cw < 1 || ch < 1) return null;
  // Full vertical layout - use entire canvas height, game-width fills horizontally
  const gw = cw * 0.96;
  const gh = ch; // use full height
  const gx = (cw - gw) / 2;
  const gy = 0; // start from top
  // tpp unified with Notes tab — same zoom = same visible measure range
  const tpp = (TPB * 16) / (ch * edZm);
  return {cw, ch, gw, gh, gx, gy, tpp, dpr};
}

function drawS() {
  const cv = $('sCv'), ctx = cv.getContext('2d');
  const met = sMet(); if (!met) return;
  const {cw, ch, gw, gh, gx, gy, tpp, dpr} = met;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08080d'; ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(gx, gy, gw, gh);
  ctx.strokeStyle = '#282845'; ctx.lineWidth = 0.5; ctx.strokeRect(gx, gy, gw, gh);

  const stT = sScr, visTk = gh * tpp, enT = stT + visTk;
  const t2y = tk => gy + gh - (tk - stT) / tpp;
  const p2x = p => gx + sp2f(p) * gw;

  // 4.9: frame-scoped {sh, lines} cache (same pattern as drawGameFrame)
  const _tkInfo = new Map();
  const getTkInfo = (tk) => {
    let info = _tkInfo.get(tk);
    if (!info) { info = {sh: getShape(tk), lines: getLines(tk)}; _tkInfo.set(tk, info); }
    return info;
  };

  // Horizontal grid subdivisions
  const tpd = TPB / sGD;
  const f_ = Math.floor(stT / tpd) * tpd;
  for (let tk = f_; tk <= enT; tk += tpd) {
    const y = t2y(tk);
    if (y < gy - 1 || y > gy + gh + 1) continue;
    if (tk % TPB !== 0) {
      ctx.strokeStyle = '#181828'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }
  }

  // Beat/measure lines
  const gLines = getGridLines(stT - TPB, enT + TPB);
  for (const gl of gLines) {
    const y = t2y(gl.tick);
    if (y < gy - 1 || y > gy + gh + 1) continue;
    ctx.strokeStyle = gl.isMeasure ? '#444' : '#2a2a3a';
    ctx.lineWidth = gl.isMeasure ? 1 : 0.3;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    if (gl.isMeasure) {
      ctx.fillStyle = gl.measureNum <= 0 ? '#a855f7' : '#666';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText(gl.measureNum <= 0 ? `m${gl.measureNum}` : gl.measureNum, gx + 3, y - 3);
    } else {
      ctx.fillStyle = '#444'; ctx.font = '7px sans-serif';
      ctx.fillText(gl.beatInMeasure, gx + 3, y - 2);
    }
  }

  // Tick 0 boundary in Shape tab
  {
    const y0 = t2y(0);
    if (y0 >= gy - 5 && y0 <= gy + gh + 5) {
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx + gw, y0); ctx.stroke();
    }
  }

  // Vertical position grid lines
  for (let p = 0; p <= 64; p++) {
    const x = p2x(p);
    const isInt = p % 4 === 0;
    const isHalf = p % 2 === 0;
    const isMajor = (p === 24 || p === 28 || p === 32 || p === 36 || p === 40);
    if (isMajor) {
      ctx.strokeStyle = p === 32 ? '#555' : '#3a3a50';
      ctx.lineWidth = p === 32 ? 1.2 : 0.8;
    } else if (isInt) {
      ctx.strokeStyle = '#2a2a40'; ctx.lineWidth = 0.5;
    } else if (isHalf && sPosSnapLevel >= 1) {
      ctx.strokeStyle = '#1e1e34'; ctx.lineWidth = 0.3;
    } else if (sPosSnapLevel >= 2) {
      ctx.strokeStyle = '#161624'; ctx.lineWidth = 0.2;
    } else { continue; }
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke();
  }

  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();

  // Shape boundary curves (step-aware for 90-degree corners)
  const evtDensity = countShapeEventsInRange(stT - 1, enT + 1);
  const steps = Math.min(500, Math.max(80, Math.floor(visTk / TPB * 20), evtDensity * 8));
  // Use a t2y adapter for buildShapePointArrays (it takes tk2y with (tk)=>y)
  const {lP: lPts, rP: rPts, stepTicks: sStepTicks} = buildShapePointArrays(
    stT - 1, enT + 1, steps,
    tk => t2y(tk), p2x
  );

  // Fill between boundaries
  ctx.fillStyle = '#12121266';
  ctx.beginPath();
  lPts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  for (let i = rPts.length - 1; i >= 0; i--) ctx.lineTo(rPts[i].x, rPts[i].y);
  ctx.closePath(); ctx.fill();

  // Left boundary line
  ctx.strokeStyle = '#6bb5ff'; ctx.lineWidth = 2;
  ctx.beginPath();
  lPts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();

  // Right boundary line
  ctx.strokeStyle = '#ff6b8a'; ctx.lineWidth = 2;
  ctx.beginPath();
  rPts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();

  // Step horizontal connectors in editor view
  for (const stk of sStepTicks) {
    const y = t2y(stk);
    if (y < gy - 2 || y > gy + gh + 2) continue;
    const shB = getShape(stk - 0.0001), shA = getShape(stk + 0.0001);
    const pls = shB.left, prs = shB.right, cls = shA.left, crs = shA.right;
    if (Math.abs(pls - cls) > 0.01) {
      ctx.strokeStyle = '#6bb5ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p2x(pls), y); ctx.lineTo(p2x(cls), y); ctx.stroke();
    }
    if (Math.abs(prs - crs) > 0.01) {
      ctx.strokeStyle = '#ff6b8a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p2x(prs), y); ctx.lineTo(p2x(crs), y); ctx.stroke();
    }
    if (prs < cls - 0.1 || crs < pls - 0.1) {
      const x1 = prs < cls - 0.1 ? p2x(prs) : p2x(crs);
      const x2 = prs < cls - 0.1 ? p2x(cls) : p2x(pls);
      ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1.2; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Wide note LN bodies (drawn behind line dividers)
  for (const wn of D.notes.filter(n => n.isWide && n.duration > 0)) {
    const wst = wn.startTick, wet = wst + wn.duration;
    if (wet < stT - TPB || wst > enT + TPB) continue;
    const wGNX = (tk) => { const sh = getTkInfo(tk).sh; return {x: p2x(sh.left), w: p2x(sh.right) - p2x(sh.left)}; };
    const wEvtCnt = countShapeEventsInRange(wst, wet);
    const wSteps = Math.min(120, Math.max(16, wEvtCnt * 6));
    const wStepTks = getStepTicks(wst, wet), wEvtTks = getShapeEventTicks(wst, wet);
    const wSeg = []; for (let s = 0; s <= wSteps; s++) wSeg.push(wst + (wet - wst) * s / wSteps);
    for (const stk of wStepTks) { if (stk > wst && stk < wet) { wSeg.push(stk - 0.0001); wSeg.push(stk + 0.0001); } }
    for (const etk of wEvtTks) { if (etk > wst && etk < wet) wSeg.push(etk); }
    wSeg.sort((a, b) => a - b);
    const wdd = []; let wpt = -Infinity;
    for (const tk of wSeg) { if (tk - wpt > 0.00005) { wdd.push(tk); wpt = tk; } }
    if (wdd.length < 2) continue;
    ctx.fillStyle = WIDE_BODY; ctx.beginPath();
    for (let s = 0; s < wdd.length; s++) { const tk = wdd[s]; const y = t2y(tk); const p = wGNX(tk); if (s === 0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y); }
    for (let s = wdd.length - 1; s >= 0; s--) { const tk = wdd[s]; const y = t2y(tk); const p = wGNX(tk); ctx.lineTo(p.x + p.w, y); }
    ctx.closePath(); ctx.fill();
  }

  // Line dividers (3 inner lines) - step-aware using lPts ticks
  for (let ln = 0; ln < 3; ln++) {
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let fi = true;
    for (const pt of lPts) {
      const tk = pt.tk;
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let cum = 0;
      for (let k = 0; k <= ln; k++) cum += lines[k] / 100;
      const dx = lx + cum * sw;
      if (fi) { ctx.moveTo(dx, pt.y); fi = false; } else ctx.lineTo(dx, pt.y);
    }
    ctx.stroke();
  }

  // Notes in shape view — 2-pass rendering (bodies first, heads on top)
  // Wide heads drawn behind normal heads (matching Notes/Preview/Play)
  const _sovM = computeNoteOverlaps();
  const {wide: svWide, normW: svNormW, normY: svNormY} = classifyNotesForZOrder(D.notes, _sovM);

  // Helper: get note position at tick
  function svGNX(n, li, tk, isEnd) {
    const evalTk = isEnd && isStepTick(tk) ? tk - 0.0001 : tk;
    const info = getTkInfo(evalTk); const sh = info.sh, lines = info.lines;
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    if (n.isWide) return {x: lx, w: sw};
    let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100;
    return {x: lx + cum * sw, w: (lines[li] / 100) * sw};
  }
  function svBuildLNTicks(st, et) {
    const lnEvtCnt = countShapeEventsInRange(st, et);
    const lnSteps = Math.min(120, Math.max(16, lnEvtCnt * 6));
    const lnStepTks = getStepTicks(st, et);
    const lnEvtTks = getShapeEventTicks(st, et);
    const segTks = [];
    for (let s = 0; s <= lnSteps; s++) segTks.push(st + (et - st) * s / lnSteps);
    for (const stk of lnStepTks) { if (stk > st && stk < et) { segTks.push(stk - 0.0001); segTks.push(stk + 0.0001); } }
    for (const etk of lnEvtTks) { if (etk > st && etk < et) segTks.push(etk); }
    segTks.sort((a, b) => a - b);
    const dd = []; let pt = -Infinity;
    for (const tk of segTks) { if (tk - pt > 0.00005) { dd.push(tk); pt = tk; } }
    return dd;
  }
  function svDrawBodyPoly(n, li, st, et, bCol) {
    const dd = svBuildLNTicks(st, et);
    if (dd.length < 2) return;
    ctx.fillStyle = bCol; ctx.beginPath();
    for (let s = 0; s < dd.length; s++) {
      const tk = dd[s]; const y = t2y(tk); const p = svGNX(n, li, tk);
      const pd = n.isWide ? 0 : p.w * 0.05;
      if (s === 0) ctx.moveTo(p.x + pd, y); else ctx.lineTo(p.x + pd, y);
    }
    for (let s = dd.length - 1; s >= 0; s--) {
      const tk = dd[s]; const y = t2y(tk); const p = svGNX(n, li, tk);
      const pd = n.isWide ? 0 : p.w * 0.05;
      ctx.lineTo(p.x + p.w - pd, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // Pass 1 — Bodies: normal white/clipped → normal yellow/merged (wide LN bodies already drawn above)
  for (const n of [...svNormW, ...svNormY]) {
    const ne = n.startTick + (n.duration || 0); if (ne < stT - TPB || n.startTick > enT + TPB) continue;
    const ov = _sovM.get(n);
    if (ov && ov.type === 'hidden') continue;
    const li = CHL[n.channel];
    const {bodyCol} = resolveNoteColor(n, ov);
    if (n.duration > 0) {
      for (const seg of splitBodyByOverlap(n, ov, n.startTick, ne, bodyCol)) {
        svDrawBodyPoly(n, li, seg.tkFrom, seg.tkTo, seg.col);
      }
    }
  }

  // Pass 2 — Heads: wide (behind) → normal white/clipped → normal yellow/merged (front)
  for (const n of [...svWide, ...svNormW, ...svNormY]) {
    const ne = n.startTick + (n.duration || 0); if (ne < stT - TPB || n.startTick > enT + TPB) continue;
    const ov = !n.isWide ? _sovM.get(n) : undefined;
    if (ov && ov.type === 'hidden') continue;
    const li = n.isWide ? 0 : CHL[n.channel];
    const {headCol} = resolveNoteColor(n, ov);

    // Head for LN (at startTick) and Tap note head share identical logic —
    // both fall through to the same primitive call.
    const y = t2y(n.startTick); const p = svGNX(n, li, n.startTick);
    if (y >= gy - 10 && y <= gy + gh + 10) {
      const hc = headColorAtTick(headCol, ov, n.startTick);
      const th = nThk * (n.isWide ? 1 : .9);
      const pd = n.isWide ? 0 : p.w * 0.05;
      drawNoteHead(ctx, n.isWide, p.x + pd, y, p.w - pd * 2, th, hc, 2);
    }
    // Wide note step-tick bridge
    if (n.isWide && isStepTick(n.startTick)) {
      const y2 = t2y(n.startTick);
      if (y2 >= gy - 10 && y2 <= gy + gh + 10) {
        const stk = n.startTick;
        const shB = getShape(stk - 0.0001), shA = getShape(stk + 0.0001);
        const pls = shB.left, prs = shB.right, cls = shA.left, crs = shA.right;
        const hc = WIDE_COLOR;
        if (prs < cls - 0.1) {
          ctx.strokeStyle = hc; ctx.lineWidth = nThk * 0.9;
          ctx.beginPath(); ctx.moveTo(p2x(prs), y2); ctx.lineTo(p2x(cls), y2); ctx.stroke();
        } else if (crs < pls - 0.1) {
          ctx.strokeStyle = hc; ctx.lineWidth = nThk * 0.9;
          ctx.beginPath(); ctx.moveTo(p2x(crs), y2); ctx.lineTo(p2x(pls), y2); ctx.stroke();
        }
      }
    }
  }

  // Shape event dots
  const dotTickMap = new Map(); // tick -> {L: [evtIdx], R: [evtIdx]}
  for (let i = 0; i < D.shapeEvents.length; i++) {
    const e = D.shapeEvents[i];
    const dotTk = e.startTick + e.duration;
    if (!dotTickMap.has(dotTk)) dotTickMap.set(dotTk, {L:[], R:[]});
    const entry = dotTickMap.get(dotTk);
    if (e.isRight) entry.R.push(i); else entry.L.push(i);
  }

  // Draw individual dots + duration lines
  for (const e of D.shapeEvents) {
    const dotTk = e.startTick + e.duration;
    if (dotTk < stT - TPB || dotTk > enT + TPB) continue;
    const y = t2y(dotTk);
    const x = p2x(e.targetPos);
    if (y < gy - 6 || y > gy + gh + 6) continue;

    const c = e.isRight ? '#ff6b8a' : '#6bb5ff';
    const isSel = selectedShapeEvts.has(e);
    const r = isSel ? 6 : 4;

    // Dot
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isSel ? '#4aff8a' : '#fff';
    ctx.lineWidth = isSel ? 2 : 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();

    // Selection glow
    if (isSel) {
      ctx.shadowColor = '#4aff8a'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Label
    const lbl = e.easing === null ? 'Init' : e.duration === 0 ? 'Step' : e.easing.substring(0, 3);
    ctx.fillStyle = '#aaa'; ctx.font = '6px sans-serif';
    ctx.fillText(lbl + ' ' + posToExtStr(e.targetPos), x + 6, y + 2);

    // Duration line (dashed)
    if (e.duration > 0) {
      const yS = t2y(e.startTick);
      ctx.strokeStyle = c + '55'; ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yS); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Draw center dots (green) and pinch stars (white) at ticks with L or R events
  for (const [tk, pair] of dotTickMap) {
    if (tk < stT - TPB || tk > enT + TPB) continue;
    const y = t2y(tk); if (y < gy - 6 || y > gy + gh + 6) continue;
    const sh_ = getShape(tk);
    const lVal = sh_.left, rVal = sh_.right;
    const cPos = (lVal + rVal) / 2;
    const cx = p2x(cPos);

    // Check if this is a pinch (L and R at same tick with same pos)
    let isPinch = false;
    if (pair.L.length > 0 && pair.R.length > 0) {
      const eL = D.shapeEvents[pair.L[pair.L.length-1]], eR = D.shapeEvents[pair.R[pair.R.length-1]];
      if (eL.easing !== null && eR.easing !== null && Math.abs(eL.targetPos - eR.targetPos) < 0.5) {
        isPinch = true;
        // Draw white star for pinch
        const px = p2x(eL.targetPos);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        const r = 5, spikes = 5;
        ctx.beginPath();
        for (let s = 0; s < spikes * 2; s++) {
          const ang = -Math.PI/2 + (s * Math.PI / spikes);
          const rad = s % 2 === 0 ? r : r * 0.4;
          const sx = px + Math.cos(ang) * rad, sy = y + Math.sin(ang) * rad;
          if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#aaa'; ctx.font = '6px sans-serif';
        ctx.fillText('P', px + 7, y - 3);
      }
    }

    // Draw center dot (green circle) if any event exists at this tick
    if (pair.L.length > 0 || pair.R.length > 0) {
      ctx.fillStyle = '#4aff8a'; ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4aff8a88'; ctx.font = '5px sans-serif';
      ctx.fillText('C' + posToExtStr(cPos), cx + 6, y + 8);
    }
  }

  ctx.restore();

  // Arc pending marker (drawn outside clip)
  if (pendArc) {
    const y = t2y(pendArc.tick); const x = p2x(pendArc.pos);
    if (y >= gy - 10 && y <= gy + gh + 10) {
      ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffe44a'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('Arc', x + 10, y + 3);
    }
  }

  // Playback position line
  if (edPlay.s) {
    const ms_ = getPlayMs('s');
    const tk = ms2t(ms_);
    if (sFollow) { sScr = tk - gh * 0.2 * tpp; if (sScr < getMinTick()) sScr = getMinTick(); }
    const y = t2y(tk);
    if (y >= gy && y <= gy + gh) {
      ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }
  }

  // Mirror mode center axis (shows shape center at mid-screen tick)
  if (sMirror) {
    const midTk = sScr + visTk / 2;
    const sh = getShape(midTk);
    const shapeCenter = (sh.left + sh.right) / 2;
    const cx = p2x(shapeCenter);
    ctx.strokeStyle = '#aaff4a44'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + gh); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#aaff4a88'; ctx.font = '7px sans-serif'; ctx.fillText('MIRROR', cx - 14, gy + 10);
  }
}

// Shape touch
(function() {
  let ty0, sc0, moved, tx0;
  let dragDot = null;
  let dragX0 = 0;
  // Sel mode state
  let dragSel = false, dragSelX0 = 0, dragSelY0 = 0, dragSelRect = null;
  let dragMoveSel = false, dragMoveDestTk0 = 0, dragMovePos0 = 0;

  function findDotAt(x, y, met) {
    const {gw, gh, gx, gy, tpp} = met;
    let best = null, bd = 35;

    const dotTicks = new Map();
    for (let i = 0; i < D.shapeEvents.length; i++) {
      const e = D.shapeEvents[i];
      const dotTk = e.startTick + e.duration;
      if (!dotTicks.has(dotTk)) dotTicks.set(dotTk, {});
      const entry = dotTicks.get(dotTk);
      if (e.isRight) entry.R = i; else entry.L = i;
    }
    for (const [tk, pair] of dotTicks) {
      if (pair.L === undefined && pair.R === undefined) continue;
      const ey = gy + gh - (tk - sScr) / tpp;
      if (pair.L !== undefined && pair.R !== undefined) {
        const eL = D.shapeEvents[pair.L], eR = D.shapeEvents[pair.R];
        if (Math.abs(eL.targetPos - eR.targetPos) < 0.5 && eL.easing !== null && eR.easing !== null) {
          const px = gx + sp2f(eL.targetPos) * gw;
          const d = Math.hypot(x - px, y - ey);
          if (d < bd) { bd = d; best = {type:'pinch', tickEvts: pair, tick: tk}; }
        }
        const lVal = getShape(tk).left;
        const rVal = getShape(tk).right;
        const cPos = (lVal + rVal) / 2;
        const cx = gx + sp2f(cPos) * gw;
        const dc = Math.hypot(x - cx, y - ey);
        if (dc < bd) { bd = dc; best = {type:'center', tick: tk, pair}; }
      }
      if ((pair.L !== undefined) !== (pair.R !== undefined)) {
        const lVal = getShape(tk).left;
        const rVal = getShape(tk).right;
        const cPos = (lVal + rVal) / 2;
        const cx = gx + sp2f(cPos) * gw;
        const dc = Math.hypot(x - cx, y - ey);
        if (dc < bd) { bd = dc; best = {type:'center', tick: tk, pair}; }
      }
    }

    for (let i = 0; i < D.shapeEvents.length; i++) {
      const ev = D.shapeEvents[i];
      const dotTk = ev.startTick + ev.duration;
      const ey = gy + gh - (dotTk - sScr) / tpp;
      const ex = gx + sp2f(ev.targetPos) * gw;
      const d = Math.hypot(x - ex, y - ey);
      if (d < bd) {
        bd = d;
        best = ev.easing === null ? {type:'init', evtIdx: i} : {type:'dot', evtIdx: i};
      }
    }
    return best;
  }

  function onDown(e) {
    e.preventDefault(); ty0 = e.clientY; tx0 = e.clientX; sc0 = sScr; moved = false;
    dragDot = null; dragSel = false; dragSelRect = null; dragMoveSel = false;
    const cv = $('sCv'), rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const met = sMet(); if (!met) return;
    const {gx, gy, gw, gh, tpp} = met;

    if (sTool === 'sel') {
      if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) {
        // Check if clicking on a selected dot (for drag move)
        if (selectedShapeEvts.size > 0) {
          const found = findShapeEvtAt(x, y, met);
          if (found && selectedShapeEvts.has(found)) {
            dragMoveSel = true;
            const clickTk = sScr + (gy + gh - y) * tpp;
            dragMoveDestTk0 = snap(clickTk, sGD);
            dragMovePos0 = snapPos(((x - gx) / gw) * 64);
            return;
          }
        }
        // Start box select
        dragSel = true; dragSelX0 = x; dragSelY0 = y;
      }
      return;
    }

    if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) {
      const hit = findDotAt(x, y, met);
      if (hit) { dragDot = hit; dragX0 = x; }
    }
  }
  function onMove(e) {
    if (!e.buttons) return;
    const cv = $('sCv'), rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (dragMoveSel) {
      const met = sMet(); if (!met) return;
      const {gx, gy, gw, gh, tpp} = met;
      const dx = e.clientX - tx0, dy = e.clientY - ty0;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (moved) {
        const curTk = snap(sScr + (gy + gh - y) * tpp, sGD);
        const curPos = snapPos(((x - gx) / gw) * 64);
        const deltaTk = curTk - dragMoveDestTk0;
        const deltaPos = curPos - dragMovePos0;
        if (deltaTk !== 0 || deltaPos !== 0) {
          for (const ev of selectedShapeEvts) {
            // Move destTick
            const oldDest = ev.startTick + ev.duration;
            const newDest = Math.max(0, oldDest + deltaTk);
            if (ev.duration === 0) { ev.startTick = newDest; }
            else { ev.startTick = 0; ev.duration = newDest; }
            // Move position
            ev.targetPos = Math.max(0, Math.min(64, ev.targetPos + deltaPos));
          }
          normalizeShapeChain(false); normalizeShapeChain(true);
          dragMoveDestTk0 = curTk;
          dragMovePos0 = curPos;
          drawS();
        }
      }
      return;
    }

    if (dragSel) {
      const dx = x - dragSelX0, dy = y - dragSelY0;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      dragSelRect = {x0: Math.min(dragSelX0, x), y0: Math.min(dragSelY0, y), x1: Math.max(dragSelX0, x), y1: Math.max(dragSelY0, y)};
      updateShapeDragSelection();
      drawS();
      drawShapeDragRect();
      return;
    }

    if (dragDot) {
      const met = sMet(); if (!met) return;
      const {gx, gw} = met;
      const dx = x - dragX0;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) {
        const posX = ((x - gx) / gw) * 64;
        const snpPos = snapPos(posX);
        if (dragDot.type === 'dot' || dragDot.type === 'init') {
          D.shapeEvents[dragDot.evtIdx].targetPos = snpPos;
        } else if (dragDot.type === 'center') {
          const sh_ = getShape(dragDot.tick);
          const lVal = sh_.left, rVal = sh_.right;
          const halfW = (rVal - lVal) / 2;
          const newL = snapPos(Math.max(0, Math.min(64, snpPos - halfW)));
          const newR = snapPos(Math.max(0, Math.min(64, snpPos + halfW)));
          if (dragDot.pair.L !== undefined) D.shapeEvents[dragDot.pair.L].targetPos = newL;
          if (dragDot.pair.R !== undefined) D.shapeEvents[dragDot.pair.R].targetPos = newR;
        } else if (dragDot.type === 'pinch') {
          if (dragDot.tickEvts.L !== undefined) D.shapeEvents[dragDot.tickEvts.L].targetPos = snpPos;
          if (dragDot.tickEvts.R !== undefined) D.shapeEvents[dragDot.tickEvts.R].targetPos = snpPos;
        }
        invalidateShapeCache();
        drawS();
      }
      return;
    }
    const dy = e.clientY - ty0;
    if (Math.abs(dy) > 4) moved = true;
    const met = sMet(); if (!met) return;
    sScr = Math.max(getMinTick(), sc0 + dy * met.tpp);
    drawS();
  }
  function onUp(e) {
    if (dragMoveSel && moved) {
      normalizeShapeChain(false); normalizeShapeChain(true);
      saveHist('s'); drawS(); dragMoveSel = false; return;
    }
    dragMoveSel = false;
    if (dragSel && dragSelRect && moved) {
      updateShapeDragSelection();
      dragSel = false; dragSelRect = null; drawS(); return;
    }
    dragSel = false; dragSelRect = null;
    if (dragDot && moved) { saveHist('s'); drawS(); dragDot = null; return; }
    dragDot = null;
    if (!moved) handleSTap(e);
  }

  function updateShapeDragSelection() {
    if (!dragSelRect) return;
    const met = sMet(); if (!met) return;
    const {gw, gh, gx, gy, tpp} = met;
    const tkTop = sScr + (gy + gh - dragSelRect.y0) * tpp;
    const tkBot = sScr + (gy + gh - dragSelRect.y1) * tpp;
    const tkMin = Math.min(tkTop, tkBot), tkMax = Math.max(tkTop, tkBot);
    const posMin = ((dragSelRect.x0 - gx) / gw) * 64;
    const posMax = ((dragSelRect.x1 - gx) / gw) * 64;
    selectedShapeEvts.clear();
    for (const e of D.shapeEvents) {
      const dest = e.startTick + e.duration;
      if (dest < tkMin || dest > tkMax) continue;
      if (e.targetPos < posMin || e.targetPos > posMax) continue;
      selectedShapeEvts.add(e);
    }
  }

  function drawShapeDragRect() {
    if (!dragSelRect) return;
    const cv = $('sCv'), ctx = cv.getContext('2d');
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const {x0, y0, x1, y1} = dragSelRect;
    ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4aff8a18';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cv = $('sCv');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const met = sMet(); if (!met) return;
      sScr = Math.max(getMinTick(), sScr - e.deltaY * met.tpp * 0.8);
      drawS();
    }, {passive: false});
  });
})();

function handleSTap(e) {
  const cv = $('sCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const met = sMet(); if (!met) return;
  const {gw, gh, gx, gy, tpp} = met;
  if (x < gx || x > gx + gw || y < gy || y > gy + gh) return;
  const clickTk = sScr + (gy + gh - y) * tpp;
  const snp = snap(clickTk, sGD);
  const posX = ((x - gx) / gw) * 64;
  const snpPos = snapPos(posX);

  // === SEL TOOL ===
  if (sTool === 'sel') {
    const found = findShapeEvtAt(x, y, met);
    if (found) {
      if (selectedShapeEvts.has(found)) selectedShapeEvts.delete(found);
      else selectedShapeEvts.add(found);
    } else {
      selectedShapeEvts.clear();
    }
    drawS();
    return;
  }

  if (sTool === 'del') {
    cancelArc();
    let best = -1, bd = 1e9;
    for (let i = 0; i < D.shapeEvents.length; i++) {
      const ev = D.shapeEvents[i];
      const dotTk = ev.startTick + ev.duration;
      const ey = gy + gh - (dotTk - sScr) / tpp;
      const ex = gx + sp2f(ev.targetPos) * gw;
      const d = Math.hypot(x - ex, y - ey);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < 35) {
      const ev = D.shapeEvents[best];
      if (ev.easing === null) {
        const curExt = posToExtStr(ev.targetPos);
        const val = prompt(`Move init ${ev.isRight ? 'R' : 'L'} position (-8~8):`, curExt);
        if (val !== null && !isNaN(+val)) {
          const newPos = Math.max(0, Math.min(64, Math.round((+val + 8) * 4)));
          ev.targetPos = newPos;
          saveHist('s'); drawS();
          toast(`Init ${ev.isRight ? 'R' : 'L'} → ${posToExtStr(newPos)}`);
        }
        return;
      }
      selectedShapeEvts.delete(ev);
      D.shapeEvents.splice(best, 1);
      normalizeShapeChain(false); normalizeShapeChain(true);
      saveHist('s'); drawS(); toast('Shape event deleted');
    }
    return;
  }
  if (sTool === 'L' || sTool === 'R' || sTool === 'C' || sTool === 'P') {
    const easing = $('easeS').value; const isR = sTool === 'R';

    const shBefore = getShape(snp);
    const shapeCenterBefore = (shBefore.left + shBefore.right) / 2;

    // Arc auto-cycle mode: automatically alternate Out-Sine / In-Sine
    if (easing === 'Arc' && sTool !== 'C' && sTool !== 'P') {
      cancelArc();
      const autoEasing = resolveArcEasing(isR, snp);
      addShapeEvt(snp, snpPos, isR, autoEasing);
      if (sMirror) {
        const mirPos = snapPos(Math.max(0, Math.min(64, 2 * shapeCenterBefore - snpPos)));
        addShapeEvt(snp, mirPos, !isR, autoEasing);
      }
      saveHist('s'); drawS();
      toast(`Arc: ${autoEasing === 'Out-Sine' ? 'OutS' : 'InS'}`);
      return;
    }

    cancelArc();
    if (sTool === 'P') {
      let easingL = $('easeS').value;
      let easingR = $('easeRS').value;
      // Arc mode: auto-cycle for pinch too
      if (easingL === 'Arc') easingL = resolveArcEasing(false, snp);
      if (easingR === 'Arc') easingR = resolveArcEasing(true, snp);
      let pinchPos = snpPos;
      if (easingL === 'Step' && easingR === 'Step') {
        pinchPos = snapPos((shBefore.left + shBefore.right) / 2);
      }
      addShapeEvt(snp, pinchPos, false, easingL);
      addShapeEvt(snp, pinchPos, true, easingR);
    } else if (sTool === 'C') {
      let cEasing = easing;
      // Arc mode: auto-cycle for center too (based on Left side's previous easing)
      if (easing === 'Arc') {
        cEasing = resolveArcEasing(false, snp);
        toast(`Arc: ${cEasing === 'Out-Sine' ? 'OutS' : 'InS'}`);
      }
      const curWidth = shBefore.right - shBefore.left;
      const halfW = curWidth / 2;
      // Snap center, then derive L and R to preserve exact width
      const center = snpPos;
      const rawL = center - halfW;
      const rawR = center + halfW;
      // Clamp but preserve width relationship
      const newL = Math.max(0, Math.min(64 - curWidth, Math.round(rawL / sPosSnapVals[sPosSnapLevel]) * sPosSnapVals[sPosSnapLevel]));
      const newR = Math.round(Math.max(curWidth, Math.min(64, newL + curWidth)));
      addShapeEvt(snp, newL, false, cEasing);
      addShapeEvt(snp, newR, true, cEasing);
    } else {
      addShapeEvt(snp, snpPos, isR, easing);
      if (sMirror) {
        const mirPos = snapPos(Math.max(0, Math.min(64, 2 * shapeCenterBefore - snpPos)));
        addShapeEvt(snp, mirPos, !isR, easing);
      }
    }
    saveHist('s'); drawS();
  }
  if (sTool === 'line') {
    cancelArc();
    const cur = getLines(snp).map(v => Math.round(v));
    const r = prompt('Line ratios (4 nums, sum=100):', cur.join(','));
    if (r) {
      const a = r.split(',').map(Number);
      if (a.length === 4 && a.every(v => !isNaN(v))) {
        D.lineEvents.push({startTick: snp, duration: 0, lines: a});
        invalidateLinesCache();
        saveHist('s');
      }
      drawS();
    }
  }
}

// ============================================================
//  EDITOR PLAYBACK
// ============================================================
function toggleEdPlay(w) {
  if (edPlay[w]) { stopEdPlay(w); return; }
  initAud();
  edPlay[w] = true;
  edHitSet[w] = new Set();
  edLastBeat[w] = -1;
  const scr = w === 'n' ? nScr : sScr;
  edMs0[w] = t2ms(scr);
  edT0[w] = performance.now();
  // Start audio with offset: audio position = chartMs + chartOffset - globalOffset
  const audioStartMs = edMs0[w] + D.metadata.offset - globalOffset;
  startAud(audioStartMs);
  $(w === 'n' ? 'nPlayBtn' : 'sPlayBtn').textContent = '⏸';

  function frame() {
    if (!edPlay[w]) return;
    const ms_ = getPlayMs(w);
    // Metronome
    if (isMetronomeOn) {
      const curTk = ms2t(ms_);
      const curBeat = Math.floor(curTk / TPB);
      if (curBeat > edLastBeat[w]) {
        edLastBeat[w] = curBeat;
        const ts = getTimeSig(curTk);
        playMetronome(curBeat % ts.numerator === 0);
      }
    }
    // Hitsound
    for (const n of D.notes) {
      if (!edHitSet[w].has(n) && t2ms(n.startTick) <= ms_) { edHitSet[w].add(n); playHit(); }
    }
    if (w === 'n') drawN(); else drawS();
    const frac = ms_ / totalMs;
    $(w === 'n' ? 'nSeek' : 'sSeek').value = frac * 1000;
    $(w === 'n' ? 'nTime' : 'sTime').textContent = fmtMs(ms_);
    edRAF[w] = requestAnimationFrame(frame);
  }
  edRAF[w] = requestAnimationFrame(frame);
}

function stopEdPlay(w) {
  edPlay[w] = false; stopAud();
  if (edRAF[w]) { cancelAnimationFrame(edRAF[w]); edRAF[w] = null; }
  $(w === 'n' ? 'nPlayBtn' : 'sPlayBtn').textContent = '▶';
  if (w === 'n') drawN(); else drawS();
}

function edSeek(w, v) {
  const was = edPlay[w]; if (was) stopEdPlay(w);
  const ms_ = (v / 1000) * totalMs;
  const tk = ms2t(ms_);
  if (w === 'n') { nScr = tk; drawN(); } else { sScr = tk; drawS(); }
  $(w === 'n' ? 'nTime' : 'sTime').textContent = fmtMs(ms_);
  if (was) toggleEdPlay(w);
}

// ============================================================
//  PLAY TAB — inline controls (play / restart / seek)
// ============================================================
// The Play tab has a single control bar with play/pause, restart,
// a seek slider, time display, and an autoplay toggle. All four
// combinations (autoplay on/off × play/restart) enter fullscreen.
//
// "Play (여기서부터)" = start from current seek position
// "Restart (처음부터)" = start from -LEAD_IN_MS
// Autoplay OFF = live key-input judgment (default play behavior)
// Autoplay ON  = auto-SYNC judgment, hitsounds pre-scheduled

function playToggle() {
  if (playActive) { stopPlay(); return; }
  startPlay(false, playAutoplay);
}

function playRestart() {
  if (playActive) stopPlay();
  startPlay(true, playAutoplay);
}

function playSeekTo(v) {
  if (playActive) return; // ignore during session
  sharedMs = (v / 1000) * totalMs;
  $('playTime').textContent = fmtMs(sharedMs);
  drawPlayIdle();
}

// ============================================================
//  SHARED GAME RENDERER
// ============================================================
// opts = { hitEffects, hitMap (null=auto), missSet, showMissColor }
function drawGameFrame(ctx, gx, gy, gw, gh, curMs, opts) {
  const curTk = ms2t(curMs);
  const visMs = 2000 / pvSpd; const jY = gy + gh * (8 / 9);
  const topMs = curMs + visMs, botMs = curMs - visMs * 0.15;
  const p2x = p => gx + sp2f(p) * gw;
  const tk2y = tk => { const ms_ = t2ms(tk); return jY - ((ms_ - curMs) / visMs) * (jY - gy); };

  // 4.9: frame-scoped {sh, lines} cache — same tk gets hit across body/head passes
  // and forward/reverse polygon loops. getShape/getLines are already cached globally,
  // but a frame-local Map avoids repeated cache lookups and object destructuring.
  const _tkInfo = new Map();
  const getTkInfo = (tk) => {
    let info = _tkInfo.get(tk);
    if (!info) { info = {sh: getShape(tk), lines: getLines(tk)}; _tkInfo.set(tk, info); }
    return info;
  };

  const botTk = ms2t(botMs), topTk = ms2t(topMs);
  const pvEvtDensity = countShapeEventsInRange(botTk, topTk);
  const steps = Math.min(500, Math.max(120, pvEvtDensity * 8));

  // --- Build step-aware shape point arrays ---
  const {lP, rP, stepTicks} = buildShapePointArrays(botTk, topTk, steps, tk2y, p2x);

  // --- Draw filled shape area ---
  if (lP.length > 1) {
    ctx.fillStyle = '#121212';
    ctx.beginPath();
    lP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    for (let i = rP.length - 1; i >= 0; i--) ctx.lineTo(rP[i].x, rP[i].y);
    ctx.closePath(); ctx.fill();
  }

  // --- Draw shape outer boundary lines with 90° Step corners ---
  ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  lP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
  ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  rP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();

  // --- Draw Step horizontal connector lines at each Step tick ---
  for (const stk of stepTicks) {
    const y = tk2y(stk);
    if (y < gy - 2 || y > gy + gh + 2) continue;
    const shBefore = getShape(stk - 0.0001);
    const shAfter  = getShape(stk + 0.0001);
    const pls = shBefore.left, prs = shBefore.right;
    const cls = shAfter.left,  crs = shAfter.right;
    if (Math.abs(pls - cls) > 0.01) {
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(p2x(pls), y); ctx.lineTo(p2x(cls), y); ctx.stroke();
    }
    if (Math.abs(prs - crs) > 0.01) {
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(p2x(prs), y); ctx.lineTo(p2x(crs), y); ctx.stroke();
    }
    if (prs < cls - 0.1) {
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(p2x(prs), y); ctx.lineTo(p2x(cls), y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (crs < pls - 0.1) {
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(p2x(crs), y); ctx.lineTo(p2x(pls), y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Wide note LN bodies (drawn behind line dividers)
  for (const wn of D.notes.filter(n => n.isWide && n.duration > 0)) {
    const wst = wn.startTick, wet = wst + wn.duration;
    const wnMs = t2ms(wst), wneMs = t2ms(wet);
    if (wnMs > topMs + 300 || wneMs < botMs - 300) continue;
    // If hit, only draw the unconsumed portion (above judgment line)
    let drawSt = wst;
    const wIsHit = opts.hitMap.has(wn);
    const wIsMiss = opts.missSet && opts.missSet.has(wn);
    if (wIsHit && !wIsMiss) {
      drawSt = Math.max(wst, curTk);
      if (drawSt >= wet) continue; // fully consumed
    }
    const wdd = buildGFTicks(drawSt, wet);
    if (wdd.length < 2) continue;
    ctx.fillStyle = WIDE_BODY; ctx.beginPath();
    for (let s = 0; s < wdd.length; s++) {
      const tk = wdd[s], y = tk2y(tk);
      const sh = getTkInfo(tk).sh, lx = p2x(sh.left), rx = p2x(sh.right);
      if (s === 0) ctx.moveTo(lx, y); else ctx.lineTo(lx, y);
    }
    for (let s = wdd.length - 1; s >= 0; s--) {
      const tk = wdd[s], y = tk2y(tk);
      const sh = getTkInfo(tk).sh, lx = p2x(sh.left), rx = p2x(sh.right);
      ctx.lineTo(rx, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // --- Draw inner line dividers (step-aware) ---
  for (let ln = 0; ln < 3; ln++) {
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let fi = true;
    for (const pt of lP) {
      const tk = pt.tk;
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let cum = 0; for (let k = 0; k <= ln; k++) cum += lines[k] / 100;
      const dx = lx + cum * sw;
      if (fi) { ctx.moveTo(dx, pt.y); fi = false; } else ctx.lineTo(dx, pt.y);
    }
    ctx.stroke();
  }

  // --- Measure lines (time-signature aware) ---
  {
    let tsSorted = getSortedTS();
    if (!tsSorted.length) tsSorted = [{tick:0, numerator:4, denominator:4}];
    for (let si = 0; si < tsSorted.length; si++) {
      const ts = tsSorted[si];
      const tpm = TPB * ts.numerator * 4 / ts.denominator; // ticks per measure
      const epStart = ts.tick;
      const epEnd = si < tsSorted.length - 1 ? tsSorted[si + 1].tick : Infinity;
      if (epStart > topTk) break;
      const startTk = Math.max(epStart, Math.floor((botTk - epStart) / tpm) * tpm + epStart);
      for (let tk = startTk; tk <= topTk && tk < epEnd; tk += tpm) {
        if (tk < 0) continue;
        const my = tk2y(tk);
        if (my < gy - 2 || my > gy + gh + 2) continue;
        const msh = getTkInfo(tk).sh;
        const mlx = p2x(msh.left), mrx = p2x(msh.right);
        ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mlx, my); ctx.lineTo(mrx, my); ctx.stroke();
      }
    }
  }

  // --- Draw notes ---
  function gNX(tk, n, li, isLNEnd) {
    const evalTk = isLNEnd && isStepTick(tk) ? tk - 0.0001 : tk;
    const info = getTkInfo(evalTk); const sh = info.sh, lines = info.lines;
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    if (n.isWide) return {x: lx, w: sw};
    let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100;
    return {x: lx + cum * sw, w: (lines[li] / 100) * sw};
  }

  // Helper: build deduped tick array for body polygon
  function buildGFTicks(st, et) {
    const lnEvtCnt = countShapeEventsInRange(st, et);
    const lnSteps = Math.min(120, Math.max(30, lnEvtCnt * 6));
    const lnStepTks = getStepTicks(st, et);
    const lnEvtTks = getShapeEventTicks(st, et);
    const segTks = [];
    for (let s = 0; s <= lnSteps; s++) segTks.push(st + (et - st) * s / lnSteps);
    for (const stk of lnStepTks) { if (stk > st && stk < et) { segTks.push(stk - 0.0001); segTks.push(stk + 0.0001); } }
    for (const etk of lnEvtTks) { if (etk > st && etk < et) segTks.push(etk); }
    segTks.sort((a, b) => a - b);
    const dd = []; let pt = -Infinity;
    for (const tk of segTks) { if (tk - pt > 0.00005) { dd.push(tk); pt = tk; } }
    return dd;
  }

  // Helper: draw body polygon for a note over a tick range
  function drawGFBody(n, li, st, et, fillCol) {
    const dd = buildGFTicks(st, et);
    if (dd.length < 2) return;
    ctx.fillStyle = fillCol; ctx.beginPath();
    for (let s = 0; s < dd.length; s++) {
      const tk = dd[s], y = tk2y(tk);
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let lnX, lnW;
      if (n.isWide) { lnX = lx; lnW = sw; }
      else { let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100; lnX = lx + cum * sw; lnW = (lines[li] / 100) * sw; }
      const pd = n.isWide ? 0 : lnW * 0.05;
      if (s === 0) ctx.moveTo(lnX + pd, y); else ctx.lineTo(lnX + pd, y);
    }
    for (let s = dd.length - 1; s >= 0; s--) {
      const tk = dd[s], y = tk2y(tk);
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let lnX, lnW;
      if (n.isWide) { lnX = lx; lnW = sw; }
      else { let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100; lnX = lx + cum * sw; lnW = (lines[li] / 100) * sw; }
      const pd = n.isWide ? 0 : lnW * 0.05;
      ctx.lineTo(lnX + lnW - pd, y);
    }
    ctx.closePath(); ctx.fill();
  }

  const _gfOvm = computeNoteOverlaps();
  // Z-order: 2-pass rendering (bodies first, heads on top)
  const gfAll = [...D.notes];
  const {wide: gfWide, normW: gfNW, normY: gfNY} = classifyNotesForZOrder(gfAll, _gfOvm);

  // Pre-compute hit/miss state for all notes
  const _gfState = new Map();
  for (const n of gfAll) {
    const ov = !n.isWide ? _gfOvm.get(n) : undefined;
    if (ov && ov.type === 'hidden') { _gfState.set(n, null); continue; }
    const nMs = t2ms(n.startTick), neMs = t2ms(n.startTick + (n.duration || 0));
    if (nMs > topMs + 300 || neMs < botMs - 300) { _gfState.set(n, null); continue; }
    const li = n.isWide ? 0 : CHL[n.channel];
    let headCol, bodyCol;
    if (n.isWide) { headCol = WIDE_COLOR; bodyCol = WIDE_BODY; }
    else if (ov && (ov.type === 'merged' || (ov.type === 'yellow' && ov.fullYellow))) { headCol = OVERLAP_COLOR; bodyCol = OVERLAP_BODY; }
    else { headCol = '#ffffff'; bodyCol = NORMAL_BODY; }
    let isHit, isMissed;
    isHit = opts.hitMap.has(n);
    isMissed = opts.missSet && opts.missSet.has(n);
    let alpha = 1;
    if (isHit && !n.duration) { alpha = Math.max(0, 1 - (curMs - nMs) / 100); } // Hit tap notes fade over 100ms
    if (isMissed && !n.duration) { alpha = 1; } // Miss tap notes keep scrolling (visible)
    _gfState.set(n, { ov, li, headCol, bodyCol, isHit, isMissed, alpha, nMs, neMs });
  }

  // Pass 1 — Bodies: normal white/clipped → normal yellow/merged (wide hold bodies already drawn above)
  for (const n of [...gfNW, ...gfNY]) {
    const s = _gfState.get(n); if (!s) continue;
    if (s.alpha <= 0) continue;
    ctx.globalAlpha = s.alpha;
    if (n.duration > 0 && !n.isWide) {
      let st = n.startTick, et = st + n.duration;
      // If hit (not miss), consume body from judgment line
      if (s.isHit && !s.isMissed) {
        st = Math.max(st, curTk);
        if (st >= et) { ctx.globalAlpha = 1; continue; } // fully consumed
      }
      // When Missed, render the full body in its default body color, ignoring overlap.
      const effectiveOv = s.isMissed ? null : s.ov;
      for (const seg of splitBodyByOverlap(n, effectiveOv, st, et, s.bodyCol)) {
        // Clamp segment to consumption-trimmed [st, et]
        const from = Math.max(seg.tkFrom, st);
        const to = Math.min(seg.tkTo, et);
        if (from < to) drawGFBody(n, s.li, from, to, seg.col);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Pass 2 — Heads: wide (behind) → normal white/clipped → normal yellow/merged (front)
  for (const n of [...gfWide, ...gfNW, ...gfNY]) {
    const s = _gfState.get(n); if (!s) continue;
    if (s.alpha <= 0) continue;
    ctx.globalAlpha = s.alpha;
    let drawHead = s.headCol;

    if (n.duration > 0) {
      // Hide head of hit LN notes (consumed)
      if (s.isHit && !s.isMissed) { ctx.globalAlpha = 1; continue; }
      const hy = tk2y(n.startTick), hp = gNX(n.startTick, n, s.li, false);
      if (hy > gy - 20 && hy < gy + gh + 20) {
        // When Missed, disable partial-yellow reshading to keep baseline color.
        const effectiveOv = s.isMissed ? null : s.ov;
        const hc = headColorAtTick(drawHead, effectiveOv, n.startTick);
        const th = nThk * (n.isWide ? 1 : .9);
        const rx0 = n.isWide ? Math.min(hp.x, hp.x + hp.w) : hp.x + hp.w * .05;
        const rw  = n.isWide ? Math.abs(hp.w)              : hp.w - hp.w * .05 * 2;
        drawNoteHead(ctx, n.isWide, rx0, hy, rw, th, hc, 4);
      }
    } else {
      const y = tk2y(n.startTick); if (y < gy - 20 || y > gy + gh + 20) { ctx.globalAlpha = 1; continue; }
      const p = gNX(n.startTick, n, s.li, false);
      const th = nThk * (n.isWide ? 1 : .9);
      // Note: v19 does not apply partial-yellow reshading to Tap heads in game mode;
      // we preserve that by using drawHead directly.
      const rx0 = n.isWide ? Math.min(p.x, p.x + p.w) : p.x + p.w * .05;
      const rw  = n.isWide ? Math.abs(p.w)            : p.w - p.w * .05 * 2;
      drawNoteHead(ctx, n.isWide, rx0, y, rw, th, drawHead, 4);

      if (n.isWide && isStepTick(n.startTick)) {
        const stk = n.startTick;
        const shB = getShape(stk - 0.0001), shA = getShape(stk + 0.0001);
        const pls = shB.left, prs = shB.right, cls = shA.left, crs = shA.right;
        const noteY = tk2y(stk);
        if (prs < cls - 0.1) {
          ctx.strokeStyle = drawHead; ctx.lineWidth = nThk * 0.9;
          ctx.beginPath(); ctx.moveTo(p2x(prs), noteY); ctx.lineTo(p2x(cls), noteY); ctx.stroke();
        } else if (crs < pls - 0.1) {
          ctx.strokeStyle = drawHead; ctx.lineWidth = nThk * 0.9;
          ctx.beginPath(); ctx.moveTo(p2x(crs), noteY); ctx.lineTo(p2x(pls), noteY); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Judgment line
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx, jY); ctx.lineTo(gx + gw, jY); ctx.stroke();
  const gr = ctx.createLinearGradient(0, jY - 6, 0, jY + 6); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(gx, jY - 6, gw, 12);

  // Hit effects — Simple ripple (water surface metaphor)
  // Unified alpha system: fillAlpha = ringAlpha × FILL_K throughout.
  // Hold pulses symmetrically around tap's plateau values.
  const effectDur = 300;       // Tap total duration (ms)
  const holdFadeDur = 250;     // Hold release fade (ms)
  const FILL_K = 0.25;        // fill-to-ring alpha ratio (tap fill 0.20 = ring 0.80 × 0.25)
  const HOLD_SWING = 0.12;    // hold ring pulse ±amplitude (ring 0.80±0.12, fill 0.20±0.03)
  const judgColMap = {SYNC:'#ffffff', PERFECT:'#ffe44a', GOOD:'#4aff8a', MISS:'#ff4a6a'};

  // Filter stale effects
  opts.hitEffects = opts.hitEffects.filter(h => {
    if (h.note.duration > 0) return curMs < h.endMs + holdFadeDur;
    return curMs - h.startMs < effectDur;
  });

  function drawSemiCircle(ctx, cx, cy, r, above, stroke) {
    ctx.beginPath();
    if (above) { ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); }
    else { ctx.arc(cx, cy, r, 0, Math.PI); }
    ctx.closePath();
    if (stroke) ctx.stroke(); else ctx.fill();
  }

  // Fade curve: holds strong early, then drops off
  // 0→0.4: alpha 0.8 (color readable), 0.4→1: smooth fade to 0
  function rippleFade(t) {
    if (t < 0.4) return 0.8;
    return 0.8 * (1 - (t - 0.4) / 0.6);
  }

  // Size curve: fast initial spread, then gentle drift outward
  function rippleSize(t) {
    return 0.15 + Math.sqrt(t) * 0.85;
  }

  for (const h of opts.hitEffects) {
    const age = curMs - h.startMs;
    if (age < 0) continue;
    const isLNActive = h.note.duration > 0 && curMs < h.endMs;
    const isLNFading = h.note.duration > 0 && curMs >= h.endMs;

    let evalTk = curTk;
    const sh = getShape(evalTk), lines = getLines(evalTk);
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    const fadeAge = isLNFading ? curMs - h.endMs : age;

    // Effect color from judgment type
    let effCol = '#ffffff';
    if (h.judgType) effCol = judgColMap[h.judgType] || '#ffffff';

    // Direction: above or below judgment line (overlap on Lines 2-3)
    const above = h.above !== false;

    // Compute center and radius
    let cx, baseR;
    if (h.isWide) {
      let cum2 = 0; for (let k = 0; k < 1; k++) cum2 += lines[k] / 100;
      let cum3end = 0; for (let k = 0; k < 3; k++) cum3end += lines[k] / 100;
      cx = lx + ((cum2 + cum3end) / 2) * sw;
      // Inverted shape (sw<0): use |sw| so ctx.arc() doesn't throw on negative radius
      baseR = Math.abs(sw) * (1.25 / 8);
    } else {
      const li = CHL[h.channel];
      let cum = 0;
      for (let k = 0; k < li; k++) cum += lines[k] / 100;
      const lineW = (lines[li] / 100) * sw;
      cx = lx + (cum + lines[li] / 200) * sw;
      // Inverted shape (sw<0): use |sw| and |lineW| so ctx.arc() doesn't throw
      baseR = Math.min(Math.abs(sw) * (0.9 / 8), Math.abs(lineW) / 2);
    }
    const dir = h.isWide ? true : above;

    if (isLNActive) {
      // Hold: pulse symmetrically around tap's plateau (ring 0.80, fill 0.20)
      const sinP = Math.sin(age * 0.005);
      const ringA = 0.80 + sinP * HOLD_SWING;
      const fillA = ringA * FILL_K;
      // Inner fill
      ctx.globalAlpha = fillA;
      ctx.fillStyle = effCol;
      drawSemiCircle(ctx, cx, jY, baseR * 0.55, dir, false);
      // Outer ring
      ctx.globalAlpha = ringA;
      ctx.strokeStyle = effCol; ctx.lineWidth = 1.5;
      drawSemiCircle(ctx, cx, jY, baseR * (0.55 + (0.5 + 0.5 * sinP) * 0.10), dir, true);
      ctx.globalAlpha = 1;
    } else if (isLNFading) {
      // Hold release: fade from tap's plateau level, same ratio
      const t = fadeAge / holdFadeDur;
      if (t < 1) {
        const ringA = 0.80 * (1 - t);
        const fillA = ringA * FILL_K;
        const r = baseR * rippleSize(t);
        ctx.globalAlpha = ringA;
        ctx.strokeStyle = effCol; ctx.lineWidth = Math.max(0.5, 1.5 * (1 - t));
        drawSemiCircle(ctx, cx, jY, r, dir, true);
        ctx.globalAlpha = fillA;
        ctx.fillStyle = effCol;
        drawSemiCircle(ctx, cx, jY, r * 0.65, dir, false);
        ctx.globalAlpha = 1;
      }
    } else {
      // Tap: ring expanding + inner fill, same ratio
      const t = age / effectDur;
      if (t < 1) {
        const ringA = rippleFade(t);
        const fillA = ringA * FILL_K;
        const r = baseR * rippleSize(t);
        ctx.globalAlpha = ringA;
        ctx.strokeStyle = effCol;
        ctx.lineWidth = Math.max(0.5, 1.8 * (1 - t * 0.5));
        drawSemiCircle(ctx, cx, jY, r, dir, true);
        ctx.globalAlpha = fillA;
        ctx.fillStyle = effCol;
        drawSemiCircle(ctx, cx, jY, r * 0.65, dir, false);
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- Text Events Overlay ---
  {
    const fadeMs = 300;
    const shCur = getShape(curTk);
    const linesCur = getLines(curTk);
    const sLx = p2x(shCur.left), sRx = p2x(shCur.right), sSw = sRx - sLx;

    // Layout constants
    const colPad = gw * 0.02;        // gap between columns
    const colW3 = gw / 3;            // each column = 1/3 of screen
    const boxPadX = gw * 0.015;      // horizontal padding inside box
    const boxPadY = gh * 0.008;      // vertical padding inside box
    const boxR = gw * 0.006;         // box corner radius

    // Tutorial: Y center at 50% screen height
    const tutorialCY = gy + gh * 0.5;

    for (const te of D.textEvents) {
      const teStartMs = t2ms(te.startTick);
      const teEndMs = t2ms(te.startTick + te.duration);
      if (curMs < teStartMs - fadeMs || curMs > teEndMs + fadeMs) continue;

      let alpha = 1;
      if (te.transition === 'fade') {
        if (curMs < teStartMs) alpha = Math.max(0, (curMs - (teStartMs - fadeMs)) / fadeMs);
        else if (curMs > teEndMs) alpha = Math.max(0, 1 - (curMs - teEndMs) / fadeMs);
      } else {
        if (curMs < teStartMs || curMs > teEndMs) continue;
      }
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      const pos = te.pos || 'middle';
      const isLine = pos.startsWith('line:');

      // --- line:N indicator (same for both modes) ---
      if (isLine) {
        const lineNum = parseInt(pos.split(':')[1]) - 1;
        let cum = 0; for (let k = 0; k < lineNum; k++) cum += linesCur[k] / 100;
        const lineCenter = sLx + (cum + linesCur[lineNum] / 200) * sSw;
        const lineW = (linesCur[lineNum] / 100) * sSw;
        const lnLx = sLx + cum * sSw;

        // Pulsing arrow indicator above judgment line
        const pulse = 0.5 + 0.5 * Math.sin(curMs * 0.006);
        const indR = gw * 0.015;
        ctx.fillStyle = `rgba(74, 224, 255, ${0.3 + pulse * 0.4})`;
        const indY = jY - indR * 3;
        ctx.beginPath();
        ctx.moveTo(lineCenter, jY - indR * 0.5);
        ctx.lineTo(lineCenter - indR, indY);
        ctx.lineTo(lineCenter + indR, indY);
        ctx.closePath(); ctx.fill();
        // Glow on the line
        ctx.fillStyle = `rgba(74, 224, 255, ${0.05 + pulse * 0.08})`;
        ctx.fillRect(lnLx, jY - gw * 0.04, lineW, gw * 0.04);

        // If there's text content, draw it below the arrow indicator
        if (te.content) {
          const txSz = Math.round(gw * 0.016);
          ctx.font = `bold ${txSz}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          const ty = indY + indR * 1.2;
          const tw = ctx.measureText(te.content).width;
          // Box
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath(); ctx.roundRect(lineCenter - tw / 2 - boxPadX, ty - boxPadY, tw + boxPadX * 2, txSz + boxPadY * 2, boxR); ctx.fill();
          ctx.strokeStyle = 'rgba(74, 224, 255, 0.3)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(lineCenter - tw / 2 - boxPadX, ty - boxPadY, tw + boxPadX * 2, txSz + boxPadY * 2, boxR); ctx.stroke();
          ctx.fillStyle = '#ffffffee';
          ctx.fillText(te.content, lineCenter, ty);
        }
        ctx.globalAlpha = 1;
        continue;
      }

      // --- Determine column region (all center-aligned within their 1/3) ---
      let colLeft, colRight, anchorX, anchorY;
      const align = 'center'; // always center within column
      if (pos === 'left') {
        colLeft = gx + colPad;
        colRight = gx + colW3 - colPad / 2;
      } else if (pos === 'right') {
        colLeft = gx + colW3 * 2 + colPad / 2;
        colRight = gx + gw - colPad;
      } else { // middle
        colLeft = gx + colW3 + colPad / 2;
        colRight = gx + colW3 * 2 - colPad / 2;
      }
      anchorX = (colLeft + colRight) / 2;
      const maxTextW = colRight - colLeft - boxPadX * 2;
      anchorY = tutorialCY;

      // --- Measure text and compute layout ---
      let txSz = Math.round(gw * 0.022);
      ctx.font = `bold ${txSz}px sans-serif`;

      // Split lines (allow \n)
      let contentLines = (te.content || '').split('\n');

      // Measure max line width and auto-scale if exceeds column
      let maxW = 0;
      for (const cl of contentLines) {
        const w = ctx.measureText(cl).width;
        if (w > maxW) maxW = w;
      }
      if (maxW > maxTextW && maxW > 0) {
        txSz = Math.max(Math.round(gw * 0.012), Math.round(txSz * maxTextW / maxW));
        ctx.font = `bold ${txSz}px sans-serif`;
        // Re-measure with new size
        maxW = 0;
        for (const cl of contentLines) {
          const w = ctx.measureText(cl).width;
          if (w > maxW) maxW = w;
        }
      }
      const lineH = txSz * 1.4;
      const totalH = contentLines.length * lineH;

      // --- Draw box ---
      const bw = Math.min(maxW, maxTextW) + boxPadX * 2;
      const bh = totalH + boxPadY * 2;
      const bx = anchorX - bw / 2;
      const by = anchorY - bh / 2;

      // Box background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.fill();
      // Box border
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.stroke();

      // --- Draw text lines (clipped to box) ---
      ctx.save();
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.clip();
      ctx.textAlign = align; ctx.textBaseline = 'middle';
      const textStartY = anchorY - (contentLines.length - 1) * lineH / 2;
      for (let li = 0; li < contentLines.length; li++) {
        const ly = textStartY + li * lineH;
        ctx.fillStyle = '#ffffffee';
        ctx.font = `bold ${txSz}px sans-serif`;
        ctx.fillText(contentLines[li], anchorX, ly);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  // HUD is drawn externally by the caller (drawPlayScreen) via drawUnifiedHUD.
  // drawPlayIdle doesn't draw HUD (it's just a static preview).
}

// ============================================================
//  AUDIO ENGINE
// ============================================================
function loadAud(inp) {
  const f = inp.files[0]; if (!f) return;
  initAud();
  const r = new FileReader();
  r.onload = () => {
    actx.decodeAudioData(r.result, b => {
      abuf = b; audioMs = b.duration * 1000; updateTotalMs();
      $('audS').textContent = `${f.name} (${b.duration.toFixed(1)}s)`;
      const ch0 = b.getChannelData(0);
      const ch1 = b.numberOfChannels > 1 ? b.getChannelData(1) : ch0;
      const factor = Math.max(1, Math.floor(b.sampleRate / 8000));
      const len = Math.floor(ch0.length / factor);
      waveData = new Float32Array(len); waveSR = b.sampleRate / factor;
      for (let i = 0; i < len; i++) { const si = i * factor; let peak = 0; for (let j = 0; j < factor && si + j < ch0.length; j++) peak = Math.max(peak, Math.abs((ch0[si + j] + ch1[si + j]) * 0.5)); waveData[i] = peak; }
      drawN();
    });
  };
  r.readAsArrayBuffer(f);
}

let _audStartCtxTime = 0, _audStartSec = 0;

function startAud(fromMs) {
  initAud();
  if (asrc) try { asrc.stop(); } catch (e) {}
  if (!abuf) return;
  asrc = actx.createBufferSource(); asrc.buffer = abuf;
  asrc.playbackRate.value = playbackRate;
  asrc.connect(musicGain || actx.destination);
  const startSec = Math.max(0, fromMs / 1000);
  asrc.start(0, startSec);
  _audStartCtxTime = actx.currentTime;
  _audStartSec = startSec;
  aOff = actx.currentTime - startSec; // keep for compat
}

function stopAud() {
  if (asrc) try { asrc.stop(); } catch (e) {}
  asrc = null;
}

/** Format milliseconds as M:SS (handles negative for lead-in) */
function fmtMs(ms) {
  if (ms < 0) {
    const s = Math.ceil(-ms / 1000);
    return `-0:${String(Math.min(s, 59)).padStart(2, '0')}`;
  }
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ============================================================
//  MODALS
// ============================================================
// showMod/closeMod defined in FILE MANAGER section

// ============================================================
//  IMPORT / EXPORT
// ============================================================
function doExport() {
  const d = JSON.stringify(D, null, 2); const b = new Blob([d], {type: 'application/json'});
  const u = URL.createObjectURL(b); const a = document.createElement('a');
  const now = new Date();
  const ts = String(now.getFullYear()).slice(2) + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + String(now.getSeconds()).padStart(2,'0');
  a.href = u; a.download = `${D.metadata.artist}-${D.metadata.title}_${D.metadata.difficulty}-${ts}.json`;
  a.click(); URL.revokeObjectURL(u);
}

function doImport(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      loadChartData(d);
      currentFileName = f.name.replace(/\.json$/i, '');
      compBPM(); syncMeta(); drawN(); drawS(); saveHist('n'); saveHist('s'); saveHist('m');
      closeMod('fileMod');
      toast('Imported: ' + f.name);
    } catch (e) { toast('Error: ' + e.message); }
  };
  r.readAsText(f);
  inp.value = '';
}

function syncMeta() {
  $('mTitle').value = D.metadata.title || '';
  $('mSubtitle').value = D.metadata.subtitle || '';
  $('mArtist').value = D.metadata.artist || 'airpole';
  $('mCharter').value = D.metadata.charter || 'airpole';
  $('mDiff').value = D.metadata.difficulty || 'Trace';
  $('mLevel').value = D.metadata.level || 0;
  $('mOff').value = D.metadata.offset || 0;
  $('syncOff').value = D.metadata.offset || 0;
  renderTempoList(); renderTSList(); renderTeList();
}

function renderTempoList() {
  const el = $('tempoList');
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  el.innerHTML = sorted.map((t, i) => {
    const isFirst = t.tick === 0 && i === 0;
    const mStr = tickToMeasure(t.tick);
    return `<div class="ev-row"><span class="ev-info"><b>${mStr}</b> <span style="font-size:8px;color:#555">(t${t.tick})</span> → <b>${t.bpm}</b> BPM</span><input type="number" value="${t.bpm}" min="1" max="999" step="0.01" onchange="editTempo(${i},null,+this.value)" title="BPM">${isFirst ? '' : '<button class="ev-del" onclick="delTempo(' + i + ')" title="Delete">✕</button>'}</div>`;
  }).join('');
}

function renderTSList() {
  const el = $('tsList');
  const sorted = getSortedTS();
  el.innerHTML = sorted.map((t, i) => {
    const isFirst = t.tick === 0 && i === 0;
    const mStr = tickToMeasure(t.tick);
    return `<div class="ev-row"><span class="ev-info"><b>${mStr}</b> <span style="font-size:8px;color:#555">(t${t.tick})</span> → <b>${t.numerator}/${t.denominator}</b></span><input type="number" value="${t.numerator}" min="1" max="32" style="width:35px" onchange="editTS(${i},+this.value,null)" title="Numerator"><span style="color:var(--tx2)">/</span><input type="number" value="${t.denominator}" min="1" max="32" style="width:35px" onchange="editTS(${i},null,+this.value)" title="Denominator">${isFirst ? '' : '<button class="ev-del" onclick="delTS(' + i + ')" title="Delete">✕</button>'}</div>`;
  }).join('');
}

// Helper: UI side-effects after an m-scope command (tempo/TS).
// Mirrors what histScopes.m.restore used to do, minus the data restoration.
// Wired via onDispatch() below so it runs for apply/undo/redo uniformly.
function _afterMetaCommand() {
  updateTotalMs();
  renderTempoList(); renderTSList();
  if (activeTab === 'note') drawN();
  else if (activeTab === 'shape') drawS();
  else if (activeTab === 'play' && !playActive) drawPlayIdle();
  scheduleAutoSave();
}

function addTempo() {
  const tkStr = $('tAddTk').value;
  const tk = measureToTick(tkStr);
  if (tk === null) { alert('올바른 마디 표기를 입력하세요 (예: 1, 3.2, 80.4.1, t1920)'); return; }
  const bpm = +$('tAddBpm').value || 120;
  if (D.tempo.some(t => t.tick === tk)) { alert('이미 해당 위치에 템포 변경이 있습니다: ' + tickToMeasure(tk)); return; }
  dispatch(AddTempo({tick: tk, bpm}));
}

function editTempo(i, tk, bpm) {
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  const t = sorted[i]; if (!t) return;
  if (bpm !== null && bpm !== undefined) {
    if (t.bpm === bpm) return;
    dispatch(EditTempoBpm(t.tick, t.bpm, bpm));
  }
  // Moving a tempo marker to a different tick is not yet migrated to Command;
  // the UI currently only exposes BPM edits inline, but guard for future.
  if (tk !== null && tk !== undefined && tk !== t.tick) {
    const oldTick = t.tick;
    dispatch({
      name: 'MoveTempo',
      apply: () => {
        const entry = D.tempo.find(x => x.tick === oldTick);
        if (entry) { entry.tick = tk; D.tempo.sort((a, b) => a.tick - b.tick); }
      },
      undo: () => {
        const entry = D.tempo.find(x => x.tick === tk);
        if (entry) { entry.tick = oldTick; D.tempo.sort((a, b) => a.tick - b.tick); }
      },
      invalidates: ['tempo']
    });
  }
}

function delTempo(i) {
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  const t = sorted[i]; if (!t) return;
  if (t.tick === 0) { alert('Cannot delete initial tempo'); return; }
  dispatch(DeleteTempo({...t}));
}

function addTimeSig() {
  const tkStr = $('tsAddTk').value;
  const tk = measureToTick(tkStr);
  if (tk === null) { alert('올바른 마디 표기를 입력하세요 (예: 1, 3, 80.4.1, t1920)'); return; }
  const num = +$('tsAddNum').value || 4;
  const den = +$('tsAddDen').value || 4;
  if (D.timeSignatures.some(t => t.tick === tk)) { alert('이미 해당 위치에 박자 변경이 있습니다: ' + tickToMeasure(tk)); return; }
  dispatch(AddTimeSig({tick: tk, numerator: num, denominator: den}));
}

function editTS(i, num, den) {
  const sorted = getSortedTS();
  const t = sorted[i]; if (!t) return;
  const oldTs = {numerator: t.numerator, denominator: t.denominator};
  const newTs = {
    numerator:   num !== null && num !== undefined ? num : t.numerator,
    denominator: den !== null && den !== undefined ? den : t.denominator
  };
  if (newTs.numerator === oldTs.numerator && newTs.denominator === oldTs.denominator) return;
  dispatch(EditTimeSig(t.tick, oldTs, newTs));
}

function delTS(i) {
  const sorted = getSortedTS();
  const t = sorted[i]; if (!t) return;
  if (t.tick === 0) { alert('Cannot delete initial time signature'); return; }
  dispatch(DeleteTimeSig({...t}));
}

// ============================================================
//  FILE MANAGER
// ============================================================
function fmGetFiles() {
  const files = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(LS_PREFIX)) {
      try {
        const raw = localStorage.getItem(k);
        const obj = JSON.parse(raw);
        files.push({
          key: k,
          name: k.slice(LS_PREFIX.length),
          date: obj._savedAt || '',
          title: obj.metadata?.title || 'Untitled',
          artist: obj.metadata?.artist || '',
          difficulty: obj.metadata?.difficulty || ''
        });
      } catch(e) {}
    }
  }
  files.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return files;
}

function renderFMList() {
  const files = fmGetFiles();
  const el = $('fmList');
  if (files.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--tx2);padding:16px;font-size:10px">No saved files</div>';
    return;
  }
  el.innerHTML = files.map(f => {
    const isCurrent = currentFileName === f.name;
    const dateStr = f.date ? new Date(f.date).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="fm-item" ${isCurrent ? 'style="border-color:var(--acc)"' : ''} onclick="fmLoad('${f.name.replace(/'/g,"\\'")}')">
      <span class="fm-name">${isCurrent ? '● ' : ''}${f.name}<br><span style="font-size:7px;color:var(--tx2)">${f.title} - ${f.artist} [${f.difficulty}]</span></span>
      <span class="fm-date">${dateStr}</span>
      <button class="fm-del" onclick="event.stopPropagation();fmDelete('${f.name.replace(/'/g,"\\'")}')">✕</button>
    </div>`;
  }).join('');
}

function fmSave() {
  if (!currentFileName) { fmSaveAs(); return; }
  const data = JSON.parse(JSON.stringify(D));
  data._savedAt = new Date().toISOString();
  localStorage.setItem(LS_PREFIX + currentFileName, JSON.stringify(data));
  updateAutoSaveIndicator(true);
  renderFMList();
  toast('Saved: ' + currentFileName);
}

function fmSaveAs() {
  const defaultName = `${D.metadata.artist}-${D.metadata.title}_${D.metadata.difficulty}`;
  const name = prompt('File name:', currentFileName || defaultName);
  if (!name) return;
  currentFileName = name;
  fmSave();
}

function fmLoad(name) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    if (!raw) { toast('File not found'); return; }
    const d = JSON.parse(raw);
    loadChartData(d);
    currentFileName = name;
    compBPM(); syncMeta(); drawN(); drawS(); saveHist('n'); saveHist('s'); saveHist('m');
    closeMod('fileMod');
    toast('Loaded: ' + name);
  } catch(e) { toast('Error: ' + e.message); }
}

function fmDelete(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  localStorage.removeItem(LS_PREFIX + name);
  if (currentFileName === name) currentFileName = '';
  renderFMList();
  toast('Deleted');
}

function showMod(id) {
  $(id).style.display = 'flex';
  if (id === 'fileMod') renderFMList();
}

function closeMod(id) {
  $(id).style.display = 'none';
}

// ============================================================
//  AUTO-SAVE
// ============================================================
function autoSave() {
  if (!currentFileName) {
    // Auto-save to a default slot
    const data = JSON.parse(JSON.stringify(D));
    data._savedAt = new Date().toISOString();
    localStorage.setItem(LS_PREFIX + '__autosave__', JSON.stringify(data));
  } else {
    const data = JSON.parse(JSON.stringify(D));
    data._savedAt = new Date().toISOString();
    localStorage.setItem(LS_PREFIX + currentFileName, JSON.stringify(data));
  }
  updateAutoSaveIndicator(true);
}

function updateAutoSaveIndicator(saved) {
  const el = $('autoSaveI');
  if (saved) {
    el.classList.add('saved');
    el.title = 'Saved ' + new Date().toLocaleTimeString();
    setTimeout(() => el.classList.remove('saved'), 2000);
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { autoSave(); }, 30000); // 30s after last change
}

// ============================================================
//  KEYBOARD SHORTCUTS (Desktop Support)
// ============================================================
// ============================================================
//  KEY CONFIG
// ============================================================
function keyCodeDisplayName(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  const map = {Space:'SPC', Enter:'ENT', Backspace:'BKSP', Tab:'TAB',
    ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓',
    Escape:'ESC', CapsLock:'CAPS', Delete:'DEL', Insert:'INS',
    Home:'HOME', End:'END', PageUp:'PgUp', PageDown:'PgDn'};
  if (code.startsWith('F') && !isNaN(code.slice(1))) return code; // F1–F12
  return map[code] || code;
}

function renderKeyCfg() {
  const el = $('keySlots'); if (!el) return;
  el.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement('button');
    btn.className = 'keySlotBtn' + (keyConfigMode === i ? ' active' : '');
    btn.textContent = `${i}: ${keyCodeDisplayName(keyBindings[i])}`;
    btn.onclick = () => startKeyConfig(i);
    el.appendChild(btn);
  }
  const hint = $('keyConfigHint');
  if (hint) hint.style.display = keyConfigMode !== null ? '' : 'none';
}

function startKeyConfig(ch) {
  keyConfigMode = ch;
  renderKeyCfg();
}

function assignKeyConfig(code) {
  if (keyConfigMode === null) return;
  const target = keyConfigMode;
  // Auto-swap if duplicate
  for (let ch = 1; ch <= 6; ch++) {
    if (ch !== target && keyBindings[ch] === code) {
      keyBindings[ch] = keyBindings[target];
      break;
    }
  }
  keyBindings[target] = code;
  keyConfigMode = null;
  rebuildCodeToChannel();
  localStorage.setItem(LS_PREFIX + 'keyBindings', JSON.stringify(keyBindings));
  renderKeyCfg();
  toast(`CH${target} → ${keyCodeDisplayName(code)}`);
}

function resetKeyBindings() {
  keyBindings = {...DEFAULT_KEYS};
  keyConfigMode = null;
  rebuildCodeToChannel();
  localStorage.setItem(LS_PREFIX + 'keyBindings', JSON.stringify(keyBindings));
  renderKeyCfg();
  toast('키 설정 기본값으로 초기화');
}

function loadKeyBindings() {
  const saved = localStorage.getItem(LS_PREFIX + 'keyBindings');
  if (saved) try { keyBindings = JSON.parse(saved); } catch(e) {}
  rebuildCodeToChannel();
}

// ============================================================
//  PLAY MODE — CANVAS RESIZE
// ============================================================
function rszPlayFSCanvas() {
  const cv = $('playFSCv'); if (!cv) return;
  const dpr = devicePixelRatio;
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
}

// ============================================================
//  PLAY MODE — DRAW FUNCTIONS
// ============================================================
function drawPlayScreen(cv, curMs) {
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  if (cw < 1 || ch_ < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch_);
  const asp = 16 / 9; let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; } else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  ctx.fillStyle = '#050508'; ctx.fillRect(gx, gy, gw, gh);
  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
  drawGameFrame(ctx, gx, gy, gw, gh, curMs, {
    hitEffects: playEffects, hitMap: playHitMap, missSet: playMissSet, showMissColor: true
  });
  drawPlayHUD(ctx, gx, gy, gw, gh, curMs);
  ctx.restore();
}

/**
 * Draw the unified HUD (combo / judgment / counters / title / score / pause button).
 * Pulls numbers from current play state (playHitMap, playMissSet, playCombo, playJudgQueue).
 *
 * v21: extracted as a helper so drawPlayIdle can render the same HUD over the
 * static preview. HUD is always visible on the Play tab — only the canvas size
 * differs between idle (inline) and session (fullscreen).
 */
function drawPlayHUD(ctx, gx, gy, gw, gh, curMs) {
  const sCount = [...playHitMap.values()].filter(v => v.type === 'SYNC').length;
  const pCount = [...playHitMap.values()].filter(v => v.type === 'PERFECT').length;
  const gCount = [...playHitMap.values()].filter(v => v.type === 'GOOD').length;
  const mCount = playMissSet.size;
  const total = D.notes.reduce((s, n) => s + (n.duration > 0 ? 2 : 1), 0);
  const score = total > 0 ? Math.round(((sCount + pCount * 0.9 + gCount * 0.5) / total) * 1000000) : 0;
  const acc = total > 0 ? ((sCount + pCount * 0.9 + gCount * 0.5) / total * 100) : 0;
  const lastJ = playJudgQueue.length > 0 ? playJudgQueue[playJudgQueue.length - 1] : null;
  drawUnifiedHUD(ctx, gx, gy, gw, gh, curMs, {
    combo: playCombo, totalNotes: total, score,
    lastJudg: lastJ,
    counts: {sync: sCount, perfect: pCount, good: gCount, miss: mCount},
    accuracy: acc,
    mode: 'play'
  });
}

// Shared empty stubs for idle Play rendering (new drawGameFrame contract:
// hitMap is always a Map and missSet is always a Set, never null).
const _EMPTY_HITMAP = new Map();
const _EMPTY_MISSSET = new Set();

function drawPlayIdle() {
  const cv = $('plCv'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  if (cw < 1 || ch_ < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch_);
  const asp = 16 / 9; let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; } else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  ctx.fillStyle = '#050508'; ctx.fillRect(gx, gy, gw, gh);
  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
  // Show static frame at current shared position — no live hits/misses driven from this draw,
  // but still show HUD so the user sees title/difficulty/score-so-far at all times on Play.
  drawGameFrame(ctx, gx, gy, gw, gh, sharedMs, {
    hitEffects: [], hitMap: _EMPTY_HITMAP, missSet: _EMPTY_MISSSET, showMissColor: false
  });
  drawPlayHUD(ctx, gx, gy, gw, gh, sharedMs);
  ctx.restore();
}

// ============================================================
//  UNIFIED HUD (shared by Preview & Play)
// ============================================================
// opts: { combo, totalNotes, score, lastJudg, counts:{sync,perfect,good,miss}, accuracy, mode }
// Visual-center text drawing helper
// Uses actualBoundingBox to find true glyph center, not font-metric center.
// Call after setting ctx.font, ctx.fillStyle, ctx.textAlign.
function drawTextVC(ctx, text, x, y) {
  const m = ctx.measureText(String(text));
  const asc = m.actualBoundingBoxAscent || 0;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + (asc - desc) / 2);
}

// Returns actual visual height of text (for layout calculations)
function textVH(ctx, text) {
  const m = ctx.measureText(String(text));
  return (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
}

function drawUnifiedHUD(ctx, gx, gy, gw, gh, curMs, opts) {
  const cx_ = gx + gw / 2;
  const jY = gy + gh * (8 / 9);
  const cell = gw / 16;
  const botTop = jY;
  const botBot = gy + gh;
  const botH = botBot - botTop;
  const G = gw * 0.008;

  // --- Pause button (top-left, 1 cell, icon only, no background) ---
  const barW = Math.round(cell * 0.12);
  const barH = Math.round(cell * 0.45);
  const barY_ = gy + (cell - barH) / 2;
  const barGap_ = Math.round(cell * 0.12);
  const barX1 = gx + (cell - barW * 2 - barGap_) / 2;
  ctx.fillStyle = '#ffffffcc';
  ctx.fillRect(barX1, barY_, barW, barH);
  ctx.fillRect(barX1 + barW + barGap_, barY_, barW, barH);

  // ==========================================================
  // CENTER COLUMN: COMBO → G → JUDGMENT → G → COUNTERS → G → ACCURACY
  // Gaps = G (edge-to-edge between font-size slots).
  // drawTextVC handles visual centering within each slot.
  // ==========================================================
  const comboSz = Math.round(gw * 0.06);
  const judgeSz = Math.round(gw * 0.016);
  const cntSz  = Math.round(gw * 0.014);
  const pctSz  = Math.round(gw * 0.013);

  const comboY = gy + gh * 0.22;
  const judgeY = comboY + comboSz / 2 + G + judgeSz / 2;
  const cntY   = judgeY + judgeSz / 2 + G + cntSz / 2;
  const pctY   = cntY + cntSz / 2 + G + pctSz / 2;

  // COMBO
  ctx.fillStyle = opts.combo > 0 ? '#ffffffdd' : '#ffffff33';
  ctx.font = `bold ${comboSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, opts.combo, cx_, comboY);

  // JUDGMENT TEXT
  if (opts.lastJudg) {
    const colMap = {SYNC:'#ffffff', PERFECT:'#ffe44a', GOOD:'#4aff8a', MISS:'#ff4a6a'};
    ctx.fillStyle = colMap[opts.lastJudg.type] || '#fff';
    ctx.font = `bold ${judgeSz}px sans-serif`;
    ctx.textAlign = 'center';
    drawTextVC(ctx, opts.lastJudg.type, cx_, judgeY);
  }

  // COUNTERS
  const cntCols = ['#ffffff','#ffe44a','#4aff8a','#ff4a6a'];
  const cntVals = [opts.counts.sync, opts.counts.perfect, opts.counts.good, opts.counts.miss];
  ctx.font = `bold ${cntSz}px sans-serif`;
  const maxCntW = ctx.measureText('9999').width;
  const cntGap = maxCntW + cntSz * 0.4;
  const cntX0 = cx_ - (cntGap * 3) / 2;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cntCols[i] + 'aa';
    ctx.textAlign = 'center';
    drawTextVC(ctx, cntVals[i], cntX0 + i * cntGap, cntY);
  }

  // ACCURACY %
  ctx.fillStyle = '#ffffff77'; ctx.font = `${pctSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, opts.accuracy.toFixed(2) + '%', cx_, pctY);

  // ==========================================================
  // BOTTOM STRIP (1 cell height below judgment line)
  // 3 equal gaps: jY↔titleTop, titleBottom↔artistTop, artistBottom↔bottom
  // ==========================================================
  const leftPad = gw * 0.01;
  const titleSz  = Math.round(cell * 0.28);
  const artistSz = Math.round(titleSz * 0.8);
  const infoGap  = (botH - titleSz - artistSz) / 3;
  const titleY   = botTop + infoGap + titleSz / 2;
  const artistY  = titleY + titleSz / 2 + infoGap + artistSz / 2;
  const botMid   = botTop + botH / 2;

  // Title
  ctx.fillStyle = '#ffffffcc'; ctx.font = `bold ${titleSz}px sans-serif`;
  ctx.textAlign = 'left';
  drawTextVC(ctx, D.metadata.title || 'Untitled', gx + leftPad, titleY);

  // Artist (80% size)
  ctx.fillStyle = '#ffffff88'; ctx.font = `bold ${artistSz}px sans-serif`;
  ctx.textAlign = 'left';
  drawTextVC(ctx, D.metadata.artist || '', gx + leftPad, artistY);

  // Difficulty [subtitle]
  ctx.fillStyle = '#ffffffcc'; ctx.font = `bold ${titleSz}px sans-serif`;
  ctx.textAlign = 'right';
  const diffStr = `${D.metadata.difficulty || 'Trace'} ${D.metadata.level || 0}${D.metadata.subtitle ? ' [' + D.metadata.subtitle + ']' : ''}`;
  drawTextVC(ctx, diffStr, gx + gw - leftPad, botMid);

  // Score
  const scoreSz = Math.round(cell * 0.38);
  ctx.fillStyle = '#ffffffdd'; ctx.font = `bold ${scoreSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, String(opts.score).padStart(7, '0'), cx_, botMid);

  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// ============================================================
//  PLAY MODE — JUDGMENT LOGIC
// ============================================================
function getPlayJudgment(channel, curMs) {
  // channel = physical key 1-6
  // Map physical key to line for normal note matching
  const line = KEY2LINE[channel]; // 1-4
  let best = null, bestDiff = Infinity;
  for (const n of D.notes) {
    if (n.isWide) {
      // Wide: accept any key
    } else {
      // Normal: match physical key's line to note's channel (which IS the line)
      if (n.channel !== line) continue;
    }
    if (playHitMap.has(n) || playMissSet.has(n)) continue;
    const diff = curMs - t2ms(n.startTick);
    const window = n.isWide ? JUDGE_WIDE_SYNC : JUDGE_GOOD;
    if (Math.abs(diff) <= window && Math.abs(diff) < bestDiff) {
      best = n; bestDiff = Math.abs(diff);
    }
  }
  return best ? {note: best, diff: curMs - t2ms(best.startTick)} : null;
}

function applyJudgment(note, diff, curMs, silent) {
  const abs = Math.abs(diff);
  // Wide notes: SYNC only (within ±100ms), no PERFECT/GOOD
  const type = note.isWide ? 'SYNC' : (abs <= JUDGE_SYNC ? 'SYNC' : abs <= JUDGE_PERFECT ? 'PERFECT' : 'GOOD');
  playHitMap.set(note, {diff, type, hitMs: curMs});
  playCombo++;
  if (playCombo > playMaxCombo) playMaxCombo = playCombo;
  playJudgQueue.push({type, diff, t: curMs});
  // Trigger hit effect
  const li = note.isWide ? 0 : CHL[note.channel];
  let col = note.isWide ? WIDE_COLOR : '#ffffff';
  const nMs = t2ms(note.startTick), neMs = t2ms(note.startTick + (note.duration || 0));
  let above = true;
  if (!note.isWide && OVERLAP_CHANNELS.includes(note.channel)) {
    const hasSameTick = playEffects.some(h => h.tk === note.startTick && h.channel === note.channel && h.above);
    if (hasSameTick) above = false;
  }
  playEffects.push({note, startMs: nMs, endMs: neMs, li, col, isWide: !!note.isWide, channel: note.channel, tk: note.startTick, judgType: type, above});
  // In autoplay mode, hitsounds are pre-scheduled by scheduleHitsounds —
  // playHit() here would double-play (or play too late due to buffer latency).
  if (!silent) playHit();
}

// checkPlayMisses moved to scheduler.js (binary-search + pointer).
// main.js adapts via a small wrapper at the call site.

// ============================================================
//  PLAY MODE — KEY INPUT
// ============================================================
function handlePlayKeyDown(code) {
  if (playAutoplay) return;  // autoplay: ignore key input
  const ch = codeToChannel[code];
  if (!ch || playKeyHeld.has(ch)) return;
  playKeyHeld.add(ch);
  const curMs = playOffMs + (performance.now() - playT0) * playbackRate;
  const result = getPlayJudgment(ch, curMs);
  if (result) {
    applyJudgment(result.note, result.diff, curMs);
    if (result.note.duration > 0) {
      playHoldState[ch] = result.note;
    }
  } else if (!playHoldState[ch]) {
    // No new note hit — check if there's an active wide hold on another key to share
    for (const [otherCh, note] of Object.entries(playHoldState)) {
      if (note.isWide && +otherCh !== ch) {
        playHoldState[ch] = note;
        break;
      }
    }
  }
}

function handlePlayKeyUp(code) {
  if (playAutoplay) return;  // autoplay: ignore key input
  const ch = codeToChannel[code];
  if (!ch) return;
  playKeyHeld.delete(ch);
  if (playHoldState[ch]) {
    const note = playHoldState[ch];
    delete playHoldState[ch];
    // Wide hold: transfer to any other held key (key switching allowed)
    if (note.isWide) {
      for (const heldCh of playKeyHeld) {
        if (!playHoldState[heldCh]) {
          playHoldState[heldCh] = note;
          return; // successfully transferred, no miss
        }
      }
    }
    const curMs = playOffMs + (performance.now() - playT0) * playbackRate;
    const tailMs = t2ms(note.startTick + note.duration);
    if (curMs - tailMs < -JUDGE_GOOD) {
      // Released too early — miss
      playCombo = 0;
      playJudgQueue.push({type: 'MISS', diff: Math.round(curMs - tailMs), t: curMs});
    }
  }
}

// ============================================================
//  PLAY MODE — LOOP & LIFECYCLE
// ============================================================
function playLoop(ts) {
  if (!playActive) return;
  const curMs = playOffMs + (ts - playT0) * playbackRate;
  // Lead-in: start audio when curMs crosses 0
  if (!playAudioStarted && curMs >= 0) {
    playAudioStarted = true;
    startAud(D.metadata.offset - globalOffset);
  }
  if (curMs >= 0) {
    if (playAutoplay) {
      // Pre-schedule hitsounds 150ms ahead (AudioContext-scheduled, exact timing)
      if (playAudioStarted && actx && hitBuf && hitVol > 0) {
        scheduleHitsounds(curMs, 150, actx, playHitAt);
      }
      // Auto-judge any note whose startTick has crossed curMs → SYNC
      autoJudge(
        curMs,
        n => playHitMap.has(n),
        (n, diff) => applyJudgment(n, diff, curMs, /*silent=*/true)
      );
    } else {
      checkPlayMisses(
        curMs,
        n => playHitMap.has(n) || playMissSet.has(n),
        n => {
          playMissSet.add(n);
          playCombo = 0;
          playJudgQueue.push({type: 'MISS', diff: undefined, t: curMs});
        }
      );
    }
  }
  const cv = playFullscreen ? $('playFSCv') : $('plCv');
  if (cv) drawPlayScreen(cv, curMs);
  if (curMs > (totalMs || 0) + 2000) { stopPlay(); return; }
  playRAF = requestAnimationFrame(playLoop);
}

/**
 * Start a play session.
 * @param {boolean} fromBeginning  true = restart from lead-in; false = from current sharedMs
 * @param {boolean} autoplay       true = auto-SYNC judgment; false = live key input
 *
 * v21: all four combinations enter fullscreen. HUD is unchanged across modes.
 */
function startPlay(fromBeginning, autoplay) {
  initAud(); // Ensure AudioContext is ready (must be in user gesture handler)
  const offMs = fromBeginning ? -LEAD_IN_MS : sharedMs;
  playOffMs = offMs;
  playActive = true;
  playFullscreen = true;          // v21: always fullscreen
  playAutoplay = !!autoplay;
  playAudioStarted = false;
  playHitMap.clear(); playMissSet.clear(); playEffects = [];
  playCombo = 0; playMaxCombo = 0; playJudgQueue = [];
  playHoldState = {}; playKeyHeld.clear();

  // Reset both schedulers; only one will be used per frame based on playAutoplay,
  // but resetting both keeps the pointer state clean after seek/toggle.
  resetMissChecker(offMs);
  resetHitScheduler(offMs);
  resetAutoJudger(offMs);

  // Update play button icon (in case user returns to Play tab after session)
  $('playBtn').textContent = '⏸';

  // Always enter fullscreen
  const el = $('playFS');
  el.classList.add('show');
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) req.call(el).catch(() => {});
  setTimeout(rszPlayFSCanvas, 80);

  // If not from beginning (no lead-in), start audio immediately
  if (!fromBeginning) {
    startAud(offMs + D.metadata.offset - globalOffset);
    playAudioStarted = true;
  }
  // If from beginning, audio will be triggered in playLoop when curMs >= 0
  playT0 = performance.now();
  playRAF = requestAnimationFrame(playLoop);
}

function stopPlay() {
  if (!playActive) return;
  playActive = false;
  cancelAnimationFrame(playRAF); playRAF = null;
  stopAud(); playKeyHeld.clear(); playHoldState = {};

  if (playFullscreen) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
    $('playFS').classList.remove('show');
    playFullscreen = false;
  }

  $('playBtn').textContent = '▶';

  // Show result summary (skip in autoplay — the numbers aren't meaningful)
  if (!playAutoplay) {
    const cnt = [...playHitMap.values()].reduce((a, v) => {
      if (v.type === 'SYNC') a.sync++;
      else if (v.type === 'PERFECT') a.perfect++;
      else if (v.type === 'GOOD') a.good++;
      return a;
    }, {sync: 0, perfect: 0, good: 0});
    const sC = cnt.sync, pC = cnt.perfect, gC = cnt.good;
    const total = D.notes.reduce((s, n) => s + (n.duration > 0 ? 2 : 1), 0);
    const acc = total > 0 ? ((sC + pC * 0.9 + gC * 0.5) / total * 100) : 0;
    toast(`SYNC:${sC} PERFECT:${pC} GOOD:${gC} MISS:${playMissSet.size} | ${acc.toFixed(1)}% | Combo:${playMaxCombo}`);
  }

  requestAnimationFrame(() => { if (activeTab === 'play') { rszActiveCanvas(); drawPlayIdle(); } });
}

// --- Pause button click handler for game canvases ---
function handleGameCanvasClick(e, cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  const asp = 16 / 9;
  let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; }
  else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  const pauseSz = gw / 16;
  const clickX = (e.clientX - rect.left) / rect.width * cw;
  const clickY = (e.clientY - rect.top) / rect.height * ch_;
  if (clickX >= gx && clickX <= gx + pauseSz && clickY >= gy && clickY <= gy + pauseSz) {
    // Pause clicked
    if (playActive) stopPlay();
  }
}
['plCv','playFSCv'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('click', (e) => handleGameCanvasClick(e, el));
});

document.addEventListener('keyup', (e) => {
  if (playActive) handlePlayKeyUp(e.code);
});

document.addEventListener('keydown', (e) => {
  // Don't fire when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  // === KEY CONFIG MODE (meta tab) ===
  if (keyConfigMode !== null && activeTab === 'meta') {
    const MODS = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'];
    if (MODS.includes(e.code)) return;
    // Digit1-6: switch to that slot directly
    const digitMatch = e.code.match(/^Digit([1-6])$/);
    if (digitMatch) { e.preventDefault(); startKeyConfig(+digitMatch[1]); return; }
    e.preventDefault();
    assignKeyConfig(e.code);
    return;
  }

  // === PLAY MODE INPUT ===
  if (playActive) {
    e.preventDefault();
    if (e.code === 'Escape') { stopPlay(); return; }
    if (!e.repeat) handlePlayKeyDown(e.code);
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  // === Ctrl+ shortcuts (common across all tabs) ===
  if (ctrl) {
    if (key === 'z' && !shift) {
      e.preventDefault();
      if (activeTab === 'note') undo('n');
      else if (activeTab === 'shape') undo('s');
      else if (activeTab === 'meta') undo('m');
      return;
    }
    if ((key === 'z' && shift) || key === 'y') {
      e.preventDefault();
      if (activeTab === 'note') redo('n');
      else if (activeTab === 'shape') redo('s');
      else if (activeTab === 'meta') redo('m');
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      if (activeTab === 'note') doCopy();
      else if (activeTab === 'shape') doShapeCopy();
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      if (activeTab === 'note') doPaste(false);
      else if (activeTab === 'shape') doShapePaste(false);
      return;
    }
    if (key === 'f') {
      e.preventDefault();
      if (activeTab === 'note') doPaste(true);
      else if (activeTab === 'shape') doShapePaste(true);
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      if (activeTab === 'note') {
        selectedNotes.clear();
        D.notes.forEach(n => selectedNotes.add(n));
        drawN();
        toast(`${selectedNotes.size}개 노트 전체 선택`);
      } else if (activeTab === 'shape') {
        selectedShapeEvts.clear();
        D.shapeEvents.forEach(ev => selectedShapeEvts.add(ev));
        drawS();
        toast(`${selectedShapeEvts.size}개 shape 전체 선택`);
      }
      return;
    }
    return; // Don't process other ctrl+ combos
  }

  // === Delete / Backspace ===
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (activeTab === 'note' && selectedNotes.size > 0) {
      const count = selectedNotes.size;
      D.notes = D.notes.filter(n => !selectedNotes.has(n));
      selectedNotes.clear();
      saveHist('n'); drawN();
      toast(`${count}개 노트 삭제`);
    } else if (activeTab === 'shape' && selectedShapeEvts.size > 0) {
      doShapeSelectionDelete();
    }
    return;
  }

  // === Space = Play/Pause ===
  if (key === ' ') {
    e.preventDefault();
    if (activeTab === 'note') toggleEdPlay('n');
    else if (activeTab === 'shape') toggleEdPlay('s');
    else if (activeTab === 'play') playToggle();
    return;
  }

  // === Escape = Deselect / Cancel / Key config cancel ===
  if (key === 'escape') {
    e.preventDefault();
    if (keyConfigMode !== null) { keyConfigMode = null; renderKeyCfg(); return; }
    if (activeTab === 'note') { cancelLN(); cancelTE(); selectedNotes.clear(); drawN(); }
    else if (activeTab === 'shape') { cancelArc(); selectedShapeEvts.clear(); drawS(); }
    return;
  }

  // === Common tool shortcuts (both Notes & Shapes) ===
  // A = Sel, D = Del, F = Follow, G = Grid picker
  if (key === 'a') {
    if (activeTab === 'note') setNT('sel');
    else if (activeTab === 'shape') setST('sel');
    return;
  }
  if (key === 'd') {
    if (activeTab === 'note') setNT('del');
    else if (activeTab === 'shape') setST('del');
    return;
  }
  if (key === 'f') {
    if (activeTab === 'note') toggleFollow();
    else if (activeTab === 'shape') toggleSFollow();
    return;
  }
  if (key === 'g') {
    if (activeTab === 'note') toggleGP('ngp');
    else if (activeTab === 'shape') toggleGP('sgp');
    return;
  }

  // === Zoom: =/+ and - ===
  if (key === '=' || key === '+') {
    if (activeTab === 'note') nZ(1);
    else if (activeTab === 'shape') sZ(1);
    return;
  }
  if (key === '-') {
    if (activeTab === 'note') nZ(-1);
    else if (activeTab === 'shape') sZ(-1);
    return;
  }

  // === Notes tab specific: Q W E R T Y ===
  if (activeTab === 'note') {
    if (key === 'q') { setNT('n'); return; }    // Note
    if (key === 'w') { setNT('ln'); return; }   // Long
    if (key === 'e') { setNT('w'); return; }    // Wide
    if (key === 'r') { setNT('wl'); return; }   // WLN
    if (key === 'u') { setNT('txt'); return; }  // Text
    return;
  }

  // === Shapes tab specific: Q W E R T S V 1-5 ===
  if (activeTab === 'shape') {
    if (key === 'q') { setST('L'); return; }    // Left
    if (key === 'w') { setST('R'); return; }    // Right
    if (key === 'e') { setST('C'); return; }    // Center
    if (key === 'r') { setST('P'); return; }    // Pinch
    if (key === 't') { setST('line'); return; } // Line
    if (key === 's') { toggleMirror(); return; } // Mirror
    if (key === 'v') { cyclePosSnap(); return; } // Cycle pos snap
    // Easing shortcuts: 1-5
    if (key === '1') { pickEase('Arc'); return; }
    if (key === '2') { pickEase('Out-Sine'); return; }
    if (key === '3') { pickEase('In-Sine'); return; }
    if (key === '4') { pickEase('Linear'); return; }
    if (key === '5') { pickEase('Step'); return; }
    return;
  }
});

// ============================================================
//  GLOBAL EXPOSURE — make functions reachable from inline HTML handlers
// ============================================================
// Phase 1 keeps existing onclick="funcName()" attributes working. The module
// scope doesn't automatically publish its bindings to window, so we do it
// explicitly. Later phases will convert onclick= to addEventListener and
// shrink this block.
Object.assign(window, {
  // Data accessed from inline handlers (e.g. oninput="D.metadata.title=this.value")
  D,
  // $ is the DOM helper, used by inline handlers like onclick="$('audF').click()"
  $: $,
  // Tab / tool / fullscreen
  goTab, goFS,
  setNT, setST, pickEase,
  // Undo / redo
  undo, redo,
  // Notes editing
  doCopy, doPaste, nZ, toggleFollow, toggleGP, closeGP,
  // Shapes editing
  doShapeCopy, doShapePaste, sZ, toggleSFollow, toggleMirror, cyclePosSnap,
  // Grid pickers (referenced via template string `${cb}(${d})` in buildGP)
  pickNG, pickSG,
  // Playback — editor
  toggleEdPlay, edSeek, toggleMetronome, setOffsetHere, setGlobalPreset, setPlaybackRate, drawN,
  // Text events
  teNew, teSave, teDelete, teEditByIdx, tePickSelect,
  // Tempo / time signature (meta tab)
  addTempo, editTempo, delTempo, addTimeSig, editTS, delTS,
  // Play mode (v21: unified from former Preview + Play)
  playToggle, playRestart, playSeekTo,
  stopPlay, resetKeyBindings,
  // File / import / export
  doExport, doImport, showMod, closeMod, fmSave, fmSaveAs, fmLoad, fmDelete,
  // Audio
  loadAud,
});

// ============================================================
//  INITIALIZATION
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // Hook m-scope command side effects (UI refresh, auto-save).
  // Runs uniformly for apply/undo/redo — no bookkeeping at each edit site.
  onDispatch(_afterMetaCommand);

  // Convert any Still/Arc easings to Linear
  D.shapeEvents.forEach(e => {
    if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear';
  });
  
  // Check for auto-save
  const autoKey = LS_PREFIX + '__autosave__';
  const autoRaw = localStorage.getItem(autoKey);
  if (autoRaw) {
    try {
      const d = JSON.parse(autoRaw);
      const savedAt = d._savedAt ? new Date(d._savedAt).toLocaleString('ko-KR') : '';
      if (confirm(`Auto-save found${savedAt ? ' (' + savedAt + ')' : ''}.\nLoad it?`)) {
        loadChartData(d);
      }
    } catch(e) {}
  }

  // Wire up inputs that previously used inline `onchange="globalOffset=..."`-style
  // handlers. Inline handlers execute in window scope, which can't see module-local
  // `let` bindings, so those four are now bound programmatically.
  const globOffInput = $('mGlobalOff');
  if (globOffInput) globOffInput.addEventListener('change', e => { globalOffset = +e.target.value; });
  const hitVolInput = $('mHitVol');
  if (hitVolInput) hitVolInput.addEventListener('input', e => {
    hitVol = e.target.value / 100;
    $('hitVolLbl').textContent = e.target.value + '%';
  });
  const spdInput = $('mSpd');
  if (spdInput) spdInput.addEventListener('change', e => { pvSpd = +e.target.value; });
  const thkInput = $('mThk');
  if (thkInput) thkInput.addEventListener('change', e => { nThk = +e.target.value; });

  // v21: autoplay toggle in the Play tab control bar
  const autoChk = $('playAutoChk');
  if (autoChk) autoChk.addEventListener('change', e => { playAutoplay = e.target.checked; });
  
  compBPM(); updateTotalMs(); saveHist('n'); saveHist('s'); saveHist('m');
  buildGP('ngp', nGD, 'pickNG'); buildGP('sgp', sGD, 'pickSG');
  syncMeta(); renderTempoList(); renderTSList();
  loadKeyBindings(); renderKeyCfg();
  requestAnimationFrame(() => { rszActiveCanvas(); drawN(); });
  
  // Auto-save on page close
  window.addEventListener('beforeunload', () => { autoSave(); });
  // Periodic auto-save every 60s
  setInterval(autoSave, 60000);
});
