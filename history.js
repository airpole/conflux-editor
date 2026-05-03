// ============================================================
//  HISTORY — snapshot stacks for n/s/m scopes + undo/redo
// ============================================================
// Phase A keeps the legacy snapshot mechanism unchanged. Tempo/TS edits
// already dispatch commands (m-scope) and undo/redo prefers the command
// stack first; this module just relocates the original logic.
//
// Future Phase B-1: migrate notes & shape edits to commands.js, delete
// histScopes.n / histScopes.s, then collapse this file entirely.

import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { compBPM, invalidateTSCache } from './timing.js';
import { invalidateShapeCache, invalidateLinesCache } from './shape.js';
import { invalidateNoteOverlaps } from './overlaps.js';
import { hasUndo as hasCmdUndo, hasRedo as hasCmdRedo, undoCmd, redoCmd } from './commands.js';
import { updateTotalMs } from './load-chart.js';

// Lazy access to renderers + meta UI to avoid load-time cycles.
function _drawN()      { import('./notes-render.js').then(m => m.drawN()); }
function _drawS()      { import('./shape-render.js').then(m => m.drawS()); }
function _drawIdle()   { import('./play-render.js').then(m => { if (!PS.playActive) m.drawPlayIdle(); }); }
function _syncMeta()   { import('./meta-ui.js').then(m => m.syncMeta()); }
function _scheduleAS() { import('./autosave.js').then(m => m.scheduleAutoSave()); }

// Scope table: each scope defines what state it captures/restores.
//   'n' = notes + textEvents
//   's' = shapeEvents + lineEvents
//   'm' = tempo + timeSignatures + metadata
const histScopes = {
  n: {
    capture: () => ({notes: D.notes, textEvents: D.textEvents}),
    restore: (d) => {
      if (d && d.notes) { D.notes = d.notes; D.textEvents = d.textEvents || []; }
      else { D.notes = d; D.textEvents = []; } // back-compat
      invalidateNoteOverlaps();
      ES.selectedNotes.clear();
      if (ES.activeTab === 'note') _drawN();
    }
  },
  s: {
    capture: () => ({shapeEvents: D.shapeEvents, lineEvents: D.lineEvents}),
    restore: (d) => {
      if (d && d.shapeEvents) {
        D.shapeEvents = d.shapeEvents;
        if (d.lineEvents) D.lineEvents = d.lineEvents;
      } else {
        D.shapeEvents = d; // back-compat
      }
      invalidateShapeCache(); invalidateLinesCache();
      ES.selectedShapeEvts.clear();
      if (ES.activeTab === 'shape') _drawS();
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
      _syncMeta();
      if (ES.activeTab === 'note') _drawN();
      else if (ES.activeTab === 'shape') _drawS();
      else if (ES.activeTab === 'play' && !PS.playActive) _drawIdle();
    }
  }
};

const hist = {n: [], s: [], m: []};
const histIdx = {n: -1, s: -1, m: -1};

export function saveHist(w) {
  const scope = histScopes[w]; if (!scope) return;
  if (w === 'n') invalidateNoteOverlaps();
  const data = JSON.stringify(scope.capture());
  // Dedup
  if (histIdx[w] >= 0 && hist[w][histIdx[w]] === data) return;
  hist[w] = hist[w].slice(0, histIdx[w] + 1);
  hist[w].push(data);
  if (hist[w].length > 60) { hist[w].shift(); histIdx[w]--; }
  histIdx[w] = hist[w].length - 1;
  _scheduleAS();
  updateTotalMs();
}

export function undo(w) {
  // m-scope tries the command stack first.
  if (w === 'm' && hasCmdUndo()) { undoCmd(); return; }
  const scope = histScopes[w]; if (!scope) return;
  saveHist(w);
  if (histIdx[w] <= 0) return;
  histIdx[w]--;
  scope.restore(JSON.parse(hist[w][histIdx[w]]));
}

export function redo(w) {
  if (w === 'm' && hasCmdRedo()) { redoCmd(); return; }
  const scope = histScopes[w]; if (!scope) return;
  if (histIdx[w] >= hist[w].length - 1) return;
  histIdx[w]++;
  scope.restore(JSON.parse(hist[w][histIdx[w]]));
}
