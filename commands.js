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
