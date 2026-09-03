(function attachMelodyRhythm(root, factory) {
  const rhythm = factory();
  if (typeof module === "object" && module.exports) module.exports = rhythm;
  if (root) root.MelodyRhythm = rhythm;
})(typeof window !== "undefined" ? window : globalThis, function createMelodyRhythm() {
  "use strict";

  const STRAIGHT_STEP = 0.125;
  const TIMING_TOLERANCE = 0.16;
  const TUPLET_PATTERNS = [
    { count: 7, notesOccupied: 4, baseSlug: "sixteenth", baseDuration: 0.25 },
    { count: 6, notesOccupied: 4, baseSlug: "sixteenth", baseDuration: 0.25 },
    { count: 5, notesOccupied: 4, baseSlug: "sixteenth", baseDuration: 0.25 },
    { count: 3, notesOccupied: 2, baseSlug: "eighth", baseDuration: 0.5 }
  ];
  const REST_VALUES = [
    { beats: 4, name: "whole note", slug: "whole", dotted: false },
    { beats: 3, name: "dotted half note", slug: "dotted-half", dotted: true },
    { beats: 2, name: "half note", slug: "half", dotted: false },
    { beats: 1.5, name: "dotted quarter note", slug: "dotted-quarter", dotted: true },
    { beats: 1, name: "quarter note", slug: "quarter", dotted: false },
    { beats: 0.75, name: "dotted eighth note", slug: "dotted-eighth", dotted: true },
    { beats: 0.5, name: "eighth note", slug: "eighth", dotted: false },
    { beats: 0.375, name: "dotted sixteenth note", slug: "dotted-sixteenth", dotted: true },
    { beats: 0.25, name: "sixteenth note", slug: "sixteenth", dotted: false },
    { beats: 0.125, name: "thirty-second note", slug: "thirty-second", dotted: false }
  ];

  function cleanBeat(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  function quantizeStraight(value, step = STRAIGHT_STEP) {
    return cleanBeat(Math.round(value / step) * step);
  }

  function eighthNoteGroups(numerator) {
    if (numerator % 3 === 0) return Array.from({ length: numerator / 3 }, () => 1.5);
    if (numerator === 5) return [1, 1.5];
    if (numerator === 7) return [1, 1, 1.5];
    if (numerator === 8) return [2, 2];
    return [numerator / 2];
  }

  function restValueFits(spec, positionInMeasure, capacity, numerator, denominator) {
    if (positionInMeasure + spec.beats > capacity + 0.001) return false;
    if (denominator !== 8) return true;

    const groups = eighthNoteGroups(numerator);
    let groupEnd = 0;
    for (const groupLength of groups) {
      groupEnd += groupLength;
      if (positionInMeasure < groupEnd - 0.001) break;
    }
    return positionInMeasure + spec.beats <= groupEnd + 0.001;
  }

  function splitRestDuration(startBeat, durationBeats, timeSignature = "4/4") {
    const [numerator, denominator] = String(timeSignature).split("/").map(Number);
    const safeNumerator = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
    const safeDenominator = Number.isFinite(denominator) && denominator > 0 ? denominator : 4;
    const capacity = safeNumerator * (4 / safeDenominator);
    const segments = [];
    let cursor = cleanBeat(startBeat);
    let remaining = Math.max(0, quantizeStraight(durationBeats));

    while (remaining > 0.001) {
      const positionInMeasure = cleanBeat(((cursor % capacity) + capacity) % capacity);
      if (positionInMeasure < 0.001 && remaining >= capacity - 0.001) {
        segments.push({
          startBeat: cursor,
          spec: { beats: capacity, name: "whole-measure", slug: "measure", dotted: false, fullMeasure: true }
        });
        cursor = quantizeStraight(cursor + capacity);
        remaining = quantizeStraight(remaining - capacity);
        continue;
      }

      const toBarline = positionInMeasure < 0.001 ? capacity : capacity - positionInMeasure;
      const available = Math.min(remaining, toBarline);
      const spec = REST_VALUES.find((candidate) => (
        candidate.beats <= available + 0.001
        && restValueFits(candidate, positionInMeasure, capacity, safeNumerator, safeDenominator)
      )) || REST_VALUES.at(-1);
      segments.push({ startBeat: cursor, spec: { ...spec } });
      cursor = quantizeStraight(cursor + spec.beats);
      remaining = quantizeStraight(remaining - spec.beats);
    }
    return segments;
  }

  function matchesTuplet(groups, beatStart, pattern) {
    if (groups.length !== pattern.count) return false;
    const expectedStep = 1 / pattern.count;
    const errors = groups.map((group, index) => (
      Math.abs(group.rawStartBeat - (beatStart + index * expectedStep))
    ));
    const intervals = groups.slice(1).map((group, index) => group.rawStartBeat - groups[index].rawStartBeat);
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const intervalSpread = Math.max(...intervals.map((interval) => Math.abs(interval - averageInterval)));
    return Math.abs(groups[0].rawStartBeat - beatStart) <= 0.12
      && Math.max(...errors) <= TIMING_TOLERANCE
      && Math.abs(averageInterval - expectedStep) < 0.045
      && intervalSpread <= 0.08;
  }

  function recognizeOnsets(onsets) {
    const ordered = onsets
      .filter((onset) => onset && typeof onset.id === "string" && Number.isFinite(onset.rawStartBeat))
      .map((onset) => ({ ...onset }))
      .sort((a, b) => a.rawStartBeat - b.rawStartBeat);
    const results = new Map();
    let previousBeat = -Infinity;

    ordered.forEach((onset) => {
      let startBeat = quantizeStraight(onset.rawStartBeat);
      if (startBeat <= previousBeat + 0.000001) startBeat = cleanBeat(previousBeat + STRAIGHT_STEP);
      previousBeat = startBeat;
      results.set(onset.id, { id: onset.id, startBeat, tuplet: null });
    });

    const claimed = new Set();
    for (let startIndex = 0; startIndex < ordered.length; startIndex += 1) {
      const first = ordered[startIndex];
      if (claimed.has(first.id)) continue;
      const beatStart = Math.round(first.rawStartBeat);
      const pattern = TUPLET_PATTERNS.find((candidate) => {
        const candidateGroups = ordered.slice(startIndex, startIndex + candidate.count);
        return candidateGroups.length === candidate.count
          && candidateGroups.every((group) => !claimed.has(group.id))
          && matchesTuplet(candidateGroups, beatStart, candidate);
      });
      if (!pattern) continue;
      const groups = ordered.slice(startIndex, startIndex + pattern.count);
      const unitBeats = cleanBeat(1 / pattern.count);
      const tupletId = `tuplet-${beatStart}-${pattern.count}-${groups[0].id}`;
      groups.forEach((group, index) => {
        claimed.add(group.id);
        results.set(group.id, {
          id: group.id,
          startBeat: cleanBeat(beatStart + index / pattern.count),
          tuplet: {
            id: tupletId,
            index,
            count: pattern.count,
            notesOccupied: pattern.notesOccupied,
            baseSlug: pattern.baseSlug,
            baseDuration: pattern.baseDuration,
            unitBeats
          }
        });
      });
    }

    return [...results.values()].sort((a, b) => a.startBeat - b.startBeat);
  }

  return {
    STRAIGHT_STEP,
    TUPLET_PATTERNS,
    REST_VALUES,
    cleanBeat,
    quantizeStraight,
    splitRestDuration,
    recognizeOnsets
  };
});
