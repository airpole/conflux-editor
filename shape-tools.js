// ============================================================
//  SHAPE-TOOLS — toolbar (setST/sZ/sMet), clipboard, flip, addShapeEvt
// ============================================================
import { $, TPB } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { sp2f, normalizeShapeChain } from './shape.js';
import { snap, toast } from './utility.js';
import { cancelArc } from './edit-options.js';
import { saveHist } from './history.js';

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
  const count = ES.selectedShapeEvts.size;
  const initSkipped = [...ES.selectedShapeEvts].filter(e => e.easing === null).length;
  const actualCount = count - initSkipped;
  if (actualCount === 0) { toast('Init 이벤트는 삭제할 수 없습니다'); return false; }
  D.shapeEvents = D.shapeEvents.filter(e => !ES.selectedShapeEvts.has(e) || e.easing === null);
  ES.selectedShapeEvts.clear();
  normalizeShapeChain(false); normalizeShapeChain(true);
  saveHist('s');
  import('./shape-render.js').then(m => m.drawS());
  toast(`${actualCount}개 shape 삭제${initSkipped ? ` (Init ${initSkipped}개 유지)` : ''}`);
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
  const sel = [...ES.selectedShapeEvts];
  const minDest = Math.min(...sel.map(e => e.startTick + e.duration));
  ES.shapeClipboard = sel.map(e => ({
    relDestTick: (e.startTick + e.duration) - minDest,
    targetPos: e.targetPos,
    isRight: e.isRight,
    easing: e.easing,
    isStep: e.duration === 0
  }));
  toast(`Copied ${ES.shapeClipboard.length} shape(s)`);
}

export function doShapePaste(flip) {
  if (ES.shapeClipboard.length === 0) { toast('Shape clipboard empty'); return; }
  const baseTick = snap(ES.sScr, ES.sGD);
  const newEvts = [];
  for (const c of ES.shapeClipboard) {
    const destTick = baseTick + c.relDestTick;
    let pos = c.targetPos, isR = c.isRight;
    if (flip) { pos = 64 - pos; isR = !isR; }
    const ne = {
      startTick: c.isStep ? destTick : 0,
      duration:  c.isStep ? 0 : destTick,
      isRight: isR,
      targetPos: pos,
      easing: c.easing
    };
    D.shapeEvents.push(ne);
    newEvts.push(ne);
  }
  normalizeShapeChain(false); normalizeShapeChain(true);
  ES.selectedShapeEvts.clear();
  newEvts.forEach(e => ES.selectedShapeEvts.add(e));
  saveHist('s');
  toast(`${flip ? 'Flip-' : ''}Pasted ${newEvts.length} shape(s)`);
  import('./shape-render.js').then(m => m.drawS());
}

/** Mirror selected shape events in place around the center axis. */
export function doShapeFlipSelected() {
  if (ES.selectedShapeEvts.size === 0) { toast('No shapes selected'); return; }
  let count = 0;
  for (const e of ES.selectedShapeEvts) {
    if (e.easing === null) continue;
    e.targetPos = 64 - e.targetPos;
    e.isRight = !e.isRight;
    count++;
  }
  if (count === 0) { toast('Nothing to flip (Init only)'); return; }
  normalizeShapeChain(false); normalizeShapeChain(true);
  saveHist('s');
  import('./shape-render.js').then(m => m.drawS());
  toast(`${count}개 shape 뒤집기`);
}

/**
 * Phase 3-2/3-3: Add a shape event with tap-on-existing-tick semantics.
 * (See main.js v20 for the original commentary; behavior preserved.)
 */
export function addShapeEvt(tick, pos, isRight, easing) {
  const sameTickSameSide = D.shapeEvents.filter(e => {
    const dest = e.startTick + e.duration;
    return Math.abs(dest - tick) < 1 && e.isRight === isRight && e.easing !== null;
  });
  if (sameTickSameSide.length === 0) {
    D.shapeEvents.push({startTick: 0, duration: tick, isRight, targetPos: pos, easing});
  } else if (sameTickSameSide.length === 1) {
    const exist = sameTickSameSide[0];
    if (Math.abs(exist.targetPos - pos) < 0.01) {
      exist.easing = easing;
    } else {
      D.shapeEvents.push({startTick: 0, duration: tick, isRight, targetPos: pos, easing});
    }
  } else {
    const last = sameTickSameSide[sameTickSameSide.length - 1];
    last.targetPos = pos;
    last.easing = easing;
  }
  normalizeShapeChain(isRight);
}
