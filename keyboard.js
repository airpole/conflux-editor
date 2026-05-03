// ============================================================
//  KEYBOARD — desktop keyboard shortcuts + play key forwarding
// ============================================================
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { toast } from './utility.js';
import { undo, redo } from './history.js';
import { dispatch, DeleteNotes } from './commands.js';
import { setNT, nZ, doCopy, doPaste, doFlipSelected, cancelLN, cancelTE } from './notes-tools.js';
import { setST, sZ, pickEase, doShapeCopy, doShapePaste, doShapeFlipSelected,
         doShapeSelectionDelete } from './shape-tools.js';
import { toggleFollow, toggleSFollow, toggleMirror, cyclePosSnap, cancelArc } from './edit-options.js';
import { toggleGP } from './grid-picker.js';
import { renderKeyCfg, startKeyConfig, assignKeyConfig } from './key-config.js';
import { handlePlayKeyDown, handlePlayKeyUp } from './play-input.js';
import { toggleEdPlay } from './edit-playback.js';
import { playToggle, stopPlay } from './play.js';
import { drawN } from './notes-render.js';
import { drawS } from './shape-render.js';

document.addEventListener('keyup', (e) => {
  if (PS.playActive) handlePlayKeyUp(e.code);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  // Key config rebind capture (meta tab only)
  if (PS.keyConfigMode !== null && ES.activeTab === 'meta') {
    const MODS = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'];
    if (MODS.includes(e.code)) return;
    const digitMatch = e.code.match(/^Digit([1-6])$/);
    if (digitMatch) { e.preventDefault(); startKeyConfig(+digitMatch[1]); return; }
    e.preventDefault();
    assignKeyConfig(e.code);
    return;
  }

  // Play mode key input
  if (PS.playActive) {
    e.preventDefault();
    if (e.code === 'Escape') { stopPlay(); return; }
    if (!e.repeat) handlePlayKeyDown(e.code);
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  if (ctrl) {
    if (key === 'z' && !shift) {
      e.preventDefault();
      if (ES.activeTab === 'note') undo('n');
      else if (ES.activeTab === 'shape') undo('s');
      else if (ES.activeTab === 'meta') undo('m');
      return;
    }
    if ((key === 'z' && shift) || key === 'y') {
      e.preventDefault();
      if (ES.activeTab === 'note') redo('n');
      else if (ES.activeTab === 'shape') redo('s');
      else if (ES.activeTab === 'meta') redo('m');
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      if (ES.activeTab === 'note') doCopy();
      else if (ES.activeTab === 'shape') doShapeCopy();
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      if (ES.activeTab === 'note') doPaste(false);
      else if (ES.activeTab === 'shape') doShapePaste(false);
      return;
    }
    if (key === 'f') {
      e.preventDefault();
      if (ES.activeTab === 'note') doFlipSelected();
      else if (ES.activeTab === 'shape') doShapeFlipSelected();
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      if (ES.activeTab === 'note') {
        ES.selectedNotes.clear();
        D.notes.forEach(n => ES.selectedNotes.add(n));
        drawN();
        toast(`${ES.selectedNotes.size}개 노트 전체 선택`);
      } else if (ES.activeTab === 'shape') {
        ES.selectedShapeEvts.clear();
        D.shapeEvents.forEach(ev => ES.selectedShapeEvts.add(ev));
        drawS();
        toast(`${ES.selectedShapeEvts.size}개 shape 전체 선택`);
      }
      return;
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (ES.activeTab === 'note' && ES.selectedNotes.size > 0) {
      const toDel = [...ES.selectedNotes];
      const count = toDel.length;
      ES.selectedNotes.clear();
      dispatch(DeleteNotes(toDel));
      toast(`${count}개 노트 삭제`);
    } else if (ES.activeTab === 'shape' && ES.selectedShapeEvts.size > 0) {
      doShapeSelectionDelete();
    }
    return;
  }

  // Space = Play/Pause
  if (key === ' ') {
    e.preventDefault();
    if (ES.activeTab === 'note') toggleEdPlay('n');
    else if (ES.activeTab === 'shape') toggleEdPlay('s');
    else if (ES.activeTab === 'play') playToggle();
    return;
  }

  if (key === 'escape') {
    e.preventDefault();
    if (PS.keyConfigMode !== null) { PS.keyConfigMode = null; renderKeyCfg(); return; }
    if (ES.activeTab === 'note') {
      cancelLN(); cancelTE(); ES.selectedNotes.clear(); drawN();
    } else if (ES.activeTab === 'shape') {
      cancelArc(); ES.selectedShapeEvts.clear(); drawS();
    }
    return;
  }

  // Common shortcuts (both Notes & Shapes)
  if (key === 'a') {
    if (ES.activeTab === 'note') setNT('sel');
    else if (ES.activeTab === 'shape') setST('sel');
    return;
  }
  if (key === 'd') {
    if (ES.activeTab === 'note') setNT('del');
    else if (ES.activeTab === 'shape') setST('del');
    return;
  }
  if (key === 'f') {
    if (ES.activeTab === 'note') toggleFollow();
    else if (ES.activeTab === 'shape') toggleSFollow();
    return;
  }
  if (key === 'g') {
    if (ES.activeTab === 'note') toggleGP('ngp');
    else if (ES.activeTab === 'shape') toggleGP('sgp');
    return;
  }

  // Zoom
  if (key === '=' || key === '+') {
    if (ES.activeTab === 'note') nZ(1);
    else if (ES.activeTab === 'shape') sZ(1);
    return;
  }
  if (key === '-') {
    if (ES.activeTab === 'note') nZ(-1);
    else if (ES.activeTab === 'shape') sZ(-1);
    return;
  }

  if (ES.activeTab === 'note') {
    if (key === 'q') { setNT('n'); return; }
    if (key === 'w') { setNT('ln'); return; }
    if (key === 'e') { setNT('w'); return; }
    if (key === 'r') { setNT('wl'); return; }
    if (key === 'u') { setNT('txt'); return; }
    return;
  }

  if (ES.activeTab === 'shape') {
    if (key === 'q') { setST('L'); return; }
    if (key === 'w') { setST('R'); return; }
    if (key === 'e') { setST('C'); return; }
    if (key === 'r') { setST('P'); return; }
    if (key === 't') { setST('line'); return; }
    if (key === 's') { toggleMirror(); return; }
    if (key === 'v') { cyclePosSnap(); return; }
    if (key === '1') { pickEase('Arc'); return; }
    if (key === '2') { pickEase('Out-Sine'); return; }
    if (key === '3') { pickEase('In-Sine'); return; }
    if (key === '4') { pickEase('Linear'); return; }
    return;
  }
});
