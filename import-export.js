// ============================================================
//  IMPORT-EXPORT — JSON file download/upload
// ============================================================
import { D } from './state.js';
import { ES } from './editor-state.js';
import { toast } from './utility.js';
import { loadChartData } from './load-chart.js';
import { compBPM } from './timing.js';
import { saveHist } from './history.js';
import { closeMod } from './file-manager.js';

export function doExport() {
  const d = JSON.stringify(D, null, 2);
  const b = new Blob([d], {type: 'application/json'});
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  const now = new Date();
  const ts = String(now.getFullYear()).slice(2)
           + String(now.getMonth() + 1).padStart(2, '0')
           + String(now.getDate()).padStart(2, '0') + '_'
           + String(now.getHours()).padStart(2, '0')
           + String(now.getMinutes()).padStart(2, '0')
           + String(now.getSeconds()).padStart(2, '0');
  a.href = u;
  a.download = `${D.metadata.artist}-${D.metadata.title}_${D.metadata.difficulty}-${ts}.json`;
  a.click();
  URL.revokeObjectURL(u);
}

export function doImport(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      loadChartData(d);
      ES.currentFileName = f.name.replace(/\.json$/i, '');
      compBPM();
      Promise.all([
        import('./meta-ui.js').then(m => m.syncMeta()),
        import('./notes-render.js').then(m => m.drawN()),
        import('./shape-render.js').then(m => m.drawS()),
      ]).then(() => {
        saveHist('n'); saveHist('s'); saveHist('m');
        closeMod('fileMod');
        toast('Imported: ' + f.name);
      });
    } catch (e) {
      toast('Error: ' + e.message);
    }
  };
  r.readAsText(f);
  inp.value = '';
}
