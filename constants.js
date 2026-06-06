// ============================================================
//  CONSTANTS — zero-dependency pure values
// ============================================================

/** DOM helper */
export const $ = id => document.getElementById(id);

/** Ticks per beat (chart time resolution) */
export const TPB = 1920;

/** Channel → line index (ch1-4 = Line 1-4) */
export const CHL = {1:0, 2:1, 3:2, 4:3};

/** Key → line mapping for play mode (6 keys → 4 lines) */
export const KEY2LINE = {1:1, 2:2, 3:3, 4:2, 5:3, 6:4};

/** Channels with 2 keys → 1 line (multi-input, overlap-capable) */
export const OVERLAP_CHANNELS = [2, 3];

// ---- Visual colors (note rendering) ----
export const WIDE_COLOR    = '#00BCD4'; // Bright cyan for wide notes (white+cyan pair)
export const WIDE_BODY     = '#008898'; // Dark teal for wide LN body (used opaque on heads)
// Wide LN body fill uses a translucent version so the grid (subdivisions,
// beats, measures) and channel separators underneath remain faintly visible
// inside the body. Without this, the wide body acts as an opaque mask and
// the user loses the rhythm/lane reference for any notes layered on top.
// Tuned by eye: 0xCC ≈ 80% opacity keeps the cyan reading clearly as "wide"
// while letting the darker grid lines (#383850 / #1e1e30) bleed through.
export const WIDE_BODY_ALPHA = '#008898cc';
export const OVERLAP_COLOR = '#FFD060'; // Gold for overlapping notes on Lines 2/3
export const OVERLAP_BODY  = '#C89830'; // Dark gold for overlap LN body (solid, no alpha)
export const NORMAL_BODY   = '#8888a0'; // Muted blue-gray for normal LN body (solid, no alpha)
export const TEXT_COLOR    = '#4ae0ff'; // Cyan for text events
export const INVALID_COLOR = '#ff3040'; // Red for Line 1/4 overlap warning (Phase 5)

// ---- Grid ----
export const GDIVS = [1,2,3,4,6,8,12,16,24,32,48,64];

// ---- Lead-in ----
export const LEAD_IN_MS = 2000;

// ---- Tab routing ----
export const TAB_MAP = {note:'noteP', shape:'shapeP', meta:'metaP', play:'playP'};

// ---- Play mode keys ----
export const DEFAULT_KEYS = {1:'KeyE', 2:'KeyR', 3:'KeyV', 4:'KeyN', 5:'KeyU', 6:'KeyI'};

// ---- Judgment windows (ms) ----
export const JUDGE_SYNC       = 25;
export const JUDGE_PERFECT    = 50;
export const JUDGE_GOOD       = 100;
export const JUDGE_WIDE_SYNC  = 100; // Wide notes: SYNC only, ±100ms

// ---- Gauge (life) system ----
// Two real gauges: Normal (recovery-leaning) and Hard (penalty-leaning).
// Values are in percent points applied to a 0–100 gauge. These are FIRST-PASS
// numbers meant to be tuned after real play — keep them all in this one table.
//
//   Normal: clears if gauge >= NORMAL_CLEAR_PCT at song end.
//   Hard:   starts at 100, fails the instant gauge hits 0. MISS = -5 means
//           20 consecutive misses (20 × 5 = 100) drain a full bar, matching
//           the "20-miss fail" intent while staying a continuous gauge.
//
// Tail OK / Tail MISS apply to hold-note tail resolution. Wide notes only ever
// produce SYNC or MISS, so their PERFECT/GOOD columns are simply never hit.
export const GAUGE_START = { normal: 0, hard: 100 };
export const NORMAL_CLEAR_PCT = 75;

export const GAUGE_DELTA = {
  normal: { SYNC: +0.6, PERFECT: +0.5, GOOD: +0.2, MISS: -2.0, TAIL_OK: +0.4, TAIL_MISS: -1.5 },
  hard:   { SYNC: +1.5, PERFECT: +1.2, GOOD: -2.0, MISS: -5.0, TAIL_OK: +1.0, TAIL_MISS: -4.0 },
};

// ---- Clear-mark lock options (on top of the chosen gauge) ----
// lockTarget: which mark the player is attempting beyond a bare clear.
//   'none' = no lock. 'fc' = Full Combo (no MISS). 'ap' = All Perfect
//   (every judgment PERFECT or better). 'as' = All Sync (every judgment SYNC).
// lockMode: what happens when the locked condition breaks.
//   'terminate' = force-end immediately (State F-style stop).
//   'cascade'   = drop down one tier (AS→AP→FC→bare gauge) and keep playing;
//                 the final mark is the highest tier still intact at song end.
export const LOCK_TIERS = ['as', 'ap', 'fc'];  // strict → loose; bare gauge sits below 'fc'

// ---- Rank thresholds (million-point score) ----
// Ordered high → low; first threshold the score meets wins.
export const RANK_TABLE = [
  ['U',  1000000],
  ['S+',  995000],
  ['S',   985000],
  ['A+',  970000],
  ['A',   950000],
  ['B',   900000],
  ['C',   800000],
  ['D',   700000],
  ['E',   500000],
  ['F',        0],
];

// ---- Storage ----
export const LS_PREFIX = 'cfx_';

// ---- Gauge / state colors (design doc §4.1, §6) ----
// Shared by the option bar, the in-game gauge bar, and the Result screen so a
// given gauge/mark always reads the same color everywhere.
//   Normal 초록 / Hard 빨강 / FC 하늘 / AP 노랑 / AS 흰.
export const GAUGE_COLOR = {
  normal: '#4aff8a',
  hard:   '#ff4a5a',
};
export const LOCK_COLOR = {
  none: '#9aa0a6',
  fc:   '#5ad1ff',   // 하늘색
  ap:   '#ffd23f',   // 노란색
  as:   '#ffffff',   // 흰색
};
// State marks → color. H/C/P/N/F reuse gauge/neutral tones.
export const STATE_COLOR = {
  AS: '#ffffff', AP: '#ffd23f', FC: '#5ad1ff',
  H:  '#ff4a5a', C: '#4aff8a',
  P:  '#9aa0a6', N: '#9aa0a6', F: '#ff4a5a',
};
// Fast / Slow feedback colors (Fast 빨강 / Slow 파랑).
export const FAST_COLOR = '#ff5a6a';
export const SLOW_COLOR = '#5aa0ff';

// ---- Shape editor ----
/** Internal units per shape position snap level (index = level 0/1/2) */
export const sPosSnapVals = [4, 2, 1];
