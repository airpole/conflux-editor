// ============================================================
//  PLAY-STATE — mutable play-session state (single shared object)
// ============================================================
// Key bindings + entire play-session state. Created on module load,
// reset (via Set/Map .clear() or field reassignment) by startPlay/stopPlay.
//
// Migration map (v20 main.js → v21 PS.):
//   keyBindings/codeToChannel → PS.*
//   keyConfigMode → PS.keyConfigMode
//   playActive/playFullscreen → PS.*
//   playStartedFromBeginning/playAutoplay → PS.*
//   playT0/playOffMs/playAudioStarted → PS.*
//   playHitMap/playMissSet/playEffects → PS.*
//   playCombo/playMaxCombo/playJudgQueue → PS.*
//   playHoldState/playKeyHeld → PS.*
//   playRAF → PS.playRAF
//   _seekDragMs → PS.seekDragMs

import { DEFAULT_KEYS } from './constants.js';

export const PS = {
  keyBindings: {...DEFAULT_KEYS},
  codeToChannel: {},
  keyConfigMode: null,

  playActive: false,
  playFullscreen: false,
  playStartedFromBeginning: false,
  playAutoplay: false,

  playT0: 0,
  playOffMs: 0,
  playAudioStarted: false,

  playHitMap: new Map(),
  playMissSet: new Set(),
  playEffects: [],
  playCombo: 0,
  playMaxCombo: 0,
  playJudgQueue: [],

  playHoldState: {},
  playKeyHeld: new Set(),

  playRAF: null,
  seekDragMs: null,

  // ── Gauge / clear-mark lock (game mode) ──────────────────────
  // Set before a session (from Music Select inline options); reset values are
  // re-applied at session start by resetGauge() in gauge.js.
  gaugeType: 'normal',     // 'normal' | 'hard'
  gaugeValue: 0,           // current 0–100 life
  lockTarget: 'none',      // 'none' | 'fc' | 'ap' | 'as'  (mark being attempted)
  lockMode: 'terminate',   // 'terminate' | 'cascade'
  lockTier: 'none',        // live highest-intact mark while playing (cascade lowers this)

  // Session outcome. Null until a session ends. Filled by computeResult().
  // { score, accuracy, rank, state, maxCombo, counts:{sync,perfect,good,miss},
  //   cleared, failed, options:{mirror,...} }
  playResult: null,
  // True when the session was force-ended (gauge death or terminate-mode lock
  // break). Distinguishes a fail-stop from a natural song-end stop.
  playForceEnded: false,

  // ── Fast / Slow feedback (ez2on-style) ──────────────────────
  // Only fires when a normal (non-wide) note lands OUTSIDE the SYNC window,
  // i.e. PERFECT or GOOD — telling the player that otherwise-good hit was
  // early (FAST) or late (SLOW). Shown briefly under the accuracy %, then
  // fades. Running totals are NOT drawn in-game; they appear only on Result.
  //   flashTiming: 'FAST' | 'SLOW' | null  — what to flash right now
  //   flashAt:     ms timestamp the flash started (for fade-out)
  //   fastCount / slowCount: session totals, surfaced on the Result screen
  flashTiming: null,
  flashAt: 0,
  fastCount: 0,
  slowCount: 0,
  showFastSlow: true,      // Settings toggle
  visualOffset: 0,         // ms; subtracted from input time (note/judge timing)
  sudden: 0,               // lane cover from top, 0..100 (% of field height)
  hidden: 0,               // lane cover from bottom, 0..100 (% of field height)
};

/** Rebuild PS.codeToChannel from PS.keyBindings. Called on key bind change. */
export function rebuildCodeToChannel() {
  PS.codeToChannel = {};
  for (const [ch, code] of Object.entries(PS.keyBindings)) {
    PS.codeToChannel[code] = +ch;
  }
}

// Initial build at module load so handlers see the defaults.
rebuildCodeToChannel();
