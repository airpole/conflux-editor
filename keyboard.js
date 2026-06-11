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
import { playToggle, playRestart, stopPlay } from './play.js';
import { setGauge, setLockTarget, setLockMode, toggleFastSlow } from './play-options.js';
import { drawN } from './notes-render.js';
import { drawS } from './shape-render.js';

document.addEventListener('keyup', (e) => {
  if (PS.playActive) handlePlayKeyUp(e.code);
});

// Stuck-key guard: alt-tab / OS overlays can swallow keyup events, leaving
// channels stuck in playKeyHeld (which then ignores the next keydown).
// Synthesize a proper release for every held key so holds resolve through
// the normal grace/transfer/mid-release path instead of dangling.
window.addEventListener('blur', () => {
  if (!PS.playActive) return;
  for (const ch of [...PS.playKeyHeld]) {
    const code = PS.keyBindings[ch];
    if (code) handlePlayKeyUp(code);
  }
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

  // Space = Play/Pause. On the Play tab this starts from the CURRENT position
  // (with a silent 3s shape lead-in); Enter below restarts from the beginning.
  if (key === ' ') {
    e.preventDefault();
    if (ES.activeTab === 'note') toggleEdPlay('n');
    else if (ES.activeTab === 'shape') toggleEdPlay('s');
    else if (ES.activeTab === 'play') playToggle();
    return;
  }

  // Play tab shortcuts (idle only — during a session every key is game input).
  if (ES.activeTab === 'play') {
    if (e.key === 'Enter') {            // Enter = restart from the beginning
      e.preventDefault();
      playRestart();
      return;
    }
    if (key === 'g') {                  // G = gauge Normal ↔ Hard
      setGauge(PS.gaugeType === 'normal' ? 'hard' : 'normal');
      toast(`게이지: ${PS.gaugeType === 'hard' ? 'Hard' : 'Normal'}`);
      return;
    }
    if (key === 'l') {                  // L = lock target None→FC→AP→AS
      const cyc = ['none', 'fc', 'ap', 'as'];
      const next = cyc[(cyc.indexOf(PS.lockTarget) + 1) % cyc.length];
      setLockTarget(next);
      toast(`잠금 목표: ${next.toUpperCase()}`);
      return;
    }
    if (key === 'm') {                  // M = lock mode Term ↔ Casc
      setLockMode(PS.lockMode === 'terminate' ? 'cascade' : 'terminate');
      toast(`잠금 모드: ${PS.lockMode === 'cascade' ? 'Cascade' : 'Terminate'}`);
      return;
    }
    if (key === 'f') {                  // F = Fast/Slow display toggle
      toggleFastSlow();
      toast(`Fast/Slow 표시: ${PS.showFastSlow ? 'ON' : 'OFF'}`);
      return;
    }
    if (key === 'a') {                  // A = autoplay toggle
      const chk = document.getElementById('playAutoChk');
      if (chk && !chk.disabled) {
        chk.checked = !chk.checked;
        PS.playAutoplay = chk.checked;
        toast(`오토플레이: ${chk.checked ? 'ON' : 'OFF'}`);
      }
      return;
    }
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
