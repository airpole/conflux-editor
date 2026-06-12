// ============================================================
//  SETTINGS — single source of truth for all player settings
// ============================================================
// One persisted object holding every Settings-screen value, saved under one
// localStorage key (LS_PREFIX + 'settings'). The Settings scene reads/writes
// this; the engine reads applied values from the places it already looks (ES,
// PS, audio gains, renderer). applySettings() pushes the object's values into
// those places so existing engine code keeps working unchanged.
//
// Category layout (mirrors the Settings scene tabs):
//   PLAY    — hiSpeed, audioOffset, visualOffset, showFallMs, (keybindings live in PS),
//             volMaster / volMusic / volEffect
//   VISUAL  — noteSkin, laneOpacity, bgBrightness, sudden, hidden,
//             hitEffect, frameCap, showCombo, showJudgment, showFastSlow
//   GAUGE   — gauge (one of: cascade/as/ap/fc/hard/normal)
//   OPTION  — mirror, random            (recorded)
//             cmod, autoplay, staticShape, noFail   (NOT recorded)
//
// Record policy: any "not recorded" option being active means the run's score
// is not saved. isRecordingDisabled() centralises that test so adding a new
// no-record modifier later is a one-line change.

import { LS_PREFIX } from './constants.js';

const KEY = LS_PREFIX + 'settings';

// ── Schema / defaults ────────────────────────────────────────
// Every setting with its default. Loading merges saved values over these, so
// adding a new setting here is automatically backward-compatible.
export const DEFAULT_SETTINGS = {
  // PLAY
  hiSpeed: 3.0,          // scroll speed (was ES.pvSpd)
  audioOffset: 0,        // ms; shifts MUSIC start (+ = music earlier, for laggy audio out)
  visualOffset: 0,       // ms; shifts JUDGE time (+ = input treated earlier, for late hitters)
  showFallMs: false,     // show note fall-time readout (Stage 5)
  volMaster: 1.0,
  volMusic: 0.7,
  volEffect: 1.0,        // absorbs the old ES.hitVol

  // VISUAL
  noteSkin: 'bar',       // 'bar' | 'circle'  (normal notes only)
  laneOpacity: 1.0,      // 0..1
  bgBrightness: 100,     // 0..100 (mirrors D.metadata.jacketBrightness range)
  sudden: 0,             // lane cover from top, 0..100 (Stage 5)
  hidden: 0,             // lane cover from bottom, 0..100 (Stage 5)
  hitEffect: true,
  frameCap: 0,           // 0 = uncapped (follows display); 30/60 = cap
  noteThickness: 15,     // was ES.nThk
  showCombo: true,
  showJudgment: true,
  showFastSlow: true,

  // GAUGE — single ladder pick
  gauge: 'normal',       // 'cascade'|'as'|'ap'|'fc'|'hard'|'normal'

  // OPTION (recorded)
  mirror: false,
  random: false,
  // OPTION (not recorded)
  cmod: false,           // constant scroll speed (ignores BPM changes)
  autoplay: false,
  staticShape: false,    // freeze shape to fixed -2/+2 (note practice)
  noFail: false,
};

// ── State ────────────────────────────────────────────────────
let _settings = { ...DEFAULT_SETTINGS };

export function getSettings() { return _settings; }
export function getSetting(key) { return _settings[key]; }

// ── Persistence ──────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge over defaults so unknown/missing keys fall back gracefully.
      _settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch { _settings = { ...DEFAULT_SETTINGS }; }
  return _settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(_settings)); } catch {}
}

/**
 * Set one setting, persist, and apply it to the engine. `deps` carries the
 * live engine objects/functions so this module imports none of them directly
 * (keeps settings a low-level leaf, avoids import cycles). Pass the same deps
 * used at init.
 */
export function setSetting(key, value, deps) {
  _settings[key] = value;
  saveSettings();
  applySettings(deps);
}

// ── GAUGE ladder ↔ internal lock fields ──────────────────────
// The 6-way ladder maps onto the existing PS.lockTarget / PS.lockMode pair:
//   cascade → target 'as', mode 'cascade'   (steps AS→AP→FC→Hard→Normal)
//   as/ap/fc → that target, mode 'terminate' (break = instant game over)
//   hard/normal → no lock, gaugeType set, mode 'terminate'
export function gaugeToLock(gauge) {
  switch (gauge) {
    case 'cascade': return { gaugeType: 'normal', lockTarget: 'as', lockMode: 'cascade' };
    case 'as':      return { gaugeType: 'normal', lockTarget: 'as', lockMode: 'terminate' };
    case 'ap':      return { gaugeType: 'normal', lockTarget: 'ap', lockMode: 'terminate' };
    case 'fc':      return { gaugeType: 'normal', lockTarget: 'fc', lockMode: 'terminate' };
    case 'hard':    return { gaugeType: 'hard',   lockTarget: 'none', lockMode: 'terminate' };
    case 'normal':
    default:        return { gaugeType: 'normal', lockTarget: 'none', lockMode: 'terminate' };
  }
}

// ── Record policy ────────────────────────────────────────────
// True when the active config must NOT save a score. Any no-record modifier
// flips this; add future no-record options to this single test.
export function isRecordingDisabled() {
  const s = _settings;
  return !!(s.autoplay || s.staticShape || s.noFail || s.cmod);
}

// ── Apply to engine ──────────────────────────────────────────
// Push current settings into the places the engine reads. Called on init and
// after every setSetting. `deps` = { ES, PS, setNoteSkin, audio } — all optional
// so partial wiring during staged development doesn't crash.
export function applySettings(deps) {
  const s = _settings;
  const d = deps || {};

  // Scroll speed + note thickness live on ES (read by game-render via CTX).
  if (d.ES) {
    d.ES.pvSpd = s.hiSpeed;
    d.ES.nThk = s.noteThickness;
    d.ES.hitVol = s.volEffect;      // legacy field still read by play.js hit path
  }

  // Note skin (renderer module state).
  if (d.setNoteSkin) d.setNoteSkin(s.noteSkin);

  // Gauge ladder → lock fields on PS.
  if (d.PS) {
    const lk = gaugeToLock(s.gauge);
    d.PS.gaugeType = lk.gaugeType;
    d.PS.lockTarget = lk.lockTarget;
    d.PS.lockMode = lk.lockMode;
    d.PS.showFastSlow = s.showFastSlow;
    d.PS.playAutoplay = s.autoplay;
    d.PS.visualOffset = s.visualOffset;
  }

  // Audio offset shifts the music start; stored where the audio start path reads
  // it. Kept separate from visualOffset so the two latencies tune independently.
  if (d.setAudioOffset) d.setAudioOffset(s.audioOffset);

  // Audio gains (master / music / effect).
  if (d.audio && d.audio.setVolumes) {
    d.audio.setVolumes(s.volMaster, s.volMusic, s.volEffect);
  }
}
