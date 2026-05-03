// ============================================================
//  EDIT-PLAYBACK — Notes/Shape inline ▶ controls
// ============================================================
import { $, TPB } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { AS } from './audio-state.js';
import { ms2t, t2ms, getTimeSig } from './timing.js';
import { fmtMs } from './utility.js';
import { initAud, startAud, stopAud, getPlayMs, playMetronome, playHit } from './audio.js';

export function toggleEdPlay(w) {
  if (ES.edPlay[w]) { stopEdPlay(w); return; }
  initAud();
  ES.edPlay[w] = true;
  ES.edHitSet[w] = new Set();
  ES.edLastBeat[w] = -1;
  const scr = w === 'n' ? ES.nScr : ES.sScr;
  ES.edMs0[w] = t2ms(scr);
  ES.edT0[w] = performance.now();
  // Audio position = chartMs + chartOffset
  const audioStartMs = ES.edMs0[w] + D.metadata.offset;
  startAud(audioStartMs);
  $(w === 'n' ? 'nPlayBtn' : 'sPlayBtn').textContent = '⏸';

  function frame() {
    if (!ES.edPlay[w]) return;
    const ms_ = getPlayMs(w);
    // Metronome
    if (AS.isMetronomeOn) {
      const curTk = ms2t(ms_);
      const curBeat = Math.floor(curTk / TPB);
      if (curBeat > ES.edLastBeat[w]) {
        ES.edLastBeat[w] = curBeat;
        const ts = getTimeSig(curTk);
        playMetronome(curBeat % ts.numerator === 0);
      }
    }
    // Hitsound
    for (const n of D.notes) {
      if (!ES.edHitSet[w].has(n) && t2ms(n.startTick) <= ms_) {
        ES.edHitSet[w].add(n);
        playHit();
      }
    }
    if (w === 'n') import('./notes-render.js').then(m => m.drawN());
    else           import('./shape-render.js').then(m => m.drawS());
    const frac = ms_ / ES.totalMs;
    $(w === 'n' ? 'nSeek' : 'sSeek').value = frac * 1000;
    $(w === 'n' ? 'nTime' : 'sTime').textContent = fmtMs(ms_);
    ES.edRAF[w] = requestAnimationFrame(frame);
  }
  ES.edRAF[w] = requestAnimationFrame(frame);
}

export function stopEdPlay(w) {
  ES.edPlay[w] = false; stopAud();
  if (ES.edRAF[w]) { cancelAnimationFrame(ES.edRAF[w]); ES.edRAF[w] = null; }
  $(w === 'n' ? 'nPlayBtn' : 'sPlayBtn').textContent = '▶';
  if (w === 'n') import('./notes-render.js').then(m => m.drawN());
  else           import('./shape-render.js').then(m => m.drawS());
}

export function edSeek(w, v) {
  const was = ES.edPlay[w]; if (was) stopEdPlay(w);
  const ms_ = (v / 1000) * ES.totalMs;
  const tk = ms2t(ms_);
  if (w === 'n') {
    ES.nScr = tk;
    import('./notes-render.js').then(m => m.drawN());
  } else {
    ES.sScr = tk;
    import('./shape-render.js').then(m => m.drawS());
  }
  $(w === 'n' ? 'nTime' : 'sTime').textContent = fmtMs(ms_);
  if (was) toggleEdPlay(w);
}
