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
//   hiSpeed fine/CMOD, syncOffset, showFallMs, sudden/hidden  (Stage 5)
//   mirror, random, staticShape                               (Stage 6)

import { goBack } from './scene-manager.js';
import { getSettings, setSetting, isRecordingDisabled } from './settings.js';

let _deps = null;        // engine deps for setSetting (injected at init)
let _activeTab = 'play';

// Set by main at init so this scene can reach keybinding config + deps.
export function initSettingsScene(deps) { _deps = deps; }

const CSS = `
#scene-settings{
  background:var(--bg); color:var(--tx);
  display:flex; flex-direction:column; height:100%;
  user-select:none; -webkit-user-select:none;
}
#scene-settings .st-top{
  display:flex; align-items:center; gap:10px; padding:10px 12px;
  border-bottom:1px solid var(--brd);
}
#scene-settings .st-logo{
  font-size:16px; font-weight:800; letter-spacing:.16em; color:var(--acc2);
  cursor:pointer;
}
#scene-settings .st-heading{ font-size:13px; color:var(--tx2); letter-spacing:.2em; }
#scene-settings .st-tabs{
  display:flex; gap:2px; padding:8px 12px 0; border-bottom:1px solid var(--brd);
}
#scene-settings .st-tab{
  flex:1; padding:9px 4px; background:none; border:none; cursor:pointer;
  color:var(--tx2); font-size:12px; letter-spacing:.08em; border-bottom:2px solid transparent;
}
#scene-settings .st-tab.on{ color:var(--acc2); border-bottom-color:var(--acc); }
#scene-settings .st-body{ flex:1; overflow-y:auto; padding:12px; }
#scene-settings .st-row{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 2px; border-bottom:1px solid #ffffff0d; gap:12px;
}
#scene-settings .st-label{ font-size:13px; color:var(--tx); }
#scene-settings .st-label small{ display:block; font-size:10px; color:var(--tx2); margin-top:2px; }
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
  font-size:11px; color:var(--tx2); letter-spacing:.15em; margin:14px 2px 4px;
  text-transform:uppercase;
}
#scene-settings .st-soon{ font-size:10px; color:var(--tx2); opacity:.7; }
`;

function injectCSS() {
  if (document.getElementById('scene-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'scene-settings-css'; s.textContent = CSS;
  document.head.appendChild(s);
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
      <input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${current}" ${dis ? 'disabled' : ''}>
      <span class="st-val" data-valof="${key}">${fmt(current)}</span>
    </div>
  </div>`;
}

// ── Tab bodies ───────────────────────────────────────────────
function tabPlay(s) {
  return `
    ${rowRange('hiSpeed', 'Hi-Speed', '스크롤 속도', 1, 8, 0.1, s.hiSpeed, v => (+v).toFixed(1))}
    ${rowRange('syncOffset', '싱크 조정', '오디오 지연 보정 (ms)', -100, 100, 1, s.syncOffset, v => `${v>0?'+':''}${v}ms`, {disabled:true, soon:true})}
    ${rowToggle('showFallMs', '낙하시간 표시', '노트가 보이는 시간(ms)', s.showFallMs, {disabled:true, soon:true})}
    <div class="st-sec">Volume</div>
    ${rowRange('volMaster', 'Master', null, 0, 1, 0.01, s.volMaster, v => Math.round(v*100)+'%')}
    ${rowRange('volMusic', 'Music', null, 0, 1, 0.01, s.volMusic, v => Math.round(v*100)+'%')}
    ${rowRange('volEffect', 'Effect', '히트사운드', 0, 1, 0.01, s.volEffect, v => Math.round(v*100)+'%')}
    <div class="st-sec">Control</div>
    <div class="st-row"><div class="st-label">Keybindings<small>키 설정 (Meta 탭과 동일)</small></div>
      <div class="st-seg"><button id="stKeyCfg">설정</button></div></div>
  `;
}

function tabVisual(s) {
  return `
    ${rowSeg('noteSkin', '노트 스킨', '일반 노트만 (Wide 제외)', [{v:'bar',t:'BAR'},{v:'circle',t:'CIRCLE'}], s.noteSkin)}
    ${rowRange('noteThickness', '노트 두께', null, 6, 24, 1, s.noteThickness, v => `${v}`)}
    ${rowRange('laneOpacity', '레인 투명도', null, 0.2, 1, 0.05, s.laneOpacity, v => Math.round(v*100)+'%')}
    ${rowRange('bgBrightness', '배경 밝기', null, 0, 100, 5, s.bgBrightness, v => `${v}%`)}
    ${rowRange('sudden', 'Sudden', '위쪽 레인 가림', 0, 100, 5, s.sudden, v => `${v}%`, {disabled:true, soon:true})}
    ${rowRange('hidden', 'Hidden', '아래쪽 레인 가림', 0, 100, 5, s.hidden, v => `${v}%`, {disabled:true, soon:true})}
    ${rowToggle('hitEffect', '히트 이펙트', null, s.hitEffect)}
    ${rowSeg('frameCap', '프레임 제한', '고주사율은 자동 지원', [{v:'0',t:'AUTO'},{v:'60',t:'60'},{v:'30',t:'30'}], String(s.frameCap))}
    <div class="st-sec">표시</div>
    ${rowToggle('showCombo', '콤보 표시', null, s.showCombo)}
    ${rowToggle('showJudgment', '판정 표시', null, s.showJudgment)}
    ${rowToggle('showFastSlow', 'Fast/Slow 표시', null, s.showFastSlow)}
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
  return `<div class="st-sec">게이지 / 클리어 조건 (하나 선택)</div>${rows}`;
}

function tabOption(s) {
  return `
    <div class="st-sec">기록 저장됨</div>
    ${rowToggle('mirror', 'Mirror', '좌우 반전', s.mirror, {disabled:true, soon:true})}
    ${rowToggle('random', 'Random', '일반 노트 레인 셔플', s.random, {disabled:true, soon:true})}
    <div class="st-sec" style="color:var(--orange)">기록 저장 안 됨</div>
    <div class="st-note">아래 옵션을 켜면 플레이 기록(점수)이 저장되지 않습니다.</div>
    ${rowToggle('cmod', '등속 (CMOD)', 'BPM 변화 무시, 일정 속도', s.cmod, {disabled:true, soon:true})}
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
  // Range sliders.
  host.querySelectorAll('[data-range]').forEach(r => {
    if (r.disabled) return;
    r.addEventListener('input', () => {
      const key = r.dataset.range;
      const val = +r.value;
      const lbl = host.querySelector(`[data-valof="${key}"]`);
      if (lbl) {
        // Re-derive the formatted label cheaply for common keys.
        if (key.startsWith('vol') || key === 'laneOpacity') lbl.textContent = Math.round(val*100)+'%';
        else if (key === 'hiSpeed') lbl.textContent = val.toFixed(1);
        else if (key === 'bgBrightness' || key === 'sudden' || key === 'hidden') lbl.textContent = val+'%';
        else lbl.textContent = String(val);
      }
      setSetting(key, val, _deps);
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
