// ============================================================
//  SCHEDULER — binary-search hitsound scheduling & miss checking
// ============================================================
// Replaces v19's per-frame O(N) scan over D.notes with an O(log N) binary
// search on seek/reset plus O(k) work per frame where k is the number of
// notes that just entered the window. For a 500+ note chart this takes
// scheduleHitsounds from several ms/frame to near-zero.
//
// Two pointer-based walkers share the same notesSorted cache:
//   - hitScheduler: advances a pointer past notes whose audio has been
//                   pre-scheduled into the AudioContext
//   - missChecker:  advances a pointer past notes whose miss window has
//                   closed without a hit
//
// Both invalidate their pointer when notesSorted rebuilds (detected via
// the cache's version counter). Callers must call resetHitScheduler or
// resetMissChecker on seek/restart; edits are handled automatically.

import { D } from './state.js';
import { defineCache, get, getVersion } from './cache.js';
import { t2ms } from './timing.js';
import { JUDGE_GOOD, JUDGE_WIDE_SYNC } from './constants.js';
defineCache('notesSorted', ['notes'], () =>
  [...D.notes].sort((a, b) => a.startTick - b.startTick)
);

/**
 * Binary search: first index i such that pred(arr[i]) is true.
 * Assumes pred is monotonic: false then true across the array.
 * Returns arr.length if no element satisfies pred.
 */
function lowerBound(arr, pred) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ============================================================
//  HITSOUND SCHEDULER
// ============================================================
// Playback-direction pointer. Advances through notesSorted as time progresses.
// On seek/restart, resetHitScheduler(curMs) rebinds the pointer by binary
// search to the first note at or after curMs.

let _hsIdx = 0;
let _hsScheduled = new WeakSet();  // notes already scheduled (re-schedule guard)
let _hsCacheVersion = -1;

/** Reset scheduling state. Call on seek, restart, play-from-beginning. */
export function resetHitScheduler(curMs) {
  const notes = get('notesSorted');
  _hsCacheVersion = getVersion('notesSorted');
  _hsScheduled = new WeakSet();
  _hsIdx = lowerBound(notes, n => t2ms(n.startTick) >= curMs);
}

/**
 * Pre-schedule hitsounds up to curMs + lookaheadMs into the AudioContext.
 * Call every frame during playback.
 *
 * @param {number} curMs                current chart ms
 * @param {number} lookaheadMs          how far ahead to schedule
 * @param {AudioContext} actx           the audio context (provides currentTime)
 * @param {(when: number) => void} playHitAt  scheduler function (AudioContext time)
 */
export function scheduleHitsounds(curMs, lookaheadMs, actx, playHitAt) {
  // If the cache rebuilt (notes mutated, chart loaded) our pointer is stale.
  if (getVersion('notesSorted') !== _hsCacheVersion) resetHitScheduler(curMs);

  const notes = get('notesSorted');
  const endMs = curMs + lookaheadMs;

  while (_hsIdx < notes.length) {
    const n = notes[_hsIdx];
    const nMs = t2ms(n.startTick);
    if (nMs >= endMs) break;  // beyond the lookahead window
    if (nMs >= curMs && !_hsScheduled.has(n)) {
      _hsScheduled.add(n);
      playHitAt(actx.currentTime + (nMs - curMs) / 1000);
    }
    _hsIdx++;
  }
}

// ============================================================
//  MISS CHECKER
// ============================================================
// Scans notes whose miss-window endpoint (startTick's ms + judgeWindow) has
// passed without a hit. Uses the same pointer pattern. Notes that are already
// hit or missed are skipped; notes not yet past their window end the sweep.

let _mcIdx = 0;
let _mcCacheVersion = -1;

/** Reset miss-checker state. Call on seek, restart, new play session. */
export function resetMissChecker(curMs) {
  const notes = get('notesSorted');
  _mcCacheVersion = getVersion('notesSorted');
  // Position just before the first note whose miss-window extends past curMs.
  // miss-window end = t2ms(startTick) + judgeWindow; for the pointer we want
  // the first index whose end is > curMs, i.e. t2ms(startTick) >= curMs - maxWin.
  const maxWin = Math.max(JUDGE_GOOD, JUDGE_WIDE_SYNC);
  _mcIdx = lowerBound(notes, n => t2ms(n.startTick) + maxWin >= curMs);
}

/**
 * Sweep notes whose miss window has closed. Invokes onMiss(note) for each
 * newly-missed note. Already-hit or already-missed notes are skipped (the
 * caller supplies a `isDone(note)` predicate).
 *
 * The pointer advances past notes for which no further decision is possible:
 * either the note is already resolved, or its miss-window endpoint has
 * passed (miss or hit has been decided by the time we reach this point in
 * each frame).
 *
 * Because different note types may have different miss windows (e.g.
 * JUDGE_GOOD vs JUDGE_WIDE_SYNC), we end the sweep only when even the
 * widest window hasn't closed yet. Within that window, each note is judged
 * against its own specific threshold.
 *
 * @param {number} curMs                      current chart ms
 * @param {(n: Note) => boolean} isDone       true if note is already hit or missed
 * @param {(n: Note) => void} onMiss          called when a note crosses into Missed
 */
export function checkPlayMisses(curMs, isDone, onMiss) {
  if (getVersion('notesSorted') !== _mcCacheVersion) resetMissChecker(curMs);

  const notes = get('notesSorted');
  const maxWin = Math.max(JUDGE_GOOD, JUDGE_WIDE_SYNC);

  // Advance the pointer only past notes fully in the past (beyond maxWin).
  // For notes whose startTick's ms is within [curMs - maxWin, curMs], we
  // inspect each against its own miss window but do NOT advance the pointer
  // past any that isn't yet done — a later note with a larger window might
  // still deserve a miss check next frame.
  while (_mcIdx < notes.length) {
    const n = notes[_mcIdx];
    const nStartMs = t2ms(n.startTick);
    if (nStartMs + maxWin >= curMs) break;  // all remaining notes still in-window
    if (!isDone(n)) onMiss(n);
    _mcIdx++;
  }
  // Additionally, emit misses for in-window notes whose own window has
  // closed (per-type threshold), without advancing the pointer past them.
  for (let i = _mcIdx; i < notes.length; i++) {
    const n = notes[i];
    const nStartMs = t2ms(n.startTick);
    if (nStartMs >= curMs) break;  // future — sorted by startTick
    if (isDone(n)) continue;
    const missWindow = n.isWide ? JUDGE_WIDE_SYNC : JUDGE_GOOD;
    if (nStartMs + missWindow < curMs) onMiss(n);
  }
}

// ============================================================
//  AUTO JUDGER (autoplay mode)
// ============================================================
// Used by Play mode when autoplay toggle is on. Every note whose startTick
// ms has just crossed curMs is auto-judged as SYNC and passed to onHit.
// Already-hit notes (via the caller-supplied isDone predicate) are skipped,
// so a pointer re-bind after seek won't double-hit.

let _ajIdx = 0;
let _ajCacheVersion = -1;

/** Reset auto-judger state. Call on seek, restart, session start. */
export function resetAutoJudger(curMs) {
  const notes = get('notesSorted');
  _ajCacheVersion = getVersion('notesSorted');
  _ajIdx = lowerBound(notes, n => t2ms(n.startTick) >= curMs);
}

/**
 * Auto-hit notes whose startTick has crossed curMs. Caller records the hit.
 *
 * @param {number} curMs                      current chart ms
 * @param {(n: Note) => boolean} isDone       true if already recorded (idempotency guard)
 * @param {(n: Note, diff: number) => void} onHit  called once per newly-crossed note; diff = curMs - noteMs (>= 0 typically)
 */
export function autoJudge(curMs, isDone, onHit) {
  if (getVersion('notesSorted') !== _ajCacheVersion) resetAutoJudger(curMs);
  const notes = get('notesSorted');
  while (_ajIdx < notes.length) {
    const n = notes[_ajIdx];
    const nMs = t2ms(n.startTick);
    if (nMs > curMs) break;
    if (!isDone(n)) onHit(n, curMs - nMs);
    _ajIdx++;
  }
}
