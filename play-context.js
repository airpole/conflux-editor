// ============================================================
//  PLAY-CONTEXT — host injection seam for the shared play engine
// ============================================================
// The play engine (play.js / play-render.js / game-render.js / gauge.js /
// play-judgment.js / play-result.js …) must run UNCHANGED in two hosts:
//   • Editor  — Play tab inside the chart editor
//   • Game    — standalone in-game scene (Music Select → In-game → Result)
//
// The engine used to read editor state (ES) directly, which welded it to the
// editor. The only fields it actually touched were 6, and only play.js wrote
// any of them. This module replaces those direct ES references with a single
// swappable context object `CTX`. The engine reads/writes CTX.*; the host
// decides what CTX *is* by calling setPlayContext() once on mode entry.
//
//   Editor mode:  setPlayContext(makeEditorContext())  → CTX proxies ES,
//                 so writes move the real edit playhead (behaviour preserved).
//   Game mode:    setPlayContext(makeGameContext(...))  → CTX holds the game's
//                 own position/settings; writes never leak into the editor.
//
// Pattern note: this mirrors the existing ES / PS / AS global-mutable-object
// style. One screen = one active mode, so a single global CTX is sufficient.
//
// Migration map (direct ES.* in engine → CTX.*):
//   ES.sharedMs  (r/w) → CTX.sharedMs      current playback position (ms)
//   ES.totalMs   (r)   → CTX.totalMs        full song length (ms)
//   ES.hitVol    (r)   → CTX.hitVol         hitsound volume 0..1
//   ES.pvSpd     (r)   → CTX.pvSpd          scroll speed (preview speed)
//   ES.nThk      (r)   → CTX.nThk           note thickness
//   ES.activeTab (r)   → CTX.redrawIdle()   abstracted: "redraw the idle frame"
//                                            (tab concept stays out of engine)

// ── The active context (engine reads/writes through this) ─────
// Starts as a minimal no-op so importing the engine before a host has
// initialised never throws. Hosts overwrite it via setPlayContext().
export let CTX = {
  // ── position (read + write) ──
  sharedMs: 0,
  // ── song length + play settings (read only by engine) ──
  totalMs: 0,
  hitVol: 1.0,
  pvSpd: 3.0,
  nThk: 12,
  // ── idle redraw hook (replaces the ES.activeTab === 'play' check) ──
  // Called after a session tears down so the host can repaint its idle view.
  // Editor: only redraw if the Play tab is showing. Game: redraw game idle.
  redrawIdle() {},
};

/**
 * Swap the active play context. Call ONCE when entering a mode (editor Play
 * tab activation, or game In-game scene entry). The engine immediately starts
 * reading/writing the new object on the next frame — no engine code changes.
 */
export function setPlayContext(ctx) {
  CTX = ctx;
}

// ── Editor host context ──────────────────────────────────────
// Proxies straight onto ES so the editor's existing behaviour is byte-for-byte
// preserved: writing CTX.sharedMs writes ES.sharedMs (the edit playhead), and
// every read pulls the live editor value. Getters/setters keep CTX a thin
// live view of ES rather than a stale snapshot.
export function makeEditorContext(ES, deps) {
  return {
    get sharedMs() { return ES.sharedMs; },
    set sharedMs(v) { ES.sharedMs = v; },
    get totalMs() { return ES.totalMs; },
    get hitVol()  { return ES.hitVol; },
    get pvSpd()   { return ES.pvSpd; },
    get nThk()    { return ES.nThk; },
    // Preserve the original guard: repaint the play idle frame only while the
    // Play tab is the active tab. deps supplies the editor-only helpers so this
    // module needs no editor imports (keeps the engine layer import-clean).
    redrawIdle() {
      if (ES.activeTab === 'play') deps.redrawPlayIdle();
    },
  };
}

// ── Game host context ────────────────────────────────────────
// Owns its own position + settings. The game scene creates one of these per
// song entry and feeds it the chart-derived length and the player's Settings
// values. Writes (sharedMs) stay inside this object — the editor is untouched.
export function makeGameContext(opts) {
  const o = opts || {};
  return {
    sharedMs: 0,
    totalMs: o.totalMs ?? 0,
    hitVol: o.hitVol ?? 1.0,
    pvSpd: o.pvSpd ?? 3.0,
    nThk: o.nThk ?? 12,
    // The game scene supplies how its idle frame is drawn.
    redrawIdle: o.redrawIdle || function () {},
  };
}
