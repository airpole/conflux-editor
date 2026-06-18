// ============================================================
//  KEY-CONFIG — physical key binding UI (Meta tab)
// ============================================================
import { $, DEFAULT_KEYS, DEFAULT_ACTION_KEYS, LS_PREFIX } from './constants.js';
import { PS, rebuildCodeToChannel, rebuildCodeToAction } from './play-state.js';
import { toast } from './utility.js';

// Human label for each action slot (shown in the rebind UI).
const ACTION_LABELS = { speedDown: '배속 −', speedUp: '배속 +', restart: '재시작' };

export function keyCodeDisplayName(code) {
  if (code.startsWith('Key'))    return code.slice(3);
  if (code.startsWith('Digit'))  return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  const map = {Space:'SPC', Enter:'ENT', Backspace:'BKSP', Tab:'TAB',
    ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓',
    Escape:'ESC', CapsLock:'CAPS', Delete:'DEL', Insert:'INS',
    Home:'HOME', End:'END', PageUp:'PgUp', PageDown:'PgDn',
    Backslash:'\\', Slash:'/', Semicolon:';', Quote:'\'', Comma:',',
    Period:'.', Minus:'-', Equal:'=', BracketLeft:'[', BracketRight:']',
    Backquote:'`'};
  if (code.startsWith('F') && !isNaN(code.slice(1))) return code; // F1–F12
  return map[code] || code;
}

export function renderKeyCfg() {
  const el = $('keySlots');
  if (el) {
    el.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
      const btn = document.createElement('button');
      btn.className = 'keySlotBtn' + (PS.keyConfigMode === i ? ' active' : '');
      btn.textContent = `${i}: ${keyCodeDisplayName(PS.keyBindings[i])}`;
      btn.onclick = () => startKeyConfig(i);
      el.appendChild(btn);
    }
  }
  // Action-key slots (speed −/+, restart). Rendered into #actionSlots if the
  // container exists; harmless when absent (staged UI wiring).
  const ael = $('actionSlots');
  if (ael) {
    ael.innerHTML = '';
    for (const action of Object.keys(DEFAULT_ACTION_KEYS)) {
      const btn = document.createElement('button');
      btn.className = 'keySlotBtn' + (PS.actionConfigMode === action ? ' active' : '');
      btn.textContent = `${ACTION_LABELS[action] || action}: ${keyCodeDisplayName(PS.actionBindings[action])}`;
      btn.onclick = () => startActionConfig(action);
      ael.appendChild(btn);
    }
  }
  const hint = $('keyConfigHint');
  if (hint) hint.style.display = (PS.keyConfigMode !== null || PS.actionConfigMode !== null) ? '' : 'none';
}

export function startKeyConfig(ch) {
  PS.keyConfigMode = ch;
  PS.actionConfigMode = null;   // only one rebind active at a time
  renderKeyCfg();
}

export function assignKeyConfig(code) {
  if (PS.keyConfigMode === null) return;
  const target = PS.keyConfigMode;
  // Auto-swap if duplicate
  for (let ch = 1; ch <= 6; ch++) {
    if (ch !== target && PS.keyBindings[ch] === code) {
      PS.keyBindings[ch] = PS.keyBindings[target];
      break;
    }
  }
  PS.keyBindings[target] = code;
  PS.keyConfigMode = null;
  rebuildCodeToChannel();
  localStorage.setItem(LS_PREFIX + 'keyBindings', JSON.stringify(PS.keyBindings));
  renderKeyCfg();
  toast(`CH${target} → ${keyCodeDisplayName(code)}`);
}

export function resetKeyBindings() {
  PS.keyBindings = {...DEFAULT_KEYS};
  PS.keyConfigMode = null;
  rebuildCodeToChannel();
  localStorage.setItem(LS_PREFIX + 'keyBindings', JSON.stringify(PS.keyBindings));
  renderKeyCfg();
  toast('키 설정 기본값으로 초기화');
}

// ── Action-key binding (speed −/+, restart) ──────────────────

export function startActionConfig(action) {
  PS.actionConfigMode = action;
  PS.keyConfigMode = null;      // only one rebind active at a time
  renderKeyCfg();
}

export function assignActionConfig(code) {
  if (PS.actionConfigMode === null) return;
  const target = PS.actionConfigMode;
  // Reject codes already used by a LANE key — an action key doubling as note
  // input would break gameplay. Tell the user instead of silently corrupting.
  for (let ch = 1; ch <= 6; ch++) {
    if (PS.keyBindings[ch] === code) {
      toast(`이미 라인 ${ch} 키로 사용 중`);
      PS.actionConfigMode = null;
      renderKeyCfg();
      return;
    }
  }
  // Auto-swap if the code is bound to another action slot.
  for (const a of Object.keys(PS.actionBindings)) {
    if (a !== target && PS.actionBindings[a] === code) {
      PS.actionBindings[a] = PS.actionBindings[target];
      break;
    }
  }
  PS.actionBindings[target] = code;
  PS.actionConfigMode = null;
  rebuildCodeToAction();
  localStorage.setItem(LS_PREFIX + 'actionBindings', JSON.stringify(PS.actionBindings));
  renderKeyCfg();
  toast(`${ACTION_LABELS[target] || target} → ${keyCodeDisplayName(code)}`);
}

export function resetActionBindings() {
  PS.actionBindings = {...DEFAULT_ACTION_KEYS};
  PS.actionConfigMode = null;
  rebuildCodeToAction();
  localStorage.setItem(LS_PREFIX + 'actionBindings', JSON.stringify(PS.actionBindings));
  renderKeyCfg();
  toast('특수키 기본값으로 초기화');
}

export function loadKeyBindings() {
  const saved = localStorage.getItem(LS_PREFIX + 'keyBindings');
  if (saved) try { PS.keyBindings = JSON.parse(saved); } catch (e) {}
  rebuildCodeToChannel();
  const savedAct = localStorage.getItem(LS_PREFIX + 'actionBindings');
  if (savedAct) try { PS.actionBindings = { ...DEFAULT_ACTION_KEYS, ...JSON.parse(savedAct) }; } catch (e) {}
  rebuildCodeToAction();
}
