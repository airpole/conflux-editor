// ============================================================
//  NOTES-INPUT — pointer-based note editing on nCv
// ============================================================
import { $, TPB, CHL, OVERLAP_CHANNELS } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { snap, line4ToChannel } from './utility.js';
import { tickToMeasure, getMinTick } from './timing.js';
import { invalidateNoteOverlaps } from './overlaps.js';
import { saveHist } from './history.js';
import { nMet, drawN } from './notes-render.js';
import { cancelLN, cancelTE, shiftSelectedByDelta } from './notes-tools.js';
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
      if (!isW) {
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
        if (atPos.length >= maxN) {
          const existTap = atPos.find(n => !n.duration);
          if (existTap) D.notes = D.notes.filter(n => n !== existTap);
          else return;
        }
        const atPos2 = D.notes.filter(n => n.channel === ch_n && n.startTick === snp && !n.isWide);
        if (atPos2.length >= maxN) return;
        const holdCount = atPos2.filter(n => n.duration > 0).length;
        if (holdCount >= maxN) return;
      } else {
        const existWide = D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && !n.duration);
        if (existWide) D.notes = D.notes.filter(n => n !== existWide);
        if (D.notes.find(n => n.startTick === snp && n.channel === ch_n && n.isWide === isW && n.duration > 0)) return;
      }
      D.notes.push({channel: ch_n, startTick: snp, duration: ES.savedLNDur, isWide: isW});
      longPressFired = true;
      saveHist('n'); drawN();
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
  if (dragMove && moved) { saveHist('n'); dragMove = false; drawN(); return; }
  dragMove = false;
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
export function findNoteAt(clickTk, ci, ch_n, tpp, selMode) {
  const tol = tpp * 15;
  let best = null, bd = 1e9;
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
    if (d < tol && d < bd) { bd = d; best = n; }
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
    D.notes.push({channel: ch_n, startTick: snp, duration: 0, isWide: isW});
    saveHist('n'); drawN();
  } else if (ES.nTool === 'ln' || ES.nTool === 'wl') {
    const isW = ES.nTool === 'wl';
    if (isW) ch_n = 0;
    if (ES.pendLN) {
      if (ES.pendLN.isWide !== isW || (!isW && ES.pendLN.channel !== ch_n)) { cancelLN(); return; }
      const startTk = Math.min(ES.pendLN.startTick, snp), endTk = Math.max(ES.pendLN.startTick, snp);
      if (endTk <= startTk) { cancelLN(); return; }
      const dur = endTk - startTk;
      if (!isW) {
        const maxN = OVERLAP_CHANNELS.includes(ch_n) ? 2 : 1;
        const atPos = D.notes.filter(n => n.channel === ch_n && n.startTick === startTk && !n.isWide);
        if (atPos.length >= maxN) {
          const existTap = atPos.find(n => !n.duration);
          if (existTap) D.notes = D.notes.filter(n => n !== existTap);
          else { cancelLN(); return; }
        }
        const atPos2 = D.notes.filter(n => n.channel === ch_n && n.startTick === startTk && !n.isWide);
        if (atPos2.length >= maxN) { cancelLN(); return; }
      }
      D.notes.push({channel: ch_n, startTick: startTk, duration: dur, isWide: isW});
      ES.savedLNDur = dur;
      saveHist('n'); cancelLN(); drawN();
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
      D.notes = D.notes.filter(n => n !== best);
      ES.selectedNotes.delete(best);
      saveHist('n'); drawN();
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
    const m = nMet(); if (!m) return;
    ES.nScr = Math.max(getMinTick(), ES.nScr - e.deltaY * m.tpp * 0.8);
    drawN();
  }, {passive: false});
});
