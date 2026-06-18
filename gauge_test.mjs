// ============================================================
//  GAUGE / SCORING / CLEAR TESTS
// ============================================================
// Exercises resetGauge / gaugeOnJudgment / evaluateEnd / computeResult against
// the real constants. Locks in current behavior so a future merge can't quietly
// change clear thresholds, lock cascade, rank cutoffs, or score weighting.
//
// Normal gauge is LENGTH-AGNOSTIC: resetGauge() computes a per-unit gain
// a = GAUGE_NORMAL_TOTAL_GAIN / totalUnits (tap=1, LN=2), so an all-SYNC run
// sums to +GAUGE_NORMAL_TOTAL_GAIN (=150%) of potential recovery on any chart.
// The gauge caps at 100 (surplus discarded). GAINS are ×a; LOSSES (MISS /
// TAIL_MISS) are absolute −2% and identical. Hard gauge is flat absolute %
// with NO low-gauge mercy. These tests assert that model.

import { ok, eq, approx, setChart, resetSession, tap, hold, D, PS } from './harness.mjs';
import { resetGauge, gaugeOnJudgment, evaluateEnd, computeResult } from '../gauge.js';
import {
  GAUGE_START, NORMAL_CLEAR_PCT, GAUGE_DELTA, RANK_TABLE,
} from '../constants.js';

// Helper: start a fresh gauge session of a given type/lock.
function gaugeSession(opts = {}) {
  resetSession(opts);
  resetGauge();
}

export function run() {
  // ── GG1: starting values ──────────────────────────────────────────────────
  gaugeSession({ gaugeType: 'normal' });
  eq(PS.gaugeValue, GAUGE_START.normal, 'GG1 normal starts at GAUGE_START.normal');
  gaugeSession({ gaugeType: 'hard' });
  eq(PS.gaugeValue, GAUGE_START.hard, 'GG1 hard starts at GAUGE_START.hard');

  // ── GG2: Normal positive deltas are unit-scaled; losses are absolute ──────
  // a = GAUGE_NORMAL_TOTAL_GAIN / totalUnits. Use a chart big enough that one
  // judgment's scaled gain stays under the 100 cap so we can read it exactly.
  // 8 taps → a = 150/8 = 18.75.
  {
    const notes = Array.from({ length: 8 }, (_, i) => tap((i % 4) + 1, i * 240));
    setChart(notes);
    const a = 150 / 8;
    for (const [kind, base] of [['SYNC', 1.0], ['PERFECT', 1.0], ['GOOD', 0.5], ['TAIL_OK', 1.0]]) {
      gaugeSession({ gaugeType: 'normal' });
      gaugeOnJudgment(kind);
      approx(PS.gaugeValue, base * a, 1e-9, `GG2 normal ${kind}: gain ×a (a=${a})`);
    }
    for (const kind of ['MISS', 'TAIL_MISS']) {
      gaugeSession({ gaugeType: 'normal' });
      PS.gaugeValue = 80;   // mid-bar so a loss isn't clamped at 0
      const before = PS.gaugeValue;
      gaugeOnJudgment(kind);
      approx(PS.gaugeValue, before + GAUGE_DELTA.normal[kind], 1e-9,
        `GG2 normal ${kind}: loss is absolute %`);
    }
  }
  // Hard deltas are absolute (above the mercy guard so nothing is halved).
  {
    setChart([tap(1, 0)]);
    for (const kind of ['SYNC', 'PERFECT', 'GOOD', 'TAIL_OK', 'MISS', 'TAIL_MISS']) {
      gaugeSession({ gaugeType: 'hard' });  // starts at 100, above guard
      const start = PS.gaugeValue;
      gaugeOnJudgment(kind);
      const expected = Math.max(0, Math.min(100, start + (GAUGE_DELTA.hard[kind] ?? 0)));
      approx(PS.gaugeValue, expected, 1e-9, `GG2 hard ${kind}: absolute delta`);
    }
  }

  // ── GG2b: all-good run reaches the 100 cap on any chart length ────────────
  // All-good gain sums to +150% but the gauge caps at 100, so every all-SYNC
  // run ends pinned at exactly 100 regardless of length.
  for (const spec of [
    { label: '4 taps',           notes: [tap(1), tap(2), tap(3), tap(4)] },
    { label: '1 tap',            notes: [tap(1)] },
    { label: '200 taps',         notes: Array.from({ length: 200 }, (_, i) => tap((i % 4) + 1, i * 240)) },
    { label: '1 LN (2 units)',   notes: [hold(1, 0, 480)] },
    { label: 'mixed taps + LNs', notes: [tap(1), hold(2, 480, 480), tap(3, 960), hold(4, 1440, 480)] },
  ]) {
    setChart(spec.notes);
    gaugeSession({ gaugeType: 'normal' });
    for (const n of spec.notes) {
      gaugeOnJudgment('SYNC');
      if (n.duration > 0) gaugeOnJudgment('TAIL_OK');
    }
    approx(PS.gaugeValue, 100, 1e-6, `GG2b all-SYNC pins at 100 cap (${spec.label})`);
  }

  // ── GG2c: 50% headroom — dropping up to a third of units still ends at 100 ─
  // With +150% potential and a 100 cap, missing ~1/3 of the gain still reaches
  // 100 (ignoring loss penalties, i.e. unhit-but-not-missed gain shortfall).
  // Concretely: hitting 2/3 of units as SYNC gives 150 × 2/3 = 100 → exactly cap.
  {
    const notes = Array.from({ length: 9 }, (_, i) => tap((i % 4) + 1, i * 240)); // 9 units
    setChart(notes);
    gaugeSession({ gaugeType: 'normal' });
    for (let i = 0; i < 6; i++) gaugeOnJudgment('SYNC');  // 6/9 = 2/3 hit as SYNC
    approx(PS.gaugeValue, 100, 1e-6, 'GG2c hitting 2/3 of units (SYNC) still reaches 100 (headroom)');
  }

  // ── GG3: clamp range — both types cap at 100, floor at 0 ──────────────────
  setChart([tap(1), tap(2), tap(3), tap(4)]);
  gaugeSession({ gaugeType: 'normal' });
  for (let i = 0; i < 300; i++) gaugeOnJudgment('SYNC');
  ok(PS.gaugeValue <= 100, 'GG3 normal gauge never exceeds 100 (capped)');
  approx(PS.gaugeValue, 100, 1e-6, 'GG3 normal gauge caps at 100');
  gaugeSession({ gaugeType: 'hard' });
  for (let i = 0; i < 300; i++) gaugeOnJudgment('SYNC');
  ok(PS.gaugeValue <= 100, 'GG3 hard gauge never exceeds 100');
  gaugeSession({ gaugeType: 'hard' });
  for (let i = 0; i < 300; i++) gaugeOnJudgment('MISS');
  ok(PS.gaugeValue >= 0, 'GG3 gauge never drops below 0');

  // ── GG3b: Hard has NO low-gauge mercy — loss identical at any level ────────
  {
    setChart([tap(1)]);
    gaugeSession({ gaugeType: 'hard' });
    PS.gaugeValue = 90; gaugeOnJudgment('MISS');
    const lossHigh = 90 - PS.gaugeValue;
    PS.gaugeValue = 20; gaugeOnJudgment('MISS');   // well below the old 30% guard
    const lossLow = 20 - PS.gaugeValue;
    approx(lossHigh, lossLow, 1e-9, 'GG3b hard MISS loss same high vs low gauge (no mercy)');
    approx(lossHigh, -GAUGE_DELTA.hard.MISS, 1e-9, 'GG3b hard MISS loss = full table value');
  }

  // ── GG4: hard gauge death at 0 force-ends ─────────────────────────────────
  gaugeSession({ gaugeType: 'hard' });
  let died = false;
  for (let i = 0; i < 50 && !died; i++) died = gaugeOnJudgment('MISS');
  ok(died, 'GG4 hard gauge force-ends when it reaches 0');
  // Normal gauge never force-ends from a low gauge (it just won't clear).
  gaugeSession({ gaugeType: 'normal' });
  let normalForced = false;
  for (let i = 0; i < 50; i++) normalForced = gaugeOnJudgment('MISS') || normalForced;
  ok(!normalForced, 'GG4 normal gauge does NOT force-end on misses');

  // ── GG5: clear evaluation thresholds ──────────────────────────────────────
  gaugeSession({ gaugeType: 'normal' });
  PS.gaugeValue = NORMAL_CLEAR_PCT;
  ok(evaluateEnd(), `GG5 normal clears at exactly ${NORMAL_CLEAR_PCT}%`);
  PS.gaugeValue = NORMAL_CLEAR_PCT - 0.5;
  ok(!evaluateEnd(), 'GG5 normal does NOT clear just below threshold');
  gaugeSession({ gaugeType: 'hard' });
  PS.gaugeValue = 0.5;
  ok(evaluateEnd(), 'GG5 hard clears if gauge > 0 at end');
  PS.gaugeValue = 0;
  ok(!evaluateEnd(), 'GG5 hard does NOT clear at exactly 0');

  // ── GG6: lock terminate vs cascade ────────────────────────────────────────
  // AS lock, terminate: a PERFECT (breaks AS) force-ends.
  gaugeSession({ gaugeType: 'normal', lockTarget: 'as', lockMode: 'terminate' });
  ok(gaugeOnJudgment('PERFECT'), 'GG6 AS+terminate: PERFECT force-ends');
  // AS lock, cascade: a PERFECT lowers tier to AP, keeps going.
  gaugeSession({ gaugeType: 'normal', lockTarget: 'as', lockMode: 'cascade' });
  ok(!gaugeOnJudgment('PERFECT'), 'GG6 AS+cascade: PERFECT does NOT end');
  eq(PS.lockTier, 'ap', 'GG6 AS+cascade: tier drops AS→AP');
  // ...another GOOD now breaks AP → drops to FC
  ok(!gaugeOnJudgment('GOOD'), 'GG6 cascade: GOOD does NOT end (drops to fc)');
  eq(PS.lockTier, 'fc', 'GG6 cascade: tier drops AP→FC');
  // ...a MISS breaks FC → drops to none (bare gauge), still playing
  ok(!gaugeOnJudgment('MISS'), 'GG6 cascade: MISS does NOT end (drops to none)');
  eq(PS.lockTier, 'none', 'GG6 cascade: tier drops FC→none');

  // ── GG7: FC lock — only MISS breaks it ────────────────────────────────────
  gaugeSession({ gaugeType: 'normal', lockTarget: 'fc', lockMode: 'terminate' });
  ok(!gaugeOnJudgment('PERFECT'), 'GG7 FC: PERFECT does not break FC');
  ok(!gaugeOnJudgment('GOOD'), 'GG7 FC: GOOD does not break FC');
  ok(gaugeOnJudgment('MISS'), 'GG7 FC: MISS breaks FC → terminate');

  // ── GG8: scoring / rank via computeResult ─────────────────────────────────
  // All-SYNC on a 4-tap chart → perfect score → top rank.
  {
    const notes = [tap(1, 0), tap(2, 480), tap(3, 960), tap(4, 1440)];
    setChart(notes); gaugeSession({ gaugeType: 'normal' });
    for (const n of notes) PS.playHitMap.set(n, { headType: 'SYNC', isLN: false, tailDone: true, tailFailed: false });
    const res = computeResult(false);
    eq(res.score, 1000000, 'GG8 all-SYNC → score 1,000,000');
    eq(res.rank, RANK_TABLE[0][0], `GG8 all-SYNC → top rank ${RANK_TABLE[0][0]}`);
    eq(res.counts.sync, 4, 'GG8 counts.sync = 4');
    eq(res.counts.miss, 0, 'GG8 counts.miss = 0');
  }

  // ── GG9: state priority AS/AP/FC/C/P/F ────────────────────────────────────
  function stateFor(hitTypes, { misses = 0, gaugeType = 'normal', gaugeValue = 100, forceEnded = false } = {}) {
    const notes = hitTypes.map((_, i) => tap(((i % 4) + 1), i * 480));
    const missNotes = Array.from({ length: misses }, (_, i) => tap(1, 100000 + i * 480));
    setChart([...notes, ...missNotes]); gaugeSession({ gaugeType });
    hitTypes.forEach((t, i) => PS.playHitMap.set(notes[i], { headType: t, isLN: false, tailDone: true, tailFailed: false }));
    for (const m of missNotes) PS.playMissSet.add(m);
    PS.gaugeValue = gaugeValue;
    return computeResult(forceEnded).state;
  }
  eq(stateFor(['SYNC', 'SYNC', 'SYNC']), 'AS', 'GG9 all SYNC → AS');
  eq(stateFor(['SYNC', 'PERFECT', 'SYNC']), 'AP', 'GG9 a PERFECT → AP');
  eq(stateFor(['SYNC', 'GOOD', 'PERFECT']), 'FC', 'GG9 a GOOD (no miss) → FC');
  eq(stateFor(['SYNC', 'SYNC'], { misses: 1, gaugeValue: 100 }), 'C', 'GG9 a MISS but cleared (normal) → C');
  eq(stateFor(['SYNC', 'SYNC'], { misses: 1, gaugeType: 'hard', gaugeValue: 50 }), 'H', 'GG9 a MISS but cleared (hard) → H');
  eq(stateFor(['SYNC'], { misses: 5, gaugeValue: 10 }), 'P', 'GG9 missed + not cleared → P');
  eq(stateFor(['SYNC'], { forceEnded: true }), 'F', 'GG9 force-ended → F');

  // ── GG10: GOOD/MISS score weighting ───────────────────────────────────────
  {
    // 4 taps: 2 SYNC, 1 GOOD (half), 1 MISS (zero) → score = (2 + 0.5)/4 * 1e6.
    const notes = [tap(1, 0), tap(2, 480), tap(3, 960), tap(4, 1440)];
    setChart(notes); gaugeSession();
    PS.playHitMap.set(notes[0], { headType: 'SYNC', isLN: false, tailDone: true, tailFailed: false });
    PS.playHitMap.set(notes[1], { headType: 'SYNC', isLN: false, tailDone: true, tailFailed: false });
    PS.playHitMap.set(notes[2], { headType: 'GOOD', isLN: false, tailDone: true, tailFailed: false });
    PS.playMissSet.add(notes[3]);
    const res = computeResult(false);
    eq(res.score, Math.round((2 + 0.5) / 4 * 1000000), 'GG10 GOOD=half, MISS=0 score weighting');
    eq(res.counts.good, 1, 'GG10 counts.good = 1');
    eq(res.counts.miss, 1, 'GG10 counts.miss = 1');
  }

  // ── GG11: LN counts as 2 units (head + tail) in totals ────────────────────
  {
    const ln = hold(1, 0, 480);
    setChart([ln]); gaugeSession();
    // head SYNC + tail OK = full 2/2 → score 1e6
    PS.playHitMap.set(ln, { headType: 'SYNC', isLN: true, tailDone: true, tailFailed: false });
    const res = computeResult(false);
    eq(res.score, 1000000, 'GG11 LN head+tail both good → full score (2 units)');
    eq(res.counts.sync, 2, 'GG11 LN good counts as 2 sync (head+tail)');
  }

  // ── GG12: record-eligibility gate ─────────────────────────────────────────
  // A best record may be written only for a full, full-speed, manual run.
  function eligibility({ fromBeginning, usedSlowRate, autoplay }) {
    const notes = [tap(1, 0)];
    setChart(notes); gaugeSession();
    PS.playStartedFromBeginning = fromBeginning;
    PS.playUsedSlowRate = usedSlowRate;
    PS.playAutoplay = autoplay;
    PS.playHitMap.set(notes[0], { headType: 'SYNC', isLN: false, tailDone: true, tailFailed: false });
    return computeResult(false).recordEligible;
  }
  ok(eligibility({ fromBeginning: true,  usedSlowRate: false, autoplay: false }) === true,
    'GG12 full manual run from start → eligible');
  ok(eligibility({ fromBeginning: false, usedSlowRate: false, autoplay: false }) === false,
    'GG12 mid-chart start → NOT eligible');
  ok(eligibility({ fromBeginning: true,  usedSlowRate: true,  autoplay: false }) === false,
    'GG12 slowed below 1.0× → NOT eligible');
  ok(eligibility({ fromBeginning: true,  usedSlowRate: false, autoplay: true  }) === false,
    'GG12 autoplay → NOT eligible');
  ok(eligibility({ fromBeginning: false, usedSlowRate: true,  autoplay: true  }) === false,
    'GG12 multiple disqualifiers → NOT eligible');
}
