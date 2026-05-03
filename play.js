// ============================================================
//  PLAY — playLoop + startPlay / stopPlay + control wrappers
// ============================================================
import { $, LEAD_IN_MS } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { AS } from './audio-state.js';
import { fmtMs } from './utility.js';
import { initAud, startAud, stopAud, playHitAt } from './audio.js';
import { resetHitScheduler, scheduleHitsounds,
         resetMissChecker, checkPlayMisses,
         resetAutoJudger, autoJudge } from './scheduler.js';
import { applyJudgment, applyTailSuccess, seedPlayStateFromCurMs } from './play-judgment.js';
import { drawPlayScreen, _getPlayDom, _ensurePlayCanvasSized } from './play-render.js';
import { rszActiveCanvas } from './canvas-resize.js';
import { rszPlayFSCanvas } from './play-render.js';
import { handleGameCanvasClick } from './play-input.js';
import { toast } from './utility.js';

function playLoop(ts) {
  if (!PS.playActive) return;
  const curMs = PS.playOffMs + (ts - PS.playT0) * AS.playbackRate;
  // Lead-in: start audio when curMs crosses 0
  if (!PS.playAudioStarted && curMs >= 0) {
    PS.playAudioStarted = true;
    startAud(D.metadata.offset);
  }
  if (curMs >= 0) {
    if (PS.playAutoplay) {
      // Pre-schedule hitsounds 150ms ahead
      if (PS.playAudioStarted && AS.actx && AS.hitBuf && ES.hitVol > 0) {
        scheduleHitsounds(curMs, 150, AS.actx, playHitAt);
      }
      autoJudge(
        curMs,
        n => PS.playHitMap.has(n),
        (n, diff) => applyJudgment(n, diff, curMs, /*silent=*/true)
      );
      // Phase 6 D2: auto-complete LN tails in autoplay
      for (const [n, rec] of PS.playHitMap) {
        if (rec.isLN && !rec.tailDone && curMs >= rec.tailMs) {
          applyTailSuccess(n, curMs);
        }
      }
    } else {
      checkPlayMisses(
        curMs,
        n => PS.playHitMap.has(n) || PS.playMissSet.has(n),
        n => {
          PS.playMissSet.add(n);
          PS.playCombo = 0;
          PS.playJudgQueue.push({type: 'MISS', diff: undefined, t: curMs});
        }
      );
    }
  }
  // Self-correcting per-frame canvas resize
  const dom = _getPlayDom();
  const cv = PS.playFullscreen ? dom.fsCv : dom.plCv;
  if (cv) {
    _ensurePlayCanvasSized(cv, PS.playFullscreen ? dom.fs : (cv.parentElement));
    drawPlayScreen(cv, curMs);
  }
  // Sync windowed playbar (skip while user is dragging the thumb)
  if (!PS.playFullscreen && ES.totalMs > 0 && PS.seekDragMs == null) {
    if (dom.seek) {
      const newVal = Math.max(0, Math.min(1000, Math.round((curMs / ES.totalMs) * 1000)));
      if (+dom.seek.value !== newVal) dom.seek.value = newVal;
    }
    if (dom.time) {
      const txt = fmtMs(Math.max(0, curMs));
      if (dom.time.textContent !== txt) dom.time.textContent = txt;
    }
  }
  if (curMs > (ES.totalMs || 0) + 2000) { stopPlay(); return; }
  PS.playRAF = requestAnimationFrame(playLoop);
}

/**
 * Start a play session.
 * @param {boolean} fromBeginning  true = restart from lead-in; false = from sharedMs
 * @param {boolean} autoplay       true = auto-SYNC; false = manual key input
 */
export function startPlay(fromBeginning, autoplay) {
  initAud();
  const offMs = fromBeginning ? -LEAD_IN_MS : ES.sharedMs;
  PS.playOffMs = offMs;
  PS.playActive = true;
  PS.playStartedFromBeginning = !!fromBeginning;
  // Freeze autoplay toggle during session
  const autoChk = $('playAutoChk');
  if (autoChk) { autoChk.disabled = true; autoChk.parentElement.style.opacity = '0.5'; }
  // Restart → fullscreen immediately. Play/Pause → windowed; user can promote.
  PS.playFullscreen = !!fromBeginning;
  PS.playAutoplay = !!autoplay;
  PS.playAudioStarted = false;
  PS.playHitMap.clear(); PS.playMissSet.clear(); PS.playEffects = [];
  PS.playCombo = 0; PS.playMaxCombo = 0; PS.playJudgQueue = [];
  PS.playHoldState = {}; PS.playKeyHeld.clear();

  seedPlayStateFromCurMs(offMs);

  resetMissChecker(offMs);
  resetHitScheduler(offMs);
  resetAutoJudger(offMs);

  $('playBtn').textContent = '⏸';

  if (PS.playFullscreen) {
    const el = $('playFS');
    el.classList.add('show');
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el).catch(() => {});
    setTimeout(rszPlayFSCanvas, 80);
  } else {
    rszActiveCanvas();
  }

  if (!fromBeginning) {
    startAud(offMs + D.metadata.offset);
    PS.playAudioStarted = true;
  }
  PS.playT0 = performance.now();
  PS.playRAF = requestAnimationFrame(playLoop);
}

export function stopPlay() {
  if (!PS.playActive) return;
  // Snapshot current play position so the next ▶ resumes from there.
  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
  if (isFinite(curMs) && curMs > 0) {
    ES.sharedMs = Math.min(curMs, ES.totalMs || curMs);
  }
  PS.playActive = false;
  cancelAnimationFrame(PS.playRAF); PS.playRAF = null;
  stopAud(); PS.playKeyHeld.clear(); PS.playHoldState = {};

  if (PS.playFullscreen) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
    $('playFS').classList.remove('show');
    PS.playFullscreen = false;
  }
  PS.playStartedFromBeginning = false;
  const autoChk = $('playAutoChk');
  if (autoChk) { autoChk.disabled = false; autoChk.parentElement.style.opacity = ''; }

  $('playBtn').textContent = '▶';

  if (!PS.playAutoplay) {
    const cnt = [...PS.playHitMap.values()].reduce((a, v) => {
      if (v.headType === 'SYNC') a.sync++;
      else if (v.headType === 'PERFECT') a.perfect++;
      else if (v.headType === 'GOOD') a.good++;
      return a;
    }, {sync: 0, perfect: 0, good: 0});
    const sC = cnt.sync, pC = cnt.perfect, gC = cnt.good;
    const total = D.notes.reduce((s, n) => s + (n.duration > 0 ? 2 : 1), 0);
    const acc = total > 0 ? ((sC + pC * 0.9 + gC * 0.5) / total * 100) : 0;
    toast(`SYNC:${sC} PERFECT:${pC} GOOD:${gC} MISS:${PS.playMissSet.size} | ${acc.toFixed(1)}% | Combo:${PS.playMaxCombo}`);
  }

  if (ES.totalMs > 0) {
    const seek = $('playSeek');
    if (seek) seek.value = Math.max(0, Math.min(1000, Math.round((ES.sharedMs / ES.totalMs) * 1000)));
  }
  const tm = $('playTime');
  if (tm) tm.textContent = fmtMs(Math.max(0, ES.sharedMs));

  requestAnimationFrame(() => {
    if (ES.activeTab === 'play') {
      rszActiveCanvas();
      import('./play-render.js').then(m => m.drawPlayIdle());
    }
  });
}

// ── Play tab inline controls ─────────────────────────────
export function playToggle() {
  if (PS.playActive) { stopPlay(); return; }
  startPlay(false, PS.playAutoplay);
}

export function playRestart() {
  if (PS.playActive) stopPlay();
  startPlay(true, PS.playAutoplay);
}

export function playSeekPreview(v) {
  if (!ES.totalMs) return;
  const ms = (v / 1000) * ES.totalMs;
  PS.seekDragMs = ms;
  const tm = $('playTime'); if (tm) tm.textContent = fmtMs(ms);
  if (!PS.playActive) {
    ES.sharedMs = ms;
    import('./play-render.js').then(m => m.drawPlayIdle());
  }
}

export function playSeekTo(v) {
  PS.seekDragMs = null;
  if (!ES.totalMs) return;
  const ms = (v / 1000) * ES.totalMs;
  ES.sharedMs = ms;
  $('playTime').textContent = fmtMs(ms);
  if (!PS.playActive) {
    import('./play-render.js').then(m => m.drawPlayIdle());
    return;
  }
  // Live seek during a session
  stopAud();
  PS.playOffMs = ms;
  PS.playT0 = performance.now();
  PS.playHitMap.clear(); PS.playMissSet.clear(); PS.playEffects = [];
  PS.playCombo = 0; PS.playMaxCombo = 0; PS.playJudgQueue = [];
  PS.playHoldState = {}; PS.playKeyHeld.clear();
  seedPlayStateFromCurMs(ms);
  resetMissChecker(ms);
  resetHitScheduler(ms);
  resetAutoJudger(ms);
  if (ms >= 0) {
    startAud(ms + D.metadata.offset);
    PS.playAudioStarted = true;
  } else {
    PS.playAudioStarted = false;
  }
}

// Pause-button click on plCv / playFSCv
['plCv', 'playFSCv'].forEach(id => {
  document.addEventListener('DOMContentLoaded', () => {
    const el = $(id);
    if (el) el.addEventListener('click', (e) => handleGameCanvasClick(e, el));
  });
});
