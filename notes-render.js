// ============================================================
//  NOTES-RENDER — drawN + nMet (Notes tab)
// ============================================================
import { $, TPB, CHL, WIDE_BODY, TEXT_COLOR, INVALID_COLOR } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { AS } from './audio-state.js';
import { t2ms, ms2t, getMinTick, tickToMeasure } from './timing.js';
import { computeNoteOverlaps, classifyNotesForZOrder } from './overlaps.js';
import { resolveNoteColor, headColorAtTick, splitBodyByOverlap, drawNoteHead } from './renderer.js';
import { drawGrid, STYLE_NOTES } from './grid-render.js';
import { getPlayMs } from './audio.js';

export function nMet() {
  const cv = $('nCv'), dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch = cv.height / dpr;
  if (cw < 1 || ch < 1) return null;
  const nCols = 4;
  const colW = Math.min(cw * 0.18, 60);
  const gw = colW * nCols, padL = (cw - gw) / 2;
  const tpp = (TPB * 16) / (ch * ES.edZm);
  return {cw, ch, colW, gw, padL, tpp, dpr, nCols};
}

export function drawN() {
  const cv = $('nCv'), ctx = cv.getContext('2d');
  const m = nMet();
  if (!m) return;
  const {cw, ch, colW, gw, padL, tpp, dpr} = m;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08080d'; ctx.fillRect(0, 0, cw, ch);

  const stT = ES.nScr, visTk = ch * tpp, enT = stT + visTk;

  // Background channel tint
  {
    const tint = '#ffffff06';
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = tint;
      ctx.fillRect(padL + i * colW, 0, colW, ch);
    }
  }

  // Measure 0 tint (virtual area below tick 0)
  if (stT < 0) {
    const y0 = ch - (0 - stT) / tpp;
    const yClamp = Math.min(y0, ch);
    if (yClamp > 0) {
      ctx.fillStyle = '#1a0a2218';
      ctx.fillRect(0, 0, cw, yClamp);
      ctx.save(); ctx.beginPath(); ctx.rect(padL, 0, gw, yClamp); ctx.clip();
      ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 0.5;
      for (let s = -yClamp; s < gw + yClamp; s += 12) {
        ctx.beginPath();
        ctx.moveTo(padL + s, yClamp);
        ctx.lineTo(padL + s + yClamp, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Grid (subdivisions + beat/measure lines + tick-0 boundary)
  drawGrid(
    ctx,
    {gx: padL, gy: 0, gw, gh: ch, stT, enT, tpp},
    ES.nGD,
    STYLE_NOTES
  );

  // Wide note LN bodies (drawn behind channel separators)
  {
    for (const n of D.notes) {
      if (!n.isWide || n.duration <= 0) continue;
      const ne = n.startTick + n.duration;
      if (ne < stT - TPB || n.startTick > enT + TPB) continue;
      const nx = padL, nw = colW * 4, px = 1;
      const y1 = ch - (n.startTick - stT) / tpp;
      const y2 = ch - (ne - stT) / tpp;
      ctx.fillStyle = WIDE_BODY;
      ctx.fillRect(nx + px, Math.min(y1, y2), nw - px * 2, Math.abs(y1 - y2));
    }
  }

  // Channel separators
  const nCols = 4;
  for (let i = 0; i <= nCols; i++) {
    const x = padL + i * colW;
    if (i === 2) { ctx.strokeStyle = '#667'; ctx.lineWidth = 1; }
    else if (i === 0 || i === 4) { ctx.strokeStyle = '#445'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = '#334'; ctx.lineWidth = 0.7; }
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, ch); ctx.stroke();
  }

  // Channel labels
  ctx.font = 'bold 7px sans-serif';
  {
    const lb4 = ['L1', 'L2', 'L3', 'L4'];
    const lc4 = '#ffffff44';
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = lc4;
      ctx.fillText(lb4[i], padL + i * colW + colW / 2 - 5, ch - 2);
    }
  }

  // BPM change markers (purple)
  for (const t of D.tempo) {
    if (t.tick < stT - TPB || t.tick > enT + TPB) continue;
    const y = ch - (t.tick - stT) / tpp;
    if (y < -5 || y > ch + 5) continue;
    ctx.strokeStyle = '#b060ff66'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    ctx.fillStyle = '#b060ff'; ctx.font = 'bold 8px sans-serif';
    ctx.fillText(`♩${t.bpm}`, padL + gw + 3, y + 3);
  }

  // Time signature change markers
  for (const ts of D.timeSignatures) {
    if (ts.tick < stT - TPB || ts.tick > enT + TPB) continue;
    const y = ch - (ts.tick - stT) / tpp;
    if (y < -5 || y > ch + 5) continue;
    if (!D.tempo.some(t => t.tick === ts.tick)) {
      ctx.strokeStyle = '#b060ff44'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    }
    ctx.fillStyle = '#d080ff'; ctx.font = '7px sans-serif';
    ctx.fillText(
      `${ts.numerator}/${ts.denominator}`,
      padL + gw + 3,
      y + (D.tempo.some(t => t.tick === ts.tick) ? 12 : 3)
    );
  }

  // Waveform
  if (AS.waveData && AS.abuf) {
    const waveL = padL, waveR = padL + gw, centerX = padL + gw / 2, maxW = gw * 0.45;
    const stMs = t2ms(stT) + D.metadata.offset;
    const enMs = t2ms(enT) + D.metadata.offset;
    const stSamp = Math.max(0, Math.floor(stMs / 1000 * AS.waveSR));
    const enSamp = Math.min(AS.waveData.length, Math.ceil(enMs / 1000 * AS.waveSR));
    if (enSamp > stSamp) {
      const sampPerPx = Math.max(1, Math.floor((enSamp - stSamp) / ch));
      ctx.save(); ctx.beginPath(); ctx.rect(waveL, 0, waveR - waveL, ch); ctx.clip();
      ctx.strokeStyle = '#ffffff38'; ctx.lineWidth = 1; ctx.beginPath();
      for (let py = 0; py < ch; py += 1.5) {
        const tk = enT - (enT - stT) * (py / ch);
        const ms_ = t2ms(tk) + D.metadata.offset;
        const si = Math.floor(ms_ / 1000 * AS.waveSR);
        if (si < 0 || si >= AS.waveData.length) continue;
        let peak = 0;
        for (let j = 0; j < sampPerPx && si + j < AS.waveData.length; j++) {
          peak = Math.max(peak, Math.abs(AS.waveData[si + j]));
        }
        const w = peak * maxW;
        ctx.moveTo(centerX - w, py); ctx.lineTo(centerX + w, py);
      }
      ctx.stroke(); ctx.restore();
    }
  }

  // Text events — left margin / right margin (line:N rendered on grid below)
  for (const te of D.textEvents) {
    if ((te.pos || '').startsWith('line:')) continue;
    const teEnd = te.startTick + te.duration;
    if (teEnd < stT - TPB || te.startTick > enT + TPB) continue;
    const yTop = ch - (teEnd - stT) / tpp;
    const yBot = ch - (te.startTick - stT) / tpp;
    if (yTop > ch + 5 || yBot < -5) continue;
    const isLeft = (te.pos === 'left');
    const txW = Math.min(isLeft ? (padL - 4) : (cw - padL - gw - 4), 80);
    if (txW < 10) continue;
    const txL = isLeft ? Math.max(2, padL - txW - 2) : (padL + gw + 2);
    const clampTop = Math.max(yTop, -1);
    const clampBot = Math.min(yBot, ch + 1);
    const clampH = clampBot - clampTop;
    ctx.fillStyle = TEXT_COLOR + '10';
    ctx.fillRect(txL, clampTop, txW, clampH);
    const startY = Math.min(yBot, ch + 1);
    if (startY >= -1 && startY <= ch + 5) {
      ctx.strokeStyle = TEXT_COLOR + 'aa'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(txL, startY); ctx.lineTo(txL + txW, startY); ctx.stroke();
      const triH = 5, triW = 4;
      ctx.fillStyle = TEXT_COLOR + 'aa';
      if (isLeft) {
        ctx.beginPath();
        ctx.moveTo(txL + txW, startY); ctx.lineTo(txL + txW + triW, startY - triH / 2);
        ctx.lineTo(txL + txW, startY - triH); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(txL, startY); ctx.lineTo(txL - triW, startY - triH / 2);
        ctx.lineTo(txL, startY - triH); ctx.closePath(); ctx.fill();
      }
    }
    const endY = Math.max(yTop, -1);
    if (endY >= -1 && endY <= ch + 5) {
      ctx.strokeStyle = TEXT_COLOR + '44'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(txL, endY); ctx.lineTo(txL + txW, endY); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (startY >= 0 && startY <= ch) {
      ctx.strokeStyle = TEXT_COLOR + '33'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(padL, startY); ctx.lineTo(padL + gw, startY); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = TEXT_COLOR + '33'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(isLeft ? txL + txW : txL, clampTop);
    ctx.lineTo(isLeft ? txL + txW : txL, clampBot);
    ctx.stroke();
    const posLabel = (te.pos || 'middle');
    const fontSize = 8;
    const lineH = fontSize + 2;
    ctx.fillStyle = TEXT_COLOR; ctx.font = `${fontSize}px sans-serif`;
    ctx.save(); ctx.beginPath(); ctx.rect(txL, clampTop, txW, clampH); ctx.clip();
    const contentLines = (te.content || '').split('\n');
    ctx.fillStyle = TEXT_COLOR + '88'; ctx.font = `bold 7px sans-serif`;
    ctx.fillText(posLabel, txL + 3, clampTop + 8);
    ctx.fillStyle = TEXT_COLOR; ctx.font = `${fontSize}px sans-serif`;
    const maxChars = Math.floor((txW - 6) / 4.5);
    let curY = startY - 4;
    for (let li = contentLines.length - 1; li >= 0; li--) {
      const line = contentLines[li];
      if (curY < clampTop + 10) break;
      if (line.length <= maxChars) {
        ctx.fillText(line, txL + 3, curY);
        curY -= lineH;
      } else {
        const chunks = [];
        for (let c = 0; c < line.length; c += maxChars) chunks.push(line.slice(c, c + maxChars));
        for (let ci = chunks.length - 1; ci >= 0; ci--) {
          if (curY < clampTop + 10) break;
          ctx.fillText(chunks[ci], txL + 3, curY);
          curY -= lineH;
        }
      }
    }
    ctx.restore();
  }

  // Pending long note marker
  if (ES.pendLN) {
    const y = ch - (ES.pendLN.startTick - stT) / tpp;
    ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    if (ES.pendLN.isWide) {
      ctx.strokeRect(padL + 1, y - 4, colW * 4 - 2, 8);
    } else {
      const li = CHL[ES.pendLN.channel];
      ctx.strokeRect(padL + li * colW + 1, y - 4, colW - 2, 8);
    }
    ctx.setLineDash([]);
  }

  // Pending text event marker
  if (ES.pendTE) {
    const y = ch - (ES.pendTE.startTick - stT) / tpp;
    if (y >= -10 && y <= ch + 10) {
      const isLeft = (ES.pendTE.pos === 'left');
      const isLineN = (ES.pendTE.pos || '').startsWith('line:');
      if (isLineN) {
        const lineNum = parseInt(ES.pendTE.pos.split(':')[1]) - 1;
        const lx = padL + lineNum * colW;
        ctx.strokeStyle = '#4ae0ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.strokeRect(lx + 1, y - 4, colW - 2, 8);
        ctx.setLineDash([]);
      } else {
        const txW = Math.min(isLeft ? (padL - 4) : (cw - padL - gw - 4), 80);
        const txL = isLeft ? Math.max(2, padL - txW - 2) : (padL + gw + 2);
        ctx.strokeStyle = TEXT_COLOR; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(txL, y); ctx.lineTo(txL + txW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = TEXT_COLOR;
        const cx = isLeft ? txL + txW : txL;
        ctx.beginPath();
        ctx.moveTo(cx, y - 5); ctx.lineTo(cx + 5, y);
        ctx.lineTo(cx, y + 5); ctx.lineTo(cx - 5, y);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // Notes — 2-pass z-order
  const _ovm = computeNoteOverlaps();
  const {wide: wideNotes, normW, normY} = classifyNotesForZOrder(D.notes, _ovm);

  function drawBodySeg(nx_, padX_, nw_, tkFrom, tkTo, bCol) {
    const y1 = ch - (tkFrom - stT) / tpp;
    const y2 = ch - (tkTo - stT) / tpp;
    ctx.fillStyle = bCol;
    ctx.fillRect(nx_ + padX_, Math.min(y1, y2), nw_ - padX_ * 2, Math.abs(y1 - y2));
  }

  function drawNoteOnCanvas(n, isWide, mode) {
    const ne = n.startTick + (n.duration || 0);
    if (ne < stT - TPB || n.startTick > enT + TPB) return;
    // Wide notes also need overlap-map lookup so wide-on-wide invalid pairs
    // can render their red warning border in the head pass below.
    const ov = _ovm.get(n);
    if (ov && ov.type === 'hidden') return;

    const {headCol, bodyCol} = resolveNoteColor(n, ov);
    let nx, nw;
    if (isWide) { nx = padL; nw = colW * 4; }
    else { nx = padL + CHL[n.channel] * colW; nw = colW; }
    const noteH = Math.max(3, 6) * (isWide ? 1 : 0.9);
    const padX = isWide ? 1 : nw * 0.05;
    const y = ch - (n.startTick - stT) / tpp;

    if (mode === 'body' && n.duration > 0 && !isWide) {
      for (const seg of splitBodyByOverlap(n, ov, n.startTick, ne, bodyCol)) {
        drawBodySeg(nx, padX, nw, seg.tkFrom, seg.tkTo, seg.col);
      }
    }

    if (mode === 'head') {
      const hc = headColorAtTick(headCol, ov, n.startTick);
      drawNoteHead(ctx, isWide, nx + padX, y, nw - padX * 2, noteH, hc);

      if (ov && ov.type === 'invalid') {
        ctx.save();
        ctx.strokeStyle = INVALID_COLOR; ctx.lineWidth = 2;
        ctx.shadowColor = INVALID_COLOR; ctx.shadowBlur = 8;
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.restore();
      }

      if (ES.selectedNotes.has(n)) {
        ctx.strokeStyle = '#4aff8a'; ctx.lineWidth = 2;
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.shadowColor = '#4aff8a'; ctx.shadowBlur = 6;
        ctx.strokeRect(nx + padX - 1, y - noteH / 2 - 1, nw - padX * 2 + 2, noteH + 2);
        ctx.shadowBlur = 0;
      }
    }
  }

  // Pass 1 — Bodies
  for (const n of normW) drawNoteOnCanvas(n, false, 'body');
  for (const n of normY) drawNoteOnCanvas(n, false, 'body');
  // Pass 2 — Heads
  for (const n of wideNotes) drawNoteOnCanvas(n, true, 'head');
  for (const n of normW) drawNoteOnCanvas(n, false, 'head');
  for (const n of normY) drawNoteOnCanvas(n, false, 'head');

  // Line:N indicators
  for (const te of D.textEvents) {
    const pos = te.pos || '';
    if (!pos.startsWith('line:')) continue;
    const teEnd = te.startTick + te.duration;
    if (teEnd < stT - TPB || te.startTick > enT + TPB) continue;
    const lineNum = parseInt(pos.split(':')[1]) - 1;
    if (lineNum < 0 || lineNum > 3) continue;
    const yTop = ch - (teEnd - stT) / tpp;
    const yBot = ch - (te.startTick - stT) / tpp;
    if (yTop > ch + 5 || yBot < -5) continue;
    const clampTop = Math.max(yTop, 0);
    const clampBot = Math.min(yBot, ch);
    const lx = padL + lineNum * colW;
    ctx.fillStyle = '#4ae0ff12';
    ctx.fillRect(lx + 1, clampTop, colW - 2, clampBot - clampTop);
    const arrowY = Math.min(clampBot, ch - 2);
    const arrowX = lx + colW / 2;
    const arrowH = Math.min(8, (clampBot - clampTop) * 0.3);
    const arrowW = Math.min(6, colW * 0.25);
    ctx.fillStyle = '#4ae0ff88';
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - arrowW, arrowY - arrowH);
    ctx.lineTo(arrowX + arrowW, arrowY - arrowH);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4ae0ff44'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(lx, clampBot); ctx.lineTo(lx + colW, clampBot); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx, clampTop); ctx.lineTo(lx + colW, clampTop); ctx.stroke();
    ctx.setLineDash([]);
    if (te.content && te.content !== '.') {
      ctx.fillStyle = '#4ae0ffcc'; ctx.font = '7px sans-serif';
      ctx.fillText(te.content.split('\n')[0].slice(0, 6), lx + 2, clampTop + 8);
    }
  }

  // Playback line
  if (ES.edPlay.n) {
    const ms_ = getPlayMs('n');
    const tk = ms2t(ms_);
    if (ES.nFollow) {
      const fixedY = ch * 0.8;
      ES.nScr = tk - (ch - fixedY) * tpp;
      if (ES.nScr < getMinTick()) ES.nScr = getMinTick();
    }
    const y = ch - (tk - ES.nScr) / tpp;
    ctx.strokeStyle = '#ffe44a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
    ctx.fillStyle = '#ffe44a';
    ctx.beginPath();
    ctx.moveTo(padL - 6, y - 4); ctx.lineTo(padL, y); ctx.lineTo(padL - 6, y + 4);
    ctx.fill();
  }

  // Selection count indicator
  const selCount = ES.selectedNotes.size;
  const lnInfo = (ES.nTool === 'n' || ES.nTool === 'w' || ES.nTool === 'ln' || ES.nTool === 'wl')
    ? ` | LN: ${ES.savedLNDur}t` : '';
  $('botI').textContent =
    `Notes: ${D.notes.length} | Shape: ${D.shapeEvents.length} | Txt: ${D.textEvents.length}` +
    `${selCount > 0 ? ' | Sel: ' + selCount + ' [DEL]' : ''}${lnInfo}`;
}
