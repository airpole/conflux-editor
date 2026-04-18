// ============================================================
//  CORE STATE — the chart data tree
// ============================================================
// The single source of truth for chart content. Never reassigned;
// only its fields are mutated (D.notes.push(...), D.tempo = [...], etc).
// ES module live bindings make `D.foo = bar` visible across all importers.

export const D = {
  metadata: {
    title: "Untitled", subtitle: "", artist: "airpole", charter: "airpole",
    audioFile: "", offset: 0, difficulty: "Trace", level: 0
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
