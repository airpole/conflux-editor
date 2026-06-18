// ============================================================
//  SHAPE-RENDER — drawS (Shape tab editor canvas)
// ============================================================
// Phase B-2: tk-info cache, raw-chain boundary strokes, and step
// horizontal connectors moved to shape-render-helpers (drawS shares
// these primitives with drawGameFrame, but uses the 'raw' mode and
// editor-specific blue/red color profiles). What's left here is
// drawS-specific: bg fill, measure-0 tint, BPM markers, wide LN bodies,
// line dividers, the 2-pass note rendering, shape-event dots, center
// dots / pinch stars, pending-arc marker, playback line, mirror axis.

import { $, TPB, CHL, WIDE_BODY, INVALID_COLOR } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { t2ms, ms2t, getMinTick } from './timing.js';
import { sp2f, getShape, getLines, getStepTicks, getShapeEventTicks,
         countShapeEventsInRange, isStepTick } from './shape.js';
import { computeNoteOverlaps, classifyNotesForZOrder } from './overlaps.js';
import { resolveNoteColor, headColorAtTick, splitBodyByOverlap, drawNoteHead } from './renderer.js';
import { drawGrid, STYLE_SHAPE } from './grid-render.js';
import { makeTkInfoCache, drawShapeBoundary, drawStepConnectors,
         STYLE_SHAPE_EDITOR, STYLE_SHAPE_EDITOR_STEP } from './shape-render-helpers.js';
import { posToExtStr } from './utility.js';
import { sMet } from './shape-tools.js';
import { getPlayMs } from './audio.js';

export function drawS() {
  const cv = $('sCv'), ctx = cv.getContext('2d');
  const m = sMet();
  if (!m) return;
  const {cw, ch, gw, gh, gx, gy, tpp, dpr} = m;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08080d'; ctx.fillRect(0, 0, cw, ch);

  const stT = ES.sScr, visTk = gh * tpp, enT = stT + visTk;
  const t2y = tk => gy + gh - (tk - stT) / tpp;
  const p2x = p => gx + sp2f(p) * gw;

  // tk → {sh raw, shN normalized min/max, lines} cache (raw mode keeps both)
  const getTkInfo = makeTkInfoCache('raw');

  // Measure 0 tint (virtual area below tick 0)
  if (stT < 0) {
    const y0 = t2y(0);
    if (y0 > gy) {
      ctx.fillStyle = '#1a0a2218';
      ctx.fillRect(gx, gy, gw, Math.min(y0, gy + gh) - gy);
    }
  }

  // Grid
  drawGrid(ctx, {gx, gy, gw, gh, stT, enT, tpp}, ES.sGD, STYLE_SHAPE);

  // BPM + Time-signature markers (purple). Measure labels live at the LEFT
  // edge (STYLE_SHAPE.labelXOffset = 3), so we anchor BPM/TS to the RIGHT
  // edge to avoid the previous collision. The shape canvas has almost no
  // outside-grid space, so labels sit just inside the grid right edge with
  // right-aligned text. When BPM and TS land on the same tick, stack them:
  // BPM on top, TS just below.
  ctx.textAlign = 'right';
  for (const t of D.tempo) {
    if (t.tick < stT - TPB || t.tick > enT + TPB) continue;
    const y = t2y(t.tick); if (y < gy - 5 || y > gy + gh + 5) continue;
    ctx.strokeStyle = '#b060ff66'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    ctx.fillStyle = '#b060ff'; ctx.font = 'bold 7px sans-serif';
    ctx.fillText(`♩${t.bpm}`, gx + gw - 3, y - 2);
  }
  for (const ts of D.timeSignatures) {
    if (ts.tick < stT - TPB || ts.tick > enT + TPB) continue;
    const y = t2y(ts.tick); if (y < gy - 5 || y > gy + gh + 5) continue;
    const coincidesWithBpm = D.tempo.some(t => t.tick === ts.tick);
    if (!coincidesWithBpm) {
      ctx.strokeStyle = '#b060ff44'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }
    ctx.fillStyle = '#d080ff'; ctx.font = '7px sans-serif';
    ctx.fillText(
      `${ts.numerator}/${ts.denominator}`,
      gx + gw - 3,
      y + (coincidesWithBpm ? 8 : -2)
    );
  }
  ctx.textAlign = 'start';

  // Shape boundary curves (raw chains, separate Blue/Red)
  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();

  const evCnt = countShapeEventsInRange(stT, enT);
  const steps = Math.min(500, Math.max(120, evCnt * 8));
  const stepTks = getStepTicks(stT, enT);
  const evtTks = getShapeEventTicks(stT, enT);
  const segTks = [];
  for (let s = 0; s <= steps; s++) segTks.push(stT + (enT - stT) * s / steps);
  for (const stk of stepTks) { if (stk > stT && stk < enT) { segTks.push(stk - 0.0001); segTks.push(stk + 0.0001); } }
  for (const etk of evtTks) { if (etk > stT && etk < enT) segTks.push(etk); }
  segTks.sort((a, b) => a - b);
  const ticks = []; let prev = -Infinity;
  for (const tk of segTks) { if (tk - prev > 0.00005) { ticks.push(tk); prev = tk; } }

  // Build separate L (blue) and R (red) curve points using raw chain
  const lPts = [], rPts = [];
  for (const tk of ticks) {
    const y = t2y(tk);
    const sh = getShape(tk); // raw
    lPts.push({x: p2x(sh.left), y, tk, val: sh.left});
    rPts.push({x: p2x(sh.right), y, tk, val: sh.right});
  }

  // Raw L (blue) and R (red) chain strokes (no fill — chains may visually cross)
  drawShapeBoundary(ctx, lPts, rPts, STYLE_SHAPE_EDITOR);

  // Step horizontal connectors (raw: both chains independently; no gap markers)
  drawStepConnectors(ctx, stepTks, t2y, p2x, STYLE_SHAPE_EDITOR_STEP, 'raw',
                     { topY: gy, botY: gy + gh });

  // Wide LN bodies (drawn behind line dividers)
  for (const wn of D.notes.filter(n => n.isWide && n.duration > 0)) {
    const wst = wn.startTick, wet = wst + wn.duration;
    if (wet < stT - TPB || wst > enT + TPB) continue;
    const wEvtCnt = countShapeEventsInRange(wst, wet);
    const wSteps = Math.min(120, Math.max(16, wEvtCnt * 6));
    const wStepTks = getStepTicks(wst, wet);
    const wEvtTks = getShapeEventTicks(wst, wet);
    const wSeg = []; for (let s = 0; s <= wSteps; s++) wSeg.push(wst + (wet - wst) * s / wSteps);
    for (const stk of wStepTks) { if (stk > wst && stk < wet) { wSeg.push(stk - 0.0001); wSeg.push(stk + 0.0001); } }
    for (const etk of wEvtTks) { if (etk > wst && etk < wet) wSeg.push(etk); }
    wSeg.sort((a, b) => a - b);
    const wdd = []; let wpt = -Infinity;
    for (const tk of wSeg) { if (tk - wpt > 0.00005) { wdd.push(tk); wpt = tk; } }
    if (wdd.length < 2) continue;

    function wGNX(tk) {
      const info = getTkInfo(tk); const shN = info.shN;
      const lx = p2x(shN.left), rx = p2x(shN.right);
      return {x: lx, w: rx - lx};
    }

    ctx.fillStyle = WIDE_BODY; ctx.beginPath();
    for (let s = 0; s < wdd.length; s++) {
      const tk = wdd[s], y = t2y(tk), p = wGNX(tk);
      if (s === 0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y);
    }
    for (let s = wdd.length - 1; s >= 0; s--) {
      const tk = wdd[s], y = t2y(tk), p = wGNX(tk);
      ctx.lineTo(p.x + p.w, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // Line dividers (3 inner) — step-aware via lPts ticks
  for (let ln = 0; ln < 3; ln++) {
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let fi = true;
    for (const pt of lPts) {
      const tk = pt.tk;
      const info = getTkInfo(tk); const sh = info.shN, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let cum = 0;
      for (let k = 0; k <= ln; k++) cum += lines[k] / 100;
      const dx = lx + cum * sw;
      if (fi) { ctx.moveTo(dx, pt.y); fi = false; } else ctx.lineTo(dx, pt.y);
    }
    ctx.stroke();
  }

  // Notes — 2-pass z-order
  const _sovM = computeNoteOverlaps();
  const {wide: svWide, normW: svNormW, normY: svNormY} = classifyNotesForZOrder(D.notes, _sovM);

  function svGNX(n, li, tk, isEnd) {
    const evalTk = isEnd && isStepTick(tk) ? tk - 0.0001 : tk;
    const info = getTkInfo(evalTk); const sh = info.shN, lines = info.lines;
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    if (n.isWide) return {x: lx, w: sw};
    let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100;
    return {x: lx + cum * sw, w: (lines[li] / 100) * sw};
  }

  function svBuildLNTicks(st, et) {
    const lnEvtCnt = countShapeEventsInRange(st, et);
    const lnSteps = Math.min(120, Math.max(16, lnEvtCnt * 6));
    const lnStepTks = getStepTicks(st, et);
    const lnEvtTks = getShapeEventTicks(st, et);
    const segTks = [];
    for (let s = 0; s <= lnSteps; s++) segTks.push(st + (et - st) * s / lnSteps);
    for (const stk of lnStepTks) { if (stk > st && stk < et) { segTks.push(stk - 0.0001); segTks.push(stk + 0.0001); } }
    for (const etk of lnEvtTks) { if (etk > st && etk < et) segTks.push(etk); }
    segTks.sort((a, b) => a - b);
    const dd = []; let pt = -Infinity;
    for (const tk of segTks) { if (tk - pt > 0.00005) { dd.push(tk); pt = tk; } }
    return dd;
  }

  function svDrawBodyPoly(n, li, st, et, bCol) {
    const dd = svBuildLNTicks(st, et);
    if (dd.length < 2) return;
    ctx.fillStyle = bCol; ctx.beginPath();
    for (let s = 0; s < dd.length; s++) {
      const tk = dd[s], y = t2y(tk), p = svGNX(n, li, tk);
      const pd = n.isWide ? 0 : p.w * 0.05;
      if (s === 0) ctx.moveTo(p.x + pd, y); else ctx.lineTo(p.x + pd, y);
    }
    for (let s = dd.length - 1; s >= 0; s--) {
      const tk = dd[s], y = t2y(tk), p = svGNX(n, li, tk);
      const pd = n.isWide ? 0 : p.w * 0.05;
      ctx.lineTo(p.x + p.w - pd, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // Pass 1 — Bodies
  for (const n of [...svNormW, ...svNormY]) {
    const ne = n.startTick + (n.duration || 0);
    if (ne < stT - TPB || n.startTick > enT + TPB) continue;
    const ov = _sovM.get(n);
    if (ov && ov.type === 'hidden') continue;
    const li = CHL[n.channel];
    const {bodyCol} = resolveNoteColor(n, ov);
    if (n.duration > 0) {
      for (const seg of splitBodyByOverlap(n, ov, n.startTick, ne, bodyCol)) {
        svDrawBodyPoly(n, li, seg.tkFrom, seg.tkTo, seg.col);
      }
    }
  }

  // Pass 2 — Heads
  for (const n of [...svWide, ...svNormW, ...svNormY]) {
    const ne = n.startTick + (n.duration || 0);
    if (ne < stT - TPB || n.startTick > enT + TPB) continue;
    const ov = !n.isWide ? _sovM.get(n) : undefined;
    if (ov && ov.type === 'hidden') continue;
    const li = n.isWide ? 0 : CHL[n.channel];
    const {headCol} = resolveNoteColor(n, ov);

    const y = t2y(n.startTick);
    if (y >= gy - 10 && y <= gy + gh + 10) {
      const hc = headColorAtTick(headCol, ov, n.startTick);
      const th = ES.nThk * (n.isWide ? 1 : .9);
      let hx, hw;
      if (n.isWide && isStepTick(n.startTick)) {
        const stk = n.startTick;
        const rawB = getShape(stk - 0.0001), rawA = getShape(stk + 0.0001);
        const shB = rawB.left <= rawB.right ? rawB : {left: rawB.right, right: rawB.left};
        const shA = rawA.left <= rawA.right ? rawA : {left: rawA.right, right: rawA.left};
        const lo = Math.min(shB.left, shA.left);
        const hi = Math.max(shB.right, shA.right);
        hx = p2x(lo); hw = p2x(hi) - hx;
      } else {
        const p = svGNX(n, li, n.startTick);
        const pd = n.isWide ? 0 : p.w * 0.05;
        hx = p.x + pd; hw = p.w - pd * 2;
      }
      drawNoteHead(ctx, n.isWide, hx, y, hw, th, hc, 2);

      if (ov && ov.type === 'invalid') {
        ctx.save();
        ctx.strokeStyle = INVALID_COLOR; ctx.lineWidth = 2;
        ctx.shadowColor = INVALID_COLOR; ctx.shadowBlur = 8;
        ctx.strokeRect(hx - 1, y - th / 2 - 1, hw + 2, th + 2);
        ctx.strokeRect(hx - 1, y - th / 2 - 1, hw + 2, th + 2);
        ctx.restore();
      }
    }
  }

  // Shape event dots + duration lines
  const dotTickMap = new Map();
  for (let i = 0; i < D.shapeEvents.length; i++) {
    const e = D.shapeEvents[i];
    const dotTk = e.startTick + e.duration;
    if (!dotTickMap.has(dotTk)) dotTickMap.set(dotTk, {L:[], R:[]});
    const entry = dotTickMap.get(dotTk);
    if (!e.isBlue) entry.R.push(i); else entry.L.push(i);
  }

  for (const e of D.shapeEvents) {
    const dotTk = e.startTick + e.duration;
    if (dotTk < stT - TPB || dotTk > enT + TPB) continue;
    const y = t2y(dotTk);
    const x = p2x(e.targetPos);
    if (y < gy - 6 || y > gy + gh + 6) continue;

    const c = e.isBlue ? '#6bb5ff' : '#ff6b8a';
    const isSel = ES.selectedShapeEvts.has(e);
    const r = isSel ? 6 : 4;

    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isSel ? '#4aff8a' : '#fff';
    ctx.lineWidth = isSel ? 2 : 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();

    if (isSel) {
      ctx.shadowColor = '#4aff8a'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const lbl = e.easing === null ? 'Init' : e.duration === 0 ? 'Step' : e.easing.substring(0, 3);
    ctx.fillStyle = '#aaa'; ctx.font = '6px sans-serif';
    ctx.fillText(lbl + ' ' + posToExtStr(e.targetPos), x + 6, y + 2);

    if (e.duration > 0) {
      const yS = t2y(e.startTick);
      ctx.strokeStyle = c + '55'; ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yS); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Center dots + pinch stars
  for (const [tk, pair] of dotTickMap) {
    if (tk < stT - TPB || tk > enT + TPB) continue;
    const y = t2y(tk); if (y < gy - 6 || y > gy + gh + 6) continue;
    const sh_ = getShape(tk);
    const lVal = sh_.left, rVal = sh_.right;
    const cPos = (lVal + rVal) / 2;
    const cx = p2x(cPos);

    let isPinch = false;
    if (pair.L.length > 0 && pair.R.length > 0) {
      const eL = D.shapeEvents[pair.L[pair.L.length-1]], eR = D.shapeEvents[pair.R[pair.R.length-1]];
      if (eL.easing !== null && eR.easing !== null && Math.abs(eL.targetPos - eR.targetPos) < 0.5) {
        isPinch = true;
        const px = p2x(eL.targetPos);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        const r = 5, spikes = 5;
        ctx.beginPath();
        for (let s = 0; s < spikes * 2; s++) {
          const ang = -Math.PI / 2 + (s * Math.PI / spikes);
          const rad = s % 2 === 0 ? r : r * 0.4;
          const sx = px + Math.cos(ang) * rad, sy = y + Math.sin(ang) * rad;
          if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#aaa'; ctx.font = '6px sans-serif';
        ctx.fillText('P', px + 7, y - 3);
      }
    }

    if (pair.L.length > 0 || pair.R.length > 0) {
      ctx.fillStyle = '#4aff8a'; ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4aff8a88'; ctx.font = '5px sans-serif';
      ctx.fillText('C' + posToExtStr(cPos), cx + 6, y + 8);
    }
  }

  ctx.restore();

  // Pending Arc marker (outside clip)
  if (ES.pendArc) {
    const y = t2y(ES.pendArc.tick); const x = p2x(ES.pendArc.pos);
    if (y >= gy - 10 && y <= gy + gh + 10) {
      ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffe44a'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('Arc', x + 10, y + 3);
    }
  }

  // Playback line
  if (ES.edPlay.s) {
    const ms_ = getPlayMs('s');
    const tk = ms2t(ms_);
    if (ES.sFollow) { ES.sScr = tk - gh * 0.2 * tpp; if (ES.sScr < getMinTick()) ES.sScr = getMinTick(); }
    const y = t2y(tk);
    if (y >= gy && y <= gy + gh) {
      ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }
  }

  // Mirror axis
  if (ES.sMirror) {
    const midTk = ES.sScr + visTk / 2;
    const sh = getShape(midTk);
    const shapeCenter = (sh.left + sh.right) / 2;
    const cx = p2x(shapeCenter);
    ctx.strokeStyle = '#aaff4a44'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + gh); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#aaff4a88'; ctx.font = '7px sans-serif'; ctx.fillText('MIRROR', cx - 14, gy + 10);
  }
}
