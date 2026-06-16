// ============================================================
//  PLAY-INPUT — keyboard handlers + pause click on game canvas
// ============================================================
import { JUDGE_GOOD, LN_RELEASE_GRACE_MS, KEY2LINE } from './constants.js';
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
    // Crossed-binding recovery on a press that judged nothing. On a 2-key lane
    // the tap-intended finger can land first and grab the LN head, leaving the
    // real holding finger with no note. When that real finger presses (no fresh
    // judgment), inherit an in-progress hold so the LN can complete on its lift:
    //   • a WIDE hold transfers to ANY other key (wide accepts any key), and
    //   • a NORMAL LN hold transfers to a key on the SAME line (a normal LN can
    //     only be sustained by its own lane's keys).
    // Without this, the wrong-bound finger lifting mid-hold drops the LN to a
    // mid-release MISS even though a finger is still holding the lane.
    const myLine = KEY2LINE[ch];
    for (const [otherCh, note] of Object.entries(PS.playHoldState)) {
      if (+otherCh === ch) continue;
      if (note.isWide) { PS.playHoldState[ch] = note; break; }
      if (note.duration > 0 && KEY2LINE[+otherCh] === myLine) {
        PS.playHoldState[ch] = note; break;
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
    // Hold transfer on release: if another finger is still holding the lane,
    // hand the LN off so it survives this lift (crossed-binding self-heal).
    //   • WIDE → any other held key.
    //   • NORMAL LN → a held key on the SAME line only.
    if (note.isWide) {
      for (const heldCh of PS.playKeyHeld) {
        if (!PS.playHoldState[heldCh]) { PS.playHoldState[heldCh] = note; return; }
      }
    } else if (note.duration > 0) {
      const noteLine = KEY2LINE[ch];
      for (const heldCh of PS.playKeyHeld) {
        if (!PS.playHoldState[heldCh] && KEY2LINE[heldCh] === noteLine) {
          PS.playHoldState[heldCh] = note; return;
        }
      }
    }
    // Classify mid-release vs tail success. A small release grace window
    // (LN_RELEASE_GRACE_MS) counts a lift just before the tail as a success —
    // human lift timing is imprecise and an early-by-a-hair release shouldn't
    // be punished as a mid-release MISS. Same sync-offset correction as press.
    const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate - (PS.visualOffset || 0);
    const tailMs = t2ms(note.startTick + note.duration);
    if (curMs < tailMs - JUDGE_GOOD - LN_RELEASE_GRACE_MS) {
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
