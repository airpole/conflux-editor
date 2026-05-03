// ============================================================
//  COMMANDS — dispatch, command stack, factories
// ============================================================
// A Command is { name, apply, undo, invalidates }.
//   apply()        : run the mutation
//   undo()         : reverse it
//   invalidates[]  : dep keys passed to cache.invalidate()
//
// dispatch(cmd) applies the command, invalidates caches, pushes onto
// the undo stack, and clears the redo stack. undoCmd/redoCmd walk
// the stacks. A listener subscription (onDispatch) lets main.js hook
// side effects like auto-save and redraws without commands.js knowing
// about them.
//
// This stack is independent of the legacy saveHist snapshot stacks in
// main.js. When the user presses Ctrl+Z, main.js decides which stack
// to pop (see main.js's undo() wrapper).

import { D } from './state.js';
import { invalidate } from './cache.js';

const undoStack = [];
const redoStack = [];
const LIMIT = 60;

const listeners = [];

/** Factory helper for building command objects. */
export function cmd(name, apply, undo, invalidates = []) {
  return { name, apply, undo, invalidates };
}

/** Apply a command, invalidate its declared caches, and push onto the stack. */
export function dispatch(command) {
  command.apply();
  invalidate(command.invalidates);
  undoStack.push(command);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  for (const l of listeners) l(command);
}

/** Undo the most recent command. Returns the command that was undone, or null. */
export function undoCmd() {
  const c = undoStack.pop();
  if (!c) return null;
  c.undo();
  invalidate(c.invalidates);
  redoStack.push(c);
  for (const l of listeners) l(c, 'undo');
  return c;
}

/** Redo the most recently undone command. Returns it, or null. */
export function redoCmd() {
  const c = redoStack.pop();
  if (!c) return null;
  c.apply();
  invalidate(c.invalidates);
  undoStack.push(c);
  for (const l of listeners) l(c, 'redo');
  return c;
}

export function hasUndo() { return undoStack.length > 0; }
export function hasRedo() { return redoStack.length > 0; }

/** Subscribe to dispatch events. listener(cmd, 'apply'|'undo'|'redo'). Returns unsubscribe fn. */
export function onDispatch(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Peek at the top of the undo stack without popping (for merging Ctrl+Z decisions). */
export function peekUndo() { return undoStack[undoStack.length - 1] || null; }

// ============================================================
//  COMMAND FACTORIES
// ============================================================
// Each factory captures enough state at call time (the `old*` params)
// to reverse the change. Callers must pass in-range indices based on
// the sorted list they showed the user; the factory stores the tick
// (identity) not the index to survive re-sorting between apply and undo.

// ---- Tempo ----

/** Add a tempo change. */
export const AddTempo = (entry) => cmd(
  'AddTempo',
  () => {
    D.tempo.push({...entry});
    D.tempo.sort((a, b) => a.tick - b.tick);
  },
  () => {
    const i = D.tempo.findIndex(t => t.tick === entry.tick);
    if (i >= 0) D.tempo.splice(i, 1);
  },
  ['tempo']
);

/** Delete a tempo change at the given tick. `entry` is the snapshot used for undo. */
export const DeleteTempo = (entry) => cmd(
  'DeleteTempo',
  () => {
    const i = D.tempo.findIndex(t => t.tick === entry.tick);
    if (i >= 0) D.tempo.splice(i, 1);
  },
  () => {
    D.tempo.push({...entry});
    D.tempo.sort((a, b) => a.tick - b.tick);
  },
  ['tempo']
);

/** Change BPM at a given tempo entry (identified by tick). */
export const EditTempoBpm = (tick, oldBpm, newBpm) => cmd(
  'EditTempoBpm',
  () => {
    const t = D.tempo.find(x => x.tick === tick);
    if (t) t.bpm = newBpm;
  },
  () => {
    const t = D.tempo.find(x => x.tick === tick);
    if (t) t.bpm = oldBpm;
  },
  ['tempo']
);

// ---- Time signature ----

export const AddTimeSig = (entry) => cmd(
  'AddTimeSig',
  () => {
    D.timeSignatures.push({...entry});
    D.timeSignatures.sort((a, b) => a.tick - b.tick);
  },
  () => {
    const i = D.timeSignatures.findIndex(t => t.tick === entry.tick);
    if (i >= 0) D.timeSignatures.splice(i, 1);
  },
  ['timeSignatures']
);

export const DeleteTimeSig = (entry) => cmd(
  'DeleteTimeSig',
  () => {
    const i = D.timeSignatures.findIndex(t => t.tick === entry.tick);
    if (i >= 0) D.timeSignatures.splice(i, 1);
  },
  () => {
    D.timeSignatures.push({...entry});
    D.timeSignatures.sort((a, b) => a.tick - b.tick);
  },
  ['timeSignatures']
);

/** Edit numerator/denominator at a given TS entry (identified by tick).
 *  oldTs and newTs are {numerator, denominator} snapshots. */
export const EditTimeSig = (tick, oldTs, newTs) => cmd(
  'EditTimeSig',
  () => {
    const t = D.timeSignatures.find(x => x.tick === tick);
    if (t) { t.numerator = newTs.numerator; t.denominator = newTs.denominator; }
  },
  () => {
    const t = D.timeSignatures.find(x => x.tick === tick);
    if (t) { t.numerator = oldTs.numerator; t.denominator = oldTs.denominator; }
  },
  ['timeSignatures']
);

// ---- Shape events ----
// Shape events live in D.shapeEvents and are heavily interdependent through
// normalizeShapeChain — adding/removing/flipping any one event re-derives
// startTick/duration of every other event on the same chain. Each shape
// command therefore calls normalizeShapeChain() on BOTH chains in apply()
// and undo(), preserving the v9 baseline behavior (always normalize both).
//
// Init events (easing === null) are anchor rows that cannot be removed.
// Delete/Flip factories silently skip them.

import { normalizeShapeChain } from './shape.js';

const _normalizeBothChains = () => {
  normalizeShapeChain(false);
  normalizeShapeChain(true);
};

/**
 * Add one or more shape events. Caller passes fresh event objects; this
 * factory pushes them and re-normalizes both chains. Undo removes them.
 * Both branches normalize so dependent events return to the right ticks.
 */
export const AddShapeEvents = (events) => cmd(
  'AddShapeEvents',
  () => {
    for (const e of events) D.shapeEvents.push(e);
    _normalizeBothChains();
  },
  () => {
    D.shapeEvents = D.shapeEvents.filter(e => !events.includes(e));
    _normalizeBothChains();
  },
  ['shapeEvents']
);

/**
 * Delete multiple shape events at once.
 * Init events (easing === null) are silently kept — Left/Right init anchor
 * rows cannot be removed.
 */
export const DeleteShapeEvents = (events) => {
  const deletable = events.filter(e => e.easing !== null);
  return cmd(
    'DeleteShapeEvents',
    () => {
      D.shapeEvents = D.shapeEvents.filter(e => !deletable.includes(e));
      _normalizeBothChains();
    },
    () => {
      for (const e of deletable) D.shapeEvents.push(e);
      _normalizeBothChains();
    },
    ['shapeEvents']
  );
};

/**
 * Mirror selected shape events around the center axis. Init events skipped.
 * `pairs` = [{ event, oldTargetPos, oldIsRight, newTargetPos, newIsRight }, ...]
 * Caller computes new values; apply() and undo() force them in place.
 * The flip itself moves an event between chains, so both chains are normalized.
 */
export const FlipShapeEvents = (pairs) => cmd(
  'FlipShapeEvents',
  () => {
    for (const p of pairs) {
      p.event.targetPos = p.newTargetPos;
      p.event.isRight = p.newIsRight;
    }
    _normalizeBothChains();
  },
  () => {
    for (const p of pairs) {
      p.event.targetPos = p.oldTargetPos;
      p.event.isRight = p.oldIsRight;
    }
    _normalizeBothChains();
  },
  ['shapeEvents']
);

// ---- Notes ----
// Notes are mutated in place by reference, so command factories store the
// note objects directly (not snapshots). Each note is identity-stable across
// undo/redo because nothing reassigns D.notes elements; D.notes itself may be
// rebuilt by `filter`, but the note objects survive and are pushed back.
//
// invalidates ['notes'] flushes overlap/cache state via overlaps.js +
// scheduler.js dependency declarations.

/** Add one or more notes (refs to fresh objects). */
export const AddNotes = (notes) => cmd(
  'AddNotes',
  () => { for (const n of notes) D.notes.push(n); },
  () => { D.notes = D.notes.filter(n => !notes.includes(n)); },
  ['notes']
);

/** Delete one or more notes by reference. */
export const DeleteNotes = (notes) => cmd(
  'DeleteNotes',
  () => { D.notes = D.notes.filter(n => !notes.includes(n)); },
  () => { for (const n of notes) D.notes.push(n); },
  ['notes']
);

/**
 * Move multiple notes in tick and/or channel space. Each entry carries
 * BOTH the old and new state explicitly, so the caller is responsible
 * for capturing originals before the drag starts. This avoids the
 * "ambiguous when to capture" problem with mutate-during-drag UIs:
 * by the time drag-end fires, the notes already hold the new values.
 *
 * `entries` = [{ note, oldStartTick, oldChannel, newStartTick, newChannel }, ...].
 * apply() forces the new state; undo() forces the old state. Both are
 * idempotent — apply after apply is a no-op since the values match.
 */
export const MoveNotes = (entries) => cmd(
  'MoveNotes',
  () => {
    for (const e of entries) {
      e.note.startTick = e.newStartTick;
      e.note.channel = e.newChannel;
    }
  },
  () => {
    for (const e of entries) {
      e.note.startTick = e.oldStartTick;
      e.note.channel = e.oldChannel;
    }
  },
  ['notes']
);

/**
 * Flip channel of multiple non-wide notes (e.g., MIRROR_CH).
 * `pairs` = [{ note, newChannel }, ...]. Old channel is captured at
 * construction time so callers can dispatch BEFORE mutating.
 */
export const FlipNotes = (pairs) => {
  const snap = pairs.map(p => ({
    note: p.note,
    oldChannel: p.note.channel,
    newChannel: p.newChannel
  }));
  return cmd(
    'FlipNotes',
    () => { for (const s of snap) s.note.channel = s.newChannel; },
    () => { for (const s of snap) s.note.channel = s.oldChannel; },
    ['notes']
  );
};

/** Change a single note's duration (LN extend/shrink, or LN-replaces-tap). */
export const SetNoteDuration = (note, newDuration) => {
  const oldDuration = note.duration || 0;
  return cmd(
    'SetNoteDuration',
    () => { note.duration = newDuration; },
    () => { note.duration = oldDuration; },
    ['notes']
  );
};

/**
 * Atomic remove-then-add. Used when a new note displaces an existing one
 * (e.g. LN-replaces-tap workflow where dropping an LN at the same tick/
 * channel as a tap deletes the tap first, then inserts the LN).
 * Single command so undo restores both states in one step.
 *
 * `removed` = note refs to delete (may be empty)
 * `added`   = note refs to insert (typically one fresh object)
 */
export const ReplaceNotes = (removed, added) => cmd(
  'ReplaceNotes',
  () => {
    if (removed.length) D.notes = D.notes.filter(n => !removed.includes(n));
    for (const n of added) D.notes.push(n);
  },
  () => {
    D.notes = D.notes.filter(n => !added.includes(n));
    for (const n of removed) D.notes.push(n);
  },
  ['notes']
);

// ---- Text events ----

/** Add one or more text events. */
export const AddTextEvents = (events) => cmd(
  'AddTextEvents',
  () => { for (const e of events) D.textEvents.push(e); },
  () => { D.textEvents = D.textEvents.filter(e => !events.includes(e)); },
  ['textEvents']
);

/** Delete one or more text events by reference. */
export const DeleteTextEvents = (events) => cmd(
  'DeleteTextEvents',
  () => { D.textEvents = D.textEvents.filter(e => !events.includes(e)); },
  () => { for (const e of events) D.textEvents.push(e); },
  ['textEvents']
);

/**
 * Edit a text event's mutable fields. `oldFields` and `newFields` are
 * partial objects; only the keys present are touched.
 */
export const EditTextEvent = (event, oldFields, newFields) => cmd(
  'EditTextEvent',
  () => { Object.assign(event, newFields); },
  () => { Object.assign(event, oldFields); },
  ['textEvents']
);
