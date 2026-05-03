// ============================================================
//  FULLSCREEN — document.fullscreen toggle + reconciliation
// ============================================================
import { $ } from './constants.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';

// Lazy: avoid cycle with canvas-resize and play modules.
function _rsz()  { import('./canvas-resize.js').then(m => m.rszActiveCanvas()); }
function _redraw(){ import('./canvas-resize.js').then(m => m.redrawActiveTab()); }
function _stopPlay() { import('./play.js').then(m => m.stopPlay()); }

export function goFS() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}

function onFullscreenChange() {
  // Two-pass settle: 80ms (early) and 250ms (late) catch both fast desktop
  // transitions and slow mobile ones (Samsung Internet rotates layout late).
  const reconcile = () => {
    const stillFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const fsEl = $('playFS');
    if (!stillFs) {
      if (fsEl) fsEl.classList.remove('show');
      if (PS.playFullscreen && PS.playActive) {
        if (PS.playStartedFromBeginning) {
          PS.playFullscreen = false;
          _stopPlay();
          return;
        }
        PS.playFullscreen = false;
      } else if (PS.playFullscreen) {
        PS.playFullscreen = false;
      }
    } else {
      if (PS.playActive && fsEl && !fsEl.classList.contains('show')) {
        fsEl.classList.add('show');
      }
      if (PS.playActive && !PS.playFullscreen) PS.playFullscreen = true;
    }
    _rsz();
    _redraw();
  };
  setTimeout(reconcile, 80);
  setTimeout(reconcile, 250);
}

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
