// ============================================================
//  EDIT-OPTIONS — follow toggle, mirror, pos snap, arc cancel
// ============================================================
import { $ } from './constants.js';
import { ES } from './editor-state.js';
import { toast } from './utility.js';

export function toggleFollow()  { ES.nFollow = !ES.nFollow; $('nFollowBtn').classList.toggle('on', ES.nFollow); }
export function toggleSFollow() { ES.sFollow = !ES.sFollow; $('sFollowBtn').classList.toggle('on', ES.sFollow); }

export function toggleMirror() {
  ES.sMirror = !ES.sMirror;
  $('sMirrorBtn').classList.toggle('on', ES.sMirror);
  toast(ES.sMirror ? 'Symmetry ON' : 'Symmetry OFF');
}

export function cyclePosSnap() {
  ES.sPosSnapLevel = (ES.sPosSnapLevel + 1) % 3;
  const labels = ['V:1', 'V:0.5', 'V:0.25'];
  $('sPosSnapBtn').textContent = labels[ES.sPosSnapLevel];
  cancelArc();
  toast('Pos snap: ' + ['1', '0.5', '0.25'][ES.sPosSnapLevel]);
}

/** Arc-easing two-click cancel. */
export function cancelArc() {
  ES.pendArc = null;
  const el = $('arcPendUI');
  if (el) el.style.display = 'none';
}
