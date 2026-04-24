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
export const WIDE_BODY     = '#008898'; // Dark teal for wide LN body (solid, no alpha)
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

// ---- Storage ----
export const LS_PREFIX = 'cfx_';

// ---- Shape editor ----
/** Internal units per shape position snap level (index = level 0/1/2) */
export const sPosSnapVals = [4, 2, 1];
