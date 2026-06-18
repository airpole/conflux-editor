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
export const WIDE_COLOR    = '#4AE8FF'; // Bright ice-cyan for wide note HEADS — kept far brighter
                                        // than WIDE_BODY so the head reads instantly against the body
export const WIDE_BODY     = '#008898'; // Dark teal for wide LN body (used opaque on heads)
// Wide LN body fill uses a translucent version so the grid (subdivisions,
// beats, measures) and channel separators underneath remain faintly visible
// inside the body. Without this, the wide body acts as an opaque mask and
// the user loses the rhythm/lane reference for any notes layered on top.
// Tuned by eye: 0xCC ≈ 80% opacity keeps the cyan reading clearly as "wide"
// while letting the darker grid lines (#383850 / #1e1e30) bleed through.
export const WIDE_BODY_ALPHA = '#008898cc';
export const OVERLAP_COLOR = '#FFE14A'; // Vivid gold for chord (overlapping) notes on Lines 2/3 —
                                        // brightened so chords pop next to white normal heads
export const OVERLAP_BODY  = '#C89830'; // Dark gold for overlap LN body (solid, no alpha)
export const NORMAL_BODY   = '#8888a0'; // Muted blue-gray for normal LN body (solid, no alpha)
export const TEXT_COLOR    = '#4ae0ff'; // Cyan for text events
export const INVALID_COLOR = '#ff3040'; // Red for Line 1/4 overlap warning (Phase 5)

// ---- Grid ----
export const GDIVS = [1,2,3,4,6,8,12,16,24,32,48,64];

// ---- Lead-in ----
export const LEAD_IN_MS = 3000;
// Lead-in for mid-chart starts (Space): the session begins this many ms
// before the selected position, showing empty scrolling shapes so the player
// can sync up before the first live note arrives. Audio starts at the
// selected position itself.
export const PLAY_RESUME_LEAD_MS = 3000;
// LN release forgiveness: lifting the key up to this many ms before the tail
// still counts as a successful tail. Releasing exactly on the tail is humanly
// impossible; without this grace every well-timed release broke combo.
export const LN_RELEASE_GRACE_MS = 50;

// ---- Tab routing ----
export const TAB_MAP = {note:'noteP', shape:'shapeP', meta:'metaP', play:'playP'};

// ---- Play mode keys ----
export const DEFAULT_KEYS = {1:'KeyE', 2:'KeyR', 3:'Space', 4:'ArrowDown', 5:'Backslash', 6:'Numpad7'};

// Game-action key bindings (non-lane), kept separate from the 6 lane keys.
// Actions:
//   speedDown / speedUp — adjust note SCROLL speed (배속, ES.pvSpd) by ±0.1.
//                         This is hi-speed / fall speed only; audio playback
//                         rate (pitch) is NOT touched and stays 1.0.
//   restart            — restart the current song from the beginning; works
//                        even during an active fullscreen session.
export const DEFAULT_ACTION_KEYS = { speedDown: 'F1', speedUp: 'F2', restart: 'F5' };
// Scroll-speed (배속) bounds + step for the F1/F2 actions.
export const SPEED_MIN = 1.0;
export const SPEED_MAX = 10.0;
export const SPEED_STEP = 0.1;

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

// ---- Gauge tuning (length-agnostic Normal, survival Hard) ----
// NORMAL (groove-style, length-agnostic): positive deltas are ×a multipliers
// where a = GAUGE_NORMAL_TOTAL_GAIN / totalUnits (tap=1, LN=2), computed once
// at session start. An all-SYNC run therefore sums to +GAUGE_NORMAL_TOTAL_GAIN
// (=150%) of POTENTIAL recovery on any chart length. The gauge itself caps at
// 100 (gauge.js gaugeMax), so the surplus above 100 is discarded — clearing at
// NORMAL_CLEAR_PCT (75%) needs roughly half the units as SYNC. LOSSES are
// ABSOLUTE percentages (sign<0, never ×a): MISS and TAIL_MISS are both −2% and
// treated identically, so a late collapse (후살) costs the same on any chart.
// HARD (survival-style): starts 100, dies at 0. Every entry is an absolute
// percentage with NO low-gauge mercy — a loss is the same at any gauge level.
export const GAUGE_NORMAL_TOTAL_GAIN = 150;  // all-SYNC POTENTIAL recovery (%), capped at 100
export const GAUGE_DELTA = {
  // normal: positive entries are ×a multipliers (a = TOTAL_GAIN / total units);
  //         negative entries are absolute percentages (MISS == TAIL_MISS).
  normal: { SYNC: 1.0, PERFECT: 1.0, GOOD: 0.5, TAIL_OK: 1.0, MISS: -2.0, TAIL_MISS: -2.0 },
  // hard: every entry is an absolute percentage (no a-scaling, no mercy).
  hard:   { SYNC: +0.15, PERFECT: +0.15, GOOD: 0, TAIL_OK: +0.1, MISS: -5.0, TAIL_MISS: -2.5 },
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
