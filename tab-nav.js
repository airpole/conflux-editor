// ============================================================
//  TAB-NAV — switching tabs + sharedMs sync between tabs
// ============================================================
import { $, TAB_MAP } from './constants.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { t2ms, ms2t } from './timing.js';
import { fmtMs } from './utility.js';
import { rszActiveCanvas } from './canvas-resize.js';
import { stopEdPlay } from './edit-playback.js';

// Lazy: avoid cycles with Play and renderers.
async function _stopPlay()    { const m = await import('./play.js');         m.stopPlay(); }
async function _drawN()       { const m = await import('./notes-render.js'); m.drawN(); }
async function _drawS()       { const m = await import('./shape-render.js'); m.drawS(); }
async function _drawIdle()    { const m = await import('./play-render.js');  m.drawPlayIdle(); }
async function _renderKeyCfg(){ const m = await import('./key-config.js');   m.renderKeyCfg(); }

/** Lazily-bound; set up by import after canvases mount. */
function _cancelLN() { ES.pendLN = null; const el = $('lnPendUI'); if (el) el.style.display = 'none'; }
function _cancelArc(){ ES.pendArc = null; const el = $('arcPendUI'); if (el) el.style.display = 'none'; }
function _cancelTE() { ES.pendTE  = null; const el = $('tePendUI');  if (el) el.style.display = 'none'; }

export function syncSharedFromTab(tab) {
  if (tab === 'note')       ES.sharedMs = t2ms(ES.nScr);
  else if (tab === 'shape') ES.sharedMs = t2ms(ES.sScr);
  // 'play' tab: sharedMs is updated by playSeekTo; nothing to pull.
  const frac = ES.totalMs > 0 ? Math.max(0, (ES.sharedMs / ES.totalMs) * 1000) : 0;
  $('nSeek').value = frac; $('nTime').textContent = fmtMs(ES.sharedMs);
  $('sSeek').value = frac; $('sTime').textContent = fmtMs(ES.sharedMs);
  const playSeekEl = $('playSeek');
  if (playSeekEl) { playSeekEl.value = frac; $('playTime').textContent = fmtMs(ES.sharedMs); }
}

export function applySharedToTab(tab) {
  const tk = ms2t(ES.sharedMs);
  if (tab === 'note') ES.nScr = tk;
  else if (tab === 'shape') ES.sScr = tk;
  // 'play' reads sharedMs directly in drawPlayIdle.
}

export function goTab(t) {
  if (ES.activeTab === t) return;
  syncSharedFromTab(ES.activeTab);
  if (t !== 'note'  && ES.edPlay.n) stopEdPlay('n');
  if (t !== 'shape' && ES.edPlay.s) stopEdPlay('s');
  if (t !== 'play'  && PS.playActive) _stopPlay();
  if (ES.activeTab === 'meta' && t !== 'meta' && PS.keyConfigMode !== null) {
    PS.keyConfigMode = null;
    _renderKeyCfg();
  }
  _cancelLN(); _cancelArc(); _cancelTE();
  ES.activeTab = t;
  applySharedToTab(t);
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  const navBtn = document.querySelector(`.nb[data-action="goTab"][data-arg="${t}"]`);
  if (navBtn) navBtn.classList.add('on');
  for (const key in TAB_MAP) $(TAB_MAP[key]).classList.toggle('on', key === t);
  requestAnimationFrame(() => {
    rszActiveCanvas();
    if (t === 'note') _drawN();
    else if (t === 'shape') _drawS();
    else if (t === 'play') _drawIdle();
  });
}
