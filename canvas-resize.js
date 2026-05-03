// ============================================================
//  CANVAS-RESIZE — DPR-aware resize, redraw dispatcher, observers
// ============================================================
import { $ } from './constants.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';

// Lazy renderer imports to avoid load-time cycles.
let _drawN, _drawS, _drawPlayIdle, _drawPlayScreen, _getPlayDom, _ensurePlayCanvasSized;
async function _hydrateRenderers() {
  if (!_drawN) ({ drawN: _drawN } = await import('./notes-render.js'));
  if (!_drawS) ({ drawS: _drawS } = await import('./shape-render.js'));
  if (!_drawPlayIdle) ({ drawPlayIdle: _drawPlayIdle, drawPlayScreen: _drawPlayScreen,
                          _getPlayDom, _ensurePlayCanvasSized } = await import('./play-render.js'));
}

export function rszActiveCanvas() {
  const dpr = devicePixelRatio;
  // When Play is fullscreen, plCv is occluded; fullscreen canvas resized below.
  const skipPlay = (ES.activeTab === 'play' && PS.playFullscreen);
  const ids = ES.activeTab === 'note' ? ['nCv']
            : ES.activeTab === 'shape' ? ['sCv']
            : (ES.activeTab === 'play' && !skipPlay) ? ['plCv']
            : [];
  for (const id of ids) {
    const cv = $(id); if (!cv) continue;
    const p = cv.parentElement;
    const r = p.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  if (PS.playFullscreen) rszPlayFSCanvas();
}

export function rszPlayFSCanvas() {
  // Defer to play-render.js helper. Falls back to a simple resize if not yet
  // loaded (e.g., a resize event during initial module wiring).
  if (_getPlayDom && _ensurePlayCanvasSized) {
    const dom = _getPlayDom();
    _ensurePlayCanvasSized(dom.fsCv, dom.fs);
  } else {
    _hydrateRenderers().then(() => {
      const dom = _getPlayDom();
      _ensurePlayCanvasSized(dom.fsCv, dom.fs);
    });
  }
}

export function redrawActiveTab() {
  _hydrateRenderers().then(() => {
    if (ES.activeTab === 'note') _drawN();
    else if (ES.activeTab === 'shape') _drawS();
    else if (ES.activeTab === 'play' && !PS.playActive) _drawPlayIdle();
  });
}

// ── Resize event wiring ────────────────────────────────────
let resizeTimer = null, resizeTimer2 = null;
window.addEventListener('resize', () => {
  // Two-pass settle: orientation changes on Samsung Internet emit `resize`
  // mid-transition; one debounced handler can sample the wrong moment.
  if (resizeTimer) clearTimeout(resizeTimer);
  if (resizeTimer2) clearTimeout(resizeTimer2);
  const run = () => { rszActiveCanvas(); redrawActiveTab(); };
  resizeTimer  = setTimeout(() => { resizeTimer = null;  run(); }, 100);
  resizeTimer2 = setTimeout(() => { resizeTimer2 = null; run(); }, 320);
});

window.addEventListener('orientationchange', () => {
  setTimeout(() => { rszActiveCanvas(); redrawActiveTab(); }, 200);
  setTimeout(() => { rszActiveCanvas(); redrawActiveTab(); }, 600);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; rszActiveCanvas(); redrawActiveTab(); }, 120);
  });
}

// ResizeObserver on play overlay — most reliable mobile signal for layout
// shape changes (orientation, fullscreen, browser chrome show/hide).
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => {
    _hydrateRenderers().then(() => {
      const dom = _getPlayDom();
      if (!dom.fs) return;
      if (PS.playFullscreen || dom.fs.classList.contains('show')) {
        _ensurePlayCanvasSized(dom.fsCv, dom.fs);
        if (!PS.playActive && dom.fs.classList.contains('show')) {
          _drawPlayScreen(dom.fsCv, ES.sharedMs);
        }
      }
    });
  });
  document.addEventListener('DOMContentLoaded', () => {
    _hydrateRenderers().then(() => {
      const dom = _getPlayDom();
      if (dom.fs) ro.observe(dom.fs);
      if (dom.plCv && dom.plCv.parentElement) ro.observe(dom.plCv.parentElement);
    });
  });
}
