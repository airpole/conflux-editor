// ============================================================
//  SHAPE-TOOLS — toolbar (setST/sZ/sMet), clipboard, flip, addShapeEvt
// ============================================================
// Phase B-1: doShapeSelectionDelete, doShapePaste, doShapeFlipSelected
// migrated from saveHist('s') to commands.js dispatch. All three factories
// call normalizeShapeChain() in both apply() and undo() because chain
// events are interdependent — adding/removing/flipping any one event
// re-derives startTick/duration of every other event on the same chain.

import { $, TPB } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { sp2f } from './shape.js';
import { snap, toast } from './utility.js';
import { cancelArc } from './edit-options.js';
import { dispatch, AddShapeEvents, DeleteShapeEvents, FlipShapeEvents } from './commands.js';

export function sMet() {
  const cv = $('sCv'), dpr = devicePixelRatio;
  const cw = cv.width / dpr, ch = cv.height / dpr;
  if (cw < 1 || ch < 1) return null;
  const gw = cw * 0.96;
  const gh = ch;
  const gx = (cw - gw) / 2;
  const gy = 0;
  const tpp = (TPB * 16) / (ch * ES.edZm);
  return {cw, ch, gw, gh, gx, gy, tpp, dpr};
}

export function sZ(d) {
  ES.edZm = Math.max(0.25, Math.min(8, ES.edZm * (d > 0 ? 1.35 : 1 / 1.35)));
  import('./notes-render.js').then(m => m.drawN());
  import('./shape-render.js').then(m => m.drawS());
}

/**
 * Delete selection — keeps Init events (easing===null) silently.
 * Returns true if at least one non-init event was removed.
 */
export function doShapeSelectionDelete() {
  if (ES.selectedShapeEvts.size === 0) return false;
  const all = [...ES.selectedShapeEvts];
  const deletable = all.filter(e => e.easing !== null);
  const initSkipped = all.length - deletable.length;
  if (deletable.length === 0) { toast('Init 이벤트는 삭제할 수 없습니다'); return false; }
  ES.selectedShapeEvts.clear();
  dispatch(DeleteShapeEvents(deletable));
  toast(`${deletable.length}개 shape 삭제${initSkipped ? ` (Init ${initSkipped}개 유지)` : ''}`);
  return true;
}

export function setST(t) {
  // Sel + Del combo: in sel mode with selection, Del deletes.
  if (t === 'del' && ES.sTool === 'sel' && ES.selectedShapeEvts.size > 0) {
    doShapeSelectionDelete();
    return;
  }
  ES.sTool = t; cancelArc();
  if (t !== 'sel') ES.selectedShapeEvts.clear();
  document.querySelectorAll('#stb .t[data-t]').forEach(b => {
    b.classList.remove('on', 'sel-on');
    if (b.dataset.t === t) {
      b.classList.add(t === 'sel' ? 'sel-on' : 'on');
    }
  });
}

export function pickEase(name) {
  $('easeS').value = name;
  $('easeRS').value = name;
  // Phase 3-2: 'Step' removed.
  const easeNames = ['Linear', 'Arc', 'Out-Sine', 'In-Sine'];
  easeNames.forEach(n => {
    const btn = $('easeBtn_' + n);
    if (btn) {
      btn.classList.remove('on', 'ease-on');
      if (n === name) btn.classList.add('ease-on');
    }
  });
}

export function updateEaseR() { if (ES.sTool !== 'P') $('easeRS').value = $('easeS').value; }

export function findShapeEvtAt(x, y, met) {
  const {gw, gh, gx, gy, tpp} = met;
  let best = null, bd = 35;
  for (let i = 0; i < D.shapeEvents.length; i++) {
    const ev = D.shapeEvents[i];
    const dotTk = ev.startTick + ev.duration;
    const ey = gy + gh - (dotTk - ES.sScr) / tpp;
    const ex = gx + sp2f(ev.targetPos) * gw;
    const d = Math.hypot(x - ex, y - ey);
    if (d < bd) { bd = d; best = ev; }
  }
  return best;
}

export function doShapeCopy() {
  if (ES.selectedShapeEvts.size === 0) { toast('No shapes selected'); return; }
  // Init events (easing === null) are anchors at the chart's start and must
  // not be copied — pasting them would create duplicate anchors that
  // normalizeShapeChain rejects. Filter them out silently here.
  const all = [...ES.selectedShapeEvts];
  const sel = all.filter(e => e.easing !== null);
  const initSkipped = all.length - sel.length;
  if (sel.length === 0) { toast('Init 이벤트는 복사할 수 없습니다'); return; }
  const minDest = Math.min(...sel.map(e => e.startTick + e.duration));
  ES.shapeClipboard = sel.map(e => ({
    relDestTick: (e.startTick + e.duration) - minDest,
    targetPos: e.targetPos,
    isBlue: e.isBlue,
    easing: e.easing,
    isStep: e.duration === 0
  }));
  toast(`Copied ${ES.shapeClipboard.length} shape(s)${initSkipped ? ` (Init ${initSkipped}개 제외)` : ''}`);
}

export function doShapePaste(flip) {
  if (ES.shapeClipboard.length === 0) { toast('Shape clipboard empty'); return; }
  const baseTick = snap(ES.sScr, ES.sGD);
  const newEvts = [];
  for (const c of ES.shapeClipboard) {
    const destTick = baseTick + c.relDestTick;
    let pos = c.targetPos, isB = c.isBlue;
    if (flip) { pos = 64 - pos; isB = !isB; }
    const ne = {
      startTick: c.isStep ? destTick : 0,
      duration:  c.isStep ? 0 : destTick,
      isBlue: isB,
      targetPos: pos,
      easing: c.easing
    };
    newEvts.push(ne);
  }
  if (newEvts.length === 0) return;
  ES.selectedShapeEvts.clear();
  newEvts.forEach(e => ES.selectedShapeEvts.add(e));
  dispatch(AddShapeEvents(newEvts));
  toast(`${flip ? 'Flip-' : ''}Pasted ${newEvts.length} shape(s)`);
}

/** Mirror selected shape events in place around the center axis. */
export function doShapeFlipSelected() {
  if (ES.selectedShapeEvts.size === 0) { toast('No shapes selected'); return; }
  const pairs = [];
  for (const e of ES.selectedShapeEvts) {
    if (e.easing === null) continue;
    pairs.push({
      event: e,
      oldTargetPos: e.targetPos,
      oldIsBlue: e.isBlue,
      newTargetPos: 64 - e.targetPos,
      newIsBlue: !e.isBlue
    });
  }
  if (pairs.length === 0) { toast('Nothing to flip (Init only)'); return; }
  dispatch(FlipShapeEvents(pairs));
  toast(`${pairs.length}개 shape 뒤집기`);
}

/**
 * Phase 3-2/3-3: Compute the op describing how a tap on (tick, pos) for
 * the given (isBlue, easing) should mutate D.shapeEvents.
 *
 * Returns one of:
 *   { kind: 'add', event: {startTick, duration, isBlue, targetPos, easing} }
 *     — when no existing event sits on the same chain at this tick, OR
 *       there is one but its targetPos differs from `pos`.
 *   { kind: 'set', event: existRef, oldFields, newFields }
 *     — when one existing event at the same tick has effectively the same
 *       targetPos (re-apply only changes its easing), OR when multiple
 *       events stack at the same tick and we update the last one's
 *       targetPos+easing.
 *
 * This function does NOT mutate D.shapeEvents and does NOT normalize.
 * The caller (Arc / L / R / C / P tap handlers in shape-input.js) batches
 * one or more ops into a single `dispatch(ApplyShapeOps(ops))` so the
 * whole tap-with-mirror is one undo unit, and the factory normalizes
 * both chains once at the end.
 */
export function addShapeEvt(tick, pos, isBlue, easing) {
  const sameTickSameSide = D.shapeEvents.filter(e => {
    const dest = e.startTick + e.duration;
    return Math.abs(dest - tick) < 1 && e.isBlue === isBlue && e.easing !== null;
  });
  if (sameTickSameSide.length === 0) {
    return { kind: 'add', event: {startTick: 0, duration: tick, isBlue, targetPos: pos, easing} };
  } else if (sameTickSameSide.length === 1) {
    const exist = sameTickSameSide[0];
    if (Math.abs(exist.targetPos - pos) < 0.01) {
      return {
        kind: 'set',
        event: exist,
        oldFields: { easing: exist.easing },
        newFields: { easing }
      };
    } else {
      return { kind: 'add', event: {startTick: 0, duration: tick, isBlue, targetPos: pos, easing} };
    }
  } else {
    const last = sameTickSameSide[sameTickSameSide.length - 1];
    return {
      kind: 'set',
      event: last,
      oldFields: { targetPos: last.targetPos, easing: last.easing },
      newFields: { targetPos: pos, easing }
    };
  }
}
