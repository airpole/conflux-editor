// ============================================================
//  PLAY-INPUT — keyboard handlers + pause click on game canvas
// ============================================================
import { PS } from './play-state.js';
import { AS } from './audio-state.js';
import { KEY2LINE, LN_RELEASE_GRACE_MS } from './constants.js';
import { getPlayJudgment, applyJudgment, applyTailSuccess, applyMidRelease } from './play-judgment.js';

export function handlePlayKeyDown(code) {
  if (PS.playAutoplay) return;
  const ch = PS.codeToChannel[code];
  if (!ch || PS.playKeyHeld.has(ch)) return;
  PS.playKeyHeld.add(ch);
  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;
  // Visual feedback: record press time so the renderer can flash the lane beam.
  if (!PS.playKeyPressMs) PS.playKeyPressMs = {};
  PS.playKeyPressMs[ch] = curMs;
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

  const curMs = PS.playOffMs + (performance.now() - PS.playT0) * AS.playbackRate;

  // Release grace: lifting at or after (tail − grace) is a successful tail.
  // The per-frame check in playLoop still grants success at the exact tail
  // for keys held through it, so this branch only fires for slightly-early
  // releases — the human-impossible "release exactly on the tail" case.
  if (curMs >= rec.tailMs - LN_RELEASE_GRACE_MS) {
    applyTailSuccess(note, curMs);
    return;
  }

  // Shared hold: if another channel still references this same note (wide
  // holds can be shared by several keys), this release is just one finger
  // lifting off — the note continues, no judgment.
  for (const heldCh of Object.keys(PS.playHoldState)) {
    if (PS.playHoldState[heldCh] === note) return;
  }

  // Hold transfer — the crossed-binding self-heal. In a chord the "wrong"
  // finger can land first and get bound to the hold (e.g. a wide-intended
  // tap on key 4 grabbing a line-2 hold head). When that finger lifts, hand
  // the sustain to any other currently-pressed free key that can legally
  // sustain this note: ANY key for a wide note, a SAME-LINE key for a normal
  // note. The player's real holding finger then carries the LN.
  for (const heldCh of PS.playKeyHeld) {
    if (PS.playHoldState[heldCh]) continue;
    if (note.isWide || KEY2LINE[heldCh] === note.channel) {
      PS.playHoldState[heldCh] = note;
      return;
    }
  }

  // Nothing can carry it: released too early → mid-release MISS.
  applyMidRelease(note, curMs);
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
