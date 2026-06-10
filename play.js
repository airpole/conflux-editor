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
import { resetGauge, gaugeOnJudgment, computeResult } from './gauge.js';
import { showResult } from './play-result.js';
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
    // Rebind the hit scheduler at the exact moment audio comes online.
    // resetHitScheduler in startPlay was based on the negative lead-in
    // timestamp; by the time PS.playAudioStarted flips to true, the loop
    // condition `nMs >= curMs` would skip notes whose nMs sits just before
    // the current frame's curMs (notably the first note at nMs ≈ 0 when
    // curMs has already advanced to ~16ms). Reset here so the lookahead
    // window starts inclusive of any note that's already "due".
    resetHitScheduler(curMs);
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
          // Gauge: a missed note (LN head miss auto-fails its tail too, but we
          // charge the gauge a single MISS — the lost tail is already counted
          // in scoring; double-draining the gauge would be over-punishing).
          if (gaugeOnJudgment('MISS')) PS.playForceEnded = true;
        }
      );
      // LN tail completion (manual). A held LN succeeds at the exact tail
      // moment — combo rises here, NOT when the key is later released. keyup
      // only handles early release (mid-release MISS). Iterating playHoldState
      // mirrors the autoplay tail loop above so both paths resolve identically.
      for (const ch of Object.keys(PS.playHoldState)) {
        const note = PS.playHoldState[ch];
        const rec = PS.playHitMap.get(note);
        if (!rec || !rec.isLN || rec.tailDone) { delete PS.playHoldState[ch]; continue; }
        if (curMs >= rec.tailMs) {
          applyTailSuccess(note, curMs);
          delete PS.playHoldState[ch];
        }
      }
    }
  }
  // ── Force-end (gauge death / terminate-mode lock break) ──────
  // A judgment this frame may have flagged a force-end. Only meaningful in
  // manual play (autoplay can't fail). Finalize as a fail (State F).
  if (PS.playForceEnded && !PS.playAutoplay) {
    finalizePlay(/*forceEnded=*/true);
    return;
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
  // ── Natural song end ─────────────────────────────────────────
  if (curMs > (ES.totalMs || 0) + 2000) {
    // In manual play, evaluate clear/fail and produce a result before stopping.
    if (!PS.playAutoplay) finalizePlay(/*forceEnded=*/false);
    else stopPlay();
    return;
  }
  PS.playRAF = requestAnimationFrame(playLoop);
}

/**
 * End a manual session and compute its result. forceEnded=true marks a
 * fail-stop (gauge death / terminate-mode lock break): the remaining unjudged
 * notes are swept into the miss set so the result reflects the whole chart,
 * per the design's force-end handling. Then computeResult() fills PS.playResult
 * and stopPlay() tears the session down. (Result-screen transition is wired in
 * a later step; for now the outcome lives on PS.playResult.)
 */
function finalizePlay(forceEnded) {
  // Resolve any LN whose head was hit but whose tail never completed. On a
  // natural end the per-frame tail check has already finished held notes, so
  // this only catches force-end (fail-stop) cases where the player was still
  // holding — those tails are charged as failed so the result reflects them
  // instead of silently dropping the tail point.
  for (const rec of PS.playHitMap.values()) {
    if (rec.isLN && !rec.tailDone) {
      rec.tailDone = true;
      rec.tailFailed = true;
    }
  }
  if (forceEnded) {
    for (const n of D.notes) {
      if (!PS.playHitMap.has(n) && !PS.playMissSet.has(n)) PS.playMissSet.add(n);
    }
  }
  const result = computeResult(forceEnded);
  const wasAutoplay = PS.playAutoplay;
  stopPlay();
  // Autoplay runs are practice — no Result/record. Manual sessions show the
  // Result overlay; Retry restarts the chart from the lead-in (fullscreen),
  // matching the design's Retry → Credits → In-game flow (Credits TBD).
  if (!wasAutoplay) {
    showResult(result, () => startPlay(true, false));
  }
}

/**
 * Start a play session.
 * @param {boolean} fromBeginning  true = restart from lead-in; false = from sharedMs
 * @param {boolean} autoplay       true = auto-SYNC; false = manual key input
 */
export function startPlay(fromBeginning, autoplay) {
  initAud();
  // Phase: AudioContext.resume() is async — on Samsung Internet (and Safari)
  // a freshly-created context can sit in 'suspended' for a frame or two
  // after initAud(), and AS.asrc.start() called against a suspended context
  // produces unpredictable scheduling: the buffer eventually plays but the
  // ctx.currentTime anchor we capture in startAud() lags reality, so
  // performance.now() (used for curMs) and the audio drift apart for the
  // first 50-200ms. If suspended, defer the rest of startup until resumed.
  if (AS.actx && AS.actx.state === 'suspended') {
    AS.actx.resume().then(() => _startPlayImpl(fromBeginning, autoplay))
                    .catch(() => _startPlayImpl(fromBeginning, autoplay));
    return;
  }
  _startPlayImpl(fromBeginning, autoplay);
}

function _startPlayImpl(fromBeginning, autoplay) {
  // Phase: re-read the Auto checkbox at session start. The change-event
  // handler in main.js writes PS.playAutoplay, but on the very first toggle
  // after page load there are edge cases (rapid label-click double-fires,
  // pointercancel ordering) where the variable can lag the UI. Pulling the
  // truth straight from the DOM here makes the visible checkbox state
  // authoritative for the session, matching user expectation.
  const autoChkEl = $('playAutoChk');
  if (autoChkEl) PS.playAutoplay = !!autoChkEl.checked;

  const offMs = fromBeginning ? -LEAD_IN_MS : ES.sharedMs;
  PS.playOffMs = offMs;
  PS.playActive = true;
  PS.playStartedFromBeginning = !!fromBeginning;
  // Freeze autoplay toggle during session
  const autoChk = $('playAutoChk');
  if (autoChk) { autoChk.disabled = true; autoChk.parentElement.style.opacity = '0.5'; }
  // Restart → fullscreen immediately. Play/Pause → windowed; user can promote.
  PS.playFullscreen = !!fromBeginning;
  // Note: PS.playAutoplay was already set from the live checkbox above; the
  // `autoplay` parameter is now only a fallback for callers that pass it
  // explicitly when the checkbox is absent (it is the live source of truth).
  if (!autoChkEl) PS.playAutoplay = !!autoplay;
  PS.playAudioStarted = false;
  PS.playHitMap.clear(); PS.playMissSet.clear(); PS.playEffects = [];
  PS.playCombo = 0; PS.playMaxCombo = 0; PS.playJudgQueue = [];
  PS.playHoldState = {}; PS.playKeyHeld.clear();

  // Gauge / clear-mark lock + Fast-Slow counters reset for the new session.
  resetGauge();

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
