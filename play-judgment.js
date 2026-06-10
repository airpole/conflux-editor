// ============================================================
//  PLAY-JUDGMENT — getPlayJudgment, applyJudgment, tail handling, seeding
// ============================================================
import { CHL, KEY2LINE, OVERLAP_CHANNELS, WIDE_COLOR,
         JUDGE_SYNC, JUDGE_PERFECT, JUDGE_GOOD, JUDGE_WIDE_SYNC } from './constants.js';
import { D } from './state.js';
import { PS } from './play-state.js';
import { t2ms } from './timing.js';
import { playHit } from './audio.js';
import { gaugeOnJudgment, feedFastSlow } from './gauge.js';

export function getPlayJudgment(channel, curMs) {
  // channel = physical key 1-6; map to line for normal note matching
  const line = KEY2LINE[channel];
  // Among all notes whose judgment window currently contains curMs, the press
  // resolves the EARLIEST one (smallest startTick), not the absolute-nearest.
  // Nearest-pick lets a slightly-early input skip an older un-hit note and
  // grab a closer later one, orphaning the older note into a MISS ("note
  // stealing"). Earliest-pick consumes notes in the order they appear, which
  // is the conventional rhythm-game behaviour.
  let best = null, bestTick = Infinity;
  for (const n of D.notes) {
    if (!n.isWide && n.channel !== line) continue;
    if (PS.playHitMap.has(n) || PS.playMissSet.has(n)) continue;
    // A wide note already being sustained by another key must not be re-judged
    // as a fresh head hit (it would double-count combo / score).
    if (n.isWide) {
      const held = Object.values(PS.playHoldState).includes(n);
      if (held) continue;
    }
    const diff = curMs - t2ms(n.startTick);
    const window = n.isWide ? JUDGE_WIDE_SYNC : JUDGE_GOOD;
    if (Math.abs(diff) <= window && n.startTick < bestTick) {
      best = n; bestTick = n.startTick;
    }
  }
  return best ? {note: best, diff: curMs - t2ms(best.startTick)} : null;
}

/**
 * Phase 7-3: seed playHitMap/combo as if every note before `curMs` had been
 * autoplayed as SYNC. AP/FC validity is preserved.
 */
export function seedPlayStateFromCurMs(curMs) {
  for (const n of D.notes) {
    const nMs = t2ms(n.startTick);
    if (nMs >= curMs) continue;
    const isLN = n.duration > 0;
    const tailMs = isLN ? t2ms(n.startTick + n.duration) : nMs;
    const tailIsPast = isLN && tailMs < curMs;
    PS.playHitMap.set(n, {
      headHit: true,
      headDiff: 0,
      headType: 'SYNC',
      headMs: nMs,
      isLN,
      tailDone: !isLN || tailIsPast,
      tailFailed: false,
      tailMs: isLN ? tailMs : undefined,
    });
    PS.playCombo++;
    if (isLN && tailIsPast) PS.playCombo++;
  }
  if (PS.playCombo > PS.playMaxCombo) PS.playMaxCombo = PS.playCombo;
}

export function applyJudgment(note, diff, curMs, silent) {
  const abs = Math.abs(diff);
  const type = note.isWide ? 'SYNC' : (abs <= JUDGE_SYNC ? 'SYNC' : abs <= JUDGE_PERFECT ? 'PERFECT' : 'GOOD');
  const isLN = note.duration > 0;
  PS.playHitMap.set(note, {
    headHit: true,
    headDiff: diff,
    headType: type,
    headMs: curMs,
    isLN,
    tailDone: !isLN,
    tailFailed: false,
    tailMs: isLN ? t2ms(note.startTick + note.duration) : undefined,
  });
  PS.playCombo++;
  if (PS.playCombo > PS.playMaxCombo) PS.playMaxCombo = PS.playCombo;
  PS.playJudgQueue.push({type, diff, t: curMs});
  // Gauge + clear-mark lock. A locked-condition break in terminate mode (or
  // Hard reaching 0) returns true; we only flag it — playLoop performs the
  // actual force-end so all judgment paths funnel through one stop point.
  if (gaugeOnJudgment(type)) PS.playForceEnded = true;
  // Fast/Slow feedback (normal head notes only; never wide, never MISS,
  // never SYNC, never autoplay — handled inside feedFastSlow).
  feedFastSlow(diff, note.isWide, type, curMs);
  // Hit effect
  const li = note.isWide ? 0 : CHL[note.channel];
  let col = note.isWide ? WIDE_COLOR : '#ffffff';
  const nMs = t2ms(note.startTick), neMs = t2ms(note.startTick + (note.duration || 0));
  let above = true;
  if (!note.isWide && OVERLAP_CHANNELS.includes(note.channel)) {
    const hasSameTick = PS.playEffects.some(h => h.tk === note.startTick && h.channel === note.channel && h.above);
    if (hasSameTick) above = false;
  }
  PS.playEffects.push({
    note,
    startMs: nMs, endMs: neMs,
    li, col,
    isWide: !!note.isWide,
    channel: note.channel, tk: note.startTick,
    judgType: type, above
  });
  // In autoplay mode hitsounds are pre-scheduled; manual play needs the
  // immediate playHit() call.
  if (!silent) playHit();
}

/** LN tail success — bumps combo and records tailDone. */
export function applyTailSuccess(note, curMs) {
  const rec = PS.playHitMap.get(note);
  if (!rec || !rec.isLN || rec.tailDone) return;
  rec.tailDone = true;
  rec.tailFailed = false;
  PS.playCombo++;
  if (PS.playCombo > PS.playMaxCombo) PS.playMaxCombo = PS.playCombo;
  if (gaugeOnJudgment('TAIL_OK')) PS.playForceEnded = true;
}

/** LN mid-release — head hit but key released before tail. */
export function applyMidRelease(note, curMs) {
  const rec = PS.playHitMap.get(note);
  if (!rec || !rec.isLN || rec.tailDone) return;
  rec.tailDone = true;
  rec.tailFailed = true;
  PS.playCombo = 0;
  PS.playJudgQueue.push({type: 'MISS', diff: undefined, t: curMs});
  if (gaugeOnJudgment('TAIL_MISS')) PS.playForceEnded = true;
}
