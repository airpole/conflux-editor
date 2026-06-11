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
  // Two separate candidate searches, because normal and wide notes compete
  // differently for a key press:
  //   • A NORMAL note can ONLY be hit by its own lane's key.
  //   • A WIDE note accepts ANY key.
  // So when a wide and a normal coincide, the lane key must take the normal
  // (its only possible hitter) and let some other key satisfy the wide. If we
  // judged them in one pool the wide could be picked first and orphan the
  // normal into a MISS — the "input eaten" bug on wide+normal chords.
  //
  // Within each class we pick the EARLIEST note in window (smallest startTick),
  // not the absolute-nearest, so a slightly-early input can't skip an older
  // un-hit note and steal a closer later one.
  let bestNormal = null, bestNormalTick = Infinity;
  let bestWide = null, bestWideTick = Infinity;
  for (const n of D.notes) {
    if (PS.playHitMap.has(n) || PS.playMissSet.has(n)) continue;
    const diff = Math.abs(curMs - t2ms(n.startTick));
    if (n.isWide) {
      // A wide note already sustained by another key must not be re-judged as
      // a fresh head hit (it would double-count combo / score).
      if (Object.values(PS.playHoldState).includes(n)) continue;
      if (diff <= JUDGE_WIDE_SYNC && n.startTick < bestWideTick) {
        bestWide = n; bestWideTick = n.startTick;
      }
    } else {
      if (n.channel !== line) continue;
      if (diff <= JUDGE_GOOD && n.startTick < bestNormalTick) {
        bestNormal = n; bestNormalTick = n.startTick;
      }
    }
  }
  const best = bestNormal || bestWide;   // normal (lane-specific) wins ties
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
  // Cut the hold effect short: its endMs was the tail time, which kept the
  // ripple glowing on a broken hold. Clamping to now lets it fade immediately.
  for (const h of PS.playEffects) {
    if (h.note === note && h.endMs > curMs) h.endMs = curMs;
  }
  PS.playCombo = 0;
  PS.playJudgQueue.push({type: 'MISS', diff: undefined, t: curMs});
  if (gaugeOnJudgment('TAIL_MISS')) PS.playForceEnded = true;
}
