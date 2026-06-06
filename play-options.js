// ============================================================
//  PLAY-OPTIONS — gauge / clear-mark lock selection (Play tab)
// ============================================================
// Wires the Play-tab option bar to PS gauge/lock fields. Test/dev controls so
// Normal vs Hard and the FC/AP/AS locks can be tried without a console. When
// the real Music Select inline options land, they can reuse these setters.
//
// Selection feedback is COLOR-ONLY (no toast): the chosen button lights up in
// that gauge/mark's own color (Normal green / Hard red / FC sky / AP yellow /
// AS white), pulling from the shared palette in constants.js so the bar, the
// in-game gauge bar, and the Result screen all agree. Options freeze during an
// active session (a frozen click simply does nothing).

import { $, GAUGE_COLOR, LOCK_COLOR } from './constants.js';
import { PS } from './play-state.js';

// Mode buttons (Term/Casc) and the F/S toggle have no dedicated palette color;
// they use a neutral accent when active.
const ACCENT = '#cfd3d8';

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

function paintGroup(action, currentVal, colorFor) {
  document.querySelectorAll('[data-action="' + action + '"]').forEach(btn => {
    const v = btn.dataset.arg;
    paintBtn(btn, v === currentVal, colorFor(v));
  });
}

/** Reflect all current PS option state onto the button colors. */
function syncOptUI() {
  paintGroup('setGauge', PS.gaugeType, v => GAUGE_COLOR[v] || ACCENT);
  paintGroup('setLockTarget', PS.lockTarget, v => LOCK_COLOR[v] || ACCENT);
  paintGroup('setLockMode', PS.lockMode, () => ACCENT);
  const fsBtn = $('optFastSlow');
  if (fsBtn) {
    paintBtn(fsBtn, PS.showFastSlow, ACCENT);
    fsBtn.textContent = PS.showFastSlow ? 'F/S \u2713' : 'F/S \u2717';
  }
}

function frozen() { return PS.playActive; }

export function setGauge(type) {
  if (frozen()) return;
  PS.gaugeType = (type === 'hard') ? 'hard' : 'normal';
  syncOptUI();
}

export function setLockTarget(target) {
  if (frozen()) return;
  const valid = ['none', 'fc', 'ap', 'as'];
  PS.lockTarget = valid.includes(target) ? target : 'none';
  syncOptUI();
}

export function setLockMode(mode) {
  if (frozen()) return;
  PS.lockMode = (mode === 'cascade') ? 'cascade' : 'terminate';
  syncOptUI();
}

export function toggleFastSlow() {
  PS.showFastSlow = !PS.showFastSlow;
  syncOptUI();
}

/** Initial paint so the bar reflects PS defaults on load. */
export function initPlayOptionsUI() { syncOptUI(); }
