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

/**
 * Delete multiple shape events at once. Reserved for future use when Shape
 * drag/edit operations migrate to Command pattern (Phase 3-5). Phase 3-1
 * (multi-delete via sel+del) continues to use the saveHist('s') snapshot
 * stack to keep undo ordering interleaved with existing Shape edits.
 *
 * `events` is an array of shape event references (identity, not snapshots).
 * Init events (easing === null) are silently kept — Left/Right init anchor
 * rows cannot be removed.
 */
export const DeleteShapeEvents = (events) => {
  const deletable = events.filter(e => e.easing !== null);
  return cmd(
    'DeleteShapeEvents',
    () => {
      D.shapeEvents = D.shapeEvents.filter(e => !deletable.includes(e));
    },
    () => {
      D.shapeEvents.push(...deletable);
    },
    ['shapeEvents']
  );
};

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
 * Move multiple notes in tick and/or channel space.
 * `moves` = [{ note, newStartTick, newChannel }, ...]. Each note's current
 * startTick/channel is captured at construction so callers can pass the
 * already-mutated object — but cleanest usage is to call BEFORE mutating
 * and let dispatch run apply() to perform the change. (Phase B-1 will
 * adopt the latter pattern; FlipNotes shows how.)
 */
export const MoveNotes = (moves) => {
  const snap = moves.map(m => ({
    note: m.note,
    oldStartTick: m.note.startTick,
    oldChannel: m.note.channel,
    newStartTick: m.newStartTick,
    newChannel: m.newChannel
  }));
  return cmd(
    'MoveNotes',
    () => {
      for (const s of snap) {
        s.note.startTick = s.newStartTick;
        s.note.channel = s.newChannel;
      }
    },
    () => {
      for (const s of snap) {
        s.note.startTick = s.oldStartTick;
        s.note.channel = s.oldChannel;
      }
    },
    ['notes']
  );
};

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
