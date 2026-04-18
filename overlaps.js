// ============================================================
//  DOMAIN: OVERLAPS — note overlap map for Lines 2/3 multi-input
// ============================================================
// Two keys map to each of Lines 2 and 3, so notes on those channels can
// overlap. This module computes, per note, the visual treatment:
//   - merged  : identical range; a single yellow note is drawn
//   - yellow  : partial overlap; this note has a yellow portion
//   - clipped : partial overlap; this white note has a region occluded
//   - hidden  : identical-range sibling already drawn as merged
//
// Active range: Tap = point [t,t], Hold = half-open [head, head+dur).
// Rule 1: no overlap → white. Rule 2: identical range → merge (one yellow).
// Rule 3: partial overlap → later/shorter note's overlap portion yellow,
//         white note clips body in overlap zone (w-y single rendering).

import { D } from './state.js';
import { OVERLAP_CHANNELS } from './constants.js';
import { defineCache, get, invalidate } from './cache.js';

defineCache('noteOverlapMap', ['notes'], () => {
  const ovm = new Map();
  for (const ch of OVERLAP_CHANNELS) {
    const cns = D.notes.filter(n => !n.isWide && n.channel === ch);
    if (cns.length < 2) continue;
    cns.sort((a, b) => a.startTick - b.startTick || (a.duration || 0) - (b.duration || 0));
    for (let i = 0; i < cns.length; i++) {
      const a = cns[i];
      const aE = a.duration > 0 ? a.startTick + a.duration : a.startTick;
      for (let j = i + 1; j < cns.length; j++) {
        const b = cns[j];
        // Early break: since cns is sorted by startTick, if b.startTick > aE,
        // no later b' can overlap a. Use strict > to preserve tap-on-tap-at-same-tick.
        if (b.startTick > aE) break;
        const bE = b.duration > 0 ? b.startTick + b.duration : b.startTick;
        let hit = false;
        if (!a.duration && !b.duration) hit = (a.startTick === b.startTick);
        else if (!a.duration && b.duration > 0) hit = (a.startTick >= b.startTick && a.startTick < bE);
        else if (a.duration > 0 && !b.duration) hit = (b.startTick >= a.startTick && b.startTick < aE);
        else hit = (a.startTick < bE && b.startTick < aE);
        if (!hit) continue;
        const sameRange = (a.startTick === b.startTick && (a.duration || 0) === (b.duration || 0));
        if (sameRange) {
          if (!ovm.has(a)) ovm.set(a, {type:'merged'});
          if (!ovm.has(b)) ovm.set(b, {type:'hidden'});
        } else {
          let yel, whi;
          if (a.startTick !== b.startTick) { yel = b; whi = a; }
          else { yel = (a.duration||0) <= (b.duration||0) ? a : b; whi = (a.duration||0) <= (b.duration||0) ? b : a; }
          const ovS = Math.max(a.startTick, b.startTick);
          const ovE = Math.min(aE, bE);
          const yS = yel.startTick;
          const yE2 = yel.duration > 0 ? yel.startTick + yel.duration : yel.startTick;
          if (!ovm.has(yel)) {
            ovm.set(yel, {type:'yellow', yellowStart:ovS, yellowEnd:ovE, fullYellow:(ovS<=yS && ovE>=yE2)});
          }
          // Clip white note body in overlap zone (w-y single rendering)
          if (whi.duration > 0 && !ovm.has(whi)) {
            ovm.set(whi, {type:'clipped', clipStart:ovS, clipEnd:ovE});
          }
        }
      }
    }
  }
  return ovm;
});

/** Legacy compat: forward to generic invalidate. Keeps existing call sites working. */
export function invalidateNoteOverlaps() { invalidate(['notes']); }

/** Read the overlap map (a Map<note, {type, ...}>), rebuilt lazily when notes mutate. */
export function computeNoteOverlaps() { return get('noteOverlapMap'); }

/**
 * Z-order bucketing for 2-pass rendering (bodies then heads).
 * Uses overlap map from computeNoteOverlaps(); shared by drawN/drawS/drawGameFrame.
 * Buckets: wide (full-width notes), normW (no overlap or clipped-white portion),
 * normY (merged/yellow overlap), hidden (fully hidden by overlap — do not draw).
 */
export function classifyNotesForZOrder(notes, ovm) {
  const wide = [], normW = [], normY = [], hidden = [];
  for (const n of notes) {
    if (n.isWide) { wide.push(n); continue; }
    const o = ovm.get(n);
    if (!o || o.type === 'clipped') normW.push(n);
    else if (o.type === 'hidden') hidden.push(n);
    else normY.push(n); // merged | yellow
  }
  return {wide, normW, normY, hidden};
}
