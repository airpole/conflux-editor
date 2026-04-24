// ============================================================
//  DOMAIN: SHAPE — chain evaluation, easing, caches
// ============================================================
// Shape and line caches use the generic cache.js abstraction.
// External mutators call invalidate(['shapeEvents'|'lineEvents']) — or the
// legacy compat wrappers invalidateShapeCache/invalidateLinesCache, which
// forward to the same mechanism.
//
// Phase 3-5 semantic note:
//   `isRight` is a *chain identifier*, not a direction. The two chains are
//   labeled "Blue" (isRight=false) and "Red" (isRight=true) in the UI. Either
//   chain may be visually left or right of the other at any given tick — the
//   rendering layer (drawGameFrame) picks min/max per tick to produce the
//   actual gameplay boundaries. Shape tab (drawS) shows the raw chains so
//   the editor can manipulate each curve independently; crossings are a
//   legitimate editing workflow, not an error state.
//   The field name `isRight` is retained to avoid a schema bump — only its
//   interpretation changed, not the data layout.

import { D } from './state.js';
import { defineCache, get, invalidate } from './cache.js';

// Shape event sort comparator: by startTick, then duration==0 first, then Step last.
// Shared between the shapeChains cache and any ad-hoc shapeEvents sorting.
export function shapeEventCmp(a, b) {
  if (a.startTick !== b.startTick) return a.startTick - b.startTick;
  const aZ = (a.duration || 0) === 0 ? 0 : 1;
  const bZ = (b.duration || 0) === 0 ? 0 : 1;
  if (aZ !== bZ) return aZ - bZ;
  const aS = (a.easing === 'Step') ? 1 : 0;
  const bS = (b.easing === 'Step') ? 1 : 0;
  return aS - bS;
}

// ============================================================
//  CHAIN EVALUATION CACHES
// ============================================================
// shapeChains groups the 5 values produced from a single pass over
// D.shapeEvents: leftChain, rightChain, leftInit, rightInit, stepTicks.
// Computed together because they share a filter; memoized together
// because they invalidate together.
defineCache('shapeChains', ['shapeEvents'], () => {
  const leftAll  = D.shapeEvents.filter(e => !e.isRight);
  const rightAll = D.shapeEvents.filter(e =>  e.isRight);
  const lInit = leftAll.find(e => e.easing === null);
  const rInit = rightAll.find(e => e.easing === null);
  const stepTicks = new Set();
  for (const e of D.shapeEvents) {
    if (e.duration === 0 && e.easing !== null) stepTicks.add(e.startTick);
  }
  return {
    leftChain:  leftAll.filter(e => e.easing !== null).sort(shapeEventCmp),
    rightChain: rightAll.filter(e => e.easing !== null).sort(shapeEventCmp),
    leftInit:   lInit ? lInit.targetPos : 32,
    rightInit:  rInit ? rInit.targetPos : 40,
    stepTicks
  };
});

defineCache('lineEventsSorted', ['lineEvents'], () =>
  [...D.lineEvents].sort((a, b) => a.startTick - b.startTick)
);

/** Legacy compat wrappers — forward to generic invalidate. */
export function invalidateShapeCache() { invalidate(['shapeEvents']); }
export function invalidateLinesCache() { invalidate(['lineEvents']); }

// ============================================================
//  EASING FUNCTIONS
// ============================================================
export function ease(from, to, t, type) {
  t = Math.max(0, Math.min(1, t));
  let e;
  switch (type) {
    case 'Linear':   e = t; break;
    case 'In-Sine':  e = 1 - Math.cos(t * Math.PI / 2); break;
    case 'Out-Sine': e = Math.sin(t * Math.PI / 2); break;
    case 'Arc':      e = Math.sin(t * Math.PI); break;
    default:         e = t;
  }
  return from + (to - from) * e;
}

// ============================================================
//  SHAPE CHAIN EVALUATION
// ============================================================
// Fast chain evaluator — takes pre-sorted chain array + initial value
export function _evalSorted(chain, initVal, tick) {
  let val = initVal;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    const end = e.startTick + e.duration;
    if (tick < e.startTick) return val;
    if (e.duration <= 0) {
      if (tick >= e.startTick) val = e.targetPos;
      continue;
    }
    if (tick >= end) { val = e.targetPos; continue; }
    const t = (tick - e.startTick) / e.duration;
    return ease(val, e.targetPos, t, e.easing);
  }
  return val;
}

// Returns sorted array of ticks where Step events occur, within [startTk, endTk]
export function getStepTicks(startTk, endTk) {
  const ticks = new Set();
  for (const e of D.shapeEvents) {
    if (e.easing === null || e.duration !== 0) continue;
    if (e.startTick >= startTk && e.startTick <= endTk) ticks.add(e.startTick);
  }
  return [...ticks].sort((a, b) => a - b);
}

// Returns sorted array of ALL shape event critical ticks within [startTk, endTk]
export function getShapeEventTicks(startTk, endTk) {
  const ticks = new Set();
  for (const e of D.shapeEvents) {
    if (e.easing === null) continue;
    const st = e.startTick, en = st + e.duration;
    if (st >= startTk && st <= endTk) ticks.add(st);
    if (en >= startTk && en <= endTk) ticks.add(en);
  }
  return [...ticks].sort((a, b) => a - b);
}

// Count shape events whose range overlaps [startTk, endTk]
export function countShapeEventsInRange(startTk, endTk) {
  let cnt = 0;
  for (const e of D.shapeEvents) {
    if (e.easing === null) continue;
    const st = e.startTick, en = st + e.duration;
    if (en >= startTk && st <= endTk) cnt++;
  }
  return cnt;
}

// Build step-aware lP/rP for shape boundary rendering (90-degree corners at Step ticks)
export function buildShapePointArrays(botTk, topTk, steps, tk2y, p2x) {
  const stSz = (topTk - botTk) / steps;
  const stepTicks = getStepTicks(botTk - 1, topTk + 1);
  const allEvtTicks = getShapeEventTicks(botTk - 1, topTk + 1);

  // Build tick list: uniform grid + all event ticks + ε-pairs at step ticks
  const tickSet = new Set();
  for (let i = 0; i <= steps; i++) tickSet.add(botTk + i * stSz);
  for (const et of allEvtTicks) {
    tickSet.add(et);
    tickSet.add(et - stSz * 0.25);
    tickSet.add(et + stSz * 0.25);
  }
  const tickArr = [...tickSet];
  for (const stk of stepTicks) {
    tickArr.push(stk - 0.0001);
    tickArr.push(stk + 0.0001);
  }
  tickArr.sort((a, b) => a - b);

  const ticks = [];
  let prev = -Infinity;
  for (const tk of tickArr) {
    if (tk - prev < 0.00005) continue;
    prev = tk; ticks.push(tk);
  }

  const lP = [], rP = [];
  for (const tk of ticks) {
    const y = tk2y(tk);
    const sh = getShape(tk);
    lP.push({x: p2x(sh.left),  y, pos: sh.left,  tk});
    rP.push({x: p2x(sh.right), y, pos: sh.right, tk});
  }
  return {lP, rP, stepTicks};
}

// Check if a tick is a Step tick (uses shapeChains cache)
export function isStepTick(tick) {
  return get('shapeChains').stepTicks.has(tick);
}

// Arc auto-cycle: pick Out-Sine or In-Sine based on the previous event's easing on the same side.
// Previous event = the transition (easing !== null) with the largest destTick strictly less than `tick`.
// Out-Sine is chosen when there's no previous event, or the previous was Linear / Step / zero-duration / In-Sine.
// Otherwise (previous was Out-Sine) returns In-Sine — creating the alternation that "Arc" mode is about.
export function resolveArcEasing(isRight, tick) {
  const sideEvts = D.shapeEvents.filter(e => e.isRight === isRight && e.easing !== null);
  const sorted = sideEvts.map(e => ({evt: e, dest: e.startTick + e.duration})).sort((a, b) => a.dest - b.dest);
  const prev = sorted.filter(s => s.dest < tick).pop();
  if (!prev || prev.evt.easing === 'Linear' || prev.evt.easing === 'Step' || prev.evt.duration === 0 || prev.evt.easing === 'In-Sine') {
    return 'Out-Sine';
  }
  return 'In-Sine';
}

// Normalize shape chain: fix startTick/duration so events form a proper sequence by destTick
export function normalizeShapeChain(isRight) {
  const inits = D.shapeEvents.filter(e => e.isRight === isRight && e.easing === null);
  const trans = D.shapeEvents.filter(e => e.isRight === isRight && e.easing !== null);
  trans.forEach(e => {
    e._dest = e.startTick + e.duration;
    e._isStep = (e.duration === 0);
  });
  trans.sort((a, b) => a._dest - b._dest);
  let prevEnd = 0;
  for (const e of inits) prevEnd = Math.max(prevEnd, e.startTick + (e.duration || 0));
  for (const e of trans) {
    const dest = e._dest;
    if (e._isStep) {
      e.startTick = dest; e.duration = 0;
      prevEnd = Math.max(prevEnd, dest);
    } else {
      e.startTick = prevEnd;
      e.duration = Math.max(0, dest - prevEnd);
      prevEnd = dest;
    }
    delete e._dest; delete e._isStep;
  }
  invalidateShapeCache();
}

// Fast cached getShape — uses pre-sorted chains
export function getShape(tick) {
  const c = get('shapeChains');
  return {
    left:  _evalSorted(c.leftChain,  c.leftInit,  tick),
    right: _evalSorted(c.rightChain, c.rightInit, tick)
  };
}

// Fast cached getLines — uses pre-sorted line events
export function getLines(tick) {
  const evts = get('lineEventsSorted');
  if (!evts.length) return [25,25,25,25];
  let val = evts[0].lines;
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    const end = e.startTick + (e.duration || 0);
    if (tick < e.startTick) return val.slice();
    if (!e.duration || tick >= end) { val = e.lines; continue; }
    const prev = val;
    const t = (tick - e.startTick) / e.duration;
    return e.lines.map((v, j) => prev[j] + (v - prev[j]) * t);
  }
  return val.slice();
}

/** Shape position: internal unit → fractional (0..1) */
export function sp2f(p) { return p / 64; }
