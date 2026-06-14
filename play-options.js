// ============================================================
//  PLAY-OPTIONS — editor Play-tab quick options (Mirror, Fast/Slow)
// ============================================================
// Wires the Play-tab option bar to the player settings. Gauge / clear-mark
// lock now live in the Settings scene (single source of truth), so the editor
// bar only carries the two options worth toggling mid-charting:
//   • Mirror   — lane mirror (1<->4, 2<->3) + shape flip; shares the same value
//                as the Settings OPTION->Mirror toggle (routed through
//                setSetting so both UIs and PS.optMirror stay in sync and it
//                persists).
//   • F/S      — Fast/Slow feedback display toggle.
//
// Selection feedback is COLOR-ONLY (no toast). Options freeze during an active
// session (a frozen click does nothing).

import { $ } from './constants.js';
import { PS } from './play-state.js';
import { getSetting, setSetting } from './settings.js';

const ACCENT = '#cfd3d8';

// Engine deps for setSetting (injected by main at init), so the Mirror toggle
// can go through the same applySettings path the Settings scene uses.
let _deps = null;

/** Paint one button as selected (filled with `color`) or idle. */
function paintBtn(btn, on, color) {
  if (!btn) return;
  if (on) {
    btn.style.background = color;
    btn.style.color = '#10121a';      // dark text on bright fills for contrast
    btn.style.borderColor = color;
    btn.style.fontWeight = '700';
  } else {
    btn.style.background = 'transparent';
    btn.style.color = 'var(--tx2)';
    btn.style.borderColor = '';
    btn.style.fontWeight = '';
  }
}

/** Reflect current option state onto the button colors. */
function syncOptUI() {
  const mirBtn = $('optMirror');
  if (mirBtn) {
    const on = !!getSetting('mirror');
    paintBtn(mirBtn, on, ACCENT);
    mirBtn.textContent = on ? 'Mirror \u2713' : 'Mirror \u2717';
  }
  const fsBtn = $('optFastSlow');
  if (fsBtn) {
    paintBtn(fsBtn, PS.showFastSlow, ACCENT);
    fsBtn.textContent = PS.showFastSlow ? 'F/S \u2713' : 'F/S \u2717';
  }
}

function frozen() { return PS.playActive; }

/** Editor Play-tab Mirror toggle. Routes through settings so it persists and
 *  keeps PS.optMirror in sync with the Settings scene toggle. */
export function togglePlayMirror() {
  if (frozen()) return;
  const next = !getSetting('mirror');
  setSetting('mirror', next, _deps);   // persists + applySettings -> PS.optMirror
  syncOptUI();
}

export function toggleFastSlow() {
  PS.showFastSlow = !PS.showFastSlow;
  syncOptUI();
}

/** Initial paint so the bar reflects current state on load. `deps` is the same
 *  engine-deps bundle main passes to settings (carries PS for applySettings). */
export function initPlayOptionsUI(deps) {
  if (deps) _deps = deps;
  syncOptUI();
}

/** Re-sync the bar when the Play tab is shown (Settings may have changed Mirror
 *  while we were away). */
export function refreshPlayOptionsUI() { syncOptUI(); }
