(() => {
  "use strict";

  const STORAGE_KEY = "melody-catcher-aic-2026-0017-v1";
  const CHORD_WINDOW_MS = 10;
  const BEAT_SPACING = 88;
  const SCORE_START_X = 108;
  const SCORE_END_PADDING = 18;
  const NOTE_EDGE_PADDING = 24;
  const STEM_LENGTH = 42;
  const RHYTHM_QUANTUM = 0.25;
  const MIN_REST_BEATS = 1.25;
  const REST_CONFIRM_DELAY_MS = 350;
  const TIME_SIGNATURES = ["4/4", "2/2", "6/8", "3/4", "2/4", "12/8", "9/8", "5/4", "7/4", "3/8", "5/8", "7/8", "8/8"];
  const NOTE_VALUES = [
    { beats: 4, name: "whole note", slug: "whole", open: true, stem: false, flags: 0, dotted: false },
    { beats: 3, name: "dotted half note", slug: "dotted-half", open: true, stem: true, flags: 0, dotted: true },
    { beats: 2, name: "half note", slug: "half", open: true, stem: true, flags: 0, dotted: false },
    { beats: 1.5, name: "dotted quarter note", slug: "dotted-quarter", open: false, stem: true, flags: 0, dotted: true },
    { beats: 1, name: "quarter note", slug: "quarter", open: false, stem: true, flags: 0, dotted: false },
    { beats: 0.75, name: "dotted eighth note", slug: "dotted-eighth", open: false, stem: true, flags: 1, dotted: true },
    { beats: 0.5, name: "eighth note", slug: "eighth", open: false, stem: true, flags: 1, dotted: false },
    { beats: 0.25, name: "sixteenth note", slug: "sixteenth", open: false, stem: true, flags: 2, dotted: false }
  ];
  const FLAT_SPELLINGS = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const DEFAULT_BINDINGS = [
    "a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k",
    "o", "l", "p", ";", "'", "z", "x", "c", "v", "b", "n", "m"
  ];

  const notesInRange = [];
  let whiteIndex = -1;
  for (let midi = 48; midi <= 72; midi += 1) {
    const pitchClass = NOTE_NAMES[midi % 12];
    const isBlack = pitchClass.includes("#");
    if (!isBlack) whiteIndex += 1;
    notesInRange.push({
      note: `${pitchClass}${Math.floor(midi / 12) - 1}`,
      midi,
      isBlack,
      whiteIndex
    });
  }

  const noteByName = new Map(notesInRange.map((item) => [item.note, item]));
  const defaultBindingMap = Object.fromEntries(notesInRange.map((item, index) => [item.note, DEFAULT_BINDINGS[index]]));

  const state = {
    notes: [],
    undoStack: [],
    redoStack: [],
    selectedId: null,
    recording: true,
    playing: false,
    instrument: "piano",
    volume: 70,
    tempo: 100,
    timeSignature: "4/4",
    profileName: "",
    ideaTitle: "Untitled idea",
    timelineEndBeat: 0,
    bindings: { ...defaultBindingMap }
  };

  const el = {
    appStatus: document.querySelector("#app-status"),
    recordToggle: document.querySelector("#record-toggle"),
    playScore: document.querySelector("#play-score"),
    scoreTitle: document.querySelector("#score-title"),
    scoreMeta: document.querySelector("#score-meta"),
    undo: document.querySelector("#undo"),
    redo: document.querySelector("#redo"),
    exportOpen: document.querySelector("#export-open"),
    emptyScore: document.querySelector("#empty-score"),
    staff: document.querySelector("#staff"),
    scoreViewport: document.querySelector("#score-viewport"),
    selectionBar: document.querySelector("#selection-bar"),
    selectionLabel: document.querySelector("#selection-label"),
    deleteNote: document.querySelector("#delete-note"),
    instrumentTitle: document.querySelector("#piano-title"),
    instrumentSelect: document.querySelector("#instrument-select"),
    volume: document.querySelector("#volume"),
    volumeOutput: document.querySelector("#volume-output"),
    tempo: document.querySelector("#tempo"),
    tempoOutput: document.querySelector("#tempo-output"),
    timeSignature: document.querySelector("#time-signature-select"),
    piano: document.querySelector("#piano-keys"),
    pianoWrap: document.querySelector("#piano"),
    clearScore: document.querySelector("#clear-score"),
    toastRegion: document.querySelector("#toast-region"),
    settingsDialog: document.querySelector("#settings-dialog"),
    settingsForm: document.querySelector("#settings-form"),
    settingsOpen: document.querySelector("#settings-open"),
    settingsClose: document.querySelector("#settings-close"),
    settingsCancel: document.querySelector("#settings-cancel"),
    profileName: document.querySelector("#profile-name"),
    ideaTitle: document.querySelector("#idea-title"),
    bindingsGrid: document.querySelector("#bindings-grid"),
    bindingsError: document.querySelector("#bindings-error"),
    resetBindings: document.querySelector("#reset-bindings"),
    exportDialog: document.querySelector("#export-dialog"),
    exportSummary: document.querySelector("#export-summary"),
    exportPreview: document.querySelector("#export-preview"),
    exportState: document.querySelector("#export-state"),
    downloadNotes: document.querySelector("#download-notes"),
    copyNotes: document.querySelector("#copy-notes"),
    helpDialog: document.querySelector("#help-dialog"),
    helpButton: document.querySelector("#help-button")
  };

  let audioContext = null;
  let masterGain = null;
  let audioUnavailable = false;
  let storageUnavailable = false;
  let clearArmed = false;
  let clearTimer = null;
  let playbackTimers = [];
  const activeVoices = new Map();
  const activeSources = new Map();
  const activeKeyboard = new Map();
  const activeRecordIds = new Map();
  const recordStartTimes = new Map();
  const staffByRecordedNote = new Map();
  let keyboardAudioBatch = null;
  let silentMeasureTimer = null;
  let silenceStartedAt = null;
  let currentOnsetWindow = null;
  let recordingClock = null;
  let lastOnsetBeat = null;
  let scoreRenderFrame = null;
  let scoreShouldFollow = false;

  function displayNote(note) {
    return note.replace("#", "♯").replace("b", "♭");
  }

  function spokenNote(note) {
    return note.replace("#", " sharp ").replace("b", " flat ");
  }

  function instrumentLabel(value = state.instrument) {
    return { piano: "Grand piano", electric: "Electric piano", organ: "Warm organ" }[value] || "Grand piano";
  }

  function formatBinding(value) {
    if (value === " ") return "Space";
    return value.toUpperCase();
  }

  function normalizeBinding(value) {
    return value.length === 1 ? value.toLowerCase() : "";
  }

  function cloneNotes(notes = state.notes) {
    return notes.map((note) => ({ ...note }));
  }

  function onsetGroups(notes = state.notes) {
    const groups = [];
    const byId = new Map();
    notes.forEach((recordedNote) => {
      let group = byId.get(recordedNote.onsetId);
      if (!group) {
        group = { id: recordedNote.onsetId, notes: [], startBeat: recordedNote.startBeat };
        byId.set(recordedNote.onsetId, group);
        groups.push(group);
      }
      group.notes.push(recordedNote);
      group.startBeat = Math.min(group.startBeat, recordedNote.startBeat);
    });
    groups.forEach((group) => {
      group.durationBeats = Math.max(...group.notes.map((note) => note.durationBeats || 1));
    });
    return groups.sort((a, b) => a.startBeat - b.startBeat || a.notes[0].createdAt - b.notes[0].createdAt);
  }

  function formattedOnsetGroups() {
    return onsetGroups().map((group) => {
      const names = group.notes.map((note) => displayNote(note.spelling || note.note));
      const pitches = names.length > 1 ? `[${names.join(" + ")}]` : names[0];
      const durations = new Set(group.notes.map((note) => note.durationBeats || RHYTHM_QUANTUM));
      if (durations.size === 1) return `${pitches} — ${durationName(group.notes[0].durationBeats || RHYTHM_QUANTUM)}`;
      return `[${group.notes.map((note) => `${displayNote(note.spelling || note.note)} — ${durationName(note.durationBeats || RHYTHM_QUANTUM)}`).join("; ")}]`;
    });
  }

  function createOnsetId() {
    return `onset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function beatDurationMs() {
    return 60000 / state.tempo;
  }

  function timeSignatureParts() {
    const [numerator, denominator] = state.timeSignature.split("/").map(Number);
    return { numerator, denominator };
  }

  function beatUnitQuarterLength() {
    return 4 / timeSignatureParts().denominator;
  }

  function measureCapacity() {
    const { numerator } = timeSignatureParts();
    return numerator * beatUnitQuarterLength();
  }

  function beatUnitName() {
    return { 2: "half note", 4: "quarter note", 8: "eighth note" }[timeSignatureParts().denominator] || `${timeSignatureParts().denominator}th note`;
  }

  function quarterUnitsFromMs(milliseconds) {
    return milliseconds / beatDurationMs() * beatUnitQuarterLength();
  }

  function millisecondsFromQuarterUnits(quarterUnits) {
    return quarterUnits / beatUnitQuarterLength() * beatDurationMs();
  }

  function quantizeBeat(value) {
    return Math.round(value / RHYTHM_QUANTUM) * RHYTHM_QUANTUM;
  }

  function nextCompositionBeat() {
    const noteEnd = state.notes.length
      ? Math.max(...state.notes.map((note) => note.startBeat + (note.durationBeats || 1)))
      : 0;
    return quantizeBeat(Math.max(noteEnd, state.timelineEndBeat || 0));
  }

  function latestOnsetBeat() {
    return state.notes.length ? Math.max(...state.notes.map((note) => note.startBeat)) : 0;
  }

  function cancelSilentMeasureTimer() {
    if (silentMeasureTimer !== null) window.clearTimeout(silentMeasureTimer);
    silentMeasureTimer = null;
  }

  function resetRecordingClock() {
    cancelSilentMeasureTimer();
    silenceStartedAt = null;
    currentOnsetWindow = null;
    recordingClock = null;
    lastOnsetBeat = null;
  }

  function resolveOnset(startedAt, hasHeldCompanion) {
    const elapsed = currentOnsetWindow ? startedAt - currentOnsetWindow.startedAt : Infinity;
    if (hasHeldCompanion && elapsed >= 0 && elapsed <= CHORD_WINDOW_MS) {
      return currentOnsetWindow;
    }
    if (!recordingClock) {
      recordingClock = { startedAt, startBeat: nextCompositionBeat() };
    }
    let startBeat = quantizeBeat(
      recordingClock.startBeat + quarterUnitsFromMs(startedAt - recordingClock.startedAt)
    );
    if (lastOnsetBeat !== null) startBeat = Math.max(startBeat, lastOnsetBeat + RHYTHM_QUANTUM);
    currentOnsetWindow = { id: createOnsetId(), startedAt, startBeat };
    lastOnsetBeat = startBeat;
    return currentOnsetWindow;
  }

  function durationName(beats) {
    const exact = NOTE_VALUES.find((value) => Math.abs(value.beats - beats) < 0.001);
    if (exact) return exact.name;
    return `${Number(beats.toFixed(2))} beats (tied)`;
  }

  function tempoWord() {
    if (state.tempo < 66) return "Largo";
    if (state.tempo < 108) return "Andante";
    if (state.tempo < 168) return "Allegro";
    return "Presto";
  }

  function showToast(message, kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${kind === "error" ? "error" : ""}`;
    toast.textContent = message;
    el.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function setAppStatus(message, mode = "ready") {
    el.appStatus.dataset.state = mode;
    el.appStatus.querySelector("span:last-child").textContent = message;
  }

  function saveAll() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        notes: state.notes,
        instrument: state.instrument,
        volume: state.volume,
        tempo: state.tempo,
        timeSignature: state.timeSignature,
        profileName: state.profileName,
        ideaTitle: state.ideaTitle,
        bindings: state.bindings
      }));
    } catch (error) {
      if (!storageUnavailable) {
        storageUnavailable = true;
        showToast("This browser blocked auto-save. Export your notes before leaving.", "error");
      }
    }
  }

  function loadSavedState() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      storageUnavailable = true;
      return;
    }
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.notes)) {
        const restoredOnsets = new Map();
        let restoredBeat = 0;
        state.notes = parsed.notes
          .filter((item) => item && noteByName.has(item.note))
          .map((item, index) => {
            const createdAt = Number.isFinite(item.createdAt)
              ? item.createdAt
              : Date.now() + index * (CHORD_WINDOW_MS + 1);
            let onsetId = typeof item.onsetId === "string" && item.onsetId
              ? item.onsetId
              : null;
            if (!onsetId) {
              onsetId = `restored-onset-${index}-${Date.now()}`;
            }
            if (!restoredOnsets.has(onsetId)) {
              const startBeat = Number.isFinite(item.startBeat) ? Math.max(0, quantizeBeat(item.startBeat)) : restoredBeat;
              restoredOnsets.set(onsetId, startBeat);
              restoredBeat = Math.max(restoredBeat, startBeat + 1);
            }
            const spelling = typeof item.spelling === "string" && /^[A-G](?:#|b)?\d$/.test(item.spelling)
              ? item.spelling
              : item.note;
            return {
              id: String(item.id || `restored-${index}-${Date.now()}`),
              onsetId,
              note: item.note,
              spelling,
              midi: noteByName.get(item.note).midi,
              duration: Number.isFinite(item.duration) ? item.duration : 0.5,
              durationBeats: Number.isFinite(item.durationBeats)
                ? Math.max(RHYTHM_QUANTUM, quantizeBeat(item.durationBeats))
                : 1,
              startBeat: restoredOnsets.get(onsetId),
              createdAt
            };
          });
      }
      // Trailing silence is live session state. Gaps before later notes are
      // already preserved by their onset positions and do not need this value.
      state.timelineEndBeat = latestOnsetBeat();
      if (["piano", "electric", "organ"].includes(parsed.instrument)) state.instrument = parsed.instrument;
      if (Number.isFinite(parsed.volume)) state.volume = Math.max(0, Math.min(100, parsed.volume));
      if (Number.isFinite(parsed.tempo)) state.tempo = Math.max(40, Math.min(200, Math.round(parsed.tempo)));
      if (TIME_SIGNATURES.includes(parsed.timeSignature)) state.timeSignature = parsed.timeSignature;
      if (typeof parsed.profileName === "string") state.profileName = parsed.profileName.slice(0, 40);
      if (typeof parsed.ideaTitle === "string" && parsed.ideaTitle.trim()) state.ideaTitle = parsed.ideaTitle.trim().slice(0, 60);
      if (parsed.bindings && typeof parsed.bindings === "object") {
        const candidate = {};
        notesInRange.forEach(({ note }) => {
          const value = normalizeBinding(String(parsed.bindings[note] || ""));
          candidate[note] = value || defaultBindingMap[note];
        });
        if (new Set(Object.values(candidate)).size === notesInRange.length && !Object.values(candidate).includes(" ")) {
          state.bindings = candidate;
        }
      }
      bridgeAllShortGaps();
    } catch (error) {
      showToast("The saved idea could not be read, so a fresh sheet was opened.", "error");
    }
  }

  function pushHistory() {
    state.undoStack.push(cloneNotes());
    state.redoStack = [];
  }

  function createKeyButton(item) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = item.isBlack ? "key-black" : "key-white";
    key.dataset.note = item.note;
    key.setAttribute("aria-label", `${spokenNote(item.note)}, keyboard key ${formatBinding(state.bindings[item.note])}`);
    if (item.isBlack) key.style.setProperty("--white-index", item.whiteIndex);
    const label = document.createElement("span");
    label.className = "key-label";
    const shortcut = document.createElement("kbd");
    shortcut.textContent = formatBinding(state.bindings[item.note]);
    const noteName = document.createElement("small");
    noteName.textContent = displayNote(item.note);
    label.append(shortcut, noteName);
    key.append(label);
    return key;
  }

  function renderPiano() {
    el.piano.replaceChildren();
    notesInRange.filter((item) => !item.isBlack).forEach((item) => el.piano.append(createKeyButton(item)));
    notesInRange.filter((item) => item.isBlack).forEach((item) => el.piano.append(createKeyButton(item)));
  }

  function renderBindings(bindings = state.bindings) {
    el.bindingsGrid.replaceChildren();
    notesInRange.forEach((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "binding-item";
      const label = document.createElement("label");
      label.htmlFor = `binding-${item.midi}`;
      label.textContent = displayNote(item.note);
      const input = document.createElement("input");
      input.className = "binding-input";
      input.id = `binding-${item.midi}`;
      input.type = "text";
      input.inputMode = "text";
      input.maxLength = 1;
      input.value = formatBinding(bindings[item.note]);
      input.dataset.note = item.note;
      input.dataset.raw = bindings[item.note];
      input.setAttribute("aria-label", `Keyboard control for ${spokenNote(item.note)}`);
      wrapper.append(label, input);
      el.bindingsGrid.append(wrapper);
    });
  }

  function chooseSpelling(note, onsetId) {
    if (!note.includes("#")) return note;
    const previous = [...state.notes].reverse().find((item) => item.onsetId !== onsetId);
    if (!previous || noteByName.get(note).midi >= previous.midi) return note;
    const octave = note.slice(-1);
    return `${FLAT_SPELLINGS[note.slice(0, -1)]}${octave}`;
  }

  function diatonicStep(note) {
    const match = note.match(/^([A-G])(?:#|b)?(\d)$/);
    const letterIndex = ["C", "D", "E", "F", "G", "A", "B"].indexOf(match[1]);
    return Number(match[2]) * 7 + letterIndex - 21;
  }

  function noteY(recordedNote) {
    return 172 - diatonicStep(recordedNote.spelling || recordedNote.note) * 8;
  }

  function noteStaff(recordedNote) {
    return staffByRecordedNote.get(recordedNote.id) || (recordedNote.midi < 60 ? "bass" : "treble");
  }

  function updateChordStaffAssignments(groups) {
    staffByRecordedNote.clear();
    groups.forEach((group) => {
      const midis = group.notes.map((note) => note.midi);
      const lowest = Math.min(...midis);
      const highest = Math.max(...midis);
      const isCompactChord = group.notes.length > 1 && highest - lowest <= 12;
      const sharedStaff = isCompactChord
        ? (midis.reduce((sum, midi) => sum + midi, 0) / midis.length < 60 ? "bass" : "treble")
        : null;
      group.notes.forEach((note) => {
        staffByRecordedNote.set(note.id, sharedStaff || (note.midi < 60 ? "bass" : "treble"));
      });
    });
  }

  function scoreLayout(totalMeasures) {
    const capacity = measureCapacity();
    const viewportWidth = el.scoreViewport.clientWidth || 960;
    const horizontalPadding = viewportWidth <= 780 ? 40 : 68;
    const contentWidth = Math.max(280, viewportWidth - horizontalPadding);
    const segmentCounts = new Map();
    buildEngravedSegments(totalMeasures * capacity).forEach((segment) => {
      const measure = Math.floor(segment.startBeat / capacity);
      segmentCounts.set(measure, (segmentCounts.get(measure) || 0) + 1);
    });
    const densestMeasure = Math.max(1, ...segmentCounts.values());
    const minimumMeasureWidth = Math.max(380, capacity * BEAT_SPACING, 112 + densestMeasure * 22);
    const measuresPerSystem = Math.max(1, Math.min(4, Math.floor((contentWidth - 20) / minimumMeasureWidth)));
    const measureWidth = minimumMeasureWidth;
    const systemWidth = measuresPerSystem * measureWidth + 20;
    const beatSpacing = measureWidth / capacity;
    const beatsPerSystem = capacity * measuresPerSystem;
    return {
      capacity,
      measuresPerSystem,
      beatsPerSystem,
      beatSpacing,
      measureWidth,
      systemWidth,
      systemHeight: 270,
      systemCount: Math.ceil(totalMeasures / measuresPerSystem)
    };
  }

  function systemIndexForBeat(beat, layout) {
    return Math.min(layout.systemCount - 1, Math.max(0, Math.floor((beat + 0.0001) / layout.beatsPerSystem)));
  }

  function localTimelineX(beat, systemIndex, layout) {
    const localBeat = beat - systemIndex * layout.beatsPerSystem;
    return SCORE_START_X + localBeat * layout.beatSpacing;
  }

  function localBeatX(beat, systemIndex, layout) {
    const localBeat = beat - systemIndex * layout.beatsPerSystem;
    const measureIndex = Math.max(0, Math.floor((localBeat + 0.0001) / layout.capacity));
    const beatInMeasure = localBeat - measureIndex * layout.capacity;
    const measureWidth = layout.capacity * layout.beatSpacing;
    const usableWidth = measureWidth - NOTE_EDGE_PADDING * 2;
    const gridSpan = Math.max(RHYTHM_QUANTUM, layout.capacity - RHYTHM_QUANTUM);
    return SCORE_START_X
      + measureIndex * measureWidth
      + NOTE_EDGE_PADDING
      + beatInMeasure / gridSpan * usableWidth;
  }

  function localRestX(startBeat, durationBeats, systemIndex, layout) {
    const centerBeat = startBeat + durationBeats / 2;
    const localCenter = centerBeat - systemIndex * layout.beatsPerSystem;
    const measureIndex = Math.max(0, Math.floor((startBeat - systemIndex * layout.beatsPerSystem + 0.0001) / layout.capacity));
    const measureStartX = SCORE_START_X + measureIndex * layout.capacity * layout.beatSpacing;
    const measureEndX = measureStartX + layout.capacity * layout.beatSpacing;
    const rawX = SCORE_START_X + localCenter * layout.beatSpacing;
    return Math.max(measureStartX + NOTE_EDGE_PADDING, Math.min(measureEndX - NOTE_EDGE_PADDING, rawX));
  }

  function splitDuration(startBeat, durationBeats) {
    const segments = [];
    const capacity = measureCapacity();
    let cursor = startBeat;
    let remaining = Math.max(RHYTHM_QUANTUM, quantizeBeat(durationBeats));
    while (remaining > 0.001) {
      const positionInMeasure = ((cursor % capacity) + capacity) % capacity;
      const toBarline = positionInMeasure < 0.001
        ? capacity
        : capacity - positionInMeasure;
      const available = Math.min(remaining, toBarline);
      const spec = NOTE_VALUES.find((value) => value.beats <= available + 0.001) || NOTE_VALUES.at(-1);
      segments.push({ startBeat: cursor, spec });
      cursor = quantizeBeat(cursor + spec.beats);
      remaining = quantizeBeat(remaining - spec.beats);
    }
    return segments.map((segment, index) => ({
      ...segment,
      index,
      tiedFromPrevious: index > 0,
      tiedToNext: index < segments.length - 1
    }));
  }

  function setEventStemLayout(event, forcedStemDown = null) {
    const positionedNotes = event.notes
      .map((note) => ({ note, y: noteY(note) }))
      .sort((a, b) => a.y - b.y);
    const middleLineY = event.staff === "treble" ? 68 : 164;
    const furthest = positionedNotes.reduce((current, item) => (
      Math.abs(item.y - middleLineY) > Math.abs(current.y - middleLineY) ? item : current
    ));
    event.stemDown = forcedStemDown === null ? furthest.y <= middleLineY : forcedStemDown;
    event.stemNoteId = event.stemDown
      ? positionedNotes[0].note.id
      : positionedNotes[positionedNotes.length - 1].note.id;
    event.stemSpan = positionedNotes.at(-1).y - positionedNotes[0].y;
    event.headShiftById = new Map();
    let flipHead = false;
    const headOrder = event.stemDown ? positionedNotes : [...positionedNotes].reverse();
    headOrder.forEach((item, index) => {
      const previous = headOrder[index - 1];
      flipHead = Boolean(previous && Math.abs(item.y - previous.y) <= 8) ? !flipHead : false;
      event.headShiftById.set(item.note.id, flipHead ? (event.stemDown ? -7 : 7) : 0);
    });
  }

  function buildNotationEvents(groups) {
    const eventsById = new Map();
    groups.forEach((group) => {
      group.notes.forEach((note) => {
        const staff = noteStaff(note);
        const sameStaffChordNotes = group.notes.filter((groupNote) => noteStaff(groupNote) === staff);
        const notationDuration = sameStaffChordNotes.length > 1
          ? Math.max(...sameStaffChordNotes.map((groupNote) => groupNote.durationBeats || RHYTHM_QUANTUM))
          : note.durationBeats || RHYTHM_QUANTUM;
        splitDuration(note.startBeat, notationDuration).forEach((segment) => {
          const id = [
            group.id,
            staff,
            segment.startBeat,
            segment.spec.slug,
            segment.index,
            Number(segment.tiedFromPrevious),
            Number(segment.tiedToNext)
          ].join(":");
          let event = eventsById.get(id);
          if (!event) {
            event = {
              id,
              groupId: group.id,
              group,
              notes: [],
              staff,
              startBeat: segment.startBeat,
              spec: segment.spec,
              segmentIndex: segment.index,
              tiedFromPrevious: segment.tiedFromPrevious,
              tiedToNext: segment.tiedToNext,
              xOffset: 0
            };
            eventsById.set(id, event);
          }
          event.notes.push(note);
        });
      });
    });
    const events = [...eventsById.values()];

    const lanes = new Map();
    events.forEach((event) => {
      const key = `${event.startBeat}:${event.staff}`;
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push(event);
    });
    lanes.forEach((laneEvents) => {
      laneEvents.sort((a, b) => Number(b.tiedFromPrevious) - Number(a.tiedFromPrevious));
      const middle = (laneEvents.length - 1) / 2;
      laneEvents.forEach((event, index) => {
        event.xOffset = (index - middle) * 8;
      });
    });

    events.forEach((event) => setEventStemLayout(event));
    return events;
  }

  function accidentalLayout(groups) {
    const result = new Map();
    const capacity = measureCapacity();
    let activeMeasure = -1;
    let measureState = new Map();
    groups.forEach((group) => {
      const measure = Math.floor(group.startBeat / capacity);
      if (measure !== activeMeasure) {
        activeMeasure = measure;
        measureState = new Map();
      }
      const needed = [];
      [...group.notes].sort((a, b) => a.midi - b.midi).forEach((recordedNote) => {
        const spelling = recordedNote.spelling || recordedNote.note;
        const pitchKey = spelling.replace(/#|b/, "");
        const alteration = spelling.includes("#") ? "sharp" : spelling.includes("b") ? "flat" : "natural";
        const previousAlteration = measureState.get(pitchKey) || "natural";
        if (alteration !== previousAlteration) {
          needed.push({
            id: recordedNote.id,
            symbol: alteration === "sharp" ? "♯" : alteration === "flat" ? "♭" : "♮",
            y: noteY(recordedNote)
          });
        }
        measureState.set(pitchKey, alteration);
      });

      const lastYByColumn = [];
      needed.sort((a, b) => a.y - b.y).forEach((accidental) => {
        let column = 0;
        while (lastYByColumn[column] !== undefined && Math.abs(accidental.y - lastYByColumn[column]) < 20) column += 1;
        lastYByColumn[column] = accidental.y;
        result.set(accidental.id, { symbol: accidental.symbol, column });
      });
    });
    return result;
  }

  function ledgerLinePositions(recordedNote) {
    const y = noteY(recordedNote);
    const staff = noteStaff(recordedNote);
    const lines = [];
    if (staff === "treble") {
      for (let lineY = 116; lineY <= y + 0.001; lineY += 16) lines.push(lineY);
      for (let lineY = 20; lineY >= y - 0.001; lineY -= 16) lines.push(lineY);
    } else {
      for (let lineY = 116; lineY >= y - 0.001; lineY -= 16) lines.push(lineY);
      for (let lineY = 212; lineY <= y + 0.001; lineY += 16) lines.push(lineY);
    }
    return lines;
  }

  function addStaffFurniture(system, systemIndex, measuresInSystem, layout) {
    [36, 52, 68, 84, 100, 132, 148, 164, 180, 196].forEach((top) => {
      const line = document.createElement("span");
      line.className = "staff-line";
      line.style.top = `${top}px`;
      system.append(line);
    });
    const treble = document.createElement("span");
    treble.className = "clef treble-clef";
    treble.setAttribute("aria-hidden", "true");
    treble.textContent = "𝄞";
    const bass = document.createElement("span");
    bass.className = "clef bass-clef";
    bass.setAttribute("aria-hidden", "true");
    bass.textContent = "𝄢";
    const tempo = document.createElement("span");
    tempo.className = "tempo-mark";
    tempo.textContent = `${beatUnitName()} = ${state.tempo}  ${tempoWord()}`;
    system.append(treble, bass);
    if (systemIndex === 0) system.append(tempo);

    if (systemIndex > 0) {
      const measureNumber = document.createElement("span");
      measureNumber.className = "measure-number";
      measureNumber.textContent = String(systemIndex * layout.measuresPerSystem + 1);
      measureNumber.setAttribute("aria-hidden", "true");
      system.append(measureNumber);
    }

    ["treble", "bass"].forEach((staff) => {
      const signature = document.createElement("span");
      signature.className = `time-signature ${staff}`;
      signature.setAttribute("aria-label", `${timeSignatureParts().numerator}-${timeSignatureParts().denominator} time`);
      const top = document.createElement("span");
      top.textContent = String(timeSignatureParts().numerator);
      const bottom = document.createElement("span");
      bottom.textContent = String(timeSignatureParts().denominator);
      signature.append(top, bottom);
      system.append(signature);
    });

    const openingBar = document.createElement("span");
    openingBar.className = "bar-line system-start";
    openingBar.style.left = "58px";
    system.append(openingBar);

    for (let measure = 1; measure <= measuresInSystem; measure += 1) {
      const bar = document.createElement("span");
      bar.className = measure === measuresInSystem ? "bar-line system-end" : "bar-line";
      bar.style.left = `${SCORE_START_X + measure * layout.capacity * layout.beatSpacing}px`;
      system.append(bar);
    }
  }

  function globalRestSegments(groups, totalBeats) {
    const intervals = groups
      .flatMap((group) => group.notes)
      .map((note) => ({ start: note.startBeat, end: note.startBeat + (note.durationBeats || RHYTHM_QUANTUM) }))
      .sort((a, b) => a.start - b.start);
    const merged = [];
    intervals.forEach((interval) => {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end + 0.001) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
    });
    const gaps = [];
    let cursor = 0;
    merged.forEach((interval) => {
      if (interval.start > cursor + 0.001) gaps.push({ start: cursor, duration: interval.start - cursor });
      cursor = Math.max(cursor, interval.end);
    });
    if (cursor < totalBeats - 0.001) gaps.push({ start: cursor, duration: totalBeats - cursor });
    return gaps.flatMap((gap) => splitRestDuration(gap.start, gap.duration));
  }

  function restStaffAt(startBeat, groups) {
    const notes = groups.flatMap((group) => group.notes);
    const previous = [...notes]
      .filter((note) => note.startBeat + (note.durationBeats || RHYTHM_QUANTUM) <= startBeat + 0.001)
      .sort((a, b) => b.startBeat + (b.durationBeats || RHYTHM_QUANTUM) - a.startBeat - (a.durationBeats || RHYTHM_QUANTUM))[0];
    const next = [...notes]
      .filter((note) => note.startBeat >= startBeat - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat)[0];
    return noteStaff(previous || next || { midi: 60 });
  }

  function splitRestDuration(startBeat, durationBeats) {
    const capacity = measureCapacity();
    const segments = [];
    let cursor = startBeat;
    let remaining = Math.max(0, quantizeBeat(durationBeats));
    while (remaining > 0.001) {
      const positionInMeasure = ((cursor % capacity) + capacity) % capacity;
      if (positionInMeasure < 0.001 && remaining >= capacity - 0.001) {
        segments.push({
          startBeat: cursor,
          spec: { beats: capacity, name: "whole-measure", slug: "measure", dotted: false, fullMeasure: true }
        });
        cursor = quantizeBeat(cursor + capacity);
        remaining = quantizeBeat(remaining - capacity);
        continue;
      }
      const toBarline = positionInMeasure < 0.001 ? capacity : capacity - positionInMeasure;
      const available = Math.min(remaining, toBarline);
      const spec = NOTE_VALUES.find((value) => value.beats <= available + 0.001) || NOTE_VALUES.at(-1);
      segments.push({ startBeat: cursor, spec });
      cursor = quantizeBeat(cursor + spec.beats);
      remaining = quantizeBeat(remaining - spec.beats);
    }
    return segments;
  }

  function addRests(systems, groups, totalBeats, layout) {
    globalRestSegments(groups, totalBeats).forEach((segment) => {
      const systemIndex = systemIndexForBeat(segment.startBeat, layout);
      const staff = restStaffAt(segment.startBeat, groups);
      const rest = document.createElement("span");
      rest.className = `score-rest rest-${segment.spec.slug} ${staff}`;
      const left = localRestX(segment.startBeat, segment.spec.beats, systemIndex, layout);
      rest.style.left = `${left}px`;
      rest.setAttribute("role", "img");
      rest.setAttribute("aria-label", `${segment.spec.name} rest, measure ${Math.floor(segment.startBeat / layout.capacity) + 1}`);
      const mark = document.createElement("span");
      mark.className = "rest-mark";
      mark.setAttribute("aria-hidden", "true");
      rest.append(mark);
      if (segment.spec.dotted) {
        const dot = document.createElement("span");
        dot.className = "rest-dot";
        dot.setAttribute("aria-hidden", "true");
        rest.append(dot);
      }
      systems[systemIndex].element.append(rest);
    });
  }

  function createTie(left, top, width, stemDown) {
    const tie = document.createElement("span");
    tie.className = `note-tie ${stemDown ? "tie-above" : "tie-below"}`;
    tie.style.left = `${left}px`;
    tie.style.top = `${top}px`;
    tie.style.width = `${Math.max(8, width)}px`;
    tie.setAttribute("aria-hidden", "true");
    return tie;
  }

  function addTie(systems, event, nextEvent, recordedNote, layout) {
    const startSystem = event.systemIndex;
    const endSystem = nextEvent.systemIndex;
    const startX = localBeatX(event.startBeat, startSystem, layout) + event.xOffset;
    const endX = localBeatX(nextEvent.startBeat, endSystem, layout) + nextEvent.xOffset;
    const top = noteY(recordedNote) + (event.stemDown ? -12 : 8);
    if (startSystem === endSystem) {
      systems[startSystem].element.append(createTie(startX + 6, top, endX - startX - 12, event.stemDown));
      return;
    }

    const outgoingEnd = systems[startSystem].musicEndX - 5;
    systems[startSystem].element.append(createTie(startX + 6, top, outgoingEnd - startX - 6, event.stemDown));
    systems[endSystem].element.append(createTie(62, top, endX - 70, event.stemDown));
  }

  function beamBucket(startBeat, capacity) {
    const { numerator, denominator } = timeSignatureParts();
    const withinMeasure = ((startBeat % capacity) + capacity) % capacity;
    let pattern;
    if (denominator === 8 && numerator % 3 === 0) {
      pattern = Array.from({ length: numerator / 3 }, () => 1.5);
    } else if (denominator === 8 && numerator === 5) {
      pattern = [1, 1.5];
    } else if (denominator === 8 && numerator === 7) {
      pattern = [1, 1, 1.5];
    } else if (denominator === 8 && numerator === 8) {
      pattern = [2, 2];
    } else {
      pattern = Array.from({ length: numerator }, () => beatUnitQuarterLength());
    }
    let boundary = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      boundary += pattern[index];
      if (withinMeasure < boundary - 0.001) return index;
    }
    return pattern.length - 1;
  }

  function buildBeamGroups(events, layout) {
    const buckets = new Map();
    events.forEach((event) => {
      event.beamed = false;
      if (!event.spec.flags || event.tiedFromPrevious || event.tiedToNext) return;
      const measure = Math.floor(event.startBeat / layout.capacity);
      const key = [
        event.systemIndex,
        event.staff,
        measure,
        beamBucket(event.startBeat, layout.capacity),
        event.spec.flags
      ].join(":");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(event);
    });

    const groups = [];
    buckets.forEach((bucket) => {
      bucket.sort((a, b) => a.startBeat - b.startBeat);
      let run = [];
      const finishRun = () => {
        if (run.length > 1) {
          const allNoteYs = run.flatMap((event) => event.notes.map((note) => noteY(note)));
          const averageY = allNoteYs.reduce((sum, y) => sum + y, 0) / allNoteYs.length;
          const middleLineY = run[0].staff === "treble" ? 68 : 164;
          const sharedStemDown = averageY <= middleLineY;
          run.forEach((event) => {
            event.beamed = true;
            setEventStemLayout(event, sharedStemDown);
          });
          const baseTips = run.map((event) => {
            const stemNote = event.notes.find((note) => note.id === event.stemNoteId);
            return {
              event,
              x: localBeatX(event.startBeat, event.systemIndex, layout) + event.xOffset + (event.stemDown ? -8 : 7),
              y: noteY(stemNote) + (event.stemDown ? STEM_LENGTH + event.stemSpan : -STEM_LENGTH - event.stemSpan)
            };
          });
          const firstTip = baseTips[0];
          const lastTip = baseTips.at(-1);
          const runWidth = Math.max(1, lastTip.x - firstTip.x);
          const naturalSlope = (lastTip.y - firstTip.y) / runWidth;
          const maxSlope = 12 / runWidth;
          const slope = Math.max(-maxSlope, Math.min(maxSlope, naturalSlope));
          const intercepts = baseTips.map((tip) => tip.y - slope * (tip.x - firstTip.x));
          const intercept = sharedStemDown ? Math.max(...intercepts) : Math.min(...intercepts);
          baseTips.forEach((tip) => {
            tip.event.beamTipY = intercept + slope * (tip.x - firstTip.x);
            tip.event.beamExtension = Math.abs(tip.event.beamTipY - tip.y);
          });
          groups.push(run);
        }
        run = [];
      };
      bucket.forEach((event) => {
        const previous = run.at(-1);
        const followsPrevious = previous
          && event.startBeat > previous.startBeat + 0.001
          && event.startBeat <= previous.startBeat + previous.spec.beats + 0.001;
        if (previous && !followsPrevious) finishRun();
        run.push(event);
      });
      finishRun();
    });
    return groups;
  }

  function stemTip(event, layout) {
    const stemNote = event.notes.find((note) => note.id === event.stemNoteId);
    return {
      x: localBeatX(event.startBeat, event.systemIndex, layout) + event.xOffset + (event.stemDown ? -8 : 7),
      y: event.beamTipY ?? noteY(stemNote) + (event.stemDown ? STEM_LENGTH + event.stemSpan : -STEM_LENGTH - event.stemSpan)
    };
  }

  function addBeamPair(system, firstEvent, secondEvent, layout) {
    const first = stemTip(firstEvent, layout);
    const second = stemTip(secondEvent, layout);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const width = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const levels = Math.min(firstEvent.spec.flags, secondEvent.spec.flags);
    for (let level = 0; level < levels; level += 1) {
      const offset = level * (firstEvent.stemDown ? -7 : 7);
      const beam = document.createElement("span");
      beam.className = "note-beam";
      beam.style.left = `${first.x}px`;
      beam.style.top = `${first.y + offset}px`;
      beam.style.width = `${width}px`;
      beam.style.transform = `rotate(${angle}deg)`;
      beam.setAttribute("aria-hidden", "true");
      system.append(beam);
    }
  }

  function addBeams(systems, beamGroups, layout) {
    beamGroups.forEach((group) => {
      for (let index = 0; index < group.length - 1; index += 1) {
        addBeamPair(systems[group[index].systemIndex].element, group[index], group[index + 1], layout);
      }
    });
  }

  function buildEngravedLanes() {
    const eventsByStaff = { treble: [], bass: [] };
    onsetGroups().forEach((group) => {
      ["treble", "bass"].forEach((staff) => {
        const notes = group.notes.filter((note) => noteStaff(note) === staff).sort((a, b) => a.midi - b.midi);
        if (!notes.length) return;
        const durationBeats = Math.max(...notes.map((note) => note.durationBeats || RHYTHM_QUANTUM));
        eventsByStaff[staff].push({
          id: `${group.id}-${staff}`,
          startBeat: group.startBeat,
          durationBeats,
          endBeat: group.startBeat + durationBeats,
          notes
        });
      });
    });

    const lanesByStaff = { treble: [], bass: [] };
    ["treble", "bass"].forEach((staff) => {
      eventsByStaff[staff]
        .sort((a, b) => a.startBeat - b.startBeat || b.durationBeats - a.durationBeats)
        .forEach((event) => {
          let lane = lanesByStaff[staff].find((candidate) => candidate.endBeat <= event.startBeat + 0.001);
          if (!lane) {
            lane = { endBeat: 0, events: [], pieces: [] };
            lanesByStaff[staff].push(lane);
          }
          lane.events.push(event);
          lane.endBeat = event.endBeat;
          splitDuration(event.startBeat, event.durationBeats).forEach((piece) => {
            lane.pieces.push({
              id: `${event.id}-${piece.index}`,
              sourceId: event.id,
              startBeat: piece.startBeat,
              spec: piece.spec,
              notes: event.notes,
              tiedFromPrevious: piece.tiedFromPrevious,
              tiedToNext: piece.tiedToNext
            });
          });
        });
      if (!lanesByStaff[staff].length) lanesByStaff[staff].push({ endBeat: 0, events: [], pieces: [] });
    });
    return lanesByStaff;
  }

  function buildEngravedSegments() {
    const lanes = buildEngravedLanes();
    return [...lanes.treble, ...lanes.bass].flatMap((lane) => lane.pieces);
  }

  function measureLaneSegments(lane, measureStart, measureEnd) {
    const result = [];
    let cursor = measureStart;
    lane.pieces
      .filter((piece) => piece.startBeat >= measureStart - 0.001 && piece.startBeat < measureEnd - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat)
      .forEach((piece) => {
        if (piece.startBeat > cursor + 0.001) {
          splitDuration(cursor, piece.startBeat - cursor).forEach((restPiece) => {
            result.push({
              id: `rest-${cursor}-${restPiece.index}`,
              startBeat: restPiece.startBeat,
              spec: restPiece.spec,
              notes: [],
              isRest: true
            });
          });
        }
        result.push(piece);
        cursor = Math.max(cursor, piece.startBeat + piece.spec.beats);
      });
    if (cursor < measureEnd - 0.001) {
      splitDuration(cursor, measureEnd - cursor).forEach((restPiece) => {
        result.push({
          id: `rest-${cursor}-${restPiece.index}`,
          startBeat: restPiece.startBeat,
          spec: restPiece.spec,
          notes: [],
          isRest: true
        });
      });
    }
    return result;
  }

  function measureRestTrackSegments(restSegments, measureStart, measureEnd, staff, groups) {
    const result = [];
    let cursor = measureStart;
    const addHiddenTime = (startBeat, durationBeats) => {
      if (durationBeats <= 0.001) return;
      splitDuration(startBeat, durationBeats).forEach((piece) => {
        result.push({
          id: `rest-time-${staff}-${piece.startBeat}-${piece.index}`,
          startBeat: piece.startBeat,
          spec: piece.spec,
          notes: [],
          isRest: true,
          hiddenRest: true
        });
      });
    };

    restSegments
      .filter((segment) => segment.startBeat >= measureStart - 0.001 && segment.startBeat < measureEnd - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat)
      .forEach((segment) => {
        if (segment.startBeat > cursor + 0.001) addHiddenTime(cursor, segment.startBeat - cursor);
        result.push({
          ...segment,
          id: `confirmed-rest-${staff}-${segment.startBeat}`,
          notes: [],
          isRest: true,
          hiddenRest: restStaffAt(segment.startBeat, groups) !== staff
        });
        cursor = Math.max(cursor, segment.startBeat + segment.spec.beats);
      });

    if (cursor < measureEnd - 0.001) addHiddenTime(cursor, measureEnd - cursor);
    return result;
  }

  function vexDuration(spec, isRest) {
    const base = {
      measure: "w",
      whole: "w",
      "dotted-half": "h",
      half: "h",
      "dotted-quarter": "q",
      quarter: "q",
      "dotted-eighth": "8",
      eighth: "8",
      sixteenth: "16"
    }[spec.slug] || "16";
    return `${base}${spec.dotted ? "d" : ""}${isRest ? "r" : ""}`;
  }

  function vexKey(recordedNote) {
    const match = (recordedNote.spelling || recordedNote.note).match(/^([A-G])([#b]?)(\d)$/);
    return `${match[1].toLowerCase()}${match[2]}/${match[3]}`;
  }

  function createEngravedEntry(VF, segment, staff, accidentalState, laneIndex = 0, laneCount = 1) {
    const notes = segment.notes.filter((note) => noteStaff(note) === staff).sort((a, b) => a.midi - b.midi);
    const isRest = notes.length === 0;
    const hiddenRest = isRest && segment.hiddenRest;
    const fullMeasureRest = isRest && segment.spec.fullMeasure;
    const hangsFromFourthLine = fullMeasureRest || (isRest && segment.spec.slug === "whole");
    const restKey = staff === "treble"
      ? hangsFromFourthLine ? "d/5" : "b/4"
      : hangsFromFourthLine ? "f/3" : "d/3";
    const keys = isRest ? [restKey] : notes.map(vexKey);
    const vexNote = hiddenRest
      ? new VF.GhostNote({ duration: vexDuration(segment.spec, false) })
      : new VF.StaveNote({
        clef: staff,
        keys,
        duration: vexDuration(segment.spec, isRest),
        auto_stem: true
      });
    if (fullMeasureRest) {
      vexNote.setDuration(new VF.Fraction(measureCapacity(), 4));
      if (!hiddenRest) vexNote.setCenterAlignment(true);
    }
    if (segment.spec.dotted && !hiddenRest) VF.Dot.buildAndAttach([vexNote], { all: true });
    if (!isRest) {
      const middleLineStep = staff === "treble" ? 13 : 1;
      const furthestNote = notes.reduce((furthest, recordedNote) => {
        const step = diatonicStep(recordedNote.spelling || recordedNote.note);
        const distance = Math.abs(step - middleLineStep);
        if (!furthest || distance > furthest.distance || (distance === furthest.distance && step >= middleLineStep)) {
          return { step, distance };
        }
        return furthest;
      }, null);
      vexNote.setStemDirection(furthestNote.step >= middleLineStep ? VF.Stem.DOWN : VF.Stem.UP);
    }

    const idToIndex = new Map();
    notes.forEach((recordedNote, noteIndex) => {
      idToIndex.set(recordedNote.id, noteIndex);
      const spelling = recordedNote.spelling || recordedNote.note;
      const match = spelling.match(/^([A-G])([#b]?)(\d)$/);
      const pitchKey = `${match[1]}${match[3]}`;
      const alteration = match[2] || "natural";
      const previous = accidentalState.get(pitchKey) || "natural";
      const isAttack = Math.abs(recordedNote.startBeat - segment.startBeat) < 0.001;
      if (isAttack && alteration !== previous) {
        const symbol = alteration === "natural" ? "n" : alteration;
        vexNote.addModifier(new VF.Accidental(symbol), noteIndex);
      }
      accidentalState.set(pitchKey, alteration);
    });

    return { segment, staff, notes, isRest, hiddenRest, vexNote, idToIndex, laneIndex };
  }

  function addEngravedTie(VF, context, firstEntry, lastEntry, noteId) {
    const firstIndex = firstEntry?.idToIndex.get(noteId) ?? 0;
    const lastIndex = lastEntry?.idToIndex.get(noteId) ?? 0;
    const tie = new VF.StaveTie({
      first_note: firstEntry?.vexNote,
      last_note: lastEntry?.vexNote,
      first_indices: [firstIndex],
      last_indices: [lastIndex]
    });
    tie.setContext(context).draw();
  }

  function addScoreHitTargets(system, entries) {
    entries.forEach((entry) => {
      if (entry.isRest) return;
      const noteX = entry.vexNote.getAbsoluteX();
      const noteYs = entry.vexNote.getYs();
      entry.notes.forEach((recordedNote, noteIndex) => {
        if (Math.abs(recordedNote.startBeat - entry.segment.startBeat) > 0.001) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `score-hit-target${state.selectedId === recordedNote.id ? " is-selected" : ""}`;
        button.dataset.id = recordedNote.id;
        button.style.left = `${noteX - 12}px`;
        button.style.top = `${noteYs[noteIndex] - 12}px`;
        button.setAttribute("aria-label", `${spokenNote(recordedNote.spelling || recordedNote.note)}, ${entry.segment.spec.name}. Select to edit.`);
        button.setAttribute("aria-pressed", state.selectedId === recordedNote.id ? "true" : "false");
        system.append(button);
      });
    });
  }

  function renderEngravedSystems(totalMeasures, totalBeats, layout) {
    const VF = window.Vex?.Flow || window.Vex;
    if (!VF?.Renderer) throw new Error("The music engraving library did not load.");
    const lanesByStaff = buildEngravedLanes();
    const entriesByLane = new Map();
    const systemModels = [];
    const { numerator, denominator } = timeSignatureParts();
    const groups = onsetGroups();
    const confirmedRestEnd = Math.min(totalBeats, state.timelineEndBeat || 0);
    const confirmedRests = globalRestSegments(groups, confirmedRestEnd);

    for (let systemIndex = 0; systemIndex < layout.systemCount; systemIndex += 1) {
      const firstMeasure = systemIndex * layout.measuresPerSystem;
      const measuresInSystem = Math.min(layout.measuresPerSystem, totalMeasures - firstMeasure);
      const systemWidth = measuresInSystem * layout.measureWidth + 20;
      const system = document.createElement("div");
      system.className = "score-system engraved-system";
      system.style.width = `${systemWidth}px`;
      system.style.height = `${layout.systemHeight}px`;
      system.setAttribute("aria-label", measuresInSystem === 1
        ? `Measure ${firstMeasure + 1}`
        : `Measures ${firstMeasure + 1} through ${firstMeasure + measuresInSystem}`);
      const engraving = document.createElement("div");
      engraving.className = "score-engraving";
      engraving.setAttribute("aria-hidden", "true");
      system.append(engraving);
      el.staff.append(system);

      const renderer = new VF.Renderer(engraving, VF.Renderer.Backends.SVG);
      renderer.resize(systemWidth, layout.systemHeight);
      const context = renderer.getContext();
      const systemEntries = [];

      for (let localMeasure = 0; localMeasure < measuresInSystem; localMeasure += 1) {
        const measureIndex = firstMeasure + localMeasure;
        const measureStart = measureIndex * layout.capacity;
        const measureEnd = measureStart + layout.capacity;
        const x = 10 + localMeasure * layout.measureWidth;
        const trebleStave = new VF.Stave(x, 34, layout.measureWidth);
        const bassStave = new VF.Stave(x, 144, layout.measureWidth);
        if (localMeasure === 0) {
          trebleStave.addClef("treble").addTimeSignature(state.timeSignature);
          bassStave.addClef("bass").addTimeSignature(state.timeSignature);
        }
        if (systemIndex === 0 && localMeasure === 0) {
          const duration = denominator === 8 ? "8" : denominator === 2 ? "h" : "q";
          trebleStave.setTempo({ name: tempoWord(), duration, bpm: state.tempo }, -8);
        }
        trebleStave.setContext(context).draw();
        bassStave.setContext(context).draw();

        if (localMeasure === 0) {
          new VF.StaveConnector(trebleStave, bassStave)
            .setType(VF.StaveConnector.type.BRACE)
            .setContext(context)
            .draw();
          new VF.StaveConnector(trebleStave, bassStave)
            .setType(VF.StaveConnector.type.SINGLE_LEFT)
            .setContext(context)
            .draw();
        }

        const voiceModels = [];
        [
          { staff: "treble", stave: trebleStave },
          { staff: "bass", stave: bassStave }
        ].forEach(({ staff, stave }) => {
          const lanes = lanesByStaff[staff];
          lanes.forEach((lane, laneIndex) => {
            const laneKey = `${staff}-${laneIndex}`;
            const accidentalState = new Map();
            const laneSegments = measureLaneSegments(lane, measureStart, measureEnd);
            laneSegments.forEach((segment) => {
              // Note voices need complete timing for VexFlow, but only the
              // separate confirmed-silence track is allowed to print rests.
              if (segment.isRest) segment.hiddenRest = true;
            });
            const entries = laneSegments.map((segment) => (
              createEngravedEntry(VF, segment, staff, accidentalState, laneIndex, lanes.length)
            ));
            const notes = entries.map((entry) => entry.vexNote);
            const voice = new VF.Voice({ num_beats: numerator, beat_value: denominator })
              .setStrict(false)
              .addTickables(notes);
            voiceModels.push({ staff, stave, laneKey, entries, notes, voice });
          });

          const restEntries = measureRestTrackSegments(
            confirmedRests,
            measureStart,
            measureEnd,
            staff,
            groups
          ).map((segment) => createEngravedEntry(VF, segment, staff, new Map()));
          if (restEntries.some((entry) => !entry.hiddenRest)) {
            const notes = restEntries.map((entry) => entry.vexNote);
            const voice = new VF.Voice({ num_beats: numerator, beat_value: denominator })
              .setStrict(false)
              .addTickables(notes);
            voiceModels.push({
              staff,
              stave,
              laneKey: `${staff}-confirmed-rests`,
              entries: restEntries,
              notes,
              voice
            });
          }
        });

        const beamOptions = {
          groups: VF.Beam.getDefaultBeamGroups(state.timeSignature),
          beam_rests: false,
          maintain_stem_directions: false
        };
        // Attach beams before drawing the notes. Otherwise flagged notes are
        // painted first and keep their individual flags underneath the beam.
        voiceModels.forEach((model) => {
          model.beams = VF.Beam.generateBeams(model.notes, beamOptions);
        });

        const formatter = new VF.Formatter();
        ["treble", "bass"].forEach((staff) => {
          const staffVoices = voiceModels
            .filter((model) => model.staff === staff)
            .map((model) => model.voice);
          if (staffVoices.length) formatter.joinVoices(staffVoices);
        });
        formatter.format(voiceModels.map(({ voice }) => voice), layout.measureWidth - (localMeasure === 0 ? 104 : 34));
        voiceModels.forEach(({ voice, stave }) => voice.draw(context, stave));

        voiceModels.forEach(({ beams, entries, laneKey }) => {
          beams.forEach((beam) => beam.setContext(context).draw());
          if (!entriesByLane.has(laneKey)) entriesByLane.set(laneKey, []);
          entries.forEach((entry) => {
            entry.context = context;
            entry.systemIndex = systemIndex;
            entry.laneKey = laneKey;
            entriesByLane.get(laneKey).push(entry);
            systemEntries.push(entry);
          });
        });
      }
      systemModels.push({ system, context, entries: systemEntries });
    }

    entriesByLane.forEach((laneEntries) => {
      const entries = laneEntries.sort((a, b) => a.segment.startBeat - b.segment.startBeat);
      for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1];
        const current = entries[index];
        if (!current.segment.tiedFromPrevious || previous.segment.sourceId !== current.segment.sourceId) continue;
        if (Math.abs(previous.segment.startBeat + previous.segment.spec.beats - current.segment.startBeat) > 0.001) continue;
        const sharedIds = previous.notes.filter((note) => current.idToIndex.has(note.id)).map((note) => note.id);
        sharedIds.forEach((noteId) => {
          if (previous.systemIndex === current.systemIndex) {
            addEngravedTie(VF, current.context, previous, current, noteId);
          } else {
            addEngravedTie(VF, previous.context, previous, null, noteId);
            addEngravedTie(VF, current.context, null, current, noteId);
          }
        });
      }
    });
    systemModels.forEach(({ system, entries }) => addScoreHitTargets(system, entries));
  }

  function renderScore(shouldFollow = false) {
    const previousViewportScroll = {
      top: el.scoreViewport.scrollTop,
      left: el.scoreViewport.scrollLeft
    };
    const previousStaffHeight = el.staff.offsetHeight;
    const hasNotes = state.notes.length > 0;
    el.emptyScore.hidden = hasNotes;
    el.staff.classList.toggle("has-notes", hasNotes);
    // Keep the scroll range from collapsing while the synchronous engraving is
    // replaced. Without this guard, scrollTop is forced to zero for a moment.
    if (previousStaffHeight > 0) el.staff.style.minHeight = `${previousStaffHeight}px`;
    el.staff.replaceChildren();
    const groups = onsetGroups();
    updateChordStaffAssignments(groups);
    const capacity = measureCapacity();
    const noteEnd = hasNotes ? Math.max(...groups.map((group) => group.startBeat + group.durationBeats)) : 0;
    const scoreEnd = Math.max(noteEnd, state.timelineEndBeat || 0);
    const totalBeats = hasNotes ? Math.max(capacity, Math.ceil(scoreEnd / capacity) * capacity) : capacity;
    const totalMeasures = Math.max(1, Math.round(totalBeats / capacity));
    const layout = scoreLayout(totalMeasures);
    el.staff.style.width = "";
    if (hasNotes) {
      try {
        renderEngravedSystems(totalMeasures, totalBeats, layout);
      } catch (error) {
        console.error(error);
        const message = document.createElement("p");
        message.className = "score-render-error";
        message.textContent = "The music sheet could not be drawn. Your recording is still saved; reload the page to try again.";
        el.staff.append(message);
        setAppStatus("Music sheet needs a reload", "error");
      }
    }
    const selected = state.notes.find((note) => note.id === state.selectedId);
    el.selectionBar.hidden = !selected;
    if (selected) el.selectionLabel.textContent = `${displayNote(selected.spelling || selected.note)} · ${durationName(selected.durationBeats)} selected`;
    el.undo.disabled = state.undoStack.length === 0;
    el.redo.disabled = state.redoStack.length === 0;
    el.playScore.disabled = !hasNotes;
    el.exportOpen.disabled = !hasNotes;
    el.clearScore.disabled = !hasNotes;
    el.playScore.textContent = state.playing ? "Stop playback" : "Play idea";
    el.scoreTitle.textContent = state.ideaTitle;
    const measureCount = hasNotes ? totalMeasures : 0;
    el.scoreMeta.textContent = hasNotes
      ? `${groups.length} ${groups.length === 1 ? "attack" : "attacks"} · ${measureCount} ${measureCount === 1 ? "measure" : "measures"} · C major · ${state.timeSignature} · ${beatUnitName()} = ${state.tempo}`
      : `C major · ${state.timeSignature} time · ${beatUnitName()} = ${state.tempo} BPM · 10 ms chord window`;
    updateStatus();
    el.staff.style.minHeight = "";
    // System heights are fixed, so the final scroll range is available now.
    // Move before the browser paints to avoid a visible top-then-bottom flash.
    const maxTop = Math.max(0, el.scoreViewport.scrollHeight - el.scoreViewport.clientHeight);
    const maxLeft = Math.max(0, el.scoreViewport.scrollWidth - el.scoreViewport.clientWidth);
    if (shouldFollow) {
      el.scoreViewport.scrollTop = maxTop;
      el.scoreViewport.scrollLeft = 0;
    } else {
      el.scoreViewport.scrollTop = Math.min(previousViewportScroll.top, maxTop);
      el.scoreViewport.scrollLeft = Math.min(previousViewportScroll.left, maxLeft);
    }
  }

  function scheduleScoreRender(shouldFollow = false) {
    scoreShouldFollow = scoreShouldFollow || shouldFollow;
    if (scoreRenderFrame !== null) return;
    scoreRenderFrame = requestAnimationFrame(() => {
      scoreRenderFrame = null;
      const follow = scoreShouldFollow;
      scoreShouldFollow = false;
      renderScore(follow);
    });
  }

  function updateStatus() {
    const count = state.notes.length;
    const saved = storageUnavailable ? "export before leaving" : `${count} ${count === 1 ? "note" : "notes"} saved`;
    if (state.playing) setAppStatus("Playing your idea", "playing");
    else if (state.recording) setAppStatus(`Recording • ${saved}`, "recording");
    else setAppStatus(`Recording paused • ${saved}`, "paused");
    el.recordToggle.classList.toggle("is-paused", !state.recording);
    el.recordToggle.setAttribute("aria-pressed", String(state.recording));
    el.recordToggle.querySelector("span:last-child").textContent = state.recording ? "Recording on" : "Recording paused";
  }

  async function ensureAudio() {
    if (audioUnavailable) return false;
    try {
      if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unsupported");
        audioContext = new AudioContextClass();
        masterGain = audioContext.createGain();
        masterGain.gain.value = state.volume / 100;
        masterGain.connect(audioContext.destination);
      }
      if (audioContext.state === "suspended") await audioContext.resume();
      return true;
    } catch (error) {
      audioUnavailable = true;
      setAppStatus("Sound unavailable in this browser", "error");
      showToast("Sound could not start. Check browser audio permissions and try again.", "error");
      return false;
    }
  }

  function startVoice(note, startAt = audioContext?.currentTime) {
    if (!audioContext || activeVoices.has(note)) return;
    const item = noteByName.get(note);
    const frequency = 440 * 2 ** ((item.midi - 69) / 12);
    const now = Math.max(audioContext.currentTime, startAt || audioContext.currentTime);
    const voiceGain = audioContext.createGain();
    const configs = {
      piano: [{ type: "triangle", ratio: 1, level: 0.72 }, { type: "sine", ratio: 2, level: 0.21 }, { type: "sine", ratio: 3, level: 0.08 }],
      electric: [{ type: "sine", ratio: 1, level: 0.68 }, { type: "triangle", ratio: 2, level: 0.18 }, { type: "sine", ratio: 4, level: 0.06 }],
      organ: [{ type: "sine", ratio: 1, level: 0.55 }, { type: "square", ratio: 2, level: 0.13 }, { type: "sine", ratio: 3, level: 0.11 }]
    }[state.instrument];
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.exponentialRampToValueAtTime(state.instrument === "organ" ? 0.36 : 0.55, now + 0.018);
    if (state.instrument === "piano") voiceGain.gain.exponentialRampToValueAtTime(0.13, now + 1.25);
    if (state.instrument === "electric") voiceGain.gain.exponentialRampToValueAtTime(0.2, now + 1.8);
    voiceGain.connect(masterGain);
    const oscillators = configs.map((config) => {
      const oscillator = audioContext.createOscillator();
      const partialGain = audioContext.createGain();
      oscillator.type = config.type;
      oscillator.frequency.value = frequency * config.ratio;
      partialGain.gain.value = config.level;
      oscillator.connect(partialGain).connect(voiceGain);
      oscillator.start(now);
      return oscillator;
    });
    activeVoices.set(note, { oscillators, gain: voiceGain });
  }

  function queueKeyboardVoice(note) {
    if (!keyboardAudioBatch) {
      keyboardAudioBatch = {
        notes: new Set(),
        audioReady: ensureAudio(),
        timer: null
      };
      keyboardAudioBatch.timer = window.setTimeout(async () => {
        const batch = keyboardAudioBatch;
        keyboardAudioBatch = null;
        if (!batch || !(await batch.audioReady) || !audioContext) return;
        const heldNotes = [...batch.notes].filter((queuedNote) => activeSources.get(queuedNote)?.size);
        if (!heldNotes.length) return;
        const sharedStartTime = audioContext.currentTime + 0.005;
        heldNotes.forEach((queuedNote) => startVoice(queuedNote, sharedStartTime));
      }, CHORD_WINDOW_MS);
    }
    keyboardAudioBatch.notes.add(note);
  }

  function cancelKeyboardAudioBatch() {
    if (!keyboardAudioBatch) return;
    window.clearTimeout(keyboardAudioBatch.timer);
    keyboardAudioBatch = null;
  }

  function stopVoice(note) {
    const voice = activeVoices.get(note);
    if (!voice || !audioContext) return;
    const now = audioContext.currentTime;
    const release = state.instrument === "organ" ? 0.18 : 0.35;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, release / 4);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + release + 0.08));
    activeVoices.delete(note);
  }

  function setKeyActive(note, active) {
    const key = el.piano.querySelector(`[data-note="${CSS.escape(note)}"]`);
    if (key) key.classList.toggle("is-active", active);
  }

  function bridgeShortGapTo(onsetBeat, silenceDurationMs = null) {
    const previousGroup = onsetGroups()
      .filter((group) => group.startBeat < onsetBeat - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat)
      .at(-1);
    if (!previousGroup) return;
    const previousEnd = Math.max(...previousGroup.notes.map(
      (recordedNote) => recordedNote.startBeat + (recordedNote.durationBeats || RHYTHM_QUANTUM)
    ));
    const silentGap = onsetBeat - previousEnd;
    const isQuickKeyTransition = Number.isFinite(silenceDurationMs)
      ? silenceDurationMs < REST_CONFIRM_DELAY_MS
      : silentGap < MIN_REST_BEATS - 0.001;
    if (silentGap <= 0.001 || !isQuickKeyTransition) return;
    previousGroup.notes.forEach((recordedNote) => {
      const joinedDuration = quantizeBeat(onsetBeat - recordedNote.startBeat);
      recordedNote.durationBeats = Math.max(recordedNote.durationBeats || RHYTHM_QUANTUM, joinedDuration);
      recordedNote.duration = millisecondsFromQuarterUnits(recordedNote.durationBeats) / 1000;
    });
  }

  function bridgeAllShortGaps() {
    const groups = onsetGroups();
    for (let index = 1; index < groups.length; index += 1) {
      const previousGroup = groups[index - 1];
      const nextOnset = groups[index].startBeat;
      const previousEnd = Math.max(...previousGroup.notes.map(
        (recordedNote) => recordedNote.startBeat + (recordedNote.durationBeats || RHYTHM_QUANTUM)
      ));
      const silentGap = nextOnset - previousEnd;
      if (silentGap <= 0.001 || silentGap >= MIN_REST_BEATS - 0.001) continue;
      previousGroup.notes.forEach((recordedNote) => {
        recordedNote.durationBeats = Math.max(
          recordedNote.durationBeats || RHYTHM_QUANTUM,
          quantizeBeat(nextOnset - recordedNote.startBeat)
        );
        recordedNote.duration = millisecondsFromQuarterUnits(recordedNote.durationBeats) / 1000;
      });
    }
  }

  function scheduleSilentMeasureConfirmation() {
    cancelSilentMeasureTimer();
    if (!state.recording || state.playing || activeSources.size || !recordingClock || !state.notes.length) return;
    const capacity = measureCapacity();
    const lastSoundEnd = Math.max(...state.notes.map(
      (recordedNote) => recordedNote.startBeat + (recordedNote.durationBeats || RHYTHM_QUANTUM)
    ));
    const firstEmptyMeasureStart = Math.ceil((lastSoundEnd - 0.001) / capacity) * capacity;
    let targetBeat = firstEmptyMeasureStart + capacity;
    while (targetBeat <= (state.timelineEndBeat || 0) + 0.001) targetBeat += capacity;
    const currentBeat = recordingClock.startBeat
      + quarterUnitsFromMs(performance.now() - recordingClock.startedAt);
    if (currentBeat > targetBeat + capacity) {
      targetBeat += Math.floor((currentBeat - targetBeat) / capacity) * capacity;
    }
    const delay = Math.max(0, millisecondsFromQuarterUnits(targetBeat - currentBeat));
    const clock = recordingClock;
    silentMeasureTimer = window.setTimeout(() => {
      silentMeasureTimer = null;
      if (recordingClock !== clock || !state.recording || state.playing || activeSources.size) return;
      state.timelineEndBeat = Math.max(state.timelineEndBeat || 0, targetBeat);
      saveAll();
      scheduleScoreRender(true);
      scheduleSilentMeasureConfirmation();
    }, delay + 8);
  }

  function recordNote(note, inputStartedAt = performance.now(), silenceDurationMs = null) {
    if (!state.recording || state.playing) return;
    cancelSilentMeasureTimer();
    pushHistory();
    const item = noteByName.get(note);
    const hasHeldCompanion = [...activeSources.entries()].some(
      ([activeNote, sources]) => activeNote !== note && sources.size > 0
    );
    const onset = resolveOnset(inputStartedAt, hasHeldCompanion);
    const joinsExistingOnset = state.notes.some((recordedNote) => recordedNote.onsetId === onset.id);
    if (!joinsExistingOnset) {
      activeRecordIds.forEach((activeId) => {
        const heldNote = state.notes.find((recordedNote) => recordedNote.id === activeId);
        if (!heldNote || heldNote.onsetId === onset.id) return;
        heldNote.durationBeats = Math.max(
          heldNote.durationBeats || 1,
          quantizeBeat(onset.startBeat - heldNote.startBeat + RHYTHM_QUANTUM)
        );
      });
      bridgeShortGapTo(onset.startBeat, silenceDurationMs);
    }
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.notes.push({
      id,
      onsetId: onset.id,
      note,
      spelling: chooseSpelling(note, onset.id),
      midi: item.midi,
      duration: millisecondsFromQuarterUnits(RHYTHM_QUANTUM) / 1000,
      durationBeats: RHYTHM_QUANTUM,
      startBeat: onset.startBeat,
      createdAt: Date.now()
    });
    state.timelineEndBeat = Math.max(state.timelineEndBeat || 0, onset.startBeat);
    activeRecordIds.set(note, id);
    recordStartTimes.set(id, inputStartedAt);
    state.selectedId = null;
    saveAll();
    scheduleScoreRender(true);
  }

  function finishRecordedNote(note, inputEndedAt = performance.now()) {
    const id = activeRecordIds.get(note);
    if (!id) return;
    const record = state.notes.find((item) => item.id === id);
    const started = recordStartTimes.get(id);
    if (record && Number.isFinite(started)) {
      const durationMs = Math.max(1, inputEndedAt - started);
      record.duration = durationMs / 1000;
      record.durationBeats = Math.max(
        record.durationBeats || RHYTHM_QUANTUM,
        RHYTHM_QUANTUM,
        quantizeBeat(quarterUnitsFromMs(durationMs))
      );
    }
    activeRecordIds.delete(note);
    recordStartTimes.delete(id);
    saveAll();
    // The final duration can cross a bar or system boundary, so keep the
    // newly created measure/row in view after the key is released as well.
    scheduleScoreRender(true);
    if (!activeSources.size) scheduleSilentMeasureConfirmation();
  }

  function pressNote(note, source, allowRecording = true, inputStartedAt = performance.now()) {
    if (!noteByName.has(note)) return;
    const silenceDurationMs = Number.isFinite(silenceStartedAt)
      ? Math.max(0, inputStartedAt - silenceStartedAt)
      : null;
    let sources = activeSources.get(note);
    if (!sources) {
      sources = new Set();
      activeSources.set(note, sources);
    }
    if (sources.has(source)) return;
    const firstSource = sources.size === 0;
    sources.add(source);
    if (!firstSource) return;
    setKeyActive(note, true);
    if (source.startsWith("keyboard:")) {
      queueKeyboardVoice(note);
    } else {
      ensureAudio().then((ready) => {
        if (ready && activeSources.get(note)?.size) startVoice(note);
      });
    }
    if (allowRecording) recordNote(note, inputStartedAt, silenceDurationMs);
    silenceStartedAt = null;
  }

  function releaseNote(note, source, inputEndedAt = performance.now()) {
    const sources = activeSources.get(note);
    if (!sources) return;
    sources.delete(source);
    if (sources.size > 0) return;
    activeSources.delete(note);
    if (!activeSources.size) silenceStartedAt = inputEndedAt;
    setKeyActive(note, false);
    stopVoice(note);
    finishRecordedNote(note, inputEndedAt);
  }

  function stopAllNotes(inputEndedAt = performance.now()) {
    cancelKeyboardAudioBatch();
    activeSources.forEach((sources, note) => {
      setKeyActive(note, false);
      stopVoice(note);
      finishRecordedNote(note, inputEndedAt);
    });
    activeSources.clear();
    activeKeyboard.clear();
    resetRecordingClock();
  }

  function toggleRecording() {
    state.recording = !state.recording;
    resetRecordingClock();
    updateStatus();
    showToast(state.recording ? "Recording resumed." : "Recording paused. You can still play freely.");
  }

  function stopPlayback() {
    playbackTimers.forEach((timer) => clearTimeout(timer));
    playbackTimers = [];
    [...activeSources.entries()].forEach(([note, sources]) => {
      [...sources].filter((source) => source.startsWith("playback:")).forEach((source) => releaseNote(note, source));
    });
    state.playing = false;
    resetRecordingClock();
    renderScore();
  }

  function playComposition() {
    if (state.playing) return stopPlayback();
    if (!state.notes.length) return;
    resetRecordingClock();
    state.playing = true;
    renderScore();
    let endTime = 0;
    onsetGroups().forEach((group, groupIndex) => {
      const startTime = millisecondsFromQuarterUnits(group.startBeat);
      group.notes.forEach((recordedNote, noteIndex) => {
        const source = `playback:${groupIndex}:${noteIndex}`;
        const duration = millisecondsFromQuarterUnits(recordedNote.durationBeats || RHYTHM_QUANTUM);
        playbackTimers.push(setTimeout(() => pressNote(recordedNote.note, source, false), startTime));
        playbackTimers.push(setTimeout(() => releaseNote(recordedNote.note, source), startTime + duration));
        endTime = Math.max(endTime, startTime + duration);
      });
    });
    playbackTimers.push(setTimeout(() => {
      state.playing = false;
      playbackTimers = [];
      renderScore();
      showToast("Playback finished.");
    }, endTime + 80));
  }

  function undo() {
    if (!state.undoStack.length) return;
    stopPlayback();
    state.redoStack.push(cloneNotes());
    state.notes = state.undoStack.pop();
    state.timelineEndBeat = latestOnsetBeat();
    state.selectedId = null;
    resetRecordingClock();
    saveAll();
    renderScore();
    showToast("Last change undone.");
  }

  function redo() {
    if (!state.redoStack.length) return;
    stopPlayback();
    state.undoStack.push(cloneNotes());
    state.notes = state.redoStack.pop();
    state.timelineEndBeat = latestOnsetBeat();
    state.selectedId = null;
    resetRecordingClock();
    saveAll();
    renderScore();
    showToast("Change restored.");
  }

  function deleteSelectedNote() {
    const index = state.notes.findIndex((note) => note.id === state.selectedId);
    if (index < 0) return;
    pushHistory();
    const [deleted] = state.notes.splice(index, 1);
    state.timelineEndBeat = latestOnsetBeat();
    state.selectedId = null;
    resetRecordingClock();
    saveAll();
    renderScore();
    showToast(`${displayNote(deleted.spelling || deleted.note)} deleted. Undo is available.`);
  }

  function clearComposition() {
    if (!state.notes.length) return;
    if (!clearArmed) {
      clearArmed = true;
      el.clearScore.textContent = "Click again to clear";
      showToast("Click “Clear idea” again to confirm.");
      clearTimer = setTimeout(() => {
        clearArmed = false;
        el.clearScore.textContent = "Clear idea";
      }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    el.clearScore.textContent = "Clear idea";
    stopPlayback();
    pushHistory();
    state.notes = [];
    state.timelineEndBeat = 0;
    state.selectedId = null;
    resetRecordingClock();
    saveAll();
    renderScore();
    showToast("Idea cleared. Undo can bring it back.");
  }

  function openDialog(dialog) {
    stopAllNotes();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function openSettings() {
    el.profileName.value = state.profileName;
    el.ideaTitle.value = state.ideaTitle === "Untitled idea" ? "" : state.ideaTitle;
    el.bindingsError.hidden = true;
    renderBindings();
    openDialog(el.settingsDialog);
  }

  function readBindingInputs() {
    const nextBindings = {};
    const used = new Map();
    let firstProblem = null;
    el.bindingsGrid.querySelectorAll(".binding-input").forEach((input) => {
      const raw = normalizeBinding(input.dataset.raw || input.value);
      const note = input.dataset.note;
      if (!raw || raw === " ") firstProblem ||= `Choose a printable key for ${displayNote(note)}. Space is reserved for recording.`;
      if (raw && used.has(raw)) firstProblem ||= `${formatBinding(raw)} is assigned to both ${displayNote(used.get(raw))} and ${displayNote(note)}.`;
      if (raw) used.set(raw, note);
      nextBindings[note] = raw;
    });
    return { nextBindings, problem: firstProblem };
  }

  function saveSettings(event) {
    event.preventDefault();
    const { nextBindings, problem } = readBindingInputs();
    if (problem) {
      el.bindingsError.textContent = problem;
      el.bindingsError.hidden = false;
      el.bindingsError.scrollIntoView({ block: "nearest" });
      return;
    }
    state.profileName = el.profileName.value.trim().slice(0, 40);
    state.ideaTitle = el.ideaTitle.value.trim().slice(0, 60) || "Untitled idea";
    state.bindings = nextBindings;
    saveAll();
    renderPiano();
    renderScore();
    closeDialog(el.settingsDialog);
    showToast("Settings saved. Piano labels are updated.");
  }

  function noteListText() {
    const labels = formattedOnsetGroups();
    const capacity = measureCapacity();
    const beatUnit = beatUnitQuarterLength();
    return onsetGroups().map((group, index) => {
      const measure = Math.floor(group.startBeat / capacity) + 1;
      const beat = Number(((group.startBeat % capacity) / beatUnit + 1).toFixed(2));
      return `Measure ${measure}, beat ${beat}: ${labels[index]}`;
    }).join("\n");
  }

  function openExport() {
    if (!state.notes.length) return;
    const groups = onsetGroups();
    const beats = Math.max(...groups.map((group) => group.startBeat + group.durationBeats));
    const measures = Math.ceil(beats / measureCapacity());
    el.exportSummary.textContent = `${state.notes.length} ${state.notes.length === 1 ? "note" : "notes"} across ${measures} ${measures === 1 ? "measure" : "measures"} at ${state.tempo} BPM from ${state.ideaTitle}.`;
    el.exportPreview.value = noteListText();
    el.exportState.className = "export-state";
    el.exportState.textContent = "Choose an export option.";
    openDialog(el.exportDialog);
  }

  function setExportState(message, type) {
    el.exportState.className = `export-state ${type === "success" ? "is-success" : "is-error"}`;
    el.exportState.textContent = message;
  }

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(noteListText());
      setExportState("Copied. Paste the note list wherever you keep ideas.", "success");
    } catch (error) {
      try {
        el.exportPreview.select();
        const copied = document.execCommand("copy");
        if (!copied) throw new Error("Copy failed");
        setExportState("Copied. Paste the note list wherever you keep ideas.", "success");
      } catch (fallbackError) {
        setExportState("Copy was blocked. Select the note list and copy it manually.", "error");
      }
    }
  }

  function downloadNotes() {
    try {
      const lines = [state.ideaTitle, `Instrument: ${instrumentLabel()}`, "Range: C3–C5", "Key: C major", `Time signature: ${state.timeSignature}`, `Tempo: ${beatUnitName()} = ${state.tempo} BPM (${tempoWord()})`, "Rhythm: sixteenth-note grid with standard values, rests, dots, and ties", `Notes (${state.notes.length}):`, noteListText(), "", "Created with Melody Catcher"];
      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTitle = state.ideaTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "melody-idea";
      anchor.href = url;
      anchor.download = `${safeTitle}.txt`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportState("Downloaded as a text file.", "success");
    } catch (error) {
      setExportState("The download could not start. Try copying the note list instead.", "error");
    }
  }

  function isInteractiveTarget(target) {
    return target.closest("input, textarea, select, button, dialog, [contenteditable='true']");
  }

  function bindEvents() {
    el.piano.addEventListener("pointerdown", (event) => {
      const key = event.target.closest("[data-note]");
      if (!key) return;
      event.preventDefault();
      key.setPointerCapture?.(event.pointerId);
      pressNote(key.dataset.note, `pointer:${event.pointerId}`, true, performance.now());
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      el.piano.addEventListener(eventName, (event) => {
        const key = event.target.closest("[data-note]");
        if (key) releaseNote(key.dataset.note, `pointer:${event.pointerId}`, performance.now());
      });
    });
    el.piano.addEventListener("click", (event) => {
      const key = event.target.closest("[data-note]");
      if (!key || event.detail !== 0) return;
      const source = `activation:${Date.now()}`;
      pressNote(key.dataset.note, source, true, performance.now());
      setTimeout(() => releaseNote(key.dataset.note, source, performance.now()), 260);
    });
    el.piano.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", (event) => {
      if (event.repeat || isInteractiveTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRecording();
        return;
      }
      const key = normalizeBinding(event.key);
      const note = notesInRange.find((item) => state.bindings[item.note] === key)?.note;
      if (!note || activeKeyboard.has(event.code)) return;
      event.preventDefault();
      const source = `keyboard:${event.code}`;
      activeKeyboard.set(event.code, { note, source });
      pressNote(note, source, true, performance.now());
    });
    window.addEventListener("keyup", (event) => {
      const active = activeKeyboard.get(event.code);
      if (!active) return;
      activeKeyboard.delete(event.code);
      releaseNote(active.note, active.source, performance.now());
    });
    window.addEventListener("blur", stopAllNotes);
    window.addEventListener("resize", () => {
      if (state.notes.length) scheduleScoreRender();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAllNotes();
    });
    el.recordToggle.addEventListener("click", toggleRecording);
    el.playScore.addEventListener("click", playComposition);
    el.undo.addEventListener("click", undo);
    el.redo.addEventListener("click", redo);
    el.deleteNote.addEventListener("click", deleteSelectedNote);
    el.clearScore.addEventListener("click", clearComposition);
    el.exportOpen.addEventListener("click", openExport);
    el.staff.addEventListener("click", (event) => {
      const noteButton = event.target.closest(".score-note, .score-hit-target");
      if (!noteButton) return;
      state.selectedId = state.selectedId === noteButton.dataset.id ? null : noteButton.dataset.id;
      renderScore();
      if (state.selectedId) el.deleteNote.focus();
    });
    el.staff.addEventListener("keydown", (event) => {
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
        event.preventDefault();
        deleteSelectedNote();
      }
    });
    el.instrumentSelect.addEventListener("change", () => {
      state.instrument = el.instrumentSelect.value;
      el.instrumentTitle.textContent = instrumentLabel();
      saveAll();
      stopAllNotes();
      showToast(`${instrumentLabel()} selected.`);
    });
    el.volume.addEventListener("input", () => {
      state.volume = Number(el.volume.value);
      el.volumeOutput.value = `${state.volume}%`;
      if (masterGain && audioContext) masterGain.gain.setTargetAtTime(state.volume / 100, audioContext.currentTime, 0.02);
      saveAll();
    });
    el.tempo.addEventListener("input", () => {
      stopAllNotes();
      state.tempo = Number(el.tempo.value);
      el.tempoOutput.value = `${state.tempo} BPM`;
      saveAll();
      renderScore();
    });
    el.timeSignature.addEventListener("change", () => {
      stopAllNotes();
      state.timeSignature = TIME_SIGNATURES.includes(el.timeSignature.value) ? el.timeSignature.value : "4/4";
      resetRecordingClock();
      saveAll();
      renderScore();
      showToast(`${state.timeSignature} time selected. Measures and rests were recalculated.`);
    });
    el.settingsOpen.addEventListener("click", openSettings);
    el.settingsClose.addEventListener("click", () => closeDialog(el.settingsDialog));
    el.settingsCancel.addEventListener("click", () => closeDialog(el.settingsDialog));
    el.settingsForm.addEventListener("submit", saveSettings);
    el.resetBindings.addEventListener("click", () => {
      renderBindings(defaultBindingMap);
      el.bindingsError.hidden = true;
      showToast("Default controls are ready. Save to apply them.");
    });
    el.bindingsGrid.addEventListener("keydown", (event) => {
      if (!event.target.classList.contains("binding-input")) return;
      if (["Tab", "Shift", "Escape", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Backspace" || event.key === "Delete") {
        event.target.value = "";
        event.target.dataset.raw = "";
        return;
      }
      if (event.key.length === 1) {
        const raw = normalizeBinding(event.key);
        event.target.value = formatBinding(raw);
        event.target.dataset.raw = raw;
        el.bindingsError.hidden = true;
      }
    });
    el.bindingsGrid.addEventListener("input", (event) => {
      if (!event.target.classList.contains("binding-input")) return;
      const raw = normalizeBinding(event.target.value.slice(0, 1));
      event.target.dataset.raw = raw;
      event.target.value = formatBinding(raw);
    });
    el.helpButton.addEventListener("click", () => openDialog(el.helpDialog));
    el.downloadNotes.addEventListener("click", downloadNotes);
    el.copyNotes.addEventListener("click", copyNotes);
    document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    }));
  }

  function initialize() {
    loadSavedState();
    renderPiano();
    renderBindings();
    bindEvents();
    el.instrumentSelect.value = state.instrument;
    el.instrumentTitle.textContent = instrumentLabel();
    el.volume.value = String(state.volume);
    el.volumeOutput.value = `${state.volume}%`;
    el.tempo.value = String(state.tempo);
    el.tempoOutput.value = `${state.tempo} BPM`;
    el.timeSignature.value = state.timeSignature;
    renderScore();
    requestAnimationFrame(() => {
      el.pianoWrap.scrollLeft = Math.max(0, (el.pianoWrap.scrollWidth - el.pianoWrap.clientWidth) / 2);
    });
    if (state.notes.length) showToast(`Recovered ${state.notes.length} saved ${state.notes.length === 1 ? "note" : "notes"}.`);
  }

  initialize();
})();
