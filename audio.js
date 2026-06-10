// ============================================================
//  AUDIO — context, hitsound buffer, music playback, metronome
// ============================================================
import { $ } from './constants.js';
import { D } from './state.js';
import { ES } from './editor-state.js';
import { AS } from './audio-state.js';
import { PS } from './play-state.js';
import { toast } from './utility.js';
import { t2ms } from './timing.js';

export function initAud() {
  if (!AS.actx) AS.actx = new (window.AudioContext || window.webkitAudioContext)();
  if (AS.actx.state === 'suspended') AS.actx.resume();
  if (!AS.musicGain) {
    AS.musicGain = AS.actx.createGain();
    AS.musicGain.gain.value = 0.7;
    AS.musicGain.connect(AS.actx.destination);
  }
  if (!AS.hitGain) {
    AS.hitGain = AS.actx.createGain();
    AS.hitGain.gain.value = 1.0;
    const comp = AS.actx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    AS.hitGain.connect(comp);
    comp.connect(AS.actx.destination);
  }
  if (!AS.hitBuf) {
    const sr = AS.actx.sampleRate, len = Math.floor(sr * 0.025);
    AS.hitBuf = AS.actx.createBuffer(1, len, sr);
    const d = AS.hitBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 160);
      d[i] = env * (Math.sin(2 * Math.PI * 2400 * t) * 0.35
                  + Math.sin(2 * Math.PI * 4200 * t) * 0.15
                  + Math.sin(2 * Math.PI * 1200 * t) * 0.1) * 0.8;
    }
  }
}

export function playHit() {
  if (!AS.actx || !AS.hitBuf || ES.hitVol <= 0) return;
  const s = AS.actx.createBufferSource(); s.buffer = AS.hitBuf;
  const g = AS.actx.createGain(); g.gain.value = ES.hitVol * 1.5;
  s.connect(g); g.connect(AS.hitGain || AS.actx.destination); s.start();
}

/** Pre-scheduled hitsound: play at exact AudioContext time. */
export function playHitAt(when) {
  if (!AS.actx || !AS.hitBuf || ES.hitVol <= 0) return;
  const s = AS.actx.createBufferSource(); s.buffer = AS.hitBuf;
  const g = AS.actx.createGain(); g.gain.value = ES.hitVol * 1.5;
  s.connect(g); g.connect(AS.hitGain || AS.actx.destination);
  s.start(Math.max(AS.actx.currentTime, when));
}

export function setPlaybackRate(val) {
  const newRate = Math.max(0.5, Math.min(1.0, val / 100));
  // Capture both clocks ONCE up front so the audio and play-session
  // re-anchors describe the same instant. Reading performance.now() twice
  // (as before) let a few ms leak between the two anchors, drifting the
  // judgment clock from the audio clock on every rate change.
  const nowPerf = performance.now();
  const nowCtx = AS.actx ? AS.actx.currentTime : 0;
  const oldRate = AS.playbackRate;

  // Re-anchor audio timing if currently playing (convert elapsed at OLD rate).
  if (AS.asrc && AS.actx) {
    const elapsed = nowCtx - AS.audStartCtxTime;
    AS.audStartSec = AS.audStartSec + elapsed * oldRate;
    AS.audStartCtxTime = nowCtx;
    try { AS.asrc.playbackRate.value = newRate; } catch (e) {}
  }
  // Re-anchor play session timing against the SAME performance.now() reading.
  let curMs = null;
  if (PS.playActive) {
    curMs = PS.playOffMs + (nowPerf - PS.playT0) * oldRate;
    PS.playOffMs = curMs;
    PS.playT0 = nowPerf;
  }
  AS.playbackRate = newRate;
  $('rateLbl').textContent = AS.playbackRate.toFixed(2) + 'x';

  // Hitsounds pre-scheduled under the old rate now point at the wrong audio
  // time. Rebind the scheduler from the current position so the next frame
  // re-queues the lookahead window against the new rate. (Only relevant in an
  // active autoplay session; manual play emits hits on key press, not ahead.)
  if (PS.playActive && curMs !== null) {
    import('./scheduler.js').then(m => m.resetHitScheduler(curMs)).catch(() => {});
  }
}

export function playMetronome(isDownbeat) {
  if (!AS.isMetronomeOn || !AS.actx) return;
  const osc = AS.actx.createOscillator();
  const gain = AS.actx.createGain();
  osc.connect(gain); gain.connect(AS.actx.destination);
  osc.frequency.value = isDownbeat ? 1000 : 600;
  gain.gain.setValueAtTime(0.4, AS.actx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, AS.actx.currentTime + 0.08);
  osc.start(); osc.stop(AS.actx.currentTime + 0.08);
}

export function toggleMetronome() {
  AS.isMetronomeOn = !AS.isMetronomeOn;
  $('metroBtn').style.background = AS.isMetronomeOn ? 'var(--green)' : '';
  $('metroBtn').style.color = AS.isMetronomeOn ? '#000' : '';
  if (AS.isMetronomeOn) initAud();
  toast(AS.isMetronomeOn ? 'Metronome ON' : 'Metronome OFF');
}

// ============================================================
//  AUDIO SOURCE LIFECYCLE
// ============================================================
export function startAud(fromMs) {
  initAud();
  if (AS.asrc) try { AS.asrc.stop(); } catch (e) {}
  if (!AS.abuf) return;
  AS.asrc = AS.actx.createBufferSource(); AS.asrc.buffer = AS.abuf;
  AS.asrc.playbackRate.value = AS.playbackRate;
  AS.asrc.connect(AS.musicGain || AS.actx.destination);
  const startSec = Math.max(0, fromMs / 1000);
  AS.asrc.start(0, startSec);
  AS.audStartCtxTime = AS.actx.currentTime;
  AS.audStartSec = startSec;
  AS.aOff = AS.actx.currentTime - startSec; // legacy compat
}

export function stopAud() {
  if (AS.asrc) try { AS.asrc.stop(); } catch (e) {}
  AS.asrc = null;
}

// ============================================================
//  AUDIO FILE LOAD (waveform peak extraction)
// ============================================================
export function loadAud(inp) {
  const f = inp.files[0]; if (!f) return;
  initAud();
  const r = new FileReader();
  r.onload = async () => {
    try {
      // 모바일 브라우저(특히 Samsung Internet)에서 신규 AudioContext가
      // 'suspended' 상태일 때 decodeAudioData가 silently fail하는 케이스가
      // 있다. 여기서 명시적 대기.
      if (AS.actx.state === 'suspended') {
        try { await AS.actx.resume(); } catch (e) {}
      }
      const b = await AS.actx.decodeAudioData(r.result);
      AS.abuf = b;
      ES.audioMs = b.duration * 1000;
      // Lazy import — load-chart.js owns updateTotalMs.
      const { updateTotalMs } = await import('./load-chart.js');
      updateTotalMs();
      $('audS').textContent = `${f.name} (${b.duration.toFixed(1)}s)`;
      const ch0 = b.getChannelData(0);
      const ch1 = b.numberOfChannels > 1 ? b.getChannelData(1) : ch0;
      const factor = Math.max(1, Math.floor(b.sampleRate / 8000));
      const len = Math.floor(ch0.length / factor);
      AS.waveData = new Float32Array(len);
      AS.waveSR = b.sampleRate / factor;
      for (let i = 0; i < len; i++) {
        const si = i * factor;
        let peak = 0;
        for (let j = 0; j < factor && si + j < ch0.length; j++) {
          peak = Math.max(peak, Math.abs((ch0[si + j] + ch1[si + j]) * 0.5));
        }
        AS.waveData[i] = peak;
      }
      const { drawN } = await import('./notes-render.js');
      drawN();
      toast('Loaded: ' + f.name);
    } catch (err) {
      toast('Audio load failed: ' + (err && err.message ? err.message : err));
    }
  };
  r.onerror = () => toast('File read failed');
  r.readAsArrayBuffer(f);
  inp.value = '';
}

// ============================================================
//  TIME-BASE — chart ms during editor playback
// ============================================================
/** Returns current CHART ms during editor playback (not audio ms). */
export function getPlayMs(w) {
  if (!ES.edPlay[w]) return ES.edMs0[w];
  if (AS.actx && AS.asrc && AS.abuf) {
    const audioSec = AS.audStartSec + (AS.actx.currentTime - AS.audStartCtxTime) * AS.playbackRate;
    const audioMs = audioSec * 1000;
    return Math.max(0, audioMs - D.metadata.offset);
  }
  return ES.edMs0[w] + (performance.now() - ES.edT0[w]) * AS.playbackRate;
}

// ============================================================
//  OFFSET MANAGEMENT
// ============================================================
/** Sets chart offset so that the current scroll position aligns with audio. */
export function setOffsetHere() {
  const curTk = ES.nScr;
  const chartMs = t2ms(curTk);
  const newOff = Math.round(chartMs);
  D.metadata.offset = newOff;
  $('syncOff').value = newOff;
  $('mOff').value = newOff;
  toast('Offset set: ' + newOff + 'ms');
}
