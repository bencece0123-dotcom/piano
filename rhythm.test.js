"use strict";

const assert = require("node:assert/strict");
const rhythm = require("./rhythm.js");

function slugs(startBeat, durationBeats, timeSignature) {
  return rhythm.splitRestDuration(startBeat, durationBeats, timeSignature)
    .map((segment) => segment.spec.slug);
}

function starts(startBeat, durationBeats, timeSignature) {
  return rhythm.splitRestDuration(startBeat, durationBeats, timeSignature)
    .map((segment) => segment.startBeat);
}

assert.deepEqual(slugs(0, 4, "4/4"), ["measure"], "an empty 4/4 bar uses one measure rest");
assert.deepEqual(slugs(0, 3, "4/4"), ["half", "quarter"], "4/4 keeps the half-bar visible");
assert.deepEqual(slugs(1, 3, "4/4"), ["quarter", "half"], "a rest may not cross the 4/4 half-bar");
assert.deepEqual(slugs(1, 2, "4/4"), ["quarter", "quarter"], "a half rest may not straddle beat three");
assert.deepEqual(
  slugs(0.25, 1.5, "4/4"),
  ["dotted-eighth", "dotted-eighth"],
  "sub-beat rests remain separated at the beat boundary"
);
assert.deepEqual(starts(0.25, 1.5, "4/4"), [0.25, 1], "the second sub-beat rest starts on beat two");
assert.deepEqual(
  slugs(0.125, 0.875, "4/4"),
  ["thirty-second", "dotted-eighth"],
  "an off-grid rest exposes the internal subdivision before the longer value"
);
assert.deepEqual(slugs(0, 1.5, "6/8"), ["dotted-quarter"], "6/8 uses one dotted-quarter beat rest");
assert.deepEqual(slugs(0.5, 1, "6/8"), ["quarter"], "the last two eighths of a compound beat combine");
assert.deepEqual(slugs(0, 3, "12/8"), ["dotted-half"], "12/8 may combine two dotted beats within a half-bar");
assert.deepEqual(
  slugs(0, 3, "9/8"),
  ["dotted-quarter", "dotted-quarter"],
  "9/8 keeps its three dotted-quarter beats visible"
);
assert.deepEqual(slugs(0, 1.5, "5/8"), ["quarter", "eighth"], "5/8 preserves its 2+3 grouping");
assert.deepEqual(slugs(0, 4, "7/4"), ["half", "half"], "7/4 preserves its 2+2+3 grouping");

console.log("13 meter-aware rest notation tests passed.");
