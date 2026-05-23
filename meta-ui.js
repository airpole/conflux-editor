// ============================================================
//  META-UI — title/artist/diff/offset + tempo/TS lists
// ============================================================
import { $ } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { tickToMeasure, measureToTick, getSortedTS } from './timing.js';
import { dispatch, AddTempo, DeleteTempo, EditTempoBpm,
         AddTimeSig, DeleteTimeSig, EditTimeSig, onDispatch } from './commands.js';
import { renderTeList } from './text-events.js';
import { _syncJacketUI } from './jacket.js';
import { updateTotalMs } from './load-chart.js';
import { scheduleAutoSave } from './autosave.js';

export function syncMeta() {
  $('mTitle').value    = D.metadata.title    || '';
  $('mSubtitle').value = D.metadata.subtitle || '';
  $('mArtist').value   = D.metadata.artist   || 'airpole';
  $('mCharter').value  = D.metadata.charter  || 'airpole';
  $('mDiff').value     = D.metadata.difficulty || 'Trace';
  $('mLevel').value    = D.metadata.level || 0;
  $('mOff').value      = D.metadata.offset || 0;
  $('syncOff').value   = D.metadata.offset || 0;
  // Phase 7-2
  const moInput = $('mMeasureOff');
  if (moInput) moInput.value = D.metadata.measureLabelOffset || 0;
  // Phase 7-3
  _syncJacketUI();
  const jb = (D.metadata.jacketBrightness != null) ? D.metadata.jacketBrightness : 50;
  const brInput = $('mJacketBright');
  if (brInput) brInput.value = jb;
  const brLbl = $('jacketBrightLbl');
  if (brLbl) brLbl.textContent = jb + '%';
  renderTempoList(); renderTSList(); renderTeList();
}

export function renderTempoList() {
  const el = $('tempoList');
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  el.innerHTML = sorted.map((t, i) => {
    const isFirst = t.tick === 0 && i === 0;
    const mStr = tickToMeasure(t.tick);
    return `<div class="ev-row"><span class="ev-info"><b>${mStr}</b> <span style="font-size:8px;color:#555">(t${t.tick})</span> → <b>${t.bpm}</b> BPM</span><input type="number" value="${t.bpm}" min="1" max="999" step="0.01" data-action="editTempo" data-arg="${i}" title="BPM">${isFirst ? '' : '<button class="ev-del" data-action="delTempo" data-arg="' + i + '" title="Delete">✕</button>'}</div>`;
  }).join('');
}

export function renderTSList() {
  const el = $('tsList');
  const sorted = getSortedTS();
  el.innerHTML = sorted.map((t, i) => {
    const isFirst = t.tick === 0 && i === 0;
    const mStr = tickToMeasure(t.tick);
    return `<div class="ev-row"><span class="ev-info"><b>${mStr}</b> <span style="font-size:8px;color:#555">(t${t.tick})</span> → <b>${t.numerator}/${t.denominator}</b></span><input type="number" value="${t.numerator}" min="1" max="32" style="width:35px" data-action="editTSNum" data-arg="${i}" title="Numerator"><span style="color:var(--tx2)">/</span><input type="number" value="${t.denominator}" min="1" max="32" style="width:35px" data-action="editTSDen" data-arg="${i}" title="Denominator">${isFirst ? '' : '<button class="ev-del" data-action="delTS" data-arg="' + i + '" title="Delete">✕</button>'}</div>`;
  }).join('');
}

/**
 * UI side-effects after any dispatched command. Wired via onDispatch in
 * main.js. Fires for fresh dispatch and for undo/redo replays.
 *
 * - Inspects cmd.invalidates to choose scope-specific work:
 *     tempo/timeSignatures → re-render Meta tab tempo + TS lists
 *   (No more saveHist dual-write — v17 removed the legacy snapshot system
 *    once all user-action sites finished migrating to dispatch().)
 * - Common: updateTotalMs, redraw active tab, scheduleAutoSave.
 */
export function _afterAnyCommand(cmd, kind) {
  const inv = (cmd && cmd.invalidates) || [];

  // m-scope UI re-renders
  if (inv.includes('tempo') || inv.includes('timeSignatures')) {
    renderTempoList(); renderTSList();
  }

  updateTotalMs();
  if (ES.activeTab === 'note')      import('./notes-render.js').then(m => m.drawN());
  else if (ES.activeTab === 'shape') import('./shape-render.js').then(m => m.drawS());
  else if (ES.activeTab === 'play' && !PS.playActive) {
    import('./play-render.js').then(m => m.drawPlayIdle());
  }
  scheduleAutoSave();
}

/**
 * Back-compat alias: existing callers may import `_afterMetaCommand`.
 * Newer code should import `_afterAnyCommand` instead.
 */
export const _afterMetaCommand = _afterAnyCommand;

// ── Tempo ─────────────────────────────────────────────────
export function addTempo() {
  const tkStr = $('tAddTk').value;
  const tk = measureToTick(tkStr);
  if (tk === null) { alert('올바른 마디 표기를 입력하세요 (예: 1, 3.2, 80.4.1, t1920)'); return; }
  const bpm = +$('tAddBpm').value || 120;
  if (D.tempo.some(t => t.tick === tk)) {
    alert('이미 해당 위치에 템포 변경이 있습니다: ' + tickToMeasure(tk));
    return;
  }
  dispatch(AddTempo({tick: tk, bpm}));
}

export function editTempo(i, tk, bpm) {
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  const t = sorted[i]; if (!t) return;
  if (bpm !== null && bpm !== undefined) {
    if (t.bpm === bpm) return;
    dispatch(EditTempoBpm(t.tick, t.bpm, bpm));
  }
  if (tk !== null && tk !== undefined && tk !== t.tick) {
    const oldTick = t.tick;
    dispatch({
      name: 'MoveTempo',
      apply: () => {
        const entry = D.tempo.find(x => x.tick === oldTick);
        if (entry) { entry.tick = tk; D.tempo.sort((a, b) => a.tick - b.tick); }
      },
      undo: () => {
        const entry = D.tempo.find(x => x.tick === tk);
        if (entry) { entry.tick = oldTick; D.tempo.sort((a, b) => a.tick - b.tick); }
      },
      invalidates: ['tempo']
    });
  }
}

export function delTempo(i) {
  const sorted = [...D.tempo].sort((a, b) => a.tick - b.tick);
  const t = sorted[i]; if (!t) return;
  if (t.tick === 0) { alert('Cannot delete initial tempo'); return; }
  dispatch(DeleteTempo({...t}));
}

// ── Time signature ────────────────────────────────────────
export function addTimeSig() {
  const tkStr = $('tsAddTk').value;
  const tk = measureToTick(tkStr);
  if (tk === null) { alert('올바른 마디 표기를 입력하세요 (예: 1, 3, 80.4.1, t1920)'); return; }
  const num = +$('tsAddNum').value || 4;
  const den = +$('tsAddDen').value || 4;
  if (D.timeSignatures.some(t => t.tick === tk)) {
    alert('이미 해당 위치에 박자 변경이 있습니다: ' + tickToMeasure(tk));
    return;
  }
  dispatch(AddTimeSig({tick: tk, numerator: num, denominator: den}));
}

export function editTS(i, num, den) {
  const sorted = getSortedTS();
  const t = sorted[i]; if (!t) return;
  const oldTs = {numerator: t.numerator, denominator: t.denominator};
  const newTs = {
    numerator:   num !== null && num !== undefined ? num : t.numerator,
    denominator: den !== null && den !== undefined ? den : t.denominator
  };
  if (newTs.numerator === oldTs.numerator && newTs.denominator === oldTs.denominator) return;
  dispatch(EditTimeSig(t.tick, oldTs, newTs));
}

export function delTS(i) {
  const sorted = getSortedTS();
  const t = sorted[i]; if (!t) return;
  if (t.tick === 0) { alert('Cannot delete initial time signature'); return; }
  dispatch(DeleteTimeSig({...t}));
}
