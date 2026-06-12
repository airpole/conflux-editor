// ============================================================
//  GAUGE — life gauge, clear-mark locks, rank/state, result calc
// ============================================================
// One module owning every "did the player clear, and how well" decision.
//
// Design (agreed):
//   • Two real gauges: Normal and Hard (PS.gaugeType).
//       Normal: starts 0, clears if gauge >= NORMAL_CLEAR_PCT at song end.
//       Hard:   starts 100, fails the instant gauge reaches 0.
//   • Clear-mark locks (FC / AP / AS) sit ON TOP of the gauge (PS.lockTarget):
//       'terminate' → breaking the locked condition force-ends the song (F).
//       'cascade'   → breaking drops one tier (AS→AP→FC→bare gauge) and play
//                     continues; final mark = highest tier still intact.
//
// The gauge is fed by the judgment pipeline (play-judgment.js) and the miss
// sweep (play.js). Every head judgment, tail resolution, and miss calls in
// here exactly once so the gauge and the lock tier stay in lock-step with
// PS.playHitMap / PS.playMissSet.
//
// All tunable numbers live in constants.js (GAUGE_DELTA etc.), never here.

import { GAUGE_START, NORMAL_CLEAR_PCT, GAUGE_DELTA, LOCK_TIERS, RANK_TABLE } from './constants.js';
import { D } from './state.js';
import { PS } from './play-state.js';

// ── Lifecycle ────────────────────────────────────────────────

/** Reset gauge + lock state at session start. Call from _startPlayImpl. */
export function resetGauge() {
  PS.gaugeValue = GAUGE_START[PS.gaugeType] ?? 0;
  // Live lock tier begins at whatever the player is attempting. With no lock
  // it stays 'none' and only the bare gauge decides the outcome.
  PS.lockTier = PS.lockTarget;
  PS.playForceEnded = false;
  PS.playResult = null;
  PS.fastCount = 0;
  PS.slowCount = 0;
  PS.flashTiming = null;
  PS.flashAt = 0;
}

function clampGauge(v) {
  return Math.max(0, Math.min(100, v));
}

// ── Judgment feed ────────────────────────────────────────────
// `kind` is one of: 'SYNC' | 'PERFECT' | 'GOOD' | 'MISS'
//                   | 'TAIL_OK' | 'TAIL_MISS'
// Head judgments use SYNC/PERFECT/GOOD/MISS; hold tails use TAIL_OK/TAIL_MISS.

/**
 * Apply one judgment's gauge delta and update the clear-mark lock.
 * Returns true if this judgment force-ends the session (caller should stop).
 */
export function gaugeOnJudgment(kind) {
  // 1) Gauge delta
  const table = GAUGE_DELTA[PS.gaugeType] || GAUGE_DELTA.normal;
  const delta = table[kind] ?? 0;
  PS.gaugeValue = clampGauge(PS.gaugeValue + delta);

  // 2) Clear-mark lock evaluation. Map this judgment to the strictest tier
  //    it still satisfies, then break any locked tier it falls short of.
  //    A MISS / TAIL_MISS breaks FC (and everything stricter). A GOOD breaks
  //    AP (and AS). A PERFECT breaks AS. SYNC / TAIL_OK break nothing.
  const isMiss = (kind === 'MISS' || kind === 'TAIL_MISS');
  const isGood = (kind === 'GOOD');
  const isPerfect = (kind === 'PERFECT');
  // SYNC and TAIL_OK satisfy every tier — no break.

  let forceEnd = false;
  if (PS.lockTarget !== 'none') {
    if (isMiss)        forceEnd = breakLockAt('fc');  // breaking FC breaks all above
    else if (isGood)   forceEnd = breakLockAt('ap');
    else if (isPerfect)forceEnd = breakLockAt('as');
  }

  // 3) Hard gauge death — reaching 0 ends the run regardless of locks.
  if (PS.gaugeType === 'hard' && PS.gaugeValue <= 0) forceEnd = true;

  return forceEnd;
}

/**
 * The locked condition for `tier` (and everything stricter) just broke.
 * terminate-mode: returns true (force end). cascade-mode: lower the live tier
 * to one step below `tier` and keep going (returns false).
 *
 * Tier order strict→loose: as > ap > fc > (bare gauge = 'none').
 */
function breakLockAt(tier) {
  // If our attempt is already at/below the broken tier, nothing stricter is
  // riding on this judgment — no effect.
  if (!tierAtLeast(PS.lockTier, tier)) return false;

  if (PS.lockMode === 'terminate') {
    PS.lockTier = 'broken';
    return true;
  }
  // cascade: step the live tier down to just below the broken one.
  PS.lockTier = tierBelow(tier);
  return false;
}

/** Is tier `a` at least as strict as tier `b`? (as>ap>fc>none) */
function tierAtLeast(a, b) {
  const rank = t => (t === 'as' ? 3 : t === 'ap' ? 2 : t === 'fc' ? 1 : 0);
  return rank(a) >= rank(b);
}

/** The tier one step looser than `tier`. fc→none, ap→fc, as→ap. */
function tierBelow(tier) {
  const i = LOCK_TIERS.indexOf(tier);          // ['as','ap','fc']
  if (i === -1) return 'none';
  return i === LOCK_TIERS.length - 1 ? 'none' : LOCK_TIERS[i + 1];
}

// ── Fast / Slow feedback ─────────────────────────────────────
// Called only for normal (non-wide) head judgments that aren't MISS. `diff`
// is curMs - noteMs: positive = late press = SLOW, negative = early = FAST.
// |diff| within SYNC window is treated as on-time (no F/S shown), matching
// the convention that a perfect-sync hit shouldn't nag the player.
// ── Fast / Slow feedback (ez2on-style) ───────────────────────
// Fires ONLY when a normal (non-wide) note is judged PERFECT or GOOD — i.e.
// the player hit it well but OUTSIDE the top SYNC window — to flag that the
// hit was early (FAST, diff<0) or late (SLOW, diff>0). A SYNC hit shows
// nothing (it was on time); MISS and Wide show nothing; autoplay shows nothing
// (auto-judges a frame late, so every diff would read SLOW and be meaningless).
// Sets a brief flash + bumps the session total drawn later on Result.
export function feedFastSlow(diff, isWide, kind, curMs) {
  if (PS.playAutoplay) return;
  if (isWide) return;
  if (kind !== 'PERFECT' && kind !== 'GOOD') return;   // SYNC / MISS → nothing
  if (diff < 0) { PS.flashTiming = 'FAST'; PS.fastCount++; }
  else if (diff > 0) { PS.flashTiming = 'SLOW'; PS.slowCount++; }
  else return;
  PS.flashAt = curMs;
}

// ── End-of-song evaluation ───────────────────────────────────

/**
 * Decide clear/fail at natural song end (called when curMs passes the chart
 * end). Does NOT cover force-end mid-song — that path sets playForceEnded
 * directly. Returns the cleared boolean it also writes onto the result.
 */
export function evaluateEnd() {
  if (PS.gaugeType === 'normal') {
    return PS.gaugeValue >= NORMAL_CLEAR_PCT;
  }
  // Hard: survived to the end without hitting 0 → cleared.
  return PS.gaugeValue > 0;
}

// ── Result computation ───────────────────────────────────────
// Mirrors the scoring already used by drawPlayHUD so the Result screen and
// the in-game HUD never disagree. `forceEnded` true means a fail-stop (F).

export function computeResult(forceEnded) {
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
  for (const n of PS.playMissSet) headMissPoints += (n.duration > 0 ? 2 : 1);
  const missCount = headMissPoints + midReleases;

  const total = D.notes.reduce((s, n) => s + (n.duration > 0 ? 2 : 1), 0);

  // Score (million): SYNC/PERFECT = full, GOOD = half, MISS = 0.
  const scoreNum = sCount + tailHits + pCount + gCount * 0.5;
  const score = total > 0 ? Math.round((scoreNum / total) * 1000000) : 0;

  // Percent (independent weighting): SYNC 100 / PERFECT 70 / GOOD 30 / MISS 0.
  const pctNum = sCount + tailHits + pCount * 0.7 + gCount * 0.3;
  const accuracy = total > 0 ? (pctNum / total * 100) : 0;

  const rank = scoreToRank(score);
  const cleared = forceEnded ? false : evaluateEnd();
  const state = computeState({ sCount, pCount, gCount, tailHits, missCount, forceEnded, cleared });

  const result = {
    score, accuracy, rank, state,
    maxCombo: PS.playMaxCombo,
    counts: { sync: sCount + tailHits, perfect: pCount, good: gCount, miss: missCount },
    fastCount: PS.fastCount,
    slowCount: PS.slowCount,
    cleared, failed: !!forceEnded || (!cleared && !forceEnded ? (PS.gaugeType === 'normal') : false),
    forceEnded: !!forceEnded,
    options: {
      gaugeType: PS.gaugeType,
      lockTarget: PS.lockTarget,
      lockMode: PS.lockMode,
    },
  };
  PS.playResult = result;
  return result;
}

function scoreToRank(score) {
  for (const [name, thr] of RANK_TABLE) {
    if (score >= thr) return name;
  }
  return 'F';
}

/**
 * State priority: AS > AP > FC > H > C > P > N, plus F for force-fail.
 *   AS: every judgment SYNC (no PERFECT/GOOD/MISS).
 *   AP: every judgment PERFECT or better (no GOOD/MISS).
 *   FC: no MISS.
 *   H : Hard-gauge clear.   C: Normal-gauge clear (>=75%).
 *   P : played but not cleared (record exists).   F: force-ended fail.
 */
function computeState({ pCount, gCount, missCount, forceEnded, cleared }) {
  if (forceEnded) return 'F';
  if (missCount === 0 && gCount === 0 && pCount === 0) return 'AS';
  if (missCount === 0 && gCount === 0) return 'AP';
  if (missCount === 0) return 'FC';
  if (cleared) return PS.gaugeType === 'hard' ? 'H' : 'C';
  return 'P';
}
