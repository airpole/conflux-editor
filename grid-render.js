// ============================================================
//  GRID-RENDER — shared grid + measure/beat lines
// ============================================================
// Used by drawN (full-canvas grid) and drawS (in-rect grid). Replaces
// ~80 lines of duplicated grid-drawing code that differed only in
// styling and rect placement.
//
// Each caller passes a `style` profile; this file knows nothing about
// canvas layout beyond what the caller computes (gx, gy, gw, gh, tpp).
//
// Coordinate convention: time flows up. tk2y = gy + gh - (tk - stT)/tpp.
//
// ── Style profile ────────────────────────────────────────────
// {
//   bgFill:        '#0a0a12'       background fill (or null to skip)
//   subdivStroke:  '#1e1e30'       subdivision lines between beats
//   subdivWidth:   0.3
//   beatStroke:    '#383850'       beat lines (within a measure)
//   beatWidth:     0.7
//   beatLabel:     '#444'          beat number text color (or null to skip)
//   beatLabelSize: 8               px
//   measureStroke: '#555'          measure lines
//   measureWidth:  1.5
//   measureLabel:  '#888'          measure number text color (or null to skip)
//   measureLabelSize: 10           px
//   preRollStroke: '#a855f7'       (optional) pre-roll measure line color
//   preRollLabel:  '#a855f7'       pre-roll measure number color
//   tickZeroStroke:'#a855f7'       tick-0 boundary line
//   tickZeroWidth: 2
//   labelXOffset:  -16             x-shift for measure number relative to gx
//   beatLabelXOffset: -10
//   labelYOffset:  4               y-shift for measure number relative to line y
// }

import { TPB } from './constants.js';
import { getGridLines } from './timing.js';

/**
 * Draw the full grid stack: subdivisions, beat/measure lines + labels,
 * and the tick-0 boundary marker. The pre-roll (tick<0) tint is left to
 * the caller — it's geometry-specific (full canvas vs. inside the rect).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout {gx, gy, gw, gh, stT, enT, tpp}
 * @param {number} divPerBeat e.g. 4 means 16th-note grid (TPB/4 per division)
 * @param {object} style see profile above
 */
export function drawGrid(ctx, layout, divPerBeat, style) {
  const { gx, gy, gw, gh, stT, enT, tpp } = layout;
  const tk2y = (tk) => gy + gh - (tk - stT) / tpp;

  // 1. Background fill (optional)
  if (style.bgFill) {
    ctx.fillStyle = style.bgFill;
    ctx.fillRect(gx, gy, gw, gh);
  }

  // 2. Subdivisions (between beats)
  // Subdivision unit is 1/divPerBeat of a quarter-note (TPB ticks). The
  // grid resolution toggle is independent of the chart's time-signature
  // denominator — picking "32" subdivisions still means 32nd-notes, even
  // in a 7/8 signature. Beat lines (drawn below) override coincident
  // subdivision lines; collect their ticks first so we can skip drawing
  // a subdivision line at the same position (avoids a doubly-thick line
  // when the subdivision grid happens to land on a beat boundary, e.g.
  // any denominator 4 signature, or denominator 8 with divPerBeat=2).
  const gLinesEarly = getGridLines(stT - TPB, enT + TPB);
  const beatTicks = new Set();
  for (const gl of gLinesEarly) beatTicks.add(gl.tick);

  const tpd = TPB / divPerBeat;
  const f = Math.floor(stT / tpd) * tpd;
  ctx.strokeStyle = style.subdivStroke;
  ctx.lineWidth = style.subdivWidth;
  for (let tk = f; tk <= enT; tk += tpd) {
    if (beatTicks.has(tk)) continue;          // beat lines drawn separately
    const y = tk2y(tk);
    if (y < gy - 1 || y > gy + gh + 1) continue;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
  }

  // 3. Beat & measure lines + labels
  // Reuse the gridlines computed above so we only call getGridLines once.
  const gLines = gLinesEarly;
  for (const gl of gLines) {
    const y = tk2y(gl.tick);
    if (y < gy - 1 || y > gy + gh + 1) continue;

    if (gl.isMeasure) {
      ctx.strokeStyle = gl.isPreRoll && style.preRollStroke
        ? style.preRollStroke : style.measureStroke;
      ctx.lineWidth = style.measureWidth;
    } else {
      ctx.strokeStyle = style.beatStroke;
      ctx.lineWidth = style.beatWidth;
    }
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();

    if (gl.isMeasure && style.measureLabel) {
      ctx.fillStyle = gl.isPreRoll && style.preRollLabel
        ? style.preRollLabel : style.measureLabel;
      ctx.font = `bold ${style.measureLabelSize}px sans-serif`;
      const txt = gl.isPreRoll ? `m${gl.measureNum}` : `${gl.measureNum}`;
      const xShift = gl.isPreRoll ? style.labelXOffset - 6 : style.labelXOffset;
      ctx.fillText(txt, gx + xShift, y + style.labelYOffset);
    } else if (!gl.isMeasure && style.beatLabel) {
      ctx.fillStyle = style.beatLabel;
      ctx.font = `${style.beatLabelSize}px sans-serif`;
      ctx.fillText(`${gl.beatInMeasure}`,
        gx + style.beatLabelXOffset, y + style.labelYOffset - 1);
    }
  }

  // 4. Tick-0 boundary
  if (style.tickZeroStroke) {
    const y0 = tk2y(0);
    if (y0 >= gy - 5 && y0 <= gy + gh + 5) {
      ctx.strokeStyle = style.tickZeroStroke;
      ctx.lineWidth = style.tickZeroWidth;
      ctx.beginPath();
      ctx.moveTo(gx, y0);
      ctx.lineTo(gx + gw, y0);
      ctx.stroke();
    }
  }
}

/**
 * drawN-style profile: full canvas, prominent labels in the left margin,
 * beat numbers at gx-10. Caller passes layout with gx=padL, gw=gw,
 * gy=0, gh=ch.
 *
 * Visibility note: subdivision/beat strokes were bumped up from the
 * original very-dark slate (#1e1e30/#383850) because they read as nearly
 * invisible on Samsung Browser at typical viewing brightness — the 1/2
 * and 1/4 grid was effectively missing for the user. New values keep the
 * blue-purple cast but lift luminance enough to register through both
 * empty regions and (after the wide-body alpha change) wide LN interiors.
 */
export const STYLE_NOTES = {
  bgFill: null,                 // drawN paints its own dark base
  subdivStroke: '#3a3a52', subdivWidth: 0.5,
  beatStroke: '#5a5a78',  beatWidth: 0.8,
  beatLabel: '#444',      beatLabelSize: 8,
  measureStroke: '#777',  measureWidth: 1.5,
  measureLabel: '#888',   measureLabelSize: 10,
  preRollStroke: null,
  preRollLabel: '#a855f7',
  tickZeroStroke: '#a855f7', tickZeroWidth: 2,
  labelXOffset: -16, beatLabelXOffset: -10, labelYOffset: 4,
};

/**
 * drawS-style profile: in-rect grid, smaller labels at gx+3.
 */
export const STYLE_SHAPE = {
  bgFill: null,                 // drawS paints its own rect
  subdivStroke: '#181828', subdivWidth: 0.3,
  beatStroke: '#2a2a3a',  beatWidth: 0.3,
  beatLabel: '#444',      beatLabelSize: 7,
  measureStroke: '#444',  measureWidth: 1,
  measureLabel: '#666',   measureLabelSize: 8,
  preRollStroke: null,
  preRollLabel: '#a855f7',
  tickZeroStroke: '#a855f7', tickZeroWidth: 2,
  labelXOffset: 3, beatLabelXOffset: 3, labelYOffset: -3,
};
