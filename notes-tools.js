// ============================================================
//  NOTES-TOOLS — toolbar (setNT/nZ), clipboard, flip, shift
// ============================================================
// Phase B-1: doFlipSelected, doPaste, sel+del, and shiftSelectedByDelta
// have been migrated from saveHist('n') snapshots to commands.js dispatch.
// As of v17 the legacy saveHist system has been removed entirely; undo
// is driven by the scope-partitioned command stacks in commands.js.

import { $ } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { snap, MIRROR_CH, toast } from './utility.js';
import { dispatch, AddNotes, DeleteNotes, FlipNotes } from './commands.js';

export function setNT(t) {
  // Sel + Del combo: in sel mode with selection, Del deletes instead of switching.
  if (t === 'del' && ES.nTool === 'sel' && ES.selectedNotes.size > 0) {
    const toDel = [...ES.selectedNotes];
    const count = toDel.length;
    ES.selectedNotes.clear();
    dispatch(DeleteNotes(toDel));
    toast(`${count}개 노트 삭제`);
    return;
  }
  ES.nTool = t;
  cancelLN(); cancelTE();
  if (t !== 'sel') ES.selectedNotes.clear();
  document.querySelectorAll('#ntb .t[data-t]').forEach(b => {
    b.classList.remove('on', 'sel-on');
    if (b.dataset.t === t) {
      b.classList.add(t === 'sel' ? 'sel-on' : 'on');
    }
  });
  import('./notes-render.js').then(m => m.drawN());
}

export function nZ(d) {
  ES.edZm = Math.max(0.25, Math.min(8, ES.edZm * (d > 0 ? 1.35 : 1 / 1.35)));
  import('./notes-render.js').then(m => m.drawN());
  import('./shape-render.js').then(m => m.drawS());
}

export function cancelLN() {
  ES.pendLN = null;
  const el = $('lnPendUI'); if (el) el.style.display = 'none';
}
export function cancelTE() {
  ES.pendTE = null;
  const el = $('tePendUI'); if (el) el.style.display = 'none';
}

// ── Copy / Paste ────────────────────────────────────────────
export function doCopy() {
  if (ES.selectedNotes.size === 0) { toast('No notes selected'); return; }
  const sel = [...ES.selectedNotes];
  const minTick = Math.min(...sel.map(n => n.startTick));
  ES.clipboard = sel.map(n => ({
    channel: n.channel,
    relTick: n.startTick - minTick,
    duration: n.duration || 0,
    isWide: !!n.isWide
  }));
  toast(`Copied ${ES.clipboard.length} note(s)`);
}

export function doPaste(mirror) {
  if (ES.clipboard.length === 0) { toast('Clipboard empty'); return; }
  const baseTick = snap(ES.nScr, ES.nGD);
  const newNotes = [];
  for (const c of ES.clipboard) {
    let ch = c.channel, isW = c.isWide;
    if (mirror) ch = MIRROR_CH[ch] !== undefined ? MIRROR_CH[ch] : ch;
    const n = {channel: ch, startTick: baseTick + c.relTick, duration: c.duration, isWide: isW};
    // Collision check: against existing notes AND already-added in this paste.
    const hit = D.notes.find(x => x.channel === n.channel && x.startTick === n.startTick && x.isWide === n.isWide)
             || newNotes.find(x => x.channel === n.channel && x.startTick === n.startTick && x.isWide === n.isWide);
    if (!hit) newNotes.push(n);
  }
  if (newNotes.length === 0) { toast('Nothing to paste (collisions)'); return; }
  ES.selectedNotes.clear();
  newNotes.forEach(n => ES.selectedNotes.add(n));
  dispatch(AddNotes(newNotes));
  toast(`${mirror ? 'Flip-' : ''}Pasted ${newNotes.length} note(s)`);
}

/** Phase 4: in-place flip (Line 1↔4, 2↔3). Wide notes skipped. */
export function doFlipSelected() {
  if (ES.selectedNotes.size === 0) { toast('No notes selected'); return; }
  const pairs = [];
  for (const n of ES.selectedNotes) {
    if (n.isWide) continue;
    const next = MIRROR_CH[n.channel];
    if (next !== undefined && next !== n.channel) {
      pairs.push({ note: n, newChannel: next });
    }
  }
  if (pairs.length === 0) { toast('Nothing to flip'); return; }
  dispatch(FlipNotes(pairs));
  toast(`${pairs.length}개 노트 뒤집기`);
}

/**
 * Phase 5: shift selected non-wide notes by delta (+1 right / -1 left).
 * Group-solidarity clamp: if any selected non-wide note would cross the
 * 1..4 boundary, NO note moves.
 */
export function shiftSelectedByDelta(delta) {
  const targets = [];
  for (const n of ES.selectedNotes) { if (!n.isWide) targets.push(n); }
  if (targets.length === 0) return false;
  let minCh = Infinity, maxCh = -Infinity;
  for (const n of targets) {
    if (n.channel < minCh) minCh = n.channel;
    if (n.channel > maxCh) maxCh = n.channel;
  }
  if (delta > 0 && maxCh + delta > 4) return false;
  if (delta < 0 && minCh + delta < 1) return false;
  for (const n of targets) n.channel += delta;
  return true;
}
