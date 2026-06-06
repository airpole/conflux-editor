// ============================================================
//  PLAY-RENDER — Play canvas (idle + active), HUD, fullscreen
// ============================================================
import { $, GAUGE_COLOR, FAST_COLOR, SLOW_COLOR } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { AS } from './audio-state.js';
import { drawGameFrame } from './game-render.js';

// ── Cached play-mode DOM refs ────────────────────────────────
// Hit every play frame; getElementById is cheap individually but cumulative
// calls (4–5 per frame × 60 fps) are measurable on Samsung Internet.
const _playDom = {plCv: null, fsCv: null, fs: null, seek: null, time: null, btn: null};
export function _getPlayDom() {
  if (!_playDom.plCv) {
    _playDom.plCv = $('plCv');
    _playDom.fsCv = $('playFSCv');
    _playDom.fs   = $('playFS');
    _playDom.seek = $('playSeek');
    _playDom.time = $('playTime');
    _playDom.btn  = $('playBtn');
  }
  return _playDom;
}

/**
 * Self-correcting canvas resize. Called every play frame: reads the live
 * bounding rect of the target container and only touches cv.width/height/style
 * if dimensions actually changed. See main.js v20 commentary on why per-frame
 * correction is the cheapest robust fix for Samsung Internet's
 * windowed→fullscreen→rotate dance.
 */
export function _ensurePlayCanvasSized(cv, containerEl) {
  if (!cv || !containerEl) return;
  const r = containerEl.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const dpr = devicePixelRatio;
  const targetW = Math.round(r.width * dpr);
  const targetH = Math.round(r.height * dpr);
  if (cv.width !== targetW)  cv.width  = targetW;
  if (cv.height !== targetH) cv.height = targetH;
  const sw = r.width + 'px', sh = r.height + 'px';
  if (cv.style.width !== sw)   cv.style.width  = sw;
  if (cv.style.height !== sh)  cv.style.height = sh;
}

// ── Constants for idle frame ─────────────────────────────────
export const _EMPTY_HITMAP  = new Map();
export const _EMPTY_MISSSET = new Set();

// ── Main draw entry points ───────────────────────────────────
export function drawPlayScreen(cv, curMs) {
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  if (cw < 1 || ch_ < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch_);
  const asp = 16 / 9; let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; }
  else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  ctx.fillStyle = '#050508'; ctx.fillRect(gx, gy, gw, gh);
  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
  drawGameFrame(ctx, gx, gy, gw, gh, curMs, {
    hitEffects: PS.playEffects,
    hitMap: PS.playHitMap,
    missSet: PS.playMissSet,
    showMissColor: true,
    showInvalid: true,   // Phase: surface unplayable overlaps in live Play too
    gauge: { value: PS.gaugeValue, type: PS.gaugeType, color: GAUGE_COLOR[PS.gaugeType] }   // judgment line → life bar
  });
  drawPlayHUD(ctx, gx, gy, gw, gh, curMs);
  ctx.restore();
}

export function drawPlayIdle() {
  const cv = $('plCv'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  if (cw < 1 || ch_ < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch_);
  const asp = 16 / 9; let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; }
  else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  ctx.fillStyle = '#050508'; ctx.fillRect(gx, gy, gw, gh);
  ctx.save(); ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
  drawGameFrame(ctx, gx, gy, gw, gh, ES.sharedMs, {
    hitEffects: [],
    hitMap: _EMPTY_HITMAP,
    missSet: _EMPTY_MISSSET,
    showMissColor: false,
    showInvalid: true    // Phase 6 Q4: idle preview shows Line 1/4 warnings
  });
  drawPlayHUD(ctx, gx, gy, gw, gh, ES.sharedMs);
  ctx.restore();
}

// ── HUD ─────────────────────────────────────────────────────
export function drawPlayHUD(ctx, gx, gy, gw, gh, curMs) {
  let sCount = 0, pCount = 0, gCount = 0;
  let tailHits = 0, midReleases = 0;
  for (const rec of PS.playHitMap.values()) {
    if (rec.headType === 'SYNC') sCount++;
    else if (rec.headType === 'PERFECT') pCount++;
    else if (rec.headType === 'GOOD') gCount++;
    if (rec.isLN && rec.tailDone) {
      if (rec.tailFailed) midReleases++;
      else tailHits++;
    }
  }
  let headMissPoints = 0;
  for (const n of PS.playMissSet) {
    headMissPoints += (n.duration > 0 ? 2 : 1);
  }
  const mCount = headMissPoints + midReleases;
  const total = D.notes.reduce((s, n) => s + (n.duration > 0 ? 2 : 1), 0);
  // Score (million): SYNC/PERFECT = full, GOOD = half, MISS = 0. Matches the
  // design doc §5 and gauge.js computeResult so HUD and Result never disagree.
  const scoreNum = sCount + tailHits + pCount + gCount * 0.5;
  const score = total > 0 ? Math.round((scoreNum / total) * 1000000) : 0;
  // Percent (independent): SYNC 100 / PERFECT 70 / GOOD 30 / MISS 0.
  const pctNum = sCount + tailHits + pCount * 0.7 + gCount * 0.3;
  const acc = total > 0 ? (pctNum / total * 100) : 0;
  const lastJ = PS.playJudgQueue.length > 0 ? PS.playJudgQueue[PS.playJudgQueue.length - 1] : null;
  drawUnifiedHUD(ctx, gx, gy, gw, gh, curMs, {
    combo: PS.playCombo, totalNotes: total, score,
    lastJudg: lastJ,
    counts: {sync: sCount + tailHits, perfect: pCount, good: gCount, miss: mCount},
    accuracy: acc,
    mode: 'play',
    // Fast/Slow feedback (Settings-toggleable; normal notes only). Only shown
    // in an active session, not in the idle editor preview.
    fastSlow: (PS.playActive && PS.showFastSlow)
      ? { last: PS.lastTiming, fast: PS.fastCount, slow: PS.slowCount }
      : null
  });
}

// ── HUD primitive ───────────────────────────────────────────
export function drawTextVC(ctx, text, x, y) {
  const m = ctx.measureText(String(text));
  const asc = m.actualBoundingBoxAscent || 0;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + (asc - desc) / 2);
}

export function textVH(ctx, text) {
  const m = ctx.measureText(String(text));
  return (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
}

export function drawUnifiedHUD(ctx, gx, gy, gw, gh, curMs, opts) {
  const cx_ = gx + gw / 2;
  const jY = gy + gh * (8 / 9);
  const cell = gw / 16;
  const botTop = jY;
  const botBot = gy + gh;
  const botH = botBot - botTop;
  const G = gw * 0.008;

  // Shadow helper — HUD text sits over a moving shape area + (optionally) a
  // jacket illustration backdrop. A soft dark shadow keeps every label
  // readable regardless of what's behind it.
  const withShadow = (blur, fn) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, blur * 0.12);
    fn();
    ctx.restore();
  };

  // Pause button (top-left, no background)
  const barW = Math.round(cell * 0.12);
  const barH = Math.round(cell * 0.45);
  const barY_ = gy + (cell - barH) / 2;
  const barGap_ = Math.round(cell * 0.12);
  const barX1 = gx + (cell - barW * 2 - barGap_) / 2;
  withShadow(gw * 0.004, () => {
    ctx.fillStyle = '#ffffffcc';
    ctx.fillRect(barX1, barY_, barW, barH);
    ctx.fillRect(barX1 + barW + barGap_, barY_, barW, barH);
  });

  const comboSz = Math.round(gw * 0.06);
  const judgeSz = Math.round(gw * 0.021);    // 원래(0.016)와 키운 값(0.026)의 중간
  const cntSz   = Math.round(gw * 0.014);    // 원래대로
  const pctSz   = Math.round(gw * 0.01625);  // 원래(0.013)에서 25% 키움

  const comboY = gy + gh * 0.22;
  const judgeY = comboY + comboSz / 2 + G + judgeSz / 2;
  const cntY   = judgeY + judgeSz / 2 + G + cntSz / 2;
  const pctY   = cntY + cntSz / 2 + G + pctSz / 2;

  // ── Counter geometry (computed first so the percent row can match width) ──
  // The four counters are centered on cx_, spaced by cntGap. cntSpan is the
  // center-to-center span; rowFullW is the outer edge-to-edge width of the
  // whole row (used to scale the percent text to the exact same width).
  ctx.font = `bold ${cntSz}px sans-serif`;
  const maxCntW = ctx.measureText('9999').width;
  const cntGap = maxCntW + cntSz * 0.4;
  const cntSpan = cntGap * 3;
  const cntLeftX = cx_ - cntSpan / 2;

  // Combo
  withShadow(gw * 0.012, () => {
    ctx.fillStyle = opts.combo > 0 ? '#ffffffdd' : '#ffffff33';
    ctx.font = `bold ${comboSz}px sans-serif`;
    ctx.textAlign = 'center';
    drawTextVC(ctx, opts.combo, cx_, comboY);
  });

  // Judgment — 판정별 색은 유지(어떤 판정인지 구분돼야 의미가 있음).
  // 크기를 키우고 그림자를 깔아 배경 위에서도 잘 보이게.
  if (opts.lastJudg) {
    const colMap = {SYNC:'#ffffff', PERFECT:'#ffe44a', GOOD:'#4aff8a', MISS:'#ff4a6a'};
    withShadow(gw * 0.01, () => {
      ctx.fillStyle = colMap[opts.lastJudg.type] || '#fff';
      ctx.font = `bold ${judgeSz}px sans-serif`;
      ctx.textAlign = 'center';
      drawTextVC(ctx, opts.lastJudg.type, cx_, judgeY);
    });
  }

  // Counters — 판정별 색상 유지(흰/노랑/초록/빨강). 콤보·판정 문자보다
  // 알파를 낮게(cc) 깔아 위계 구분. 카운트가 0인 판정은 더 흐리게(비활성).
  const cntCols = ['#ffffff','#ffe44a','#4aff8a','#ff4a6a'];
  const cntVals = [opts.counts.sync, opts.counts.perfect, opts.counts.good, opts.counts.miss];
  ctx.font = `bold ${cntSz}px sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i++) {
    const active = cntVals[i] > 0;
    withShadow(gw * 0.008, () => {
      ctx.fillStyle = cntCols[i] + (active ? 'cc' : '33');
      drawTextVC(ctx, cntVals[i], cntLeftX + i * cntGap, cntY);
    });
  }

  // Accuracy — 판정 숫자처럼 콤보·판정 문자보다 낮은 알파(aa). 크기는 원래
  // 대비 50% 키운 자연 크기로 표시(가로 스케일 강제 없음).
  {
    const pctStr = opts.accuracy.toFixed(2) + '%';
    withShadow(gw * 0.008, () => {
      ctx.fillStyle = '#ffffffaa';
      ctx.font = `bold ${pctSz}px sans-serif`;
      ctx.textAlign = 'center';
      drawTextVC(ctx, pctStr, cx_, pctY);
    });
  }

  // Fast / Slow — under the percent row, centered. Fast (red, F) sits left of
  // center, Slow (blue, S) right. The most-recent timing is highlighted; both
  // running counts trail beside their letters. Hidden for MISS / wide notes
  // (those never set lastTiming) and when the Settings toggle is off.
  if (opts.fastSlow) {
    const fsSz = Math.round(gw * 0.014);
    const fsY = pctY + pctSz / 2 + G + fsSz / 2;
    const off = gw * 0.06;
    const fastHot = opts.fastSlow.last === 'FAST';
    const slowHot = opts.fastSlow.last === 'SLOW';
    ctx.font = `bold ${fsSz}px sans-serif`;
    ctx.textAlign = 'center';
    withShadow(gw * 0.008, () => {
      ctx.fillStyle = fastHot ? FAST_COLOR : FAST_COLOR + '55';
      drawTextVC(ctx, `F ${opts.fastSlow.fast}`, cx_ - off, fsY);
      ctx.fillStyle = slowHot ? SLOW_COLOR : SLOW_COLOR + '55';
      drawTextVC(ctx, `S ${opts.fastSlow.slow}`, cx_ + off, fsY);
    });
  }

  // Bottom strip
  const leftPad = gw * 0.01;
  const titleSz  = Math.round(cell * 0.28);
  const artistSz = Math.round(titleSz * 0.8);
  const infoGap  = (botH - titleSz - artistSz) / 3;
  const titleY   = botTop + infoGap + titleSz / 2;
  const artistY  = titleY + titleSz / 2 + infoGap + artistSz / 2;
  const botMid   = botTop + botH / 2;

  withShadow(gw * 0.006, () => {
    ctx.fillStyle = '#ffffffdd'; ctx.font = `bold ${titleSz}px sans-serif`;
    ctx.textAlign = 'left';
    drawTextVC(ctx, D.metadata.title || 'Untitled', gx + leftPad, titleY);

    ctx.fillStyle = '#ffffff99'; ctx.font = `bold ${artistSz}px sans-serif`;
    ctx.textAlign = 'left';
    drawTextVC(ctx, D.metadata.artist || '', gx + leftPad, artistY);

    ctx.fillStyle = '#ffffffdd'; ctx.font = `bold ${titleSz}px sans-serif`;
    ctx.textAlign = 'right';
    const diffStr = `${D.metadata.difficulty || 'Trace'} ${D.metadata.level || 0}${D.metadata.subtitle ? ' [' + D.metadata.subtitle + ']' : ''}`;
    drawTextVC(ctx, diffStr, gx + gw - leftPad, botMid);

    const scoreSz = Math.round(cell * 0.38);
    ctx.fillStyle = '#ffffffee'; ctx.font = `bold ${scoreSz}px sans-serif`;
    ctx.textAlign = 'center';
    drawTextVC(ctx, String(opts.score).padStart(7, '0'), cx_, botMid);
  });

  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// ── Fullscreen toggle (Play tab specific) ───────────────────
export function togglePlayFullscreen() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (isFs) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
    return;
  }
  const el = $('playFS');
  if (!el) return;
  el.classList.add('show');
  if (PS.playActive) PS.playFullscreen = true;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) req.call(el).catch(() => {});
  // Two-pass settle
  const draw = () => {
    rszPlayFSCanvas();
    const cv = $('playFSCv'); if (!cv) return;
    if (PS.playActive) {
      const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
      drawPlayScreen(cv, curMs);
    } else {
      drawPlayScreen(cv, ES.sharedMs);
    }
  };
  setTimeout(draw, 80);
  setTimeout(draw, 300);
}

export function rszPlayFSCanvas() {
  const dom = _getPlayDom();
  _ensurePlayCanvasSized(dom.fsCv, dom.fs);
}
