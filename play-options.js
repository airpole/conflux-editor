// ============================================================
//  PLAY-OPTIONS — gauge / clear-mark lock selection (Play tab)
// ============================================================
// Wires the Play-tab option bar to PS gauge/lock fields. These are TEST/DEV
// controls so you can try Normal vs Hard and the FC/AP/AS locks without a
// console. When the real Music Select inline-options panel lands, it can call
// the same setters and this bar can be hidden.
//
// All four controls are frozen during an active session (mirroring how the
// Auto checkbox is disabled mid-play) so options can't change underfoot.

import { $ } from './constants.js';
import { PS } from './play-state.js';
import { toast } from './utility.js';

/** Reflect current PS option state onto the button group `active` styling. */
function syncOptUI() {
  const setActive = (groupSel, matchVal) => {
    document.querySelectorAll(groupSel).forEach(b => {
      b.classList.toggle('on', b.dataset.arg === matchVal);
    });
  };
  setActive('[data-action="setGauge"]', PS.gaugeType);
  setActive('[data-action="setLockTarget"]', PS.lockTarget);
  setActive('[data-action="setLockMode"]', PS.lockMode);
  // Fast/Slow toggle is a single button reading its on/off state.
  const fsBtn = $('optFastSlow');
  if (fsBtn) {
    fsBtn.classList.toggle('on', PS.showFastSlow);
    fsBtn.textContent = PS.showFastSlow ? 'F/S ✓' : 'F/S ✗';
  }
}

function blockedDuringPlay() {
  if (PS.playActive) { toast('재생 중에는 변경할 수 없습니다'); return true; }
  return false;
}

export function setGauge(type) {
  if (blockedDuringPlay()) return;
  PS.gaugeType = (type === 'hard') ? 'hard' : 'normal';
  syncOptUI();
  toast(`Gauge: ${PS.gaugeType.toUpperCase()}`);
}

export function setLockTarget(target) {
  if (blockedDuringPlay()) return;
  const valid = ['none', 'fc', 'ap', 'as'];
  PS.lockTarget = valid.includes(target) ? target : 'none';
  syncOptUI();
  toast(`Lock: ${PS.lockTarget.toUpperCase()}`);
}

export function setLockMode(mode) {
  if (blockedDuringPlay()) return;
  PS.lockMode = (mode === 'cascade') ? 'cascade' : 'terminate';
  syncOptUI();
  toast(`Lock mode: ${PS.lockMode}`);
}

export function toggleFastSlow() {
  PS.showFastSlow = !PS.showFastSlow;
  syncOptUI();
}

/** Initial paint so the bar reflects PS defaults on load. */
export function initPlayOptionsUI() { syncOptUI(); }
