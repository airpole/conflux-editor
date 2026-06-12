// ============================================================
//  PLAY-INPUT — keyboard handlers + pause click on game canvas
// ============================================================
import { JUDGE_GOOD } from './constants.js';
import { PS } from './play-state.js';
import { AS } from './audio-state.js';
import { t2ms } from './timing.js';
import { getPlayJudgment, applyJudgment, applyTailSuccess, applyMidRelease } from './play-judgment.js';

export function handlePlayKeyDown(code) {
  if (PS.playAutoplay) return;
  const ch = PS.codeToChannel[code];
  if (!ch || PS.playKeyHeld.has(ch)) return;
  PS.playKeyHeld.add(ch);
  // Personal sync offset: shift the input timestamp so the player's hardware/
  // audio latency is compensated. Positive offset advances input (for players
  // who tend to hit late). Applied here so judgment, Fast/Slow, and recorded
  // diff all share one corrected clock.
  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate - (PS.visualOffset || 0);
  const result = getPlayJudgment(ch, curMs);
  if (result) {
    applyJudgment(result.note, result.diff, curMs);
    if (result.note.duration > 0) {
      PS.playHoldState[ch] = result.note;
    }
  } else if (!PS.playHoldState[ch]) {
    // Wide hold transfer: share with another key currently holding a wide note
    for (const [otherCh, note] of Object.entries(PS.playHoldState)) {
      if (note.isWide && +otherCh !== ch) {
        PS.playHoldState[ch] = note;
        break;
      }
    }
  }
}

export function handlePlayKeyUp(code) {
  if (PS.playAutoplay) return;
  const ch = PS.codeToChannel[code];
  if (!ch) return;
  PS.playKeyHeld.delete(ch);
  if (PS.playHoldState[ch]) {
    const note = PS.playHoldState[ch];
    delete PS.playHoldState[ch];
    // Wide hold: try to transfer to any other held key
    if (note.isWide) {
      for (const heldCh of PS.playKeyHeld) {
        if (!PS.playHoldState[heldCh]) {
          PS.playHoldState[heldCh] = note;
          return;
        }
      }
    }
    // Phase 6 D2: classify mid-release vs tail success based on timing.
    // Same sync-offset correction as keypress so tail timing matches.
    const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate - (PS.visualOffset || 0);
    const tailMs = t2ms(note.startTick + note.duration);
    if (curMs < tailMs - JUDGE_GOOD) {
      applyMidRelease(note, curMs);
    } else {
      applyTailSuccess(note, curMs);
    }
  }
}

/** Pause button click handler for game canvases. */
export function handleGameCanvasClick(e, cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch_ = cv.height / dpr;
  const asp = 16 / 9;
  let gw, gh, gx, gy;
  if (cw / ch_ > asp) { gh = ch_; gw = gh * asp; gx = (cw - gw) / 2; gy = 0; }
  else { gw = cw; gh = gw / asp; gx = 0; gy = (ch_ - gh) / 2; }
  const pauseSz = gw / 16;
  const clickX = (e.clientX - rect.left) / rect.width * cw;
  const clickY = (e.clientY - rect.top)  / rect.height * ch_;
  if (clickX >= gx && clickX <= gx + pauseSz && clickY >= gy && clickY <= gy + pauseSz) {
    if (PS.playActive) {
      import('./play.js').then(m => m.stopPlay());
    }
  }
}
