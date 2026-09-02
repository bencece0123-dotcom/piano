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

  function cleanBeat(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  function quantizeStraight(value, step = STRAIGHT_STEP) {
    return cleanBeat(Math.round(value / step) * step);
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
    cleanBeat,
    quantizeStraight,
    recognizeOnsets
  };
});
