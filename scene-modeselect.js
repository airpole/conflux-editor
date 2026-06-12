// ============================================================
//  SCENE-MODESELECT — choose Play / Editor / Settings
// ============================================================
// Three entries. Each routes to its scene via the scene-manager:
//   Play     → music-select  (wired in Stage 5; toast placeholder for now)
//   Editor   → editor        (hidden entirely when FEATURES.editor is off)
//   Settings → settings      (built in Stage 4; disabled placeholder for now)
//
// Build gating lives here: the Editor button is only rendered when
// FEATURES.editor is true, so a game-only build offers no editor route at all.
// Self-contained like every scene — owns its markup, styles, and wiring; only
// touches its own #scene-modeselect mount div.

import { goScene, goBack } from './scene-manager.js';
import { FEATURES } from './config.js';
import { toast } from './utility.js';

const CSS = `
#scene-modeselect{
  background:var(--bg); color:var(--tx);
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:14px; user-select:none; -webkit-user-select:none;
}
#scene-modeselect .ms-logo{
  font-size:clamp(14px,4vw,20px); font-weight:800; letter-spacing:.18em;
  color:var(--acc2); cursor:pointer; margin-bottom:6px; opacity:.85;
}
#scene-modeselect .ms-btn.kbsel{ outline:2px solid var(--acc2); outline-offset:2px; background:var(--bg3); }
#scene-modeselect .ms-title{
  font-size:clamp(20px,6vw,32px); font-weight:700; color:var(--acc2);
  letter-spacing:.1em; margin-bottom:10px;
}
#scene-modeselect .ms-btn{
  width:min(78vw,320px); padding:16px 20px; border-radius:10px;
  background:var(--surf); color:var(--tx); border:1px solid var(--brd);
  font-size:clamp(15px,4.5vw,18px); letter-spacing:.06em; cursor:pointer;
  display:flex; align-items:center; justify-content:center; gap:10px;
}
#scene-modeselect .ms-btn:active{ background:var(--bg3); }
#scene-modeselect .ms-btn.ms-play{ border-color:var(--acc); color:var(--acc2); }
#scene-modeselect .ms-btn.ms-disabled{ opacity:.45; cursor:not-allowed; }
#scene-modeselect .ms-back{
  margin-top:8px; background:none; border:none; color:var(--tx2);
  font-size:13px; cursor:pointer; letter-spacing:.1em;
}
`;

function injectCSS() {
  if (document.getElementById('scene-modeselect-css')) return;
  const s = document.createElement('style');
  s.id = 'scene-modeselect-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function mountModeSelect(el) {
  injectCSS();
  el.innerHTML = `
    <div class="ms-logo" id="msLogo">CONFLUX</div>
    <div class="ms-title">MODE</div>
    <button class="ms-btn ms-play" id="msPlay">PLAY</button>
    ${FEATURES.editor ? '<button class="ms-btn" id="msEditor">EDITOR</button>' : ''}
    <button class="ms-btn" id="msSettings">SETTINGS</button>
    <button class="ms-back" id="msBack">\u2039 BACK</button>
  `;

  // Logo doubles as a back-to-title affordance, matching the editor logo.
  el.querySelector('#msLogo').addEventListener('click', () => goBack());

  // Play: music-select doesn't exist until Stage 5.
  el.querySelector('#msPlay').addEventListener('click', () => {
    toast('Music Select 준비 중');
  });

  if (FEATURES.editor) {
    const ed = el.querySelector('#msEditor');
    if (ed) ed.addEventListener('click', () => goScene('editor'));
  }

  // Settings scene.
  const settingsBtn = el.querySelector('#msSettings');
  settingsBtn.classList.remove('ms-disabled');
  settingsBtn.addEventListener('click', () => goScene('settings'));

  el.querySelector('#msBack').addEventListener('click', () => goBack());
}

// ── Keyboard navigation ──────────────────────────────────────
// Arrow keys move the highlight across the selectable mode buttons; Enter
// activates; Esc goes back. Listeners attach on scene enter and detach on exit
// so they never fire while another scene is active.
let _kbBtns = [];   // current selectable buttons in order
let _kbIdx = 0;
let _kbEl = null;

function kbRefresh() {
  if (!_kbEl) return;
  _kbBtns = [...(_kbEl.querySelectorAll('#msPlay, #msEditor, #msSettings'))];
  if (_kbIdx >= _kbBtns.length) _kbIdx = 0;
  kbPaint();
}
function kbPaint() {
  _kbBtns.forEach((b, i) => b.classList.toggle('kbsel', i === _kbIdx));
}
function onModeKey(e) {
  if (!_kbBtns.length) kbRefresh();
  switch (e.key) {
    case 'ArrowDown': case 'ArrowRight':
      _kbIdx = (_kbIdx + 1) % _kbBtns.length; kbPaint(); e.preventDefault(); break;
    case 'ArrowUp': case 'ArrowLeft':
      _kbIdx = (_kbIdx - 1 + _kbBtns.length) % _kbBtns.length; kbPaint(); e.preventDefault(); break;
    case 'Enter':
      if (_kbBtns[_kbIdx]) _kbBtns[_kbIdx].click(); e.preventDefault(); break;
    case 'Escape':
      goBack(); e.preventDefault(); break;
  }
}

export function enterModeSelect(el) {
  _kbEl = el; _kbIdx = 0;
  kbRefresh();
  window.addEventListener('keydown', onModeKey);
}
export function exitModeSelect() {
  window.removeEventListener('keydown', onModeKey);
  _kbBtns.forEach(b => b.classList.remove('kbsel'));
  _kbBtns = []; _kbEl = null;
}
