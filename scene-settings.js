// ============================================================
//  SCENE-SETTINGS — player settings screen (4 categories)
// ============================================================
// Tabs: PLAY / VISUAL / GAUGE / OPTION. Reads and writes the single settings
// object (settings.js); every change persists and applies immediately via
// setSetting(). Self-contained: owns its markup, styles, and wiring; only the
// empty #scene-settings mount div comes from index.html.
//
// Stage 4 scope — controls that touch no judgment/timing code are LIVE:
//   noteSkin, showCombo/showJudgment/showFastSlow, hitEffect, frameCap,
//   noteThickness, laneOpacity, bgBrightness, volumes, gauge ladder,
//   autoplay/noFail, keybindings (link to existing config).
// Placeholder (disabled, wired in later stages):
//   hiSpeed fine/CMOD, showFallMs, sudden/hidden  (Stage 5)
//   mirror, random, staticShape                               (Stage 6)

import { goBack } from './scene-manager.js';
import { getSettings, setSetting, isRecordingDisabled, DEFAULT_SETTINGS } from './settings.js';

let _deps = null;        // engine deps for setSetting (injected at init)
let _activeTab = 'play';

// Set by main at init so this scene can reach keybinding config + deps.
export function initSettingsScene(deps) { _deps = deps; }

const CSS = `
#scene-settings{
  background:var(--bg); color:var(--tx);
  display:flex; flex-direction:column; height:100%; overflow:hidden;
  user-select:none; -webkit-user-select:none;
}
#scene-settings .st-top{
  display:flex; align-items:center; gap:10px; padding:10px 12px;
  border-bottom:1px solid var(--brd); flex-shrink:0;
}
#scene-settings .st-logo{
  font-size:16px; font-weight:800; letter-spacing:.16em; color:var(--acc2);
  cursor:pointer;
}
#scene-settings .st-heading{ font-size:13px; color:var(--tx2); letter-spacing:.2em; }
#scene-settings .st-tabs{
  display:flex; gap:2px; padding:8px 12px 0; border-bottom:1px solid var(--brd); flex-shrink:0;
}
#scene-settings .st-tab{
  flex:1; padding:9px 4px; background:none; border:none; cursor:pointer;
  color:var(--tx2); font-size:12px; letter-spacing:.08em; border-bottom:2px solid transparent;
}
#scene-settings .st-tab.on{ color:var(--acc2); border-bottom-color:var(--acc); }
#scene-settings .st-body{ flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; touch-action:pan-y; padding:12px 12px 40px; }
#scene-settings .st-row{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 2px; border-bottom:1px solid #ffffff0d; gap:12px;
}
#scene-settings .st-label{ font-size:13px; color:var(--tx); font-weight:500; }
#scene-settings .st-label small{ display:block; font-size:10px; color:var(--tx2); margin-top:3px; font-weight:400; }
#scene-settings .st-seg{ display:flex; gap:3px; flex-wrap:wrap; justify-content:flex-end; }
#scene-settings .st-seg button{
  padding:6px 11px; border-radius:7px; background:var(--surf); color:var(--tx2);
  border:1px solid var(--brd); font-size:12px; cursor:pointer;
}
#scene-settings .st-seg button.on{ background:var(--acc); color:#fff; border-color:var(--acc); }
#scene-settings .st-seg button:disabled{ opacity:.4; cursor:not-allowed; }
#scene-settings input[type=range]{ width:130px; }
#scene-settings .st-val{ font-size:11px; color:var(--tx2); min-width:38px; text-align:right; }
#scene-settings .st-note{
  font-size:11px; color:var(--orange); margin:8px 2px; letter-spacing:.02em;
}
#scene-settings .st-sec{
  font-size:12px; color:var(--acc2); font-weight:700; letter-spacing:.2em;
  text-align:center; margin:26px 2px 8px; text-transform:uppercase;
  padding-top:16px; border-top:1px solid var(--brd);
}
#scene-settings .st-sec:first-child{ margin-top:6px; padding-top:0; border-top:none; }
#scene-settings .st-soon{ font-size:10px; color:var(--tx2); opacity:.7; }
`;

function injectCSS() {
  if (document.getElementById('scene-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'scene-settings-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

// Visible fall time (ms): base = 2000/hiSpeed (top of field → judgment line),
// reduced by Sudden/Hidden which cover part of the field. Mirrors game-render's
// visMs and the cover fractions, so the readout matches what's actually seen.
function fallTimeMs(s) {
  const base = 2000 / (s.hiSpeed || 3);
  const covered = Math.min(0.95, (s.sudden || 0) / 100 + (s.hidden || 0) / 100);
  return Math.round(base * (1 - covered));
}

// ── Control builders (return HTML strings; wired after render) ──
function rowSeg(key, label, sub, options, current, opts) {
  const dis = opts && opts.disabled;
  const soon = opts && opts.soon;
  const segs = options.map(o =>
    `<button data-seg="${key}" data-val="${o.v}" class="${o.v === current ? 'on' : ''}" ${dis ? 'disabled' : ''}>${o.t}</button>`
  ).join('');
  return `<div class="st-row">
    <div class="st-label">${label}${sub ? `<small>${sub}</small>` : ''}${soon ? ' <span class="st-soon">(준비 중)</span>' : ''}</div>
    <div class="st-seg">${segs}</div>
  </div>`;
}

function rowToggle(key, label, sub, current, opts) {
  return rowSeg(key, label, sub, [{v:'on',t:'ON'},{v:'off',t:'OFF'}],
    current ? 'on' : 'off', opts);
}

function rowRange(key, label, sub, min, max, step, current, fmt, opts) {
  const dis = opts && opts.disabled;
  const soon = opts && opts.soon;
  return `<div class="st-row">
    <div class="st-label">${label}${sub ? `<small>${sub}</small>` : ''}${soon ? ' <span class="st-soon">(준비 중)</span>' : ''}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${current}" title="더블클릭 시 기본값" ${dis ? 'disabled' : ''}>
      <span class="st-val" data-valof="${key}">${fmt(current)}</span>
    </div>
  </div>`;
}

// ── Tab bodies ───────────────────────────────────────────────
function tabPlay(s) {
  return `
    ${rowRange('hiSpeed', 'Hi-Speed', '스크롤 속도', 1, 8, 0.1, s.hiSpeed, v => (+v).toFixed(1))}
    <div class="st-row">
      <div class="st-label">Fall Time<small>낙하시간 — 노트가 보이는 시간 (Sudden/Hidden 반영)</small></div>
      <span class="st-val" id="stFallMs" style="min-width:60px">${fallTimeMs(s)}ms</span>
    </div>
    ${rowRange('audioOffset', 'Audio Offset', '오디오 오프셋 — 음악 출력 지연 보정 (ms)', -200, 200, 1, s.audioOffset, v => `${v>0?'+':''}${v}ms`)}
    ${rowRange('visualOffset', 'Visual Offset', '비주얼 오프셋 — 노트/판정 타이밍 보정 (ms)', -200, 200, 1, s.visualOffset, v => `${v>0?'+':''}${v}ms`)}
    <div class="st-sec">Volume</div>
    ${rowRange('volMaster', 'Master Volume', '마스터 볼륨', 0, 1, 0.01, s.volMaster, v => Math.round(v*100)+'%')}
    ${rowRange('volMusic', 'Music Volume', '음악 볼륨', 0, 1, 0.01, s.volMusic, v => Math.round(v*100)+'%')}
    ${rowRange('volEffect', 'Hitsound Volume', '히트사운드 볼륨', 0, 1, 0.01, s.volEffect, v => Math.round(v*100)+'%')}
    <div class="st-sec">Control</div>
    <div class="st-row"><div class="st-label">Keybindings<small>키 설정 (Meta 탭과 동일)</small></div>
      <div class="st-seg"><button id="stKeyCfg">설정</button></div></div>
  `;
}

function tabVisual(s) {
  return `
    ${rowSeg('noteSkin', 'Note Skin', '노트 스킨 — 일반 노트만 (Wide 제외)', [{v:'bar',t:'BAR'},{v:'circle',t:'CIRCLE'}], s.noteSkin)}
    ${rowRange('noteThickness', 'Note Thickness', '노트 두께', 6, 24, 1, s.noteThickness, v => `${v}`)}
    ${rowRange('laneOpacity', 'Lane Opacity', '레인 투명도', 0.2, 1, 0.05, s.laneOpacity, v => Math.round(v*100)+'%')}
    ${rowRange('bgBrightness', 'Background', '배경 밝기', 0, 100, 5, s.bgBrightness, v => `${v}%`)}
    ${rowRange('sudden', 'Sudden', '위쪽 레인 가림', 0, 90, 5, s.sudden, v => `${v}%`)}
    ${rowRange('hidden', 'Hidden', '아래쪽 레인 가림', 0, 90, 5, s.hidden, v => `${v}%`)}
    ${rowToggle('hitEffect', 'Hit Effect', '히트 이펙트', s.hitEffect)}
    ${rowSeg('frameCap', 'Frame Cap', '프레임 제한 — 고주사율은 자동 지원', [{v:'0',t:'AUTO'},{v:'60',t:'60'},{v:'30',t:'30'}], String(s.frameCap))}
    <div class="st-sec">Display</div>
    ${rowToggle('showCombo', 'Combo', '콤보 표시', s.showCombo)}
    ${rowToggle('showJudgment', 'Judgment', '판정 표시', s.showJudgment)}
    ${rowToggle('showFastSlow', 'Fast / Slow', 'Fast/Slow 표시', s.showFastSlow)}
  `;
}

function tabGauge(s) {
  const ladder = [
    {v:'cascade', t:'CASCADE', d:'AS에서 시작해 한 단계씩 강등'},
    {v:'as', t:'AS', d:'SYNC 외 판정 시 즉시 종료'},
    {v:'ap', t:'AP', d:'GOOD 이하 시 즉시 종료'},
    {v:'fc', t:'FC', d:'MISS 시 즉시 종료'},
    {v:'hard', t:'HARD', d:'게이지 0 도달 시 종료'},
    {v:'normal', t:'NORMAL', d:'종료 시 75% 이상이면 클리어'},
  ];
  const rows = ladder.map(g => `
    <div class="st-row">
      <div class="st-label">${g.t}<small>${g.d}</small></div>
      <div class="st-seg"><button data-seg="gauge" data-val="${g.v}" class="${s.gauge===g.v?'on':''}">${s.gauge===g.v?'선택됨':'선택'}</button></div>
    </div>`).join('');
  return `<div class="st-sec">Gauge / Clear</div>
    <div class="st-note" style="text-align:center;color:var(--tx2)">게이지 / 클리어 조건 (하나 선택)</div>${rows}`;
}

function tabOption(s) {
  return `
    <div class="st-sec">Recorded</div>
    <div class="st-note" style="text-align:center;color:var(--tx2)">기록이 저장되는 옵션</div>
    ${rowToggle('mirror', 'Mirror', '좌우 반전', s.mirror, {disabled:true, soon:true})}
    ${rowToggle('random', 'Random', '일반 노트 레인 셔플', s.random, {disabled:true, soon:true})}
    <div class="st-sec" style="color:var(--orange);border-top-color:var(--orange)">Not Recorded</div>
    <div class="st-note">아래 옵션을 켜면 플레이 기록(점수)이 저장되지 않습니다.</div>
    ${rowToggle('cmod', 'Constant (CMOD)', '등속 — BPM 변화 무시, 일정 속도', s.cmod, {disabled:true, soon:true})}
    ${rowToggle('autoplay', 'Autoplay', '자동 플레이', s.autoplay)}
    ${rowToggle('staticShape', 'Static Shape', 'Shape 고정 (-2/+2), 노트 연습', s.staticShape, {disabled:true, soon:true})}
    ${rowToggle('noFail', 'No Fail', '게이지 0이어도 안 죽음', s.noFail)}
  `;
}

// ── Render + wiring ──────────────────────────────────────────
function renderBody(host) {
  const s = getSettings();
  let html = '';
  if (_activeTab === 'play') html = tabPlay(s);
  else if (_activeTab === 'visual') html = tabVisual(s);
  else if (_activeTab === 'gauge') html = tabGauge(s);
  else if (_activeTab === 'option') html = tabOption(s);
  host.innerHTML = html;
  wireBody(host);
}

function wireBody(host) {
  // Segmented buttons (incl. gauge ladder).
  host.querySelectorAll('[data-seg]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const key = btn.dataset.seg;
      let val = btn.dataset.val;
      // Coerce types: frameCap is a number, toggles map on/off → boolean.
      if (key === 'frameCap') val = +val;
      else if (val === 'on') val = true;
      else if (val === 'off') val = false;
      setSetting(key, val, _deps);
      renderBody(host);   // reflect new state (and gauge single-select)
    });
  });
  // Format a slider's value label for a given key.
  const fmtVal = (key, val) => {
    if (key.startsWith('vol') || key === 'laneOpacity') return Math.round(val*100)+'%';
    if (key === 'hiSpeed') return (+val).toFixed(1);
    if (key === 'bgBrightness' || key === 'sudden' || key === 'hidden') return val+'%';
    if (key === 'audioOffset' || key === 'visualOffset') return `${val>0?'+':''}${val}ms`;
    return String(val);
  };
  // Range sliders. Double-click (or double-tap) resets to the schema default.
  host.querySelectorAll('[data-range]').forEach(r => {
    if (r.disabled) return;
    const key = r.dataset.range;
    const lbl = host.querySelector(`[data-valof="${key}"]`);
    r.addEventListener('input', () => {
      const val = +r.value;
      if (lbl) lbl.textContent = fmtVal(key, val);
      setSetting(key, val, _deps);
      // Fall-time depends on hiSpeed/sudden/hidden; refresh the readout if it's
      // on screen (PLAY tab). sudden/hidden live on VISUAL, so this is a no-op
      // there — the value is recomputed when PLAY is next rendered anyway.
      if (key === 'hiSpeed' || key === 'sudden' || key === 'hidden') {
        const fm = host.querySelector('#stFallMs');
        if (fm) fm.textContent = fallTimeMs(getSettings()) + 'ms';
      }
    });
    r.addEventListener('dblclick', () => {
      const def = DEFAULT_SETTINGS[key];
      if (def === undefined) return;
      r.value = def;
      if (lbl) lbl.textContent = fmtVal(key, def);
      setSetting(key, def, _deps);
      if (key === 'hiSpeed' || key === 'sudden' || key === 'hidden') {
        const fm = host.querySelector('#stFallMs');
        if (fm) fm.textContent = fallTimeMs(getSettings()) + 'ms';
      }
    });
  });
  // Keybinding config shortcut.
  const keyBtn = host.querySelector('#stKeyCfg');
  if (keyBtn && _deps && _deps.openKeyConfig) {
    keyBtn.addEventListener('click', () => _deps.openKeyConfig());
  }
}

export function mountSettings(el) {
  injectCSS();
  el.innerHTML = `
    <div class="st-top">
      <span class="st-logo" id="stLogo">CONFLUX</span>
      <span class="st-heading">SETTINGS</span>
    </div>
    <div class="st-tabs">
      <button class="st-tab" data-tab="play">PLAY</button>
      <button class="st-tab" data-tab="visual">VISUAL</button>
      <button class="st-tab" data-tab="gauge">GAUGE</button>
      <button class="st-tab" data-tab="option">OPTION</button>
    </div>
    <div class="st-body" id="stBody"></div>
  `;
  el.querySelector('#stLogo').addEventListener('click', () => goBack());
  const body = el.querySelector('#stBody');
  el.querySelectorAll('.st-tab').forEach(t => {
    t.addEventListener('click', () => {
      _activeTab = t.dataset.tab;
      el.querySelectorAll('.st-tab').forEach(x => x.classList.toggle('on', x === t));
      renderBody(body);
    });
  });
  // Default tab.
  el.querySelector('.st-tab[data-tab="play"]').classList.add('on');
  renderBody(body);
}

// ── Keyboard: Esc returns to the previous scene ──────────────
function onSettingsKey(e) {
  if (e.key === 'Escape') { goBack(); e.preventDefault(); }
}
export function enterSettings() { window.addEventListener('keydown', onSettingsKey); }
export function exitSettings()  { window.removeEventListener('keydown', onSettingsKey); }
