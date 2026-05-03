// ============================================================
//  NOTES-TOOLS — toolbar (setNT/nZ), clipboard, flip, shift
// ============================================================
import { $ } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { snap, MIRROR_CH, toast } from './utility.js';
import { saveHist } from './history.js';

export function setNT(t) {
  // Sel + Del combo: in sel mode with selection, Del deletes instead of switching.
  if (t === 'del' && ES.nTool === 'sel' && ES.selectedNotes.size > 0) {
    const count = ES.selectedNotes.size;
    D.notes = D.notes.filter(n => !ES.selectedNotes.has(n));
    ES.selectedNotes.clear();
    saveHist('n');
    import('./notes-render.js').then(m => m.drawN());
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
    if (!D.notes.find(x => x.channel === n.channel && x.startTick === n.startTick && x.isWide === n.isWide)) {
      D.notes.push(n);
      newNotes.push(n);
    }
  }
  ES.selectedNotes.clear();
  newNotes.forEach(n => ES.selectedNotes.add(n));
  saveHist('n');
  toast(`${mirror ? 'Flip-' : ''}Pasted ${newNotes.length} note(s)`);
  import('./notes-render.js').then(m => m.drawN());
}

/** Phase 4: in-place flip (Line 1↔4, 2↔3). Wide notes skipped. */
export function doFlipSelected() {
  if (ES.selectedNotes.size === 0) { toast('No notes selected'); return; }
  let count = 0;
  for (const n of ES.selectedNotes) {
    if (n.isWide) continue;
    const next = MIRROR_CH[n.channel];
    if (next !== undefined && next !== n.channel) { n.channel = next; count++; }
  }
  if (count === 0) { toast('Nothing to flip'); return; }
  saveHist('n');
  import('./notes-render.js').then(m => m.drawN());
  toast(`${count}개 노트 뒤집기`);
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
