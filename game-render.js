// ============================================================
//  GAME-RENDER — drawGameFrame (shared by Play idle + active)
// ============================================================
// Used by play-render.js (drawPlayScreen + drawPlayIdle). The opts
// argument carries hit/miss state, hit effect array, and whether to
// show invalid-overlap warnings.
//
// Phase B (v21 → v10 of zip series): tk-info cache, filled body /
// boundary strokes, and step connectors moved to shape-render-helpers.
// What's left here is genuinely game-specific: jacket backdrop, wide-LN
// bodies, line dividers, TS-aware measure lines, pre-computed note state,
// 2-pass z-ordered rendering, judgment line, hit-effect ripples, and
// the text-events overlay.

import { TPB, CHL, WIDE_BODY, WIDE_COLOR, OVERLAP_COLOR, OVERLAP_BODY,
         NORMAL_BODY, INVALID_COLOR } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { ms2t, t2ms, getSortedTS } from './timing.js';
import { sp2f, getShape, getLines, buildShapePointArrays,
         getStepTicks, getShapeEventTicks,
         countShapeEventsInRange, isStepTick } from './shape.js';
import { computeNoteOverlaps, classifyNotesForZOrder } from './overlaps.js';
import { resolveNoteColor, headColorAtTick, splitBodyByOverlap, drawNoteHead } from './renderer.js';
import { drawJacketBackground } from './jacket.js';
import { makeTkInfoCache, drawShapeBoundary, drawStepConnectors,
         STYLE_GAME, STYLE_GAME_STEP } from './shape-render-helpers.js';

export function drawGameFrame(ctx, gx, gy, gw, gh, curMs, opts) {
  drawJacketBackground(ctx, gx, gy, gw, gh);

  const curTk = ms2t(curMs);
  const visMs = 2000 / ES.pvSpd;
  const jY = gy + gh * (8 / 9);
  const topMs = curMs + visMs, botMs = curMs - visMs * 0.15;
  const p2x = p => gx + sp2f(p) * gw;
  const tk2y = tk => { const ms_ = t2ms(tk); return jY - ((ms_ - curMs) / visMs) * (jY - gy); };

  // Frame-scoped {sh, lines} cache (normalized: raw left/right swapped to min/max).
  const getTkInfo = makeTkInfoCache('normalized');

  const botTk = ms2t(botMs), topTk = ms2t(topMs);
  const pvEvtDensity = countShapeEventsInRange(botTk, topTk);
  const steps = Math.min(500, Math.max(120, pvEvtDensity * 8));

  const {lP, rP, stepTicks} = buildShapePointArrays(botTk, topTk, steps, tk2y, p2x);

  // Filled shape body + outer boundary strokes (normalized chains)
  drawShapeBoundary(ctx, lP, rP, STYLE_GAME);

  // Step horizontal connectors (normalized: separate prs<cls / crs<pls cases)
  drawStepConnectors(ctx, stepTicks, tk2y, p2x, STYLE_GAME_STEP, 'normalized',
                     { topY: gy, botY: gy + gh });

  // Wide note LN bodies
  function buildGFTicks(st, et) {
    const lnEvtCnt = countShapeEventsInRange(st, et);
    const lnSteps = Math.min(120, Math.max(30, lnEvtCnt * 6));
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

  for (const wn of D.notes.filter(n => n.isWide && n.duration > 0)) {
    const wst = wn.startTick, wet = wst + wn.duration;
    const wnMs = t2ms(wst), wneMs = t2ms(wet);
    if (wnMs > topMs + 300 || wneMs < botMs - 300) continue;

    let drawSt = wst;
    const wIsHit = opts.hitMap.has(wn);
    const wIsMiss = opts.missSet && opts.missSet.has(wn);
    const wHitRec = wIsHit ? opts.hitMap.get(wn) : null;
    const wIsMidRelease = !!(wHitRec && wHitRec.isLN && wHitRec.tailFailed);
    if (wIsHit && !wIsMiss && !wIsMidRelease) {
      drawSt = Math.max(wst, curTk);
      if (drawSt >= wet) continue;
    }
    const wdd = buildGFTicks(drawSt, wet);
    if (wdd.length < 2) continue;
    const wAlpha = (wIsMiss || wIsMidRelease) ? 0.5 : 1;
    if (wAlpha !== 1) ctx.globalAlpha = wAlpha;
    ctx.fillStyle = WIDE_BODY; ctx.beginPath();
    for (let s = 0; s < wdd.length; s++) {
      const tk = wdd[s], y = tk2y(tk);
      const sh = getTkInfo(tk).sh, lx = p2x(sh.left);
      if (s === 0) ctx.moveTo(lx, y); else ctx.lineTo(lx, y);
    }
    for (let s = wdd.length - 1; s >= 0; s--) {
      const tk = wdd[s], y = tk2y(tk);
      const sh = getTkInfo(tk).sh, rx = p2x(sh.right);
      ctx.lineTo(rx, y);
    }
    ctx.closePath(); ctx.fill();
    if (wAlpha !== 1) ctx.globalAlpha = 1;
  }

  // Inner line dividers
  for (let ln = 0; ln < 3; ln++) {
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let fi = true;
    for (const pt of lP) {
      const tk = pt.tk;
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let cum = 0; for (let k = 0; k <= ln; k++) cum += lines[k] / 100;
      const dx = lx + cum * sw;
      if (fi) { ctx.moveTo(dx, pt.y); fi = false; } else ctx.lineTo(dx, pt.y);
    }
    ctx.stroke();
  }

  // Measure lines (TS-aware)
  {
    let tsSorted = getSortedTS();
    if (!tsSorted.length) tsSorted = [{tick: 0, numerator: 4, denominator: 4}];
    for (let si = 0; si < tsSorted.length; si++) {
      const ts = tsSorted[si];
      const tpm = TPB * ts.numerator * 4 / ts.denominator;
      const epStart = ts.tick;
      const epEnd = si < tsSorted.length - 1 ? tsSorted[si + 1].tick : Infinity;
      if (epStart > topTk) break;
      const startTk = Math.max(epStart, Math.floor((botTk - epStart) / tpm) * tpm + epStart);
      for (let tk = startTk; tk <= topTk && tk < epEnd; tk += tpm) {
        if (tk < 0) continue;
        const my = tk2y(tk);
        if (my < gy - 2 || my > gy + gh + 2) continue;
        const msh = getTkInfo(tk).sh;
        const mlx = p2x(msh.left), mrx = p2x(msh.right);
        ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mlx, my); ctx.lineTo(mrx, my); ctx.stroke();
      }
    }
  }

  // Note rendering
  function gNX(tk, n, li, isLNEnd) {
    const evalTk = isLNEnd && isStepTick(tk) ? tk - 0.0001 : tk;
    const info = getTkInfo(evalTk); const sh = info.sh, lines = info.lines;
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    if (n.isWide) return {x: lx, w: sw};
    let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100;
    return {x: lx + cum * sw, w: (lines[li] / 100) * sw};
  }

  function drawGFBody(n, li, st, et, fillCol) {
    const dd = buildGFTicks(st, et);
    if (dd.length < 2) return;
    ctx.fillStyle = fillCol; ctx.beginPath();
    for (let s = 0; s < dd.length; s++) {
      const tk = dd[s], y = tk2y(tk);
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let lnX, lnW;
      if (n.isWide) { lnX = lx; lnW = sw; }
      else { let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100; lnX = lx + cum * sw; lnW = (lines[li] / 100) * sw; }
      const pd = n.isWide ? 0 : lnW * 0.05;
      if (s === 0) ctx.moveTo(lnX + pd, y); else ctx.lineTo(lnX + pd, y);
    }
    for (let s = dd.length - 1; s >= 0; s--) {
      const tk = dd[s], y = tk2y(tk);
      const info = getTkInfo(tk); const sh = info.sh, lines = info.lines;
      const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
      let lnX, lnW;
      if (n.isWide) { lnX = lx; lnW = sw; }
      else { let cum = 0; for (let k = 0; k < li; k++) cum += lines[k] / 100; lnX = lx + cum * sw; lnW = (lines[li] / 100) * sw; }
      const pd = n.isWide ? 0 : lnW * 0.05;
      ctx.lineTo(lnX + lnW - pd, y);
    }
    ctx.closePath(); ctx.fill();
  }

  const _gfOvm = computeNoteOverlaps();
  const gfAll = [...D.notes];
  const {wide: gfWide, normW: gfNW, normY: gfNY} = classifyNotesForZOrder(gfAll, _gfOvm);

  // Pre-compute hit/miss state
  const _gfState = new Map();
  for (const n of gfAll) {
    // Wide notes can be invalid (wide-on-wide); fetch their ov too so the
    // head pass below can draw the red warning border in idle preview.
    const ov = _gfOvm.get(n);
    if (ov && ov.type === 'hidden') { _gfState.set(n, null); continue; }
    const nMs = t2ms(n.startTick), neMs = t2ms(n.startTick + (n.duration || 0));
    if (nMs > topMs + 300 || neMs < botMs - 300) { _gfState.set(n, null); continue; }
    const li = n.isWide ? 0 : CHL[n.channel];
    let headCol, bodyCol;
    if (n.isWide) { headCol = WIDE_COLOR; bodyCol = WIDE_BODY; }
    else if (ov && (ov.type === 'merged' || (ov.type === 'yellow' && ov.fullYellow))) { headCol = OVERLAP_COLOR; bodyCol = OVERLAP_BODY; }
    else { headCol = '#ffffff'; bodyCol = NORMAL_BODY; }
    let isHit, isMissed;
    isHit = opts.hitMap.has(n);
    isMissed = opts.missSet && opts.missSet.has(n);
    const hitRec = isHit ? opts.hitMap.get(n) : null;
    const isMidRelease = !!(hitRec && hitRec.isLN && hitRec.tailFailed);
    let alpha = 1;
    if (isHit && !n.duration) { alpha = Math.max(0, 1 - (curMs - nMs) / 100); }
    if (isMissed && !n.duration) { alpha = 1; }
    if ((isMissed || isMidRelease) && n.duration > 0) { alpha = Math.min(alpha, 0.5); }
    _gfState.set(n, {ov, li, headCol, bodyCol, isHit, isMissed, isMidRelease, alpha, nMs, neMs});
  }

  // Pass 1 — Bodies
  for (const n of [...gfNW, ...gfNY]) {
    const s = _gfState.get(n); if (!s) continue;
    if (s.alpha <= 0) continue;
    ctx.globalAlpha = s.alpha;
    if (n.duration > 0 && !n.isWide) {
      let st = n.startTick, et = st + n.duration;
      if (s.isHit && !s.isMissed && !s.isMidRelease) {
        st = Math.max(st, curTk);
        if (st >= et) { ctx.globalAlpha = 1; continue; }
      }
      const effectiveOv = (s.isMissed || s.isMidRelease) ? null : s.ov;
      for (const seg of splitBodyByOverlap(n, effectiveOv, st, et, s.bodyCol)) {
        const from = Math.max(seg.tkFrom, st);
        const to = Math.min(seg.tkTo, et);
        if (from < to) drawGFBody(n, s.li, from, to, seg.col);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Pass 2 — Heads
  for (const n of [...gfWide, ...gfNW, ...gfNY]) {
    const s = _gfState.get(n); if (!s) continue;
    if (s.alpha <= 0) continue;
    ctx.globalAlpha = s.alpha;
    let drawHead = s.headCol;

    if (n.duration > 0) {
      if (s.isHit && !s.isMissed) { ctx.globalAlpha = 1; continue; }
      const hy = tk2y(n.startTick), hp = gNX(n.startTick, n, s.li, false);
      if (hy > gy - 20 && hy < gy + gh + 20) {
        const effectiveOv = s.isMissed ? null : s.ov;
        const hc = headColorAtTick(drawHead, effectiveOv, n.startTick);
        const th = ES.nThk * (n.isWide ? 1 : .9);
        const rx0 = n.isWide ? Math.min(hp.x, hp.x + hp.w) : hp.x + hp.w * .05;
        const rw  = n.isWide ? Math.abs(hp.w)              : hp.w - hp.w * .05 * 2;
        drawNoteHead(ctx, n.isWide, rx0, hy, rw, th, hc, 4);
        if (opts.showInvalid && s.ov && s.ov.type === 'invalid') {
          ctx.save();
          ctx.strokeStyle = INVALID_COLOR; ctx.lineWidth = 2;
          ctx.shadowColor = INVALID_COLOR; ctx.shadowBlur = 8;
          ctx.strokeRect(rx0 - 1, hy - th / 2 - 1, rw + 2, th + 2);
          ctx.strokeRect(rx0 - 1, hy - th / 2 - 1, rw + 2, th + 2);
          ctx.restore();
        }
      }
    } else {
      const y = tk2y(n.startTick); if (y < gy - 20 || y > gy + gh + 20) { ctx.globalAlpha = 1; continue; }
      const th = ES.nThk * (n.isWide ? 1 : .9);
      let rx0, rw;
      if (n.isWide && isStepTick(n.startTick)) {
        const stk = n.startTick;
        const rawB = getShape(stk - 0.0001), rawA = getShape(stk + 0.0001);
        const shB = rawB.left <= rawB.right ? rawB : {left: rawB.right, right: rawB.left};
        const shA = rawA.left <= rawA.right ? rawA : {left: rawA.right, right: rawA.left};
        const lo = Math.min(shB.left, shA.left);
        const hi = Math.max(shB.right, shA.right);
        rx0 = p2x(lo); rw = p2x(hi) - rx0;
      } else {
        const p = gNX(n.startTick, n, s.li, false);
        rx0 = n.isWide ? Math.min(p.x, p.x + p.w) : p.x + p.w * .05;
        rw  = n.isWide ? Math.abs(p.w)            : p.w - p.w * .05 * 2;
      }
      drawNoteHead(ctx, n.isWide, rx0, y, rw, th, drawHead, 4);
      if (opts.showInvalid && s.ov && s.ov.type === 'invalid') {
        ctx.save();
        ctx.strokeStyle = INVALID_COLOR; ctx.lineWidth = 2;
        ctx.shadowColor = INVALID_COLOR; ctx.shadowBlur = 8;
        ctx.strokeRect(rx0 - 1, y - th / 2 - 1, rw + 2, th + 2);
        ctx.strokeRect(rx0 - 1, y - th / 2 - 1, rw + 2, th + 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Judgment line
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gx, jY); ctx.lineTo(gx + gw, jY); ctx.stroke();
  const gr = ctx.createLinearGradient(0, jY - 6, 0, jY + 6);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx, jY - 6, gw, 12);

  // Hit effects — water ripple
  const effectDur = 300, holdFadeDur = 250, FILL_K = 0.25, HOLD_SWING = 0.12;
  const judgColMap = {SYNC:'#ffffff', PERFECT:'#ffe44a', GOOD:'#4aff8a', MISS:'#ff4a6a'};

  opts.hitEffects = opts.hitEffects.filter(h => {
    if (h.note.duration > 0) return curMs < h.endMs + holdFadeDur;
    return curMs - h.startMs < effectDur;
  });

  function drawSemiCircle(ctx, cx, cy, r, above, stroke) {
    ctx.beginPath();
    if (above) { ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); }
    else { ctx.arc(cx, cy, r, 0, Math.PI); }
    ctx.closePath();
    if (stroke) ctx.stroke(); else ctx.fill();
  }
  function rippleFade(t) {
    if (t < 0.4) return 0.8;
    return 0.8 * (1 - (t - 0.4) / 0.6);
  }
  function rippleSize(t) {
    return 0.15 + Math.sqrt(t) * 0.85;
  }

  for (const h of opts.hitEffects) {
    const age = curMs - h.startMs;
    if (age < 0) continue;
    const isLNActive = h.note.duration > 0 && curMs < h.endMs;
    const isLNFading = h.note.duration > 0 && curMs >= h.endMs;

    let evalTk = curTk;
    const sh = getShape(evalTk), lines = getLines(evalTk);
    const lx = p2x(sh.left), rx = p2x(sh.right), sw = rx - lx;
    const fadeAge = isLNFading ? curMs - h.endMs : age;

    let effCol = '#ffffff';
    if (h.judgType) effCol = judgColMap[h.judgType] || '#ffffff';
    const above = h.above !== false;

    let cx, baseR;
    if (h.isWide) {
      let cum2 = 0; for (let k = 0; k < 1; k++) cum2 += lines[k] / 100;
      let cum3end = 0; for (let k = 0; k < 3; k++) cum3end += lines[k] / 100;
      cx = lx + ((cum2 + cum3end) / 2) * sw;
      baseR = Math.abs(sw) * (1.25 / 8);
    } else {
      const li = CHL[h.channel];
      let cum = 0;
      for (let k = 0; k < li; k++) cum += lines[k] / 100;
      const lineW = (lines[li] / 100) * sw;
      cx = lx + (cum + lines[li] / 200) * sw;
      baseR = Math.min(Math.abs(sw) * (0.9 / 8), Math.abs(lineW) / 2);
    }
    const dir = h.isWide ? true : above;

    if (isLNActive) {
      const sinP = Math.sin(age * 0.005);
      const ringA = 0.80 + sinP * HOLD_SWING;
      const fillA = ringA * FILL_K;
      ctx.globalAlpha = fillA;
      ctx.fillStyle = effCol;
      drawSemiCircle(ctx, cx, jY, baseR * 0.55, dir, false);
      ctx.globalAlpha = ringA;
      ctx.strokeStyle = effCol; ctx.lineWidth = 1.5;
      drawSemiCircle(ctx, cx, jY, baseR * (0.55 + (0.5 + 0.5 * sinP) * 0.10), dir, true);
      ctx.globalAlpha = 1;
    } else if (isLNFading) {
      const t = fadeAge / holdFadeDur;
      if (t < 1) {
        const ringA = 0.80 * (1 - t);
        const fillA = ringA * FILL_K;
        const r = baseR * rippleSize(t);
        ctx.globalAlpha = ringA;
        ctx.strokeStyle = effCol; ctx.lineWidth = Math.max(0.5, 1.5 * (1 - t));
        drawSemiCircle(ctx, cx, jY, r, dir, true);
        ctx.globalAlpha = fillA;
        ctx.fillStyle = effCol;
        drawSemiCircle(ctx, cx, jY, r * 0.65, dir, false);
        ctx.globalAlpha = 1;
      }
    } else {
      const t = age / effectDur;
      if (t < 1) {
        const ringA = rippleFade(t);
        const fillA = ringA * FILL_K;
        const r = baseR * rippleSize(t);
        ctx.globalAlpha = ringA;
        ctx.strokeStyle = effCol;
        ctx.lineWidth = Math.max(0.5, 1.8 * (1 - t * 0.5));
        drawSemiCircle(ctx, cx, jY, r, dir, true);
        ctx.globalAlpha = fillA;
        ctx.fillStyle = effCol;
        drawSemiCircle(ctx, cx, jY, r * 0.65, dir, false);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Text events overlay
  {
    const fadeMs = 300;
    const shCur = getShape(curTk);
    const linesCur = getLines(curTk);
    const sLx = p2x(shCur.left), sRx = p2x(shCur.right), sSw = sRx - sLx;

    const colPad = gw * 0.02;
    const colW3 = gw / 3;
    const boxPadX = gw * 0.015;
    const boxPadY = gh * 0.008;
    const boxR = gw * 0.006;
    const tutorialCY = gy + gh * 0.5;

    for (const te of D.textEvents) {
      const teStartMs = t2ms(te.startTick);
      const teEndMs   = t2ms(te.startTick + te.duration);
      if (curMs < teStartMs - fadeMs || curMs > teEndMs + fadeMs) continue;

      let alpha = 1;
      if (te.transition === 'fade') {
        if (curMs < teStartMs) alpha = Math.max(0, (curMs - (teStartMs - fadeMs)) / fadeMs);
        else if (curMs > teEndMs) alpha = Math.max(0, 1 - (curMs - teEndMs) / fadeMs);
      } else {
        if (curMs < teStartMs || curMs > teEndMs) continue;
      }
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      const pos = te.pos || 'middle';
      const isLine = pos.startsWith('line:');

      if (isLine) {
        const lineNum = parseInt(pos.split(':')[1]) - 1;
        let cum = 0; for (let k = 0; k < lineNum; k++) cum += linesCur[k] / 100;
        const lineCenter = sLx + (cum + linesCur[lineNum] / 200) * sSw;
        const lineW = (linesCur[lineNum] / 100) * sSw;
        const lnLx = sLx + cum * sSw;

        const pulse = 0.5 + 0.5 * Math.sin(curMs * 0.006);
        const indR = gw * 0.015;
        ctx.fillStyle = `rgba(74, 224, 255, ${0.3 + pulse * 0.4})`;
        const indY = jY - indR * 3;
        ctx.beginPath();
        ctx.moveTo(lineCenter, jY - indR * 0.5);
        ctx.lineTo(lineCenter - indR, indY);
        ctx.lineTo(lineCenter + indR, indY);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(74, 224, 255, ${0.05 + pulse * 0.08})`;
        ctx.fillRect(lnLx, jY - gw * 0.04, lineW, gw * 0.04);

        if (te.content) {
          const txSz = Math.round(gw * 0.016);
          ctx.font = `bold ${txSz}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          const ty = indY + indR * 1.2;
          const tw = ctx.measureText(te.content).width;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath(); ctx.roundRect(lineCenter - tw / 2 - boxPadX, ty - boxPadY, tw + boxPadX * 2, txSz + boxPadY * 2, boxR); ctx.fill();
          ctx.strokeStyle = 'rgba(74, 224, 255, 0.3)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(lineCenter - tw / 2 - boxPadX, ty - boxPadY, tw + boxPadX * 2, txSz + boxPadY * 2, boxR); ctx.stroke();
          ctx.fillStyle = '#ffffffee';
          ctx.fillText(te.content, lineCenter, ty);
        }
        ctx.globalAlpha = 1;
        continue;
      }

      let colLeft, colRight, anchorX, anchorY;
      const align = 'center';
      if (pos === 'left') {
        colLeft = gx + colPad;
        colRight = gx + colW3 - colPad / 2;
      } else if (pos === 'right') {
        colLeft = gx + colW3 * 2 + colPad / 2;
        colRight = gx + gw - colPad;
      } else {
        colLeft = gx + colW3 + colPad / 2;
        colRight = gx + colW3 * 2 - colPad / 2;
      }
      anchorX = (colLeft + colRight) / 2;
      const maxTextW = colRight - colLeft - boxPadX * 2;
      anchorY = tutorialCY;

      let txSz = Math.round(gw * 0.022);
      ctx.font = `bold ${txSz}px sans-serif`;
      let contentLines = (te.content || '').split('\n');

      let maxW = 0;
      for (const cl of contentLines) {
        const w = ctx.measureText(cl).width;
        if (w > maxW) maxW = w;
      }
      if (maxW > maxTextW && maxW > 0) {
        txSz = Math.max(Math.round(gw * 0.012), Math.round(txSz * maxTextW / maxW));
        ctx.font = `bold ${txSz}px sans-serif`;
        maxW = 0;
        for (const cl of contentLines) {
          const w = ctx.measureText(cl).width;
          if (w > maxW) maxW = w;
        }
      }
      const lineH = txSz * 1.4;
      const totalH = contentLines.length * lineH;

      const bw = Math.min(maxW, maxTextW) + boxPadX * 2;
      const bh = totalH + boxPadY * 2;
      const bx = anchorX - bw / 2;
      const by = anchorY - bh / 2;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.stroke();

      ctx.save();
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, boxR); ctx.clip();
      ctx.textAlign = align; ctx.textBaseline = 'middle';
      const textStartY = anchorY - (contentLines.length - 1) * lineH / 2;
      for (let li = 0; li < contentLines.length; li++) {
        const ly = textStartY + li * lineH;
        ctx.fillStyle = '#ffffffee';
        ctx.font = `bold ${txSz}px sans-serif`;
        ctx.fillText(contentLines[li], anchorX, ly);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  // HUD drawn externally by caller (drawPlayScreen) via drawUnifiedHUD.
}
