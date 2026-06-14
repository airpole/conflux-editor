// ============================================================
//  AUTOSAVE — periodic localStorage sync + indicator
// ============================================================
import { $, LS_PREFIX } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';

export function autoSave() {
  // Serialize D once. The previous code deep-cloned D (JSON.parse(JSON.stringify))
  // just to attach `_savedAt`, then stringified again — three full passes over
  // the data. With a large embedded jacket (20MB+) that triple pass stalls the
  // main thread, including when exitToTitle() autosaves on the logo click. We
  // stringify D a single time and splice `_savedAt` into the JSON text instead.
  const key = ES.currentFileName
    ? (LS_PREFIX + ES.currentFileName)
    : (LS_PREFIX + '__autosave__');
  const body = JSON.stringify(D);            // single serialization pass
  const stamp = ',"_savedAt":' + JSON.stringify(new Date().toISOString()) + '}';
  // Insert _savedAt as the last top-level key: replace the final '}' with it.
  // D always serializes to a non-empty object, so the last char is '}'.
  const out = body.endsWith('}')
    ? body.slice(0, -1) + (body.length > 2 ? stamp : '"_savedAt":' + JSON.stringify(new Date().toISOString()) + '}')
    : body;
  try {
    localStorage.setItem(key, out);
    updateAutoSaveIndicator(true);
  } catch (e) {
    // QuotaExceededError is realistic with 20MB jackets — surface it, don't throw.
    updateAutoSaveIndicator(false);
    console.warn('autoSave failed:', e && e.name);
  }
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
