// ============================================================
//  FILE-MANAGER — localStorage-backed chart save/load + modals
// ============================================================
import { $, LS_PREFIX } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { toast } from './utility.js';
import { loadChartData } from './load-chart.js';
import { compBPM } from './timing.js';
import { clearHistoryBaseline } from './history.js';
import { updateAutoSaveIndicator } from './autosave.js';

export function fmGetFiles() {
  const files = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(LS_PREFIX)) {
      try {
        const raw = localStorage.getItem(k);
        const obj = JSON.parse(raw);
        files.push({
          key: k,
          name: k.slice(LS_PREFIX.length),
          date: obj._savedAt || '',
          title: obj.metadata?.title || 'Untitled',
          artist: obj.metadata?.artist || '',
          difficulty: obj.metadata?.difficulty || ''
        });
      } catch (e) {}
    }
  }
  files.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return files;
}

export function renderFMList() {
  const files = fmGetFiles();
  const el = $('fmList');
  if (files.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--tx2);padding:16px;font-size:10px">No saved files</div>';
    return;
  }
  el.innerHTML = files.map(f => {
    const isCurrent = ES.currentFileName === f.name;
    const dateStr = f.date ? new Date(f.date).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="fm-item" ${isCurrent ? 'style="border-color:var(--acc)"' : ''} onclick="fmLoad('${f.name.replace(/'/g,"\\'")}')">
      <span class="fm-name">${isCurrent ? '● ' : ''}${f.name}<br><span style="font-size:7px;color:var(--tx2)">${f.title} - ${f.artist} [${f.difficulty}]</span></span>
      <span class="fm-date">${dateStr}</span>
      <button class="fm-del" onclick="event.stopPropagation();fmDelete('${f.name.replace(/'/g,"\\'")}')">✕</button>
    </div>`;
  }).join('');
}

export function fmSave() {
  if (!ES.currentFileName) { fmSaveAs(); return; }
  const data = JSON.parse(JSON.stringify(D));
  data._savedAt = new Date().toISOString();
  localStorage.setItem(LS_PREFIX + ES.currentFileName, JSON.stringify(data));
  updateAutoSaveIndicator(true);
  renderFMList();
  toast('Saved: ' + ES.currentFileName);
}

export function fmSaveAs() {
  const defaultName = `${D.metadata.artist}-${D.metadata.title}_${D.metadata.difficulty}`;
  const name = prompt('File name:', ES.currentFileName || defaultName);
  if (!name) return;
  ES.currentFileName = name;
  fmSave();
}

export function fmLoad(name) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    if (!raw) { toast('File not found'); return; }
    const d = JSON.parse(raw);
    loadChartData(d);
    ES.currentFileName = name;
    compBPM();
    Promise.all([
      import('./meta-ui.js').then(m => m.syncMeta()),
      import('./notes-render.js').then(m => m.drawN()),
      import('./shape-render.js').then(m => m.drawS()),
    ]).then(() => {
      clearHistoryBaseline();
      closeMod('fileMod');
      toast('Loaded: ' + name);
    });
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

export function fmDelete(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  localStorage.removeItem(LS_PREFIX + name);
  if (ES.currentFileName === name) ES.currentFileName = '';
  renderFMList();
  toast('Deleted');
}

// ── Modal helpers ────────────────────────────────────────
export function showMod(id) {
  $(id).style.display = 'flex';
  if (id === 'fileMod') renderFMList();
}

export function closeMod(id) {
  $(id).style.display = 'none';
}
