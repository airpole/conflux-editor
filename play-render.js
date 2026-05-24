// ============================================================
//  PLAY-RENDER — Play canvas (idle + active), HUD, fullscreen
// ============================================================
import { $ } from './constants.js';
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
    showInvalid: true    // Phase: surface unplayable overlaps in live Play too
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
  const numerator = sCount + tailHits + pCount * 0.9 + gCount * 0.5;
  const score = total > 0 ? Math.round((numerator / total) * 1000000) : 0;
  const acc = total > 0 ? (numerator / total * 100) : 0;
  const lastJ = PS.playJudgQueue.length > 0 ? PS.playJudgQueue[PS.playJudgQueue.length - 1] : null;
  drawUnifiedHUD(ctx, gx, gy, gw, gh, curMs, {
    combo: PS.playCombo, totalNotes: total, score,
    lastJudg: lastJ,
    counts: {sync: sCount + tailHits, perfect: pCount, good: gCount, miss: mCount},
    accuracy: acc,
    mode: 'play'
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

  // Pause button (top-left, no background)
  const barW = Math.round(cell * 0.12);
  const barH = Math.round(cell * 0.45);
  const barY_ = gy + (cell - barH) / 2;
  const barGap_ = Math.round(cell * 0.12);
  const barX1 = gx + (cell - barW * 2 - barGap_) / 2;
  ctx.fillStyle = '#ffffffcc';
  ctx.fillRect(barX1, barY_, barW, barH);
  ctx.fillRect(barX1 + barW + barGap_, barY_, barW, barH);

  const comboSz = Math.round(gw * 0.06);
  const judgeSz = Math.round(gw * 0.016);
  const cntSz   = Math.round(gw * 0.014);
  const pctSz   = Math.round(gw * 0.013);

  const comboY = gy + gh * 0.22;
  const judgeY = comboY + comboSz / 2 + G + judgeSz / 2;
  const cntY   = judgeY + judgeSz / 2 + G + cntSz / 2;
  const pctY   = cntY + cntSz / 2 + G + pctSz / 2;

  // Combo
  ctx.fillStyle = opts.combo > 0 ? '#ffffffdd' : '#ffffff33';
  ctx.font = `bold ${comboSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, opts.combo, cx_, comboY);

  // Judgment
  if (opts.lastJudg) {
    const colMap = {SYNC:'#ffffff', PERFECT:'#ffe44a', GOOD:'#4aff8a', MISS:'#ff4a6a'};
    ctx.fillStyle = colMap[opts.lastJudg.type] || '#fff';
    ctx.font = `bold ${judgeSz}px sans-serif`;
    ctx.textAlign = 'center';
    drawTextVC(ctx, opts.lastJudg.type, cx_, judgeY);
  }

  // Counters
  const cntCols = ['#ffffff','#ffe44a','#4aff8a','#ff4a6a'];
  const cntVals = [opts.counts.sync, opts.counts.perfect, opts.counts.good, opts.counts.miss];
  ctx.font = `bold ${cntSz}px sans-serif`;
  const maxCntW = ctx.measureText('9999').width;
  const cntGap = maxCntW + cntSz * 0.4;
  const cntX0 = cx_ - (cntGap * 3) / 2;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cntCols[i] + 'aa';
    ctx.textAlign = 'center';
    drawTextVC(ctx, cntVals[i], cntX0 + i * cntGap, cntY);
  }

  // Accuracy
  ctx.fillStyle = '#ffffff77'; ctx.font = `${pctSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, opts.accuracy.toFixed(2) + '%', cx_, pctY);

  // Bottom strip
  const leftPad = gw * 0.01;
  const titleSz  = Math.round(cell * 0.28);
  const artistSz = Math.round(titleSz * 0.8);
  const infoGap  = (botH - titleSz - artistSz) / 3;
  const titleY   = botTop + infoGap + titleSz / 2;
  const artistY  = titleY + titleSz / 2 + infoGap + artistSz / 2;
  const botMid   = botTop + botH / 2;

  ctx.fillStyle = '#ffffffcc'; ctx.font = `bold ${titleSz}px sans-serif`;
  ctx.textAlign = 'left';
  drawTextVC(ctx, D.metadata.title || 'Untitled', gx + leftPad, titleY);

  ctx.fillStyle = '#ffffff88'; ctx.font = `bold ${artistSz}px sans-serif`;
  ctx.textAlign = 'left';
  drawTextVC(ctx, D.metadata.artist || '', gx + leftPad, artistY);

  ctx.fillStyle = '#ffffffcc'; ctx.font = `bold ${titleSz}px sans-serif`;
  ctx.textAlign = 'right';
  const diffStr = `${D.metadata.difficulty || 'Trace'} ${D.metadata.level || 0}${D.metadata.subtitle ? ' [' + D.metadata.subtitle + ']' : ''}`;
  drawTextVC(ctx, diffStr, gx + gw - leftPad, botMid);

  const scoreSz = Math.round(cell * 0.38);
  ctx.fillStyle = '#ffffffdd'; ctx.font = `bold ${scoreSz}px sans-serif`;
  ctx.textAlign = 'center';
  drawTextVC(ctx, String(opts.score).padStart(7, '0'), cx_, botMid);

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
