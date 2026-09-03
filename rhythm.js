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

  const EPSILON = 0.001;

  function repeated(value, count) {
    return Array.from({ length: count }, () => value);
  }

  function meterRestProfile(numerator, denominator) {
    const signature = `${numerator}/${denominator}`;
    const capacity = numerator * (4 / denominator);
    const profiles = {
      // The half-bar is a significant boundary in simple quadruple time.
      "4/4": { majorGroups: [2, 2], pulses: repeated(1, 4), simple: true },
      "2/2": { majorGroups: [2, 2], pulses: [2, 2], simple: true },
      // Simple triple time keeps all three beats visible.
      "3/4": { majorGroups: [1, 1, 1], pulses: repeated(1, 3), simple: true },
      "2/4": { majorGroups: [1, 1], pulses: [1, 1], simple: true },
      // Compound meters are read in dotted-quarter pulses. In 12/8, two
      // adjacent pulses may be represented by one dotted-half rest, but the
      // middle of the bar remains visible.
      "6/8": { majorGroups: [1.5, 1.5], pulses: [1.5, 1.5], simple: false },
      "9/8": { majorGroups: [1.5, 1.5, 1.5], pulses: repeated(1.5, 3), simple: false },
      "12/8": { majorGroups: [3, 3], pulses: repeated(1.5, 4), simple: false },
      // A conventional default grouping is used for irregular meters.
      "5/4": { majorGroups: [3, 2], pulses: repeated(1, 5), simple: false },
      "7/4": { majorGroups: [2, 2, 3], pulses: repeated(1, 7), simple: false },
      "3/8": { majorGroups: [0.5, 0.5, 0.5], pulses: repeated(0.5, 3), simple: true },
      "5/8": { majorGroups: [1, 1.5], pulses: [1, 1.5], simple: false },
      "7/8": { majorGroups: [1, 1, 1.5], pulses: [1, 1, 1.5], simple: false },
      "8/8": { majorGroups: [1.5, 1.5, 1], pulses: [1.5, 1.5, 1], simple: false }
    };
    return { capacity, ...(profiles[signature] || {
      majorGroups: repeated(4 / denominator, numerator),
      pulses: repeated(4 / denominator, numerator),
      simple: numerator < 6 || numerator % 3 !== 0
    }) };
  }

  function regionAt(position, groups) {
    let start = 0;
    for (const length of groups) {
      const end = cleanBeat(start + length);
      if (position < end - EPSILON) return { start, end, length };
      start = end;
    }
    const length = groups.at(-1) || 1;
    return { start: cleanBeat(start - length), end: start, length };
  }

  function near(first, second) {
    return Math.abs(first - second) <= EPSILON;
  }

  function aligned(value, unit) {
    return near(value / unit, Math.round(value / unit));
  }

  function restValueFits(spec, positionInMeasure, profile) {
    const end = cleanBeat(positionInMeasure + spec.beats);
    if (end > profile.capacity + EPSILON) return false;

    const major = regionAt(positionInMeasure, profile.majorGroups);
    if (end > major.end + EPSILON) return false;

    const pulse = regionAt(positionInMeasure, profile.pulses);
    if (spec.beats > pulse.length + EPSILON) {
      // Longer rests may join complete pulses only from an edge of their
      // notated meter group. Dotted rests longer than one pulse are avoided
      // in simple time because they hide the beat hierarchy.
      if (profile.simple && spec.dotted) return false;
      const touchesGroupEdge = near(positionInMeasure, major.start) || near(end, major.end);
      return touchesGroupEdge && profile.pulses.some((_, index) => {
        const boundary = cleanBeat(profile.pulses.slice(0, index + 1).reduce((sum, value) => sum + value, 0));
        return near(end, boundary);
      });
    }

    if (near(spec.beats, pulse.length)) return near(positionInMeasure, pulse.start);
    if (end > pulse.end + EPSILON) return false;

    const startInPulse = cleanBeat(positionInMeasure - pulse.start);
    const endInPulse = cleanBeat(end - pulse.start);
    if (spec.dotted) {
      // A dotted sub-beat rest is readable at the start or end of its pulse;
      // never let it float across an internal subdivision.
      return near(startInPulse, 0) || near(endInPulse, pulse.length);
    }
    return near(startInPulse, 0)
      || near(endInPulse, pulse.length)
      || aligned(startInPulse, spec.beats);
  }

  function bestRestSequence(startBeat, durationBeats, profile) {
    const totalUnits = Math.round(durationBeats / STRAIGHT_STEP);
    const memo = new Map();
    const solve = (usedUnits) => {
      if (usedUnits === totalUnits) return [];
      if (memo.has(usedUnits)) return memo.get(usedUnits);
      const cursor = cleanBeat(startBeat + usedUnits * STRAIGHT_STEP);
      let best = null;
      for (const spec of REST_VALUES) {
        const valueUnits = Math.round(spec.beats / STRAIGHT_STEP);
        if (usedUnits + valueUnits > totalUnits) continue;
        if (!restValueFits(spec, cursor, profile)) continue;
        const tail = solve(usedUnits + valueUnits);
        if (!tail) continue;
        const candidate = [{ startBeat: cursor, spec: { ...spec } }, ...tail];
        if (!best || candidate.length < best.length) best = candidate;
      }
      memo.set(usedUnits, best);
      return best;
    };
    return solve(0) || [];
  }

  function splitRestDuration(startBeat, durationBeats, timeSignature = "4/4") {
    const [numerator, denominator] = String(timeSignature).split("/").map(Number);
    const safeNumerator = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
    const safeDenominator = Number.isFinite(denominator) && denominator > 0 ? denominator : 4;
    const profile = meterRestProfile(safeNumerator, safeDenominator);
    const { capacity } = profile;
    const segments = [];
    let cursor = cleanBeat(startBeat);
    let remaining = Math.max(0, quantizeStraight(durationBeats));

    while (remaining > EPSILON) {
      const positionInMeasure = cleanBeat(((cursor % capacity) + capacity) % capacity);
      if (positionInMeasure < EPSILON && remaining >= capacity - EPSILON) {
        segments.push({
          startBeat: cursor,
          spec: { beats: capacity, name: "whole-measure", slug: "measure", dotted: false, fullMeasure: true }
        });
        cursor = quantizeStraight(cursor + capacity);
        remaining = quantizeStraight(remaining - capacity);
        continue;
      }

      const toBarline = positionInMeasure < EPSILON ? capacity : capacity - positionInMeasure;
      const chunkDuration = Math.min(remaining, toBarline);
      const chunk = bestRestSequence(positionInMeasure, chunkDuration, profile);
      chunk.forEach((segment) => segments.push({
        startBeat: cleanBeat(cursor + segment.startBeat - positionInMeasure),
        spec: segment.spec
      }));
      cursor = quantizeStraight(cursor + chunkDuration);
      remaining = quantizeStraight(remaining - chunkDuration);
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
    meterRestProfile,
    cleanBeat,
    quantizeStraight,
    splitRestDuration,
    recognizeOnsets
  };
});
