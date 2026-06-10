// ============================================================
//  TEXT-EVENTS — modal CRUD + sidebar list + multi-select picker
// ============================================================
// Phase B-1: teSave/teDelete migrated to commands.js dispatch.
// Edit branch uses EditTextEvent (Object.assign in-place) instead of
// the old `D.textEvents[idx] = evt` whole-object replace, so existing
// references (e.g. ES.editingTextEvt) stay valid across edits.

import { $, TPB, TEXT_COLOR } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { tickToMeasure, measureToTick } from './timing.js';
import { toast } from './utility.js';
import { dispatch, AddTextEvents, DeleteTextEvents, EditTextEvent } from './commands.js';
import { showMod, closeMod } from './file-manager.js';

/** Escape HTML so chart-supplied text can't inject markup into list views. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function teNew(tick, defaultPos) {
  ES.editingTextEvt = null;
  $('txtModTitle').textContent = 'New Text Event';
  $('teContent').value = '';
  $('teStart').value = tickToMeasure(tick);
  $('teEnd').value = tickToMeasure(tick + TPB * 2);
  $('tePos').value = defaultPos || 'middle';
  $('teTrans').value = 'fade';
  $('teMode').value = 'tutorial';
  $('teDelBtn').style.display = 'none';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

export function teNewRange(startTk, endTk, pos) {
  ES.editingTextEvt = null;
  $('txtModTitle').textContent = 'New Text Event';
  $('teContent').value = '';
  $('teStart').value = tickToMeasure(startTk);
  $('teEnd').value = tickToMeasure(endTk);
  $('tePos').value = pos || 'middle';
  $('teTrans').value = 'fade';
  $('teMode').value = 'tutorial';
  $('teDelBtn').style.display = 'none';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

export function teEdit(evt) {
  ES.editingTextEvt = evt;
  $('txtModTitle').textContent = 'Edit Text Event';
  $('teContent').value = evt.content || '';
  $('teStart').value = tickToMeasure(evt.startTick);
  $('teEnd').value = tickToMeasure(evt.startTick + evt.duration);
  $('tePos').value = evt.pos || 'middle';
  $('teTrans').value = evt.transition || 'fade';
  $('teMode').value = evt.mode || 'tutorial';
  $('teDelBtn').style.display = '';
  showMod('txtMod');
  setTimeout(() => $('teContent').focus(), 100);
}

export function teSave() {
  const content = $('teContent').value.trim();
  const startTk = parseMeasureInput($('teStart').value);
  const endTk   = parseMeasureInput($('teEnd').value);
  if (startTk === null || endTk === null) { toast('Invalid tick format'); return; }
  if (endTk <= startTk) { toast('End must be after start'); return; }
  const newFields = {
    startTick: startTk,
    duration:  endTk - startTk,
    content,
    pos:        $('tePos').value,
    transition: $('teTrans').value,
    mode:       $('teMode').value
  };
  if (ES.editingTextEvt) {
    // In-place edit: capture old field values for undo.
    const target = ES.editingTextEvt;
    const oldFields = {};
    for (const k of Object.keys(newFields)) oldFields[k] = target[k];
    // Skip dispatch if nothing actually changed (avoids stack pollution).
    let changed = false;
    for (const k of Object.keys(newFields)) {
      if (oldFields[k] !== newFields[k]) { changed = true; break; }
    }
    ES.editingTextEvt = null;
    closeMod('txtMod');
    if (changed) dispatch(EditTextEvent(target, oldFields, newFields));
  } else {
    const evt = { ...newFields };
    ES.editingTextEvt = null;
    closeMod('txtMod');
    dispatch(AddTextEvents([evt]));
  }
  renderTeList();
  toast('Text event saved');
}

export function teDelete() {
  if (!ES.editingTextEvt) return;
  const target = ES.editingTextEvt;
  ES.editingTextEvt = null;
  closeMod('txtMod');
  dispatch(DeleteTextEvents([target]));
  renderTeList();
  toast('Text event deleted');
}

export function findTextEvtAt(clickTk, tpp, side) {
  const results = [];
  for (const te of D.textEvents) {
    const teIsLeft = (te.pos === 'left');
    const teIsLine = (te.pos || '').startsWith('line:');
    if (side === 'left'  && !teIsLeft) continue;
    if (side === 'right' && (teIsLeft || teIsLine)) continue;
    const st = te.startTick, en = te.startTick + te.duration;
    if (clickTk >= st - TPB * 0.25 && clickTk <= en + TPB * 0.25) {
      const center = st + te.duration / 2;
      const dist   = Math.abs(clickTk - center);
      results.push({te, dist});
    }
  }
  results.sort((a, b) => a.dist - b.dist);
  return results.map(r => r.te);
}

export function showTePicker(list) {
  const el = $('tePickList');
  el.innerHTML = list.map((te, i) => {
    const pos = (te.pos || 'middle').replace('line:', 'L');
    const txt = esc((te.content || '(empty)').split('\n')[0].slice(0, 30));
    return `<div class="te-pick-item" data-action="tePickSelect" data-arg="${i}">${esc(pos)}: ${txt}</div>`;
  }).join('');
  window._tePickList = list;
  showMod('tePickMod');
}

export function tePickSelect(idx) {
  closeMod('tePickMod');
  const te = window._tePickList[idx];
  if (te) teEdit(te);
}

export function parseMeasureInput(str) { return measureToTick(str); }

export function renderTeList() {
  const el = $('teList');
  if (!el) return;
  const sorted = [...D.textEvents].sort((a, b) => a.startTick - b.startTick);
  if (sorted.length === 0) {
    el.innerHTML = '<div style="font-size:9px;color:var(--tx2)">No text events</div>';
    return;
  }
  el.innerHTML = sorted.map((te, i) => {
    const pos = (te.pos || 'middle').replace('line:', 'L');
    const mode = '📖';
    const trn = te.transition === 'fade' ? '◐' : '■';
    const txt = esc((te.content || '').slice(0, 25)) + ((te.content || '').length > 25 ? '…' : '');
    return `<div class="te-item" data-action="teEditByIdx" data-arg="${i}">
      <span style="color:${TEXT_COLOR};font-size:8px;min-width:36px">${tickToMeasure(te.startTick)}</span>
      <span class="te-txt">${mode}${trn} ${txt}</span>
      <span class="te-pos">${esc(pos)}</span>
    </div>`;
  }).join('');
}

export function teEditByIdx(sortedIdx) {
  const sorted = [...D.textEvents].sort((a, b) => a.startTick - b.startTick);
  const te = sorted[sortedIdx];
  if (te) teEdit(te);
}
