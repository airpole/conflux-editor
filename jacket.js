// ============================================================
//  JACKET — square jacket image + blurred backdrop (Phase 7-3)
// ============================================================
// A square jacket image, optionally provided via Meta tab, renders behind
// the play canvas as a blurred backdrop with the original square overlaid
// in the upper "above-judgment-line" space.
//
// Performance: ctx.filter='blur(...)' is expensive enough that re-running
// it every frame would noticeably hit framerate on mobile. Instead we run
// blur once when the jacket loads (or when window dimensions change enough
// that the cached backdrop becomes too small) and stash the result in an
// offscreen canvas. The per-frame cost is then two drawImage() calls.

import { $ } from './constants.js';
import { D } from './state.js';
import { toast } from './utility.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { scheduleAutoSave } from './autosave.js';

let _jacketImg = null;          // HTMLImageElement (decoded jacket)
let _jacketBlurCanvas = null;   // pre-rendered blur backdrop
// Object URL for the current jacket. Large jackets arrive as multi-MB base64
// data URLs; assigning that string straight to an <img>.src forces the browser
// to parse/decode the whole base64 blob on the main thread — and we were doing
// it twice (decoded image + Meta-tab preview). Converting once to a Blob URL
// lets both consumers share a lightweight handle and skip the base64 reparse,
// which is what was freezing input (e.g. the logo click) on big-jacket loads.
let _jacketObjURL = null;
let _jacketBlurW = 0, _jacketBlurH = 0;

// Imported lazily to avoid cycle (play-render.js will import jacket.js too).
function _drawPlayIdle() {
  if (typeof window !== 'undefined' && typeof window.drawPlayIdle === 'function') {
    window.drawPlayIdle();
  }
}

// Convert the stored data URL into a Blob URL once, revoking any previous one.
// Returns the Blob URL, or '' if there is no jacket / conversion fails. Falls
// back to the raw data URL only if Blob construction throws.
function _ensureJacketObjURL() {
  const dataURL = D.metadata.jacketImage || '';
  if (_jacketObjURL) { try { URL.revokeObjectURL(_jacketObjURL); } catch (e) {} _jacketObjURL = null; }
  if (!dataURL) return '';
  // Parse "data:<mime>;base64,<payload>" without a giant regex.
  const comma = dataURL.indexOf(',');
  if (comma < 0 || dataURL.indexOf(';base64') < 0) return dataURL; // not base64 — use as-is
  try {
    const mime = dataURL.slice(5, dataURL.indexOf(';'));
    const bin = atob(dataURL.slice(comma + 1));
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    _jacketObjURL = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
    return _jacketObjURL;
  } catch (e) {
    return dataURL; // conversion failed — fall back to the data URL
  }
}

function _rebuildJacketBlur(targetW, targetH) {
  if (!_jacketImg) return;
  // Cap the offscreen size — we only need enough resolution to look soft.
  // 1.5× DPR-clamped target to allow some upscale latitude.
  const dpr = devicePixelRatio || 1;
  const W = Math.max(64, Math.round(targetW * dpr * 1.0));
  const H = Math.max(64, Math.round(targetH * dpr * 1.0));
  if (_jacketBlurCanvas && _jacketBlurW === W && _jacketBlurH === H) return;
  _jacketBlurCanvas = document.createElement('canvas');
  _jacketBlurCanvas.width = W;
  _jacketBlurCanvas.height = H;
  _jacketBlurW = W; _jacketBlurH = H;
  const cx = _jacketBlurCanvas.getContext('2d');
  // Cover-fit the jacket image into the offscreen, then apply heavy blur.
  const iw = _jacketImg.width, ih = _jacketImg.height;
  if (iw < 1 || ih < 1) return;
  const sa = iw / ih, ta = W / H;
  let dw, dh, dx, dy;
  if (sa > ta) { dh = H; dw = H * sa; dx = (W - dw) / 2; dy = 0; }
  else         { dw = W; dh = W / sa; dx = 0; dy = (H - dh) / 2; }
  cx.filter = 'blur(28px) brightness(0.55)';
  cx.drawImage(_jacketImg, dx, dy, dw, dh);
  cx.filter = 'none';
}

export function _hydrateJacketFromMeta() {
  const dataURL = D.metadata.jacketImage || '';
  if (!dataURL) {
    _jacketImg = null;
    _jacketBlurCanvas = null;
    return;
  }
  const url = _ensureJacketObjURL();
  const img = new Image();
  img.onload = () => {
    _jacketImg = img;
    _jacketBlurCanvas = null; // force rebuild on next draw
    if (ES.activeTab === 'play' && !PS.playActive) _drawPlayIdle();
  };
  img.onerror = () => { _jacketImg = null; };
  img.src = url;
}

export function loadJacket(inp) {
  const f = inp.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataURL = reader.result;
    D.metadata.jacketImage = dataURL;
    _hydrateJacketFromMeta();
    _syncJacketUI();
    scheduleAutoSave();
    toast('Jacket loaded');
  };
  reader.onerror = () => toast('Jacket read failed');
  reader.readAsDataURL(f);
  inp.value = '';
}

export function clearJacket() {
  D.metadata.jacketImage = '';
  _jacketImg = null;
  _jacketBlurCanvas = null;
  if (_jacketObjURL) { try { URL.revokeObjectURL(_jacketObjURL); } catch (e) {} _jacketObjURL = null; }
  _syncJacketUI();
  scheduleAutoSave();
  if (ES.activeTab === 'play' && !PS.playActive) _drawPlayIdle();
}

export function _syncJacketUI() {
  // The HTML structure is:
  //   <div class="dz" ...> ← drop-zone, contains:
  //     <img id="jacketPrev"> ← preview thumbnail (was 'jacketThumb' incorrectly)
  //     <span id="jacketLbl"> ← caption text
  //     <input type="file" id="jacketF"> ← hidden file picker
  //   </div>
  //   <button id="jacketClearBtn"> ← clear button (outside the dz)
  // The earlier ids jacketDz/jacketThumb don't exist in the DOM, which is
  // why preview never appeared after loadJacket succeeded.
  const prev = $('jacketPrev');
  const lbl = $('jacketLbl');
  const clr = $('jacketClearBtn');
  const has = !!(D.metadata.jacketImage);
  if (prev) {
    if (has) {
      // Reuse the already-built Blob URL (built by _hydrateJacketFromMeta);
      // assigning the multi-MB data URL here would re-decode it a second time.
      prev.src = _jacketObjURL || D.metadata.jacketImage;
      prev.style.display = '';
    } else {
      prev.removeAttribute('src');
      prev.style.display = 'none';
    }
  }
  if (lbl) {
    lbl.textContent = has ? 'Jacket loaded — tap to replace' : 'Tap to load jacket (1:1 square image)';
  }
  if (clr) clr.style.display = has ? '' : 'none';
}

/**
 * Draw the jacket backdrop into the upper "above the judgment line" half
 * of the play canvas. The judgment line sits at gy + gh*8/9, and the
 * jacket square is centered vertically in the "above judgment line" half
 * (so the square's vertical center lands around gy + gh*4/9).
 *
 * Z-order: this is called before the shape area fill in drawGameFrame, so
 * everything else draws on top. Below the judgment line stays opaque dark
 * so notes remain readable.
 */
export function drawJacketBackground(ctx, gx, gy, gw, gh) {
  if (!_jacketImg || !D.metadata.jacketImage) return;
  const brightness = (D.metadata.jacketBrightness != null ? D.metadata.jacketBrightness : 50) / 100;
  if (brightness <= 0) return;
  // Confine jacket region to the upper "above judgment line" portion.
  const jY = gy + gh * (8 / 9);
  const regH = jY - gy;
  const regY = gy;
  // Backdrop: blurred, full-region.
  _rebuildJacketBlur(gw, regH);
  if (_jacketBlurCanvas) {
    ctx.save();
    ctx.beginPath(); ctx.rect(gx, regY, gw, regH); ctx.clip();
    ctx.globalAlpha = brightness;
    ctx.drawImage(_jacketBlurCanvas, gx, regY, gw, regH);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Crisp square overlay, centered in the upper region.
  const sqSize = Math.min(gw * 0.7, regH * 0.85);
  const sqX = gx + (gw - sqSize) / 2;
  const sqY = regY + (regH - sqSize) / 2;
  ctx.save();
  ctx.globalAlpha = brightness;
  ctx.drawImage(_jacketImg, sqX, sqY, sqSize, sqSize);
  ctx.globalAlpha = 1;
  // Subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sqX + 0.5, sqY + 0.5, sqSize, sqSize);
  ctx.restore();
}
