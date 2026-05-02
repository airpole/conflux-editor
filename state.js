// ============================================================
//  CORE STATE — the chart data tree
// ============================================================
// The single source of truth for chart content. Never reassigned;
// only its fields are mutated (D.notes.push(...), D.tempo = [...], etc).
// ES module live bindings make `D.foo = bar` visible across all importers.
//
// schemaVersion:
//   1  (or absent) = pre-Phase 3-2 format. May contain easing: 'Step'.
//                    loadChartData migrates these to easing: 'Linear'.
//   2  = current.   No 'Step' easing. duration=0 expresses instant jump.

export const D = {
  schemaVersion: 2,
  metadata: {
    title: "Untitled", subtitle: "", artist: "airpole", charter: "airpole",
    audioFile: "", offset: 0, difficulty: "Trace", level: 0,
    // Phase 7-2: Display-only offset added to measure numbers in UI labels.
    // Internal measure indexing is unchanged (tick 0 = internal measure 1);
    // this only shifts what the user sees on the canvas, in the tempo/TS
    // lists, and in the measure-input fields. Default 0 keeps legacy behavior.
    // Example: a chart whose first note sits at internal measure 4 can set
    // measureLabelOffset = -3 so the same tick reads as "1" — and the bars
    // before it read 0, -1, -2 (helpful for spotting 8/16-bar loops).
    measureLabelOffset: 0
  },
  tempo: [{tick: 0, bpm: 120}],
  timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
  shapeEvents: [
    {startTick: 0, duration: 0, isRight: false, targetPos: 24, easing: null},
    {startTick: 0, duration: 0, isRight: true,  targetPos: 40, easing: null}
  ],
  lineEvents: [{startTick: 0, duration: 0, lines: [25, 25, 25, 25]}],
  notes: [],
  textEvents: []
};
