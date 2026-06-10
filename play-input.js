// ============================================================
//  PLAY-INPUT — keyboard handlers + pause click on game canvas
// ============================================================
import { PS } from './play-state.js';
import { AS } from './audio-state.js';
import { getPlayJudgment, applyJudgment, applyTailSuccess, applyMidRelease } from './play-judgment.js';

export function handlePlayKeyDown(code) {
  if (PS.playAutoplay) return;
  const ch = PS.codeToChannel[code];
  if (!ch || PS.playKeyHeld.has(ch)) return;
  PS.playKeyHeld.add(ch);
  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
  const result = getPlayJudgment(ch, curMs);
  if (result) {
    applyJudgment(result.note, result.diff, curMs);
    if (result.note.duration > 0) {
      PS.playHoldState[ch] = result.note;
    }
  } else if (!PS.playHoldState[ch]) {
    // Wide hold transfer: a wide LN may be sustained by any key. If another
    // key is currently holding a wide note whose tail is still in the future,
    // let this key share the hold too. We require the source note's tail to be
    // unresolved so a finished/failed note can't be "re-grabbed" to farm combo.
    for (const [otherCh, note] of Object.entries(PS.playHoldState)) {
      if (!note.isWide || +otherCh === ch) continue;
      const rec = PS.playHitMap.get(note);
      if (!rec || !rec.isLN || rec.tailDone) continue;
      PS.playHoldState[ch] = note;
      break;
    }
  }
}

export function handlePlayKeyUp(code) {
  if (PS.playAutoplay) return;
  const ch = PS.codeToChannel[code];
  if (!ch) return;
  PS.playKeyHeld.delete(ch);
  if (!PS.playHoldState[ch]) return;

  const note = PS.playHoldState[ch];
  delete PS.playHoldState[ch];

  const rec = PS.playHitMap.get(note);
  // Tail already resolved (success via the per-frame check in playLoop, or a
  // prior mid-release): nothing to do.
  if (!rec || !rec.isLN || rec.tailDone) return;

  // Wide hold: a wide LN is sustained as long as ANY key still holds it.
  if (note.isWide) {
    // If another channel still references this same note, this release is just
    // one finger lifting off a multi-key hold — the note continues, no judgment.
    for (const heldCh of Object.keys(PS.playHoldState)) {
      if (PS.playHoldState[heldCh] === note) return;
    }
    // No channel holds it anymore. If another key is still physically pressed
    // and free, hand the sustain to it so the LN keeps going (tail still ahead).
    const curMsW = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
    if (curMsW < rec.tailMs) {
      for (const heldCh of PS.playKeyHeld) {
        if (!PS.playHoldState[heldCh]) {
          PS.playHoldState[heldCh] = note;
          return;
        }
      }
    }
  }

  // Classify the release. The per-frame tail check in playLoop already grants
  // success at the exact tail moment for notes still held, so reaching here
  // means the key was lifted before that check fired. Released at/after the
  // tail (same frame) → success; released before the tail → mid-release MISS.
  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
  if (curMs >= rec.tailMs) {
    applyTailSuccess(note, curMs);
  } else {
    applyMidRelease(note, curMs);
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
