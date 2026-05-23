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
  // ticksPerMeasure: TPB is a quarter-note's tick count. With denominator d,
  // one beat = TPB × 4 / d ticks; one measure = numerator × beats.
  return -(TPB * 4 * ts.numerator / ts.denominator);
}

/** Convert tick to measure.beat.subdivision notation string */
export function tickToMeasure(tick) {
  // Phase 7-2: display-only offset. Added to the internal measure number on
  // every output path; measureToTick subtracts it on input. Both sides being
  // pure shifts keeps the tick⇄string round-trip identity-preserving.
  const labelOff = (D.metadata && D.metadata.measureLabelOffset) || 0;
  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];
  // Handle negative ticks (measure 0 and below)
  if (tick < 0) {
    const ts = sorted[0];
    // tpb_unit: ticks per one beat at this denominator. TPB is for 1/4 notes;
    // a 1/8-note beat is TPB/2 ticks, a 1/2-note beat is TPB*2 ticks.
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const measureBack = Math.ceil(-tick / tpm);
    const measureStart = -measureBack * tpm;
    const relTick = tick - measureStart;
    const beat = Math.floor(relTick / tpbUnit) + 1;
    const subTick = relTick % tpbUnit;
    const measure = (1 - measureBack) + labelOff;
    if (subTick === 0 && beat === 1) return `${measure}`;
    if (subTick === 0) return `${measure}.${beat}`;
    // Sub-beat resolution: 16 subdivisions per beat regardless of denominator,
    // so .b.sub still reads naturally — sub=8 is "halfway through a beat".
    const sub = Math.round(subTick / (tpbUnit / 16));
    return `${measure}.${beat}.${sub}`;
  }
  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    if (tick < epochStart) break;
    if (tick >= epochEnd) { globalMeasure += Math.floor((epochEnd - epochStart) / tpm); continue; }
    const relTick = tick - epochStart;
    const measureInEpoch = Math.floor(relTick / tpm);
    const remainder = relTick - measureInEpoch * tpm;
    const beat = Math.floor(remainder / tpbUnit) + 1;
    const subTick = remainder % tpbUnit;
    const measure = (globalMeasure + measureInEpoch) + labelOff;
    if (subTick === 0 && beat === 1) return `${measure}`;
    if (subTick === 0) return `${measure}.${beat}`;
    // Express sub-beat as subdivision
    const sub = Math.round(subTick / (tpbUnit / 16));
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
  // Phase 7-2: input is in DISPLAYED measure units (what the user sees in the
  // tempo/TS list and the canvas grid). Convert back to internal by undoing
  // the offset that tickToMeasure added.
  const labelOff = (D.metadata && D.metadata.measureLabelOffset) || 0;
  measure = measure - labelOff;
  const beat = parts.length >= 2 ? parts[1] : 1;
  const sub = parts.length >= 3 ? parts[2] : 0;

  // Handle measure 0 and negative measures
  if (measure <= 0) {
    const sorted = getSortedTS();
    const ts = (sorted[0]) || {numerator: 4, denominator: 4};
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const tick = (measure - 1) * tpm + (beat - 1) * tpbUnit + sub * (tpbUnit / 16);
    return Math.round(tick);
  }

  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];

  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    const epochMeasures = epochEnd === Infinity ? Infinity : Math.floor((epochEnd - epochStart) / tpm);

    if (measure < globalMeasure + epochMeasures || epochEnd === Infinity) {
      const measureInEpoch = measure - globalMeasure;
      const tick = epochStart + measureInEpoch * tpm + (beat - 1) * tpbUnit + sub * (tpbUnit / 16);
      return Math.round(tick);
    }
    globalMeasure += epochMeasures;
  }
  return null;
}

export function getGridLines(startTk, endTk) {
  // Phase 7-2: offset is added to measureNum on each line entry. drawN/drawS
  // read measureNum directly to label measures, so they pick up the shift
  // automatically. The "below tick 0" styling (purple, "m" prefix) was
  // previously inferred from `measureNum <= 0`; that conflates display value
  // with location, so we now expose `isPreRoll` (tick < 0) and let callers
  // make the distinction explicitly.
  const labelOff = (D.metadata && D.metadata.measureLabelOffset) || 0;
  let sorted = getSortedTS();
  if (!sorted.length) sorted = [{tick:0, numerator:4, denominator:4}];
  const lines = [];
  // Handle negative ticks (measure 0 region)
  if (startTk < 0) {
    const ts = sorted[0];
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const negEnd = Math.min(0, endTk);
    // Walk beat-by-beat: each beat is one grid line. Round down startTk to
    // the nearest beat unit (was TPB; now tpbUnit so 8th-note signatures
    // emit gridlines on the 8th-note grid rather than the 1/4-note grid).
    const firstBeat = Math.floor(startTk / tpbUnit) * tpbUnit;
    for (let tk = firstBeat; tk < negEnd; tk += tpbUnit) {
      if (tk < startTk) continue;
      const absTk = -tk;
      const measureBack = absTk > 0 ? Math.ceil(absTk / tpm) : 0;
      const measureStart = -measureBack * tpm;
      const relTick = tk - measureStart;
      const beatInMeasure = Math.floor(relTick / tpbUnit) % ts.numerator;
      const measure = (1 - measureBack) + labelOff;
      lines.push({tick: tk, isMeasure: beatInMeasure === 0, measureNum: measure, beatInMeasure: beatInMeasure + 1, isPreRoll: true});
    }
  }
  let globalMeasure = 1;
  for (let si = 0; si < sorted.length; si++) {
    const ts = sorted[si];
    const tpbUnit = TPB * 4 / ts.denominator;
    const tpm = tpbUnit * ts.numerator;
    const epochStart = ts.tick;
    const epochEnd = (si < sorted.length - 1) ? sorted[si + 1].tick : Infinity;
    if (epochStart >= endTk) break;
    if (epochEnd <= startTk) { globalMeasure += Math.floor((epochEnd - epochStart) / tpm); continue; }
    const relStart = Math.max(0, startTk - epochStart);
    const firstBeatOff = Math.floor(relStart / tpbUnit) * tpbUnit;
    for (let off = firstBeatOff; ; off += tpbUnit) {
      const tk = epochStart + off;
      if (tk > endTk || tk >= epochEnd) break;
      if (tk < startTk) continue;
      const beatInEpoch = Math.floor(off / tpbUnit);
      const measureInEpoch = Math.floor(beatInEpoch / ts.numerator);
      const beatInMeasure = beatInEpoch % ts.numerator;
      const measure = (globalMeasure + measureInEpoch) + labelOff;
      lines.push({tick: tk, isMeasure: beatInMeasure === 0, measureNum: measure, beatInMeasure: beatInMeasure + 1, isPreRoll: false});
    }
    if (epochEnd !== Infinity) globalMeasure += Math.floor((epochEnd - epochStart) / tpm);
  }
  return lines;
}
