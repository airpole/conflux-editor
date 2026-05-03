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
  if (d.timeSignatures) D.timeSignatures = d.timeSignatures;
  if (!D.timeSignatures || D.timeSignatures.length === 0) {
    D.timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];
  }
  if (d.shapeEvents) {
    D.shapeEvents = d.shapeEvents;
    // Phase 3-2: 'Step' → 'Linear' migration (duration=0 keeps instant-jump).
    D.shapeEvents.forEach(e => {
      if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear';
      if (e.easing === 'Step') e.easing = 'Linear';
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
  D.schemaVersion = 2;
  PS.playHitMap.clear(); PS.playMissSet.clear(); PS.playEffects = [];
  PS.playJudgQueue = []; PS.playCombo = 0; PS.playMaxCombo = 0;
  invalidateNoteOverlaps();
  invalidateTSCache();
  compBPM(); updateTotalMs();
  _hydrateJacketFromMeta();
}
