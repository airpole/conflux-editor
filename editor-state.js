// ============================================================
//  EDITOR-STATE — mutable editor state (single shared object)
// ============================================================
// All editor mutables live here so any module can read/write through
// `ES.foo`. ES modules' read-only import bindings prevent external `let`
// reassignment, so we package these as fields on a const object — the
// same pattern as `D` in state.js. Mutating ES.foo from anywhere works
// because object property writes don't conflict with binding immutability.
//
// Migration map (v20 main.js → v21 ES.):
//   activeTab → ES.activeTab          nGD/sGD → ES.nGD/sGD
//   nTool/sTool → ES.nTool/sTool      nScr/sScr → ES.nScr/sScr
//   edZm → ES.edZm                    nFollow/sFollow → ES.nFollow/sFollow
//   pvSpd/nThk/hitVol → ES.*          pendLN/pendTE/pendArc → ES.*
//   savedLNDur → ES.savedLNDur        sPosSnapLevel/sMirror → ES.*
//   selectedNotes/clipboard → ES.*    selectedShapeEvts/shapeClipboard → ES.*
//   editingTextEvt → ES.editingTextEvt
//   edPlay/edT0/edMs0/edRAF/edHitSet/edLastBeat → ES.*
//   totalMs/audioMs → ES.totalMs/ES.audioMs
//   sharedMs → ES.sharedMs
//   currentFileName/autoSaveTimer → ES.*

import { TPB, DEFAULT_KEYS } from './constants.js';

export const ES = {
  // Tab & tool
  activeTab: 'note',
  nTool: 'sel', sTool: 'L',
  nGD: 2, sGD: 2,
  nScr: 0, edZm: 1,
  sScr: 0,
  nFollow: true, sFollow: true,

  // Preview/render settings
  pvSpd: 3.0, nThk: 15, hitVol: 1.0, judgeLinePos: 8 / 9,

  // Pending operations
  pendLN: null,
  pendTE: null,
  pendArc: null,
  savedLNDur: TPB,

  // Shape editor settings
  sPosSnapLevel: 0,
  sMirror: false,

  // Time totals
  totalMs: 60000,
  audioMs: 0,

  // Cross-tab shared playback position (in ms)
  sharedMs: 0,

  // Selection & clipboard (Notes)
  selectedNotes: new Set(),
  clipboard: [],

  // Selection & clipboard (Shapes)
  selectedShapeEvts: new Set(),
  shapeClipboard: [],

  // Text events
  editingTextEvt: null,

  // Editor playback (n = Notes, s = Shape)
  edPlay:     {n: false, s: false},
  edT0:       {n: 0, s: 0},
  edMs0:      {n: 0, s: 0},
  edRAF:      {n: null, s: null},
  edHitSet:   {n: new Set(), s: new Set()},
  edLastBeat: {n: -1, s: -1},

  // File management
  currentFileName: '',
  autoSaveTimer: null,
};
