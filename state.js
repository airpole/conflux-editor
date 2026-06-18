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
//   2  = no 'Step' easing. duration=0 expresses instant jump. Shape events
//        used the field `isRight` (false = Blue chain, true = Red).
//   3  = current. Shape chain field renamed `isRight` → `isBlue` (inverted:
//        isBlue = !isRight). loadChartData migrates v≤2 events.

export const D = {
  schemaVersion: 3,
  metadata: {
    title: "Untitled", subtitle: "", artist: "", charter: "airpole",
    audioFile: "", offset: 0, difficulty: "Trace", level: 0,
    // Phase 7-2: Display-only offset added to measure numbers in UI labels.
    // Internal measure indexing is unchanged (tick 0 = internal measure 1);
    // this only shifts what the user sees on the canvas, in the tempo/TS
    // lists, and in the measure-input fields. Default 0 keeps legacy behavior.
    // Example: a chart whose first note sits at internal measure 4 can set
    // measureLabelOffset = -3 so the same tick reads as "1" — and the bars
    // before it read 0, -1, -2 (helpful for spotting 8/16-bar loops).
    measureLabelOffset: 0,
    // Phase 7-3: optional square jacket image, used as a blurred background
    // during Play. Stored as a data URL so it travels with the chart JSON.
    // Empty string = no jacket loaded; brightness 0..100 (5-step UI; 50% default)
    // controls how prominent the background appears (drawn alpha = brightness/100).
    jacketImage: "",
    jacketBrightness: 50
  },
  tempo: [{tick: 0, bpm: 120}],
  timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
  shapeEvents: [
    {startTick: 0, duration: 0, isBlue: true,  targetPos: 24, easing: null},
    {startTick: 0, duration: 0, isBlue: false, targetPos: 40, easing: null}
  ],
  lineEvents: [{startTick: 0, duration: 0, lines: [25, 25, 25, 25]}],
  notes: [],
  textEvents: []
};
