// ============================================================
//  UTILITY — small pure helpers used everywhere
// ============================================================
import { $, TPB, sPosSnapVals } from './constants.js';
import { ES } from './editor-state.js';

/** Show a brief toast notification */
export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1200);
}

/** Snap a tick to the nearest division boundary. */
export function snap(tk, div) { const u = TPB / div; return Math.round(tk / u) * u; }

/** Snap raw internal pos (0..64) to current pos snap grid. */
export function snapPos(rawInternal) {
  const unit = sPosSnapVals[ES.sPosSnapLevel];
  return Math.max(0, Math.min(64, Math.round(rawInternal / unit) * unit));
}

/** Internal pos (0..64) → external display value (-8..+8). */
export function posToExt(internal) { return (internal / 4 - 8); }
export function posToExtStr(internal) { return posToExt(internal).toFixed(2).replace(/\.?0+$/, ''); }

/** Format milliseconds as M:SS (handles negative for lead-in). */
export function fmtMs(ms) {
  if (ms < 0) {
    const s = Math.ceil(-ms / 1000);
    return `-0:${String(Math.min(s, 59)).padStart(2, '0')}`;
  }
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Map 4-line column index (0-3) to channel. Wide returns 0 (full width). */
export function line4ToChannel(lineIdx, isWide) {
  if (isWide) return 0;
  return lineIdx + 1;
}

/** Channel mirror map (Line 1↔4, 2↔3; Wide stays on 0). */
export const MIRROR_CH = {1: 4, 2: 3, 3: 2, 4: 1, 0: 0};
