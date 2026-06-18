// ============================================================
//  LOAD-CHART — chart-data load/migrate + total-ms helpers
// ============================================================
import { D } from './state.js';
import { ES } from './editor-state.js';
import { PS } from './play-state.js';
import { compBPM } from './timing.js';
import { invalidateShapeCache, invalidateLinesCache } from './shape.js';
import { invalidateNoteOverlaps } from './overlaps.js';
import { invalidateTSCache } from './timing.js';
import { t2ms } from './timing.js';
import { _hydrateJacketFromMeta } from './jacket.js';

/** Effective chart end (last note/text/shape event end + 2s tail). */
export function getChartEndMs() {
  let maxTk = 0;
  for (const n of D.notes) { const e = n.startTick + (n.duration || 0); if (e > maxTk) maxTk = e; }
  for (const te of D.textEvents) { const e = te.startTick + (te.duration || 0); if (e > maxTk) maxTk = e; }
  for (const se of D.shapeEvents) { const e = se.startTick + (se.duration || 0); if (e > maxTk) maxTk = e; }
  return maxTk > 0 ? t2ms(maxTk) + 2000 : 0;
}

/** Update ES.totalMs = max of audio and chart, with 5s minimum. */
export function updateTotalMs() {
  ES.totalMs = Math.max(ES.audioMs || 0, getChartEndMs(), 5000);
}

/** Load chart data from a parsed JSON object into the global state D. */
export function loadChartData(d) {
  if (d.metadata) {
    D.metadata = {...D.metadata, ...d.metadata};
    if (d.metadata.chart && !d.metadata.charter) D.metadata.charter = d.metadata.chart;
    // Phase 7-2: defensive normalization for measureLabelOffset.
    D.metadata.measureLabelOffset =
      (typeof d.metadata.measureLabelOffset === 'number') ? d.metadata.measureLabelOffset : 0;
    // Phase 7-3: same for jacket.
    D.metadata.jacketImage =
      (typeof d.metadata.jacketImage === 'string') ? d.metadata.jacketImage : '';
    D.metadata.jacketBrightness =
      (typeof d.metadata.jacketBrightness === 'number') ? d.metadata.jacketBrightness : 50;
  } else {
    D.metadata.jacketImage = '';
    D.metadata.jacketBrightness = 50;
  }
  if (d.tempo) D.tempo = d.tempo;
  if (!D.tempo || D.tempo.length === 0) D.tempo = [{tick: 0, bpm: 120}];
  // Sanitize tempo: a non-positive / non-finite BPM makes ms-per-tick
  // Infinity or NaN, which poisons every t2ms() call and breaks the whole
  // chart. Drop bad entries and clamp ticks; guarantee a tick-0 anchor.
  D.tempo = D.tempo
    .filter(e => e && Number.isFinite(e.bpm) && e.bpm > 0)
    .map(e => ({ tick: Math.max(0, Math.floor(Number(e.tick) || 0)), bpm: e.bpm }));
  if (D.tempo.length === 0) D.tempo = [{tick: 0, bpm: 120}];
  if (!D.tempo.some(e => e.tick === 0)) D.tempo.unshift({tick: 0, bpm: 120});

  if (d.timeSignatures) D.timeSignatures = d.timeSignatures;
  if (!D.timeSignatures || D.timeSignatures.length === 0) {
    D.timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];
  }
  // Sanitize time signatures: numerator/denominator must be positive integers
  // (denominator 0 would divide-by-zero in measure math). Keep a tick-0 anchor.
  D.timeSignatures = D.timeSignatures
    .filter(e => e && Number.isFinite(e.numerator) && e.numerator > 0
                   && Number.isFinite(e.denominator) && e.denominator > 0)
    .map(e => ({
      tick: Math.max(0, Math.floor(Number(e.tick) || 0)),
      numerator: Math.floor(e.numerator),
      denominator: Math.floor(e.denominator),
    }));
  if (D.timeSignatures.length === 0) {
    D.timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];
  }
  if (!D.timeSignatures.some(e => e.tick === 0)) {
    D.timeSignatures.unshift({tick: 0, numerator: 4, denominator: 4});
  }
  if (d.shapeEvents) {
    D.shapeEvents = d.shapeEvents;
    // Phase 3-2: 'Step' → 'Linear' migration (duration=0 keeps instant-jump).
    // Schema v3: rename isRight → isBlue (inverted; isBlue = !isRight). Events
    // from v≤2 carry isRight; convert and drop the old field. New-format events
    // already have isBlue and are left untouched.
    D.shapeEvents.forEach(e => {
      if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear';
      if (e.easing === 'Step') e.easing = 'Linear';
      if (e.isBlue === undefined && e.isRight !== undefined) e.isBlue = !e.isRight;
      delete e.isRight;
    });
    invalidateShapeCache();
  }
  if (d.lineEvents) { D.lineEvents = d.lineEvents; invalidateLinesCache(); }
  if (d.notes) {
    D.notes = d.notes;
    // Migrate old 6-channel format → new 4-channel format
    const OLD_TO_NEW = {1:1, 2:2, 3:3, 4:2, 5:3, 6:4};
    const hasOldChannels = D.notes.some(n => !n.isWide && n.channel > 4);
    D.notes.forEach(n => {
      if (n.isWide) n.channel = 0;
      else if (hasOldChannels && OLD_TO_NEW[n.channel]) n.channel = OLD_TO_NEW[n.channel];
    });
  }
  D.textEvents = d.textEvents || [];
  D.schemaVersion = 3;
  PS.playHitMap.clear(); PS.playMissSet.clear(); PS.playEffects = [];
  PS.playJudgQueue = []; PS.playCombo = 0; PS.playMaxCombo = 0;
  invalidateNoteOverlaps();
  invalidateTSCache();
  compBPM(); updateTotalMs();
  _hydrateJacketFromMeta();
}
