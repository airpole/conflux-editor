// ============================================================
//  SHAPE-INPUT — pointer-based shape editing on sCv
// ============================================================
import { $, sPosSnapVals } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { snap, snapPos, posToExtStr, toast } from './utility.js';
import { getMinTick } from './timing.js';
import { sp2f, getShape, getLines, normalizeShapeChain,
         invalidateShapeCache, invalidateLinesCache,
         resolveArcEasing } from './shape.js';
import { saveHist } from './history.js';
import { sMet, findShapeEvtAt, addShapeEvt } from './shape-tools.js';
import { drawS } from './shape-render.js';
import { cancelArc } from './edit-options.js';

// Module-private drag state
let ty0, sc0, moved, tx0;
let dragDot = null;
let dragX0 = 0;
let dragSel = false, dragSelX0 = 0, dragSelY0 = 0, dragSelRect = null;
let dragMoveSel = false, dragMoveDestTk0 = 0, dragMovePos0 = 0;

function findDotAt(x, y, met) {
  const {gw, gh, gx, gy, tpp} = met;
  let best = null, bd = 35;

  const dotTicks = new Map();
  for (let i = 0; i < D.shapeEvents.length; i++) {
    const e = D.shapeEvents[i];
    const dotTk = e.startTick + e.duration;
    if (!dotTicks.has(dotTk)) dotTicks.set(dotTk, {});
    const entry = dotTicks.get(dotTk);
    if (e.isRight) entry.R = i; else entry.L = i;
  }
  for (const [tk, pair] of dotTicks) {
    if (pair.L === undefined && pair.R === undefined) continue;
    const ey = gy + gh - (tk - ES.sScr) / tpp;
    if (pair.L !== undefined && pair.R !== undefined) {
      const eL = D.shapeEvents[pair.L], eR = D.shapeEvents[pair.R];
      if (Math.abs(eL.targetPos - eR.targetPos) < 0.5 && eL.easing !== null && eR.easing !== null) {
        const px = gx + sp2f(eL.targetPos) * gw;
        const d = Math.hypot(x - px, y - ey);
        if (d < bd) { bd = d; best = {type: 'pinch', tickEvts: pair, tick: tk}; }
      }
      const lVal = getShape(tk).left;
      const rVal = getShape(tk).right;
      const cPos = (lVal + rVal) / 2;
      const cx = gx + sp2f(cPos) * gw;
      const dc = Math.hypot(x - cx, y - ey);
      if (dc < bd) { bd = dc; best = {type: 'center', tick: tk, pair}; }
    }
    if ((pair.L !== undefined) !== (pair.R !== undefined)) {
      const lVal = getShape(tk).left;
      const rVal = getShape(tk).right;
      const cPos = (lVal + rVal) / 2;
      const cx = gx + sp2f(cPos) * gw;
      const dc = Math.hypot(x - cx, y - ey);
      if (dc < bd) { bd = dc; best = {type: 'center', tick: tk, pair}; }
    }
  }

  for (let i = 0; i < D.shapeEvents.length; i++) {
    const ev = D.shapeEvents[i];
    const dotTk = ev.startTick + ev.duration;
    const ey = gy + gh - (dotTk - ES.sScr) / tpp;
    const ex = gx + sp2f(ev.targetPos) * gw;
    const d = Math.hypot(x - ex, y - ey);
    if (d < bd) {
      bd = d;
      best = ev.easing === null ? {type: 'init', evtIdx: i} : {type: 'dot', evtIdx: i};
    }
  }
  return best;
}

function onDown(e) {
  e.preventDefault();
  ty0 = e.clientY; tx0 = e.clientX; sc0 = ES.sScr; moved = false;
  dragDot = null; dragSel = false; dragSelRect = null; dragMoveSel = false;
  const cv = $('sCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const met = sMet(); if (!met) return;
  const {gx, gy, gw, gh, tpp} = met;

  if (ES.sTool === 'sel') {
    if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) {
      if (ES.selectedShapeEvts.size > 0) {
        const found = findShapeEvtAt(x, y, met);
        if (found && ES.selectedShapeEvts.has(found)) {
          dragMoveSel = true;
          const clickTk = ES.sScr + (gy + gh - y) * tpp;
          dragMoveDestTk0 = snap(clickTk, ES.sGD);
          dragMovePos0 = snapPos(((x - gx) / gw) * 64);
          return;
        }
      }
      dragSel = true; dragSelX0 = x; dragSelY0 = y;
    }
    return;
  }

  if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) {
    const hit = findDotAt(x, y, met);
    if (hit) { dragDot = hit; dragX0 = x; }
  }
}

function onMove(e) {
  if (!e.buttons) return;
  const cv = $('sCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  if (dragMoveSel) {
    const met = sMet(); if (!met) return;
    const {gx, gy, gw, gh, tpp} = met;
    const dx = e.clientX - tx0, dy = e.clientY - ty0;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (moved) {
      const curTk = snap(ES.sScr + (gy + gh - y) * tpp, ES.sGD);
      const curPos = snapPos(((x - gx) / gw) * 64);
      const deltaTk = curTk - dragMoveDestTk0;
      const deltaPos = curPos - dragMovePos0;
      if (deltaTk !== 0 || deltaPos !== 0) {
        for (const ev of ES.selectedShapeEvts) {
          const oldDest = ev.startTick + ev.duration;
          const newDest = Math.max(0, oldDest + deltaTk);
          ev.startTick = 0;
          ev.duration = newDest;
          ev.targetPos = Math.max(0, Math.min(64, ev.targetPos + deltaPos));
        }
        normalizeShapeChain(false); normalizeShapeChain(true);
        dragMoveDestTk0 = curTk;
        dragMovePos0 = curPos;
        drawS();
      }
    }
    return;
  }

  if (dragSel) {
    const dx = x - dragSelX0, dy = y - dragSelY0;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    dragSelRect = {x0: Math.min(dragSelX0, x), y0: Math.min(dragSelY0, y), x1: Math.max(dragSelX0, x), y1: Math.max(dragSelY0, y)};
    updateShapeDragSelection();
    drawS();
    drawShapeDragRect();
    return;
  }

  if (dragDot) {
    const met = sMet(); if (!met) return;
    const {gx, gw} = met;
    const dx = x - dragX0;
    if (Math.abs(dx) > 3) moved = true;
    if (moved) {
      const posX = ((x - gx) / gw) * 64;
      const snpPos = snapPos(posX);
      if (dragDot.type === 'dot' || dragDot.type === 'init') {
        D.shapeEvents[dragDot.evtIdx].targetPos = snpPos;
      } else if (dragDot.type === 'center') {
        const sh_ = getShape(dragDot.tick);
        const lVal = sh_.left, rVal = sh_.right;
        const halfW = (rVal - lVal) / 2;
        const newL = snapPos(Math.max(0, Math.min(64, snpPos - halfW)));
        const newR = snapPos(Math.max(0, Math.min(64, snpPos + halfW)));
        if (dragDot.pair.L !== undefined) D.shapeEvents[dragDot.pair.L].targetPos = newL;
        if (dragDot.pair.R !== undefined) D.shapeEvents[dragDot.pair.R].targetPos = newR;
      } else if (dragDot.type === 'pinch') {
        if (dragDot.tickEvts.L !== undefined) D.shapeEvents[dragDot.tickEvts.L].targetPos = snpPos;
        if (dragDot.tickEvts.R !== undefined) D.shapeEvents[dragDot.tickEvts.R].targetPos = snpPos;
      }
      invalidateShapeCache();
      drawS();
    }
    return;
  }

  const dy = e.clientY - ty0;
  if (Math.abs(dy) > 4) moved = true;
  const met = sMet(); if (!met) return;
  ES.sScr = Math.max(getMinTick(), sc0 + dy * met.tpp);
  drawS();
}

function onUp(e) {
  if (dragMoveSel && moved) {
    normalizeShapeChain(false); normalizeShapeChain(true);
    saveHist('s'); drawS(); dragMoveSel = false; return;
  }
  dragMoveSel = false;
  if (dragSel && dragSelRect && moved) {
    updateShapeDragSelection();
    dragSel = false; dragSelRect = null; drawS(); return;
  }
  dragSel = false; dragSelRect = null;
  if (dragDot && moved) { saveHist('s'); drawS(); dragDot = null; return; }
  dragDot = null;
  if (!moved) handleSTap(e);
}

function updateShapeDragSelection() {
  if (!dragSelRect) return;
  const met = sMet(); if (!met) return;
  const {gw, gh, gx, gy, tpp} = met;
  const tkTop = ES.sScr + (gy + gh - dragSelRect.y0) * tpp;
  const tkBot = ES.sScr + (gy + gh - dragSelRect.y1) * tpp;
  const tkMin = Math.min(tkTop, tkBot), tkMax = Math.max(tkTop, tkBot);
  const posMin = ((dragSelRect.x0 - gx) / gw) * 64;
  const posMax = ((dragSelRect.x1 - gx) / gw) * 64;
  ES.selectedShapeEvts.clear();
  for (const e of D.shapeEvents) {
    const dest = e.startTick + e.duration;
    if (dest < tkMin || dest > tkMax) continue;
    if (e.targetPos < posMin || e.targetPos > posMax) continue;
    ES.selectedShapeEvts.add(e);
  }
}

function drawShapeDragRect() {
  if (!dragSelRect) return;
  const cv = $('sCv'), ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const {x0, y0, x1, y1} = dragSelRect;
  ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4aff8a18';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

export function handleSTap(e) {
  const cv = $('sCv'), rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const met = sMet(); if (!met) return;
  const {gw, gh, gx, gy, tpp} = met;
  if (x < gx || x > gx + gw || y < gy || y > gy + gh) return;
  const clickTk = ES.sScr + (gy + gh - y) * tpp;
  const snp = snap(clickTk, ES.sGD);
  const posX = ((x - gx) / gw) * 64;
  const snpPos = snapPos(posX);

  // Sel tool
  if (ES.sTool === 'sel') {
    const found = findShapeEvtAt(x, y, met);
    if (found) {
      if (ES.selectedShapeEvts.has(found)) ES.selectedShapeEvts.delete(found);
      else ES.selectedShapeEvts.add(found);
    } else {
      ES.selectedShapeEvts.clear();
    }
    drawS();
    return;
  }

  if (ES.sTool === 'del') {
    cancelArc();
    let best = -1, bd = 1e9;
    for (let i = 0; i < D.shapeEvents.length; i++) {
      const ev = D.shapeEvents[i];
      const dotTk = ev.startTick + ev.duration;
      const ey = gy + gh - (dotTk - ES.sScr) / tpp;
      const ex = gx + sp2f(ev.targetPos) * gw;
      const d = Math.hypot(x - ex, y - ey);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < 35) {
      const ev = D.shapeEvents[best];
      if (ev.easing === null) {
        const curExt = posToExtStr(ev.targetPos);
        const val = prompt(`Move init ${ev.isRight ? 'R' : 'L'} position (-8~8):`, curExt);
        if (val !== null && !isNaN(+val)) {
          const newPos = Math.max(0, Math.min(64, Math.round((+val + 8) * 4)));
          ev.targetPos = newPos;
          saveHist('s'); drawS();
          toast(`Init ${ev.isRight ? 'R' : 'L'} → ${posToExtStr(newPos)}`);
        }
        return;
      }
      ES.selectedShapeEvts.delete(ev);
      D.shapeEvents.splice(best, 1);
      normalizeShapeChain(false); normalizeShapeChain(true);
      saveHist('s'); drawS(); toast('Shape event deleted');
    }
    return;
  }

  if (ES.sTool === 'L' || ES.sTool === 'R' || ES.sTool === 'C' || ES.sTool === 'P') {
    const easing = $('easeS').value; const isR = ES.sTool === 'R';

    const shBefore = getShape(snp);
    const shapeCenterBefore = (shBefore.left + shBefore.right) / 2;

    if (easing === 'Arc' && ES.sTool !== 'C' && ES.sTool !== 'P') {
      cancelArc();
      const autoEasing = resolveArcEasing(isR, snp);
      addShapeEvt(snp, snpPos, isR, autoEasing);
      if (ES.sMirror) {
        const mirPos = snapPos(Math.max(0, Math.min(64, 2 * shapeCenterBefore - snpPos)));
        addShapeEvt(snp, mirPos, !isR, autoEasing);
      }
      saveHist('s'); drawS();
      toast(`Arc: ${autoEasing === 'Out-Sine' ? 'OutS' : 'InS'}`);
      return;
    }

    cancelArc();
    if (ES.sTool === 'P') {
      let easingL = $('easeS').value;
      let easingR = $('easeRS').value;
      if (easingL === 'Arc') easingL = resolveArcEasing(false, snp);
      if (easingR === 'Arc') easingR = resolveArcEasing(true, snp);
      addShapeEvt(snp, snpPos, false, easingL);
      addShapeEvt(snp, snpPos, true, easingR);
    } else if (ES.sTool === 'C') {
      let cEasing = easing;
      if (easing === 'Arc') {
        cEasing = resolveArcEasing(false, snp);
        toast(`Arc: ${cEasing === 'Out-Sine' ? 'OutS' : 'InS'}`);
      }
      const curWidth = shBefore.right - shBefore.left;
      const halfW = curWidth / 2;
      const center = snpPos;
      const rawL = center - halfW;
      const rawR = center + halfW;
      const newL = Math.max(0, Math.min(64 - curWidth,
        Math.round(rawL / sPosSnapVals[ES.sPosSnapLevel]) * sPosSnapVals[ES.sPosSnapLevel]));
      const newR = Math.round(Math.max(curWidth, Math.min(64, newL + curWidth)));
      addShapeEvt(snp, newL, false, cEasing);
      addShapeEvt(snp, newR, true, cEasing);
    } else {
      addShapeEvt(snp, snpPos, isR, easing);
      if (ES.sMirror) {
        const mirPos = snapPos(Math.max(0, Math.min(64, 2 * shapeCenterBefore - snpPos)));
        addShapeEvt(snp, mirPos, !isR, easing);
      }
    }
    saveHist('s'); drawS();
  }
  if (ES.sTool === 'line') {
    cancelArc();
    const cur = getLines(snp).map(v => Math.round(v));
    const r = prompt('Line ratios (4 nums, sum=100):', cur.join(','));
    if (r) {
      const a = r.split(',').map(Number);
      if (a.length === 4 && a.every(v => !isNaN(v))) {
        D.lineEvents.push({startTick: snp, duration: 0, lines: a});
        invalidateLinesCache();
        saveHist('s');
      }
      drawS();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const cv = $('sCv'); if (!cv) return;
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const met = sMet(); if (!met) return;
    ES.sScr = Math.max(getMinTick(), ES.sScr - e.deltaY * met.tpp * 0.8);
    drawS();
  }, {passive: false});
});
