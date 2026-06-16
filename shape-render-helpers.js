// ============================================================
//  SHAPE-RENDER-HELPERS — boundary + step connectors + tk-info
// ============================================================
// Used by drawS (Shape editor) and drawGameFrame (Preview/Play).
// Replaces ~120 lines of duplicated code that differed only in
// (a) raw vs normalized chains, and (b) cosmetic stroke styling.
//
// Phase 3-5 reminder (from shape.js header):
//   isRight is a *chain identifier*, not a direction. Either chain may
//   be visually left or right at any given tick. drawS shows raw chains
//   (so the editor can manipulate each curve independently); drawGameFrame
//   shows normalized min/max (so gameplay sees ordered boundaries).
//
// The `mode` parameter controls which view a caller wants. The frame-scoped
// tk-info cache supports both via a single helper.

import { getShape, getLines } from './shape.js';

/** Normalize a {left, right} pair to (min, max). */
export function normalizeShape(sh) {
  return sh.left <= sh.right ? sh : { left: sh.right, right: sh.left };
}

/**
 * Per-frame {sh, lines} cache. Calling drawX once tends to hit the same tick
 * across body/head passes and forward/reverse polygon loops; this avoids
 * repeated object destructuring against the global cached chains.
 *
 * @param {'raw'|'normalized'} mode
 *   'raw'        → tk → {sh: raw, shN: normalized, lines}     (drawS — keeps both)
 *   'normalized' → tk → {sh: normalized, lines}              (drawGameFrame)
 *
 * Returns a `getTkInfo(tk)` function bound to a fresh Map.
 */
export function makeTkInfoCache(mode, shapeFn, linesFn) {
  // shapeFn(tk)/linesFn(tk) default to getShape/getLines. Static Shape injects
  // providers that ignore tk and return the chart's init geometry, so every
  // tick resolves to the same frozen shape + lines.
  const getSh = shapeFn || getShape;
  const getLn = linesFn || getLines;
  const cache = new Map();
  if (mode === 'raw') {
    return (tk) => {
      let info = cache.get(tk);
      if (!info) {
        const raw = getSh(tk);
        const shN = normalizeShape(raw);
        info = { sh: raw, shN, lines: getLn(tk) };
        cache.set(tk, info);
      }
      return info;
    };
  }
  return (tk) => {
    let info = cache.get(tk);
    if (!info) {
      const sh = normalizeShape(getSh(tk));
      info = { sh, lines: getLn(tk) };
      cache.set(tk, info);
    }
    return info;
  };
}

/**
 * Draw the filled body between left and right point arrays plus both
 * boundary strokes. Caller has already built lP/rP via
 * `buildShapePointArrays` and clipped/transformed as needed.
 *
 * @param {object} style {fill, leftStroke, rightStroke, lineWidth}
 *   Set fill = null to skip the body fill (e.g., when a jacket backdrop
 *   is showing through). Set leftStroke or rightStroke = null to skip
 *   that boundary line.
 */
export function drawShapeBoundary(ctx, lP, rP, style) {
  if (lP.length < 2) return;

  // Body fill
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.beginPath();
    lP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    for (let i = rP.length - 1; i >= 0; i--) ctx.lineTo(rP[i].x, rP[i].y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.lineWidth = style.lineWidth ?? 2;

  // Left boundary
  if (style.leftStroke) {
    ctx.strokeStyle = style.leftStroke;
    ctx.beginPath();
    lP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }

  // Right boundary
  if (style.rightStroke) {
    ctx.strokeStyle = style.rightStroke;
    ctx.beginPath();
    rP.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }
}

/**
 * Draw 90-degree connector segments at each step tick where the boundary
 * jumps. Both drawS and drawGameFrame need this; the only differences are
 * (a) which chain view (raw vs normalized) and (b) stroke colors.
 *
 * @param {Array<number>} stepTicks ticks where step events occur, already filtered to view
 * @param {(tk:number)=>number} tk2y
 * @param {(p:number)=>number} p2x
 * @param {object} style {leftStroke, rightStroke, lineWidth, gapStroke, gapWidth}
 *   gapStroke / gapWidth (optional): the dashed line shown in drawS when
 *   the chains cross between before/after the step (raw mode only).
 * @param {'raw'|'normalized'} mode same semantics as makeTkInfoCache
 * @param {object} clipBounds {topY, botY} — connector segments outside this y range are skipped
 */
export function drawStepConnectors(ctx, stepTicks, tk2y, p2x, style, mode, clipBounds) {
  const { topY, botY } = clipBounds;
  for (const stk of stepTicks) {
    const y = tk2y(stk);
    if (y < topY - 2 || y > botY + 2) continue;

    const rawB = getShape(stk - 0.0001);
    const rawA = getShape(stk + 0.0001);
    const shB = mode === 'raw' ? rawB : normalizeShape(rawB);
    const shA = mode === 'raw' ? rawA : normalizeShape(rawA);
    const pls = shB.left,  prs = shB.right;
    const cls = shA.left,  crs = shA.right;

    // Left chain step
    if (Math.abs(pls - cls) > 0.01) {
      ctx.strokeStyle = style.leftStroke;
      ctx.lineWidth = style.lineWidth ?? 2;
      ctx.beginPath(); ctx.moveTo(p2x(pls), y); ctx.lineTo(p2x(cls), y); ctx.stroke();
    }
    // Right chain step
    if (Math.abs(prs - crs) > 0.01) {
      ctx.strokeStyle = style.rightStroke;
      ctx.lineWidth = style.lineWidth ?? 2;
      ctx.beginPath(); ctx.moveTo(p2x(prs), y); ctx.lineTo(p2x(crs), y); ctx.stroke();
    }

    // Crossing visualization (gap line)
    if (style.gapStroke) {
      if (mode === 'raw') {
        // drawS: two possible crossings (prs<cls or crs<pls)
        if (prs < cls - 0.1 || crs < pls - 0.1) {
          const x1 = prs < cls - 0.1 ? p2x(prs) : p2x(crs);
          const x2 = prs < cls - 0.1 ? p2x(cls) : p2x(pls);
          _dashedSeg(ctx, x1, y, x2, y, style.gapStroke, style.gapWidth ?? 1.2);
        }
      } else {
        // drawGameFrame: separate prs<cls and crs<pls cases
        if (prs < cls - 0.1) _dashedSeg(ctx, p2x(prs), y, p2x(cls), y, style.gapStroke, style.gapWidth ?? 1.5);
        if (crs < pls - 0.1) _dashedSeg(ctx, p2x(crs), y, p2x(pls), y, style.gapStroke, style.gapWidth ?? 1.5);
      }
    }
  }
}

function _dashedSeg(ctx, x1, y1, x2, y2, stroke, width) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);
}

// ── Pre-canned style profiles ──────────────────────────────

/**
 * drawS-style boundary: blue/red strokes only (no fill — drawS shows raw
 * chains independently, so closing them into a polygon would not match
 * the editor's intent of letting either chain be visually L or R).
 */
export const STYLE_SHAPE_EDITOR = {
  fill: null,
  leftStroke: '#6bb5ff',
  rightStroke: '#ff6b8a',
  lineWidth: 1.5,
  gapStroke: null,
  gapWidth: null,
};

/**
 * drawS-style step connectors: matching boundary hues with alpha so the
 * step segments read as a related-but-secondary visual layer. No gap
 * marker — drawS treats raw chain crossings as expected, not warnings.
 */
export const STYLE_SHAPE_EDITOR_STEP = {
  leftStroke: '#6bb5ffaa',
  rightStroke: '#ff6b8aaa',
  lineWidth: 1.5,
  gapStroke: null,
  gapWidth: null,
};

/** drawGameFrame-style: subtle white boundaries, normalized. */
export const STYLE_GAME = {
  fill: '#121212',
  leftStroke: '#ffffff44',
  rightStroke: '#ffffff44',
  lineWidth: 1.5,
  gapStroke: '#ffffff66',
  gapWidth: 1.5,
};

/** drawGameFrame step-connector style (more visible). */
export const STYLE_GAME_STEP = {
  leftStroke: '#ffffff88',
  rightStroke: '#ffffff88',
  lineWidth: 1.8,
  gapStroke: '#ffffff66',
  gapWidth: 1.5,
};
