// ============================================================
//  NOTES-INPUT — pointer-based note editing on nCv
// ============================================================
// Phase B-1: tap-add, LN-add, quick-LN long-press, drag-end commit, and
// del-tool tap have been migrated from saveHist('n') to commands.js
// dispatch. Drag-move still mutates notes in place during the drag for
// responsive feedback; on drag-end, a single MoveNotes command captures
// the old→new transitions for undo. LN-replaces-tap uses ReplaceNotes
// so the displaced tap and the new LN form a single undo unit.

import { $, TPB, CHL, OVERLAP_CHANNELS } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { snap, line4ToChannel } from './utility.js';
import { tickToMeasure, getMinTick } from './timing.js';
import { invalidateNoteOverlaps } from './overlaps.js';
import { dispatch, AddNotes, DeleteNotes, MoveNotes, ReplaceNotes } from './commands.js';
import { nMet, drawN } from './notes-render.js';
import { cancelLN, cancelTE, shiftSelectedByDelta, nZ } from './notes-tools.js';
import { findTextEvtAt, showTePicker, teEdit, teNewRange } from './text-events.js';

// ── Module-private drag state ─────────────────────────────
let ty0, sc0, moved;
let dragSel = false;
let dragX0, dragY0;
let dragRect = null;
let dragMove = false;
let dragMoveTk0 = 0;
let dragMoveX0 = 0;
let dragMoveColDelta = 0;
let dragMoveOriginals = null;  // [{note, oldStartTick, oldChannel}, ...] captured at drag start
let longPressTimer = null;
let longPressFired = false;

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function onDown(e) {
  e.preventDefault();
  ty0 = e.clientY; sc0 = ES.nScr; moved = false;
  dragSel = false; dragRect = null; dragMove = false;
  cancelLongPress(); longPressFired = false;

  // Long press for quick-LN (n/w tools)
  if (ES.nTool === 'n' || ES.nTool === 'w') {
    const evCopy = {clientX: e.clientX, clientY: e.clientY};
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (moved) return;
      const cv = $('nCv'), rect = cv.getBoundingClientRect();
      const x = evCopy.clientX - rect.left, y = evCopy.clientY - rect.top;
      const m = nMet(); if (!m) return;
      const rx = x - m.padL;
      if (rx < 0 || rx > m.colW * 4) return;
      const ci = Math.floor(rx / m.colW);
      const clickTk = ES.nScr + (m.ch - y) * m.tpp;
      const snp = snap(clickTk, ES.nGD);
      const isW = ES.nTool === 'w';
      let ch_n = isW ? 0 : line4ToChannel(ci, isW);
      const removed = [];
      if (!isW) {
        const isOverlapCapable = OVERLAP_CHANNELS.includes(ch_n);
        const maxN = isOverlapCapable ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
        if (isOverlapCapable) {
          // L2/L3: multi-input lanes. Existing behaviour — displace a tap to
          // make room for the new long when capacity is exhausted.
          if (atPos.length >= maxN) {
            const existTap = atPos.find(n => !n.duration);
            if (existTap) removed.push(existTap);
            else return;
          }
          const remaining = atPos.filter(n => !removed.includes(n));
          if (remaining.length >= maxN) return;
          const holdCount = remaining.filter(n => n.duration > 0).length;
          if (holdCount >= maxN) return;
        } else {
          // L1/L4: single-key lanes. The user wants quick-long on top of an
          // existing tap to surface visually as an invalid overlap (so they
          // can spot it and decide how to resolve), NOT to silently replace
          // the tap. Only block when adding would create a useless duplicate
          // (a hold already exists here, since two holds on the same tick
          // collapse into one visible note).
          const existHold = atPos.find(n => n.duration > 0);
          if (existHold) return;
          // Otherwise allow the new long alongside any existing tap; the
          // overlap detector in overlaps.js will mark both as 'invalid' and
          // the renderer will draw a red warning border.
        }
      } else {
        const existWide = D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && !n.duration);
        if (existWide) removed.push(existWide);
        if (D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && n.duration > 0)) return;
      }
      const newNote = {channel: ch_n, startTick: snp, duration: ES.savedLNDur, isWide: isW};
      longPressFired = true;
      dispatch(ReplaceNotes(removed, [newNote]));
    }, 300);
  }

  // Sel tool: drag-select / drag-move detection
  if (ES.nTool === 'sel') {
    const cv = $('nCv'), rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const m = nMet(); if (m) {
      const rx = x - m.padL;
      if (rx >= 0 && rx <= m.colW * 4) {
        const clickTk = ES.nScr + (m.ch - y) * m.tpp;
        if (ES.selectedNotes.size > 0) {
          const ci = Math.floor(rx / m.colW);
          const ch_n = line4ToChannel(ci, false);
          if (ch_n) {
            const found = findNoteAt(clickTk, ci, ch_n, m.tpp, true);
            if (found && ES.selectedNotes.has(found)) {
              dragMove = true;
              dragMoveTk0 = snap(clickTk, ES.nGD);
              dragMoveX0 = x;
              dragMoveColDelta = 0;
              // Capture originals for MoveNotes dispatch on drag-end.
              dragMoveOriginals = [...ES.selectedNotes].map(n => ({
                note: n,
                oldStartTick: n.startTick,
                oldChannel: n.channel
              }));
              return;
            }
          }
        }
        dragSel = true;
        dragX0 = x;
        dragY0 = e.clientY - rect.top;
      }
    }
  }
}

function onMove(e) {
  if (!e.buttons) return;

  if (dragMove) {
    cancelLongPress();
    const cv = $('nCv'), rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const m = nMet(); if (!m) return;
    const dy = e.clientY - ty0;
    if (Math.abs(dy) > 4) moved = true;
    let changed = false;
    if (moved) {
      const curTk = snap(ES.nScr + (m.ch - y) * m.tpp, ES.nGD);
      const delta = curTk - dragMoveTk0;
      if (delta !== 0) {
        for (const n of ES.selectedNotes) {
          n.startTick += delta;
          if (n.startTick < 0) n.startTick = 0;
        }
        invalidateNoteOverlaps();
        dragMoveTk0 = curTk;
        changed = true;
      }
    }

    // Phase 5: x-axis hysteresis — column shifts via shiftSelectedByDelta
    const colW = m.colW;
    const threshold = colW * 0.5;
    const dx = x - dragMoveX0;
    while (dx - dragMoveColDelta * colW > threshold) {
      if (!shiftSelectedByDelta(+1)) break;
      dragMoveColDelta++;
      moved = true;
      changed = true;
      invalidateNoteOverlaps();
    }
    while (dx - dragMoveColDelta * colW < -threshold) {
      if (!shiftSelectedByDelta(-1)) break;
      dragMoveColDelta--;
      moved = true;
      changed = true;
      invalidateNoteOverlaps();
    }

    if (changed) drawN();
    return;
  }

  if (dragSel) {
    const cv = $('nCv'), rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dx = x - dragX0, dy = y - dragY0;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    dragRect = {x0: Math.min(dragX0, x), y0: Math.min(dragY0, y), x1: Math.max(dragX0, x), y1: Math.max(dragY0, y)};
    updateDragSelection();
    drawN();
    drawDragRect();
    return;
  }

  const dy = e.clientY - ty0;
  if (Math.abs(dy) > 4) { moved = true; cancelLongPress(); }
  const m = nMet(); if (!m) return;
  ES.nScr = Math.max(getMinTick(), sc0 + dy * m.tpp);
  drawN();
}

function onUp(e) {
  cancelLongPress();
  if (longPressFired) { longPressFired = false; return; }
  if (dragMove && moved) {
    // Build entries from captured originals, comparing to current state.
    if (dragMoveOriginals && dragMoveOriginals.length) {
      const entries = [];
      for (const o of dragMoveOriginals) {
        if (o.note.startTick !== o.oldStartTick || o.note.channel !== o.oldChannel) {
          entries.push({
            note: o.note,
            oldStartTick: o.oldStartTick,
            oldChannel: o.oldChannel,
            newStartTick: o.note.startTick,
            newChannel: o.note.channel
          });
        }
      }
      if (entries.length) {
        // Notes already hold the new values from in-flight drag mutation.
        // MoveNotes.apply() re-applies them (idempotent); the value of the
        // command is in capturing both states for a coherent undo.
        dispatch(MoveNotes(entries));
      } else {
        // No net change — just redraw to clear any drag visuals.
        drawN();
      }
    } else {
      drawN();
    }
    dragMove = false;
    dragMoveOriginals = null;
    return;
  }
  dragMove = false;
  dragMoveOriginals = null;
  if (dragSel && dragRect && moved) {
    updateDragSelection();
    dragSel = false; dragRect = null;
    drawN();
    return;
  }
  dragSel = false; dragRect = null;
  if (!moved) handleNTap(e);
}

function updateDragSelection() {
  if (!dragRect) return;
  const m = nMet(); if (!m) return;
  const {ch, colW, padL, tpp, nCols} = m;
  const tkTop = ES.nScr + (ch - dragRect.y0) * tpp;
  const tkBot = ES.nScr + (ch - dragRect.y1) * tpp;
  const tkMin = Math.min(tkTop, tkBot), tkMax = Math.max(tkTop, tkBot);
  const ciMin = Math.max(0, Math.floor((dragRect.x0 - padL) / colW));
  const ciMax = Math.min(nCols - 1, Math.floor((dragRect.x1 - padL) / colW));

  ES.selectedNotes.clear();
  for (const n of D.notes) {
    if (n.startTick < tkMin || n.startTick > tkMax) continue;
    if (n.isWide) {
      // Wide spans all columns
    } else {
      const li = CHL[n.channel];
      if (li < ciMin || li > ciMax) continue;
    }
    ES.selectedNotes.add(n);
  }
}

function drawDragRect() {
  if (!dragRect) return;
  const cv = $('nCv'), ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const {x0, y0, x1, y1} = dragRect;
  ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4aff8a18';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

// ── Find note + tap handler (used from outside the IIFE in v20) ───
/**
 * Pick the most-relevant note at (clickTk, ci, ch_n).
 *
 * Phase: when notes overlap visually, the user almost always wants the
 * smallest/most-precise hitbox first. Priority order (low number = picked first):
 *   0 = tap (smallest hit area, easiest to mis-target)
 *   1 = hold (occupies a span)
 *   2 = wide tap (spans all 4 columns horizontally)
 *   3 = wide hold (spans all 4 columns and a vertical span)
 *
 * Within the same priority, the closer note (by startTick distance) wins —
 * so two stacked taps still resolve correctly.
 */
function notePriority(n) {
  if (n.isWide) return n.duration > 0 ? 3 : 2;
  return n.duration > 0 ? 1 : 0;
}

export function findNoteAt(clickTk, ci, ch_n, tpp, selMode) {
  const tol = tpp * 15;
  let best = null, bestPri = Infinity, bd = 1e9;
  for (const n of D.notes) {
    let inRange = false;
    if (n.isWide) inRange = true;
    else { const li = CHL[n.channel]; inRange = (li === ci); }
    if (!inRange) continue;
    let d;
    if (selMode) {
      d = Math.abs(n.startTick - clickTk);
    } else {
      const ne = n.startTick + (n.duration || 0);
      if (n.duration > 0 && clickTk >= n.startTick && clickTk <= ne) d = 0;
      else d = Math.min(Math.abs(n.startTick - clickTk), Math.abs(ne - clickTk));
    }
    if (d >= tol) continue;
    const pri = notePriority(n);
    // Lower priority wins outright. Same priority → closer wins.
    if (pri < bestPri || (pri === bestPri && d < bd)) {
      bestPri = pri; bd = d; best = n;
    }
  }
  return best;
}

export function handleNTap(e) {
  const cv = $('nCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const m = nMet(); if (!m) return;
  const {ch, colW, padL, tpp, gw} = m;
  const rx = x - padL;
  const clickTk = ES.nScr + (ch - y) * tpp;
  const snp = snap(clickTk, ES.nGD);

  // Text event tool — 2-click workflow
  if (ES.nTool === 'txt') {
    if (rx >= 0 && rx < colW * 4) {
      const lineIdx = Math.floor(rx / colW);
      const lineNum = lineIdx + 1;
      const linePos = `line:${lineNum}`;
      const lineEvts = D.textEvents.filter(te => {
        if (te.pos !== linePos) return false;
        const st = te.startTick, en = te.startTick + te.duration;
        return clickTk >= st - TPB * 0.5 && clickTk <= en + TPB * 0.5;
      });
      if (lineEvts.length > 1) { showTePicker(lineEvts); return; }
      if (lineEvts.length === 1) { teEdit(lineEvts[0]); return; }
      if (ES.pendTE && ES.pendTE.pos === linePos) {
        const startTk = Math.min(ES.pendTE.startTick, snp);
        const endTk = Math.max(ES.pendTE.startTick, snp);
        if (endTk <= startTk) { cancelTE(); return; }
        cancelTE();
        teNewRange(startTk, endTk, linePos);
      } else {
        ES.pendTE = {startTick: snp, pos: linePos};
        $('tePendUI').style.display = '';
        $('tePendUI').textContent = `Txt: ${linePos} start ${tickToMeasure(snp)} — click end`;
        drawN();
      }
      return;
    }
    // Sidebar click (left/right)
    const gridCenter = padL + gw / 2;
    const clickSide = x < gridCenter ? 'left' : 'right';
    const found = findTextEvtAt(clickTk, tpp, clickSide);
    if (found.length > 1) { showTePicker(found); return; }
    if (found.length === 1) { teEdit(found[0]); return; }
    if (ES.pendTE && ES.pendTE.pos === clickSide) {
      const startTk = Math.min(ES.pendTE.startTick, snp);
      const endTk = Math.max(ES.pendTE.startTick, snp);
      if (endTk <= startTk) { cancelTE(); return; }
      cancelTE();
      teNewRange(startTk, endTk, clickSide);
    } else {
      ES.pendTE = {startTick: snp, pos: clickSide};
      $('tePendUI').style.display = '';
      $('tePendUI').textContent = `Txt: ${clickSide} start ${tickToMeasure(snp)} — click end`;
      drawN();
    }
    return;
  }

  if (rx < 0 || rx > colW * 4) return;
  const ci = Math.floor(rx / colW);
  let ch_n = line4ToChannel(ci, ES.nTool === 'w' || ES.nTool === 'wl');

  // Sel: toggle selection
  if (ES.nTool === 'sel') {
    const found = findNoteAt(clickTk, ci, ch_n, tpp, true);
    if (found) {
      if (ES.selectedNotes.has(found)) ES.selectedNotes.delete(found);
      else ES.selectedNotes.add(found);
    } else {
      ES.selectedNotes.clear();
    }
    drawN();
    return;
  }

  if (ES.nTool === 'n' || ES.nTool === 'w') {
    const isW = ES.nTool === 'w';
    if (isW) ch_n = 0;
    if (isW) {
      if (D.notes.find(n => n.startTick === snp && n.isWide && !n.duration)) return;
    } else {
      const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
      const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
      if (atPos.length >= maxN) return;
      if (atPos.some(n => !n.duration)) {
        const tapCount = atPos.filter(n => !n.duration).length;
        if (tapCount >= maxN) return;
      }
    }
    const newNote = {channel: ch_n, startTick: snp, duration: 0, isWide: isW};
    dispatch(AddNotes([newNote]));
  } else if (ES.nTool === 'ln' || ES.nTool === 'wl') {
    const isW = ES.nTool === 'wl';
    if (isW) ch_n = 0;
    if (ES.pendLN) {
      if (ES.pendLN.isWide !== isW || (!isW && ES.pendLN.channel !== ch_n)) { cancelLN(); return; }
      const startTk = Math.min(ES.pendLN.startTick, snp), endTk = Math.max(ES.pendLN.startTick, snp);
      if (endTk <= startTk) { cancelLN(); return; }
      const dur = endTk - startTk;
      const removed = [];
      if (!isW) {
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === startTk && !n.isWide);
        if (atPos.length >= maxN) {
          const existTap = atPos.find(n => !n.duration);
          if (existTap) removed.push(existTap);
          else { cancelLN(); return; }
        }
        const remaining = atPos.filter(n => !removed.includes(n));
        if (remaining.length >= maxN) { cancelLN(); return; }
      }
      const newNote = {channel: ch_n, startTick: startTk, duration: dur, isWide: isW};
      ES.savedLNDur = dur;
      cancelLN();
      dispatch(ReplaceNotes(removed, [newNote]));
    } else {
      if (isW) {
        if (D.notes.find(n => n.startTick === snp && n.isWide)) return;
      } else {
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
        if (atPos.length >= maxN) return;
      }
      ES.pendLN = {channel: ch_n, startTick: snp, isWide: isW};
      drawN();
    }
  } else if (ES.nTool === 'del') {
    const best = findNoteAt(clickTk, ci, ch_n, tpp);
    if (best) {
      ES.selectedNotes.delete(best);
      dispatch(DeleteNotes([best]));
    }
  }
}

// ── Wire up listeners on DOMContentLoaded ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  const cv = $('nCv'); if (!cv) return;
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Ctrl/Cmd + wheel = zoom (mirrors +/- keys); plain wheel = time scroll.
    if (e.ctrlKey || e.metaKey) {
      nZ(e.deltaY < 0 ? 1 : -1);
      return;
    }
    const m = nMet(); if (!m) return;
    ES.nScr = Math.max(getMinTick(), ES.nScr - e.deltaY * m.tpp * 0.8);
    drawN();
  }, {passive: false});
});
