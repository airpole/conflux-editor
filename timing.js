// ============================================================
//  DOMAIN: TIMING — BPM, tick↔ms, time signatures
// ============================================================
// BPM segments and TS are cached via the generic cache.js abstraction.
// Mutators call invalidate(['tempo'|'timeSignatures']) — or the legacy
// compat wrappers compBPM/invalidateTSCache, which forward identically.

import { TPB } from './constants.js';
import { D } from './state.js';
import { defineCache, get, invalidate } from './cache.js';

// ---- BPM segments cache ----
// Rebuilt whenever D.tempo changes. Produces a sorted array of
// { st: tick, ms: cumulative ms at that tick, bpm, mpt: ms-per-tick }.
defineCache('bpmSegments', ['tempo'], () => {
  if (!D.tempo || D.tempo.length === 0) D.tempo = [{tick: 0, bpm: 120}];
  const segs = [];
  const s = [...D.tempo].sort((a, b) => a.tick - b.tick);
  let ms = 0;
  for (let i = 0; i < s.length; i++) {
    const e = s[i], mpt = 60000 / (e.bpm * TPB);
    if (i > 0) ms += (e.tick - s[i - 1].tick) * segs[i - 1].mpt;
    segs.push({st: e.tick, ms, bpm: e.bpm, mpt});
  }
  return segs;
});

// ---- Time signature cache ----
defineCache('timeSignaturesSorted', ['timeSignatures'], () =>
  [...D.timeSignatures].sort((a, b) => a.tick - b.tick)
);

/** Legacy compat: force bpmSegments rebuild by invalidating tempo dep. */
export function compBPM() { invalidate(['tempo']); }

/** Legacy compat: same for time signatures. */
export function invalidateTSCache() { invalidate(['timeSignatures']); }

export function getSortedTS() { return get('timeSignaturesSorted'); }

// ============================================================
//  BPM / TIMING
// ============================================================
export function t2ms(tk) {
  const bpmS = get('bpmSegments');
  let s = bpmS[0];
  for (let i = bpmS.length - 1; i >= 0; i--) if (tk >= bpmS[i].st) { s = bpmS[i]; break; }
  return s.ms + (tk - s.st) * s.mpt;
}

export function ms2t(ms) {
  const bpmS = get('bpmSegments');
  let s = bpmS[0];
  for (let i = bpmS.length - 1; i >= 0; i--) if (ms >= bpmS[i].ms) { s = bpmS[i]; break; }
  return s.st + (ms - s.ms) / s.mpt;
}

export function getBPMAt(tick) {
  let bpm = 120;
  for (const e of [...D.tempo].sort((a, b) => a.tick - b.tick)) {
    if (e.tick <= tick) bpm = e.bpm; else break;
  }
  return bpm;
}

// ============================================================
//  TIME SIGNATURE
// ============================================================
export function getTimeSig(tick) {
  const sorted = getSortedTS();
  let ts = {numerator:4, denominator:4};
  for (const e of sorted) { if (e.tick <= tick) ts = e; else break; }
  return ts;
}

/** Minimum renderable tick (one measure before zero, for pre-roll) */
export function getMinTick() {
  const ts = (D.timeSignatures && D.timeSignatures[0]) || {numerator: 4, denominator: 4};
  return -(TPB * ts.numerator);
}

/** Convert tick to measure.beat.subdivision notation string */
export function tickToMeasure(tick) {
  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];
  // Handle negative ticks (measure 0 and below)
  if (tick < 0) {
    const ts = sorted[0];
    const tpm = TPB * ts.numerator;
    const measureBack = Math.ceil(-tick / tpm);
    const measureStart = -measureBack * tpm;
    const relTick = tick - measureStart;
    const beat = Math.floor(relTick / TPB) + 1;
    const subTick = relTick % TPB;
    const measure = 1 - measureBack;
    if (subTick === 0 && beat === 1) return `${measure}`;
    if (subTick === 0) return `${measure}.${beat}`;
    const sub = Math.round(subTick / (TPB / 16));
    return `${measure}.${beat}.${sub}`;
  }
  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const bpm = ts.numerator;
    const tpm = TPB * bpm;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    if (tick < epochStart) break;
    if (tick >= epochEnd) { globalMeasure += Math.floor((epochEnd - epochStart) / tpm); continue; }
    const relTick = tick - epochStart;
    const measureInEpoch = Math.floor(relTick / tpm);
    const remainder = relTick - measureInEpoch * tpm;
    const beat = Math.floor(remainder / TPB) + 1;
    const subTick = remainder % TPB;
    const measure = globalMeasure + measureInEpoch;
    if (subTick === 0 && beat === 1) return `${measure}`;
    if (subTick === 0) return `${measure}.${beat}`;
    // Express sub-beat as subdivision
    const sub = Math.round(subTick / (TPB / 16));
    return `${measure}.${beat}.${sub}`;
  }
  // Fallback
  return `t${tick}`;
}

/** Parse measure.beat.sub notation string to tick. Returns null on failure. */
export function measureToTick(str) {
  str = str.trim();
  // If starts with 't', it's raw tick
  if (str.startsWith('t')) { const v = parseInt(str.slice(1)); return isNaN(v) ? null : v; }
  // Handle negative sign for measure 0 etc
  const neg = str.startsWith('-');
  if (neg) str = str.slice(1);
  const parts = str.split('.').map(Number);
  if (parts.some(isNaN)) return null;
  let measure = parts[0] || (neg ? 0 : 1);
  if (neg) measure = -measure;
  const beat = parts.length >= 2 ? parts[1] : 1;
  const sub = parts.length >= 3 ? parts[2] : 0;

  // Handle measure 0 and negative measures
  if (measure <= 0) {
    const sorted = getSortedTS();
    const ts = (sorted[0]) || {numerator: 4, denominator: 4};
    const tpm = TPB * ts.numerator;
    const tick = (measure - 1) * tpm + (beat - 1) * TPB + sub * (TPB / 16);
    return Math.round(tick);
  }

  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];

  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const bpm = ts.numerator;
    const tpm = TPB * bpm;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    const epochMeasures = epochEnd === Infinity ? Infinity : Math.floor((epochEnd - epochStart) / tpm);

    if (measure < globalMeasure + epochMeasures || epochEnd === Infinity) {
      const measureInEpoch = measure - globalMeasure;
      const tick = epochStart + measureInEpoch * tpm + (beat - 1) * TPB + sub * (TPB / 16);
      return Math.round(tick);
    }
    globalMeasure += epochMeasures;
  }
  return null;
}

export function getGridLines(startTk, endTk) {
  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];
  const lines = [];
  // Handle negative ticks (measure 0 region)
  if (startTk < 0) {
    const ts = sorted[0];
    const bpm = ts.numerator;
    const tpm = TPB * bpm;
    const negEnd = Math.min(0, endTk);
    const firstBeat = Math.floor(startTk / TPB) * TPB;
    for (let tk = firstBeat; tk < negEnd; tk += TPB) {
      if (tk < startTk) continue;
      const absTk = -tk;
      const measureBack = absTk > 0 ? Math.ceil(absTk / tpm) : 0;
      const measureStart = -measureBack * tpm;
      const relTick = tk - measureStart;
      const beatInMeasure = Math.floor(relTick / TPB) % bpm;
      const measure = 1 - measureBack;
      lines.push({tick: tk, isMeasure: beatInMeasure === 0, measureNum: measure, beatInMeasure: beatInMeasure + 1});
    }
  }
  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const bpm = ts.numerator;
    const tpm = TPB * bpm;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    if (epochStart >= endTk) break;
    if (epochEnd <= startTk) { globalMeasure += Math.floor((epochEnd - epochStart) / tpm); continue; }
    const relStart = Math.max(0, startTk - epochStart);
    const firstBeatOff = Math.floor(relStart / TPB) * TPB;
    for (let off = firstBeatOff; ; off += TPB) {
      const tk = epochStart + off;
      if (tk > endTk || tk >= epochEnd) break;
      if (tk < startTk) continue;
      const beatInEpoch = Math.floor(off / TPB);
      const measureInEpoch = Math.floor(beatInEpoch / bpm);
      const beatInMeasure = beatInEpoch % bpm;
      lines.push({tick: tk, isMeasure: beatInMeasure === 0, measureNum: globalMeasure + measureInEpoch, beatInMeasure: beatInMeasure + 1});
    }
    if (epochEnd !== Infinity) globalMeasure += Math.floor((epochEnd - epochStart) / tpm);
  }
  return lines;
}
