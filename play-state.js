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
