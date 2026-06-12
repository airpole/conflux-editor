// ============================================================
//  SCENE-TITLE — main title screen
// ============================================================
// Minimal by design (Stage 3): the goal is proving scene transitions work, not
// visuals — polish lives here later by editing this one file. Shows the logo
// and a "touch to start" prompt. ANY pointer/key input advances to Mode-select.
//
// Self-contained: this module owns its markup (built in mount), its styles
// (injected once), and its input wiring. index.html only provides the empty
// #scene-title mount div. Nothing here reaches into other scenes' DOM.
//
// Dev shortcut: when FEATURES.editor is on, a small "→ Editor" button appears
// so development can skip straight past Title/Mode-select. It's absent in a
// game-only build, so players never see an editor route.

import { goScene } from './scene-manager.js';
import { FEATURES } from './config.js';

let _wired = false;

const CSS = `
#scene-title{
  background:var(--bg); color:var(--tx);
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  position:relative; cursor:pointer; user-select:none; -webkit-user-select:none;
}
#scene-title .tt-logo{
  font-size:clamp(40px,12vw,96px); font-weight:800; letter-spacing:.12em;
  color:var(--acc2); margin:0;
}
#scene-title .tt-sub{
  font-size:clamp(11px,3vw,14px); color:var(--tx2); letter-spacing:.3em;
  margin-top:8px; text-transform:uppercase;
}
#scene-title .tt-prompt{
  position:absolute; bottom:18%; font-size:clamp(12px,3.5vw,16px);
  color:var(--tx); letter-spacing:.1em;
}
@media (prefers-reduced-motion: no-preference){
  #scene-title .tt-prompt{ animation: ttBlink 1.4s ease-in-out infinite; }
}
@keyframes ttBlink{ 0%,100%{opacity:.25} 50%{opacity:1} }
#scene-title .tt-dev{
  position:absolute; top:14px; right:14px; z-index:2;
  background:var(--surf); color:var(--tx2); border:1px solid var(--brd);
  border-radius:6px; padding:5px 10px; font-size:11px; cursor:pointer;
}
#scene-title .tt-dev:active{ background:var(--bg3); }
`;

function injectCSS() {
  if (document.getElementById('scene-title-css')) return;
  const s = document.createElement('style');
  s.id = 'scene-title-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Advance to Mode-select. Guarded so a flurry of inputs only fires once. */
function start() {
  goScene('modeselect');
}

export function mountTitle(el) {
  injectCSS();
  el.innerHTML = `
    <h1 class="tt-logo">CONFLUX</h1>
    <div class="tt-sub">Rhythm</div>
    <div class="tt-prompt">터치하여 시작</div>
    ${FEATURES.editor ? '<button class="tt-dev" id="ttDevEditor">\u2192 Editor</button>' : ''}
  `;

  // The dev shortcut must NOT also trigger the screen-wide "any input" start,
  // so it stops propagation and routes straight to the editor scene.
  if (FEATURES.editor) {
    const dev = el.querySelector('#ttDevEditor');
    if (dev) dev.addEventListener('click', (e) => {
      e.stopPropagation();
      goScene('editor');
    });
  }
}

// onEnter: (re)attach the "any input advances" listeners. We attach on enter
// and detach on exit so the title's key listener never fires while another
// scene (editor, game) is active.
function onAnyKey(e) {
  // Ignore pure modifier presses so Shift/Ctrl alone don't skip the title.
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  start();
}

export function enterTitle(el) {
  if (_wired) return;
  _wired = true;
  el.addEventListener('pointerdown', start);
  window.addEventListener('keydown', onAnyKey);
}

export function exitTitle(el) {
  if (!_wired) return;
  _wired = false;
  el.removeEventListener('pointerdown', start);
  window.removeEventListener('keydown', onAnyKey);
}
