// ============================================================
//  AUDIO-STATE — mutable audio state (single shared object)
// ============================================================
// AudioContext, buffers, source, gain nodes, waveform peak data, hit
// buffer, metronome flag, playback rate, and the audio-time anchors used
// for getPlayMs() time-base reconstruction.
//
// Migration map (v20 main.js → v21 AS.):
//   actx/abuf/asrc/aOff → AS.*
//   waveData/waveSR → AS.*
//   musicGain/hitGain → AS.*
//   hitBuf → AS.hitBuf
//   isMetronomeOn → AS.isMetronomeOn
//   playbackRate → AS.playbackRate
//   _audStartCtxTime / _audStartSec → AS.audStartCtxTime / audStartSec

export const AS = {
  actx: null,
  abuf: null,
  asrc: null,
  aOff: 0,

  waveData: null,
  waveSR: 44100,

  musicGain: null,
  hitGain: null,

  hitBuf: null,
  isMetronomeOn: false,
  playbackRate: 1.0,

  audStartCtxTime: 0,
  audStartSec: 0,
};
