// ============================================================
//  AUTOSAVE — periodic localStorage sync + indicator
// ============================================================
import { $, LS_PREFIX } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';

export function autoSave() {
  if (!ES.currentFileName) {
    const data = JSON.parse(JSON.stringify(D));
    data._savedAt = new Date().toISOString();
    localStorage.setItem(LS_PREFIX + '__autosave__', JSON.stringify(data));
  } else {
    const data = JSON.parse(JSON.stringify(D));
    data._savedAt = new Date().toISOString();
    localStorage.setItem(LS_PREFIX + ES.currentFileName, JSON.stringify(data));
  }
  updateAutoSaveIndicator(true);
}

export function updateAutoSaveIndicator(saved) {
  const el = $('autoSaveI'); if (!el) return;
  if (saved) {
    el.classList.add('saved');
    el.title = 'Saved ' + new Date().toLocaleTimeString();
    setTimeout(() => el.classList.remove('saved'), 2000);
  }
}

export function scheduleAutoSave() {
  if (ES.autoSaveTimer) clearTimeout(ES.autoSaveTimer);
  ES.autoSaveTimer = setTimeout(() => { autoSave(); }, 30000); // 30s after last change
}
