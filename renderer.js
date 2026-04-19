// ============================================================
//  RENDERER — shared note-rendering primitives
// ============================================================
// These primitives are shared by drawN (Notes editor), drawS (Shapes
// editor), and drawGameFrame (Preview + Play). They are intentionally
// coordinate-system agnostic: each caller owns its own tk→y / pos→x
// transforms and calls these helpers for the small, high-churn bits
// that were duplicated three ways.
//
// Pure functions where possible. ctx is only taken by drawNoteHead.

import {
  WIDE_COLOR, WIDE_BODY, OVERLAP_COLOR, OVERLAP_BODY, NORMAL_BODY,
} from './constants.js';

/**
 * Decide the head and body colors for a single note given its overlap state.
 * Callers pass `ov = null` to force plain-white rendering (e.g. when a
 * game-mode note is in the Missed state and should ignore overlap styling).
 *
 * @param {Note} n  note with optional isWide flag
 * @param {{type: string, fullYellow?: boolean}|null|undefined} ov
 * @returns {{headCol: string, bodyCol: string}}
 */
export function resolveNoteColor(n, ov) {
  if (n.isWide) return { headCol: WIDE_COLOR, bodyCol: WIDE_BODY };
  if (ov && (ov.type === 'merged' || (ov.type === 'yellow' && ov.fullYellow))) {
    return { headCol: OVERLAP_COLOR, bodyCol: OVERLAP_BODY };
  }
  return { headCol: '#ffffff', bodyCol: NORMAL_BODY };
}

/**
 * For partial-yellow overlaps, a note's head may be yellow or white depending
 * on whether the query tick lies inside the yellow zone. Callers that already
 * hold a base color for the merged/full-yellow cases can pass that in as
 * `baseCol` — only the partial-yellow case rewrites the color.
 *
 * @param {string} baseCol  color to return when not partial-yellow
 * @param {{type: string, fullYellow?: boolean, yellowStart?: number, yellowEnd?: number}|null|undefined} ov
 * @param {number} tk  tick at which the head sits
 */
export function headColorAtTick(baseCol, ov, tk) {
  if (ov && ov.type === 'yellow' && !ov.fullYellow) {
    return (tk >= ov.yellowStart && tk < ov.yellowEnd) ? OVERLAP_COLOR : '#ffffff';
  }
  return baseCol;
}

/**
 * Split a hold body's [startTick, endTick) range into zero or more
 * (tkFrom, tkTo, color) segments based on the overlap state. Caller decides
 * how to draw each segment (flat rect vs polygon following a shape) — this
 * only expresses *what* to draw, not *how*.
 *
 * Yields nothing for wide notes (wide hold bodies are rendered separately
 * in a dedicated pre-pass by the callers).
 *
 * @param {Note} n
 * @param {object|null|undefined} ov
 * @param {number} startTk  note head tick
 * @param {number} endTk    note tail tick (startTk + duration)
 * @param {string} defaultCol  color used when no overlap modifies the range
 * @returns {Array<{tkFrom: number, tkTo: number, col: string}>}
 */
export function splitBodyByOverlap(n, ov, startTk, endTk, defaultCol) {
  if (n.isWide) return [];
  const segs = [];
  if (ov && ov.type === 'yellow' && !ov.fullYellow) {
    if (ov.yellowStart > startTk) segs.push({tkFrom: startTk, tkTo: ov.yellowStart, col: NORMAL_BODY});
    segs.push({tkFrom: ov.yellowStart, tkTo: ov.yellowEnd, col: OVERLAP_BODY});
    if (ov.yellowEnd < endTk)     segs.push({tkFrom: ov.yellowEnd, tkTo: endTk, col: NORMAL_BODY});
  } else if (ov && ov.type === 'clipped') {
    if (ov.clipStart > startTk)   segs.push({tkFrom: startTk, tkTo: ov.clipStart, col: NORMAL_BODY});
    if (ov.clipEnd < endTk)       segs.push({tkFrom: ov.clipEnd, tkTo: endTk, col: NORMAL_BODY});
  } else {
    segs.push({tkFrom: startTk, tkTo: endTk, col: defaultCol});
  }
  return segs;
}

/**
 * Draw a note head rectangle at (x, y-h/2, w, h). Applies rounded corners
 * for wide notes and square corners for regular lane notes, matching v19's
 * visual. Sets ctx.fillStyle — caller is responsible for ctx.globalAlpha
 * and any shadow/outline before/after.
 */
export function drawNoteHead(ctx, isWide, x, y, w, h, color, radius = 3) {
  ctx.fillStyle = color;
  if (isWide) {
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, w, h, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y - h / 2, w, h);
  }
}
