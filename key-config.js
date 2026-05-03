// ============================================================
//  KEY-CONFIG — physical key binding UI (Meta tab)
// ============================================================
import { $, DEFAULT_KEYS, LS_PREFIX } from './constants.js';
import { PS, rebuildCodeToChannel } from './play-state.js';
import { toast } from './utility.js';

export function keyCodeDisplayName(code) {
  if (code.startsWith('Key'))    return code.slice(3);
  if (code.startsWith('Digit'))  return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  const map = {Space:'SPC', Enter:'ENT', Backspace:'BKSP', Tab:'TAB',
    ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓',
    Escape:'ESC', CapsLock:'CAPS', Delete:'DEL', Insert:'INS',
    Home:'HOME', End:'END', PageUp:'PgUp', PageDown:'PgDn'};
  if (code.startsWith('F') && !isNaN(code.slice(1))) return code; // F1–F12
  return map[code] || code;
}

export function renderKeyCfg() {
  const el = $('keySlots'); if (!el) return;
  el.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement('button');
    btn.className = 'keySlotBtn' + (PS.keyConfigMode === i ? ' active' : '');
    btn.textContent = `${i}: ${keyCodeDisplayName(PS.keyBindings[i])}`;
    btn.onclick = () => startKeyConfig(i);
    el.appendChild(btn);
  }
  const hint = $('keyConfigHint');
  if (hint) hint.style.display = PS.keyConfigMode !== null ? '' : 'none';
}

export function startKeyConfig(ch) {
  PS.keyConfigMode = ch;
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

export function loadKeyBindings() {
  const saved = localStorage.getItem(LS_PREFIX + 'keyBindings');
  if (saved) try { PS.keyBindings = JSON.parse(saved); } catch (e) {}
  rebuildCodeToChannel();
}
