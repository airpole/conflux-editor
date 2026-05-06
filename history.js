// ============================================================
//  HISTORY — undo/redo wrappers over commands.js scope stacks
// ============================================================
// As of v17 history is fully driven by the commands.js scope-partitioned
// stacks (n / s / m). The legacy snapshot system (saveHist + JSON.stringify
// per scope) was removed once all user-action sites finished migrating to
// dispatch(). This file is now a thin shim that:
//
//   - exposes undo(w) / redo(w) for keyboard.js and the inline onclick
//     handlers in index.html
//   - re-exports clearAllHistory() under the legacy-friendly name
//     `clearHistoryBaseline` for chart load/import sites
//
// Selection state and the active-tab redraw are handled by the onDispatch
// listener in meta-ui.js (_afterAnyCommand), which fires for every
// dispatch / undo / redo. There's no scope-specific restore logic here
// any more — each command's undo()/apply() does its own restoration.

import { ES } from './editor-state.js';
import { undoCmd, redoCmd, hasUndo, hasRedo, clearAllHistory } from './commands.js';

/**
 * Walk one step back on the given scope's command stack. After undo,
 * dispatch listeners (in meta-ui.js) handle the redraw + autosave.
 * Selection state is cleared because note/shape references in the
 * selection set may have been removed by the undo (e.g. an AddNotes undo
 * filters them out of D.notes; a stale selection would still hold them).
 */
export function undo(w) {
  if (!hasUndo(w)) return;
  if (w === 'n') ES.selectedNotes.clear();
  else if (w === 's') ES.selectedShapeEvts.clear();
  undoCmd(w);
}

export function redo(w) {
  if (!hasRedo(w)) return;
  if (w === 'n') ES.selectedNotes.clear();
  else if (w === 's') ES.selectedShapeEvts.clear();
  redoCmd(w);
}

/**
 * Clear all undo/redo stacks. Called on chart init/load/import to mark a
 * clean baseline. Replaces the v9–v16 idiom of pushing one snapshot per
 * scope to seed each timeline.
 */
export const clearHistoryBaseline = clearAllHistory;
