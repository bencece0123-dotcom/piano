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
  const TIME_SIGNATURES = ["4/4", "2/2", "6/8", "3/4", "2/4", "12/8", "9/8", "5/4", "7/4", "3/8", "5/8", "7/8", "8/8"];
  const NOTE_VALUES = [
    { beats: 4, name: "whole note", slug: "whole", open: true, stem: false, flags: 0, dotted: false },
    { beats: 3, name: "dotted half note", slug: "dotted-half", open: true, stem: true, flags: 0, dotted: true },
    { beats: 2, name: "half note", slug: "half", open: true, stem: true, flags: 0, dotted: false },
    { beats: 1.5, name: "dotted quarter note", slug: "dotted-quarter", open: false, stem: true, flags: 0, dotted: true },
    { beats: 1, name: "quarter note", slug: "quarter", open: false, stem: true, flags: 0, dotted: false },
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
  let currentOnsetWindow = null;
  let recordingClock = null;
  let lastOnsetBeat = null;
  let scoreRenderFrame = null;

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
    if (!state.notes.length) return 0;
    return quantizeBeat(Math.max(...state.notes.map((note) => note.startBeat + (note.durationBeats || 1))));
  }

  function resetRecordingClock() {
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
    return recordedNote.midi < 60 ? "bass" : "treble";
  }

  function scoreLayout(totalMeasures) {
    const capacity = measureCapacity();
    const viewportWidth = el.scoreViewport.clientWidth || 960;
    const horizontalPadding = viewportWidth <= 780 ? 40 : 68;
    const contentWidth = Math.max(280, viewportWidth - horizontalPadding);
    const availableMusicWidth = Math.max(160, contentWidth - SCORE_START_X - SCORE_END_PADDING);
    const naturalMeasureWidth = capacity * BEAT_SPACING;
    const measuresPerSystem = Math.max(1, Math.min(4, Math.floor(availableMusicWidth / naturalMeasureWidth)));
    const beatSpacing = BEAT_SPACING;
    const beatsPerSystem = capacity * measuresPerSystem;
    return {
      capacity,
      measuresPerSystem,
      beatsPerSystem,
      beatSpacing,
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
      rest.setAttribute("aria-label", `${segment.spec.name} rest, measure ${Math.floor(segment.startBeat / capacity) + 1}`);
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

  function renderScore() {
    const previousViewportScroll = {
      top: el.scoreViewport.scrollTop,
      left: el.scoreViewport.scrollLeft
    };
    const hasNotes = state.notes.length > 0;
    el.emptyScore.hidden = hasNotes;
    el.staff.classList.toggle("has-notes", hasNotes);
    el.staff.replaceChildren();
    const groups = onsetGroups();
    const capacity = measureCapacity();
    const beatUnit = beatUnitQuarterLength();
    const scoreEnd = hasNotes ? Math.max(...groups.map((group) => group.startBeat + group.durationBeats)) : 0;
    const totalBeats = hasNotes ? Math.max(capacity, Math.ceil(scoreEnd / capacity) * capacity) : capacity;
    const totalMeasures = Math.max(1, Math.round(totalBeats / capacity));
    const layout = scoreLayout(totalMeasures);
    const events = buildNotationEvents(groups);
    events.forEach((event) => {
      event.systemIndex = systemIndexForBeat(event.startBeat, layout);
    });
    const eventByNoteSegment = new Map();
    events.forEach((event) => event.notes.forEach((note) => {
      eventByNoteSegment.set(`${note.id}:${event.segmentIndex}`, event);
    }));
    const accidentals = accidentalLayout(groups);
    el.staff.style.width = "";
    if (hasNotes) {
      const systems = [];
      const systemsFragment = document.createDocumentFragment();
      for (let systemIndex = 0; systemIndex < layout.systemCount; systemIndex += 1) {
        const firstMeasure = systemIndex * layout.measuresPerSystem;
        const measuresInSystem = Math.min(layout.measuresPerSystem, totalMeasures - firstMeasure);
        const musicEndX = SCORE_START_X + measuresInSystem * capacity * layout.beatSpacing;
        const system = document.createElement("div");
        system.className = "score-system";
        system.style.width = `${musicEndX + SCORE_END_PADDING}px`;
        system.setAttribute(
          "aria-label",
          measuresInSystem === 1
            ? `Measure ${firstMeasure + 1}`
            : `Measures ${firstMeasure + 1} through ${firstMeasure + measuresInSystem}`
        );
        addStaffFurniture(system, systemIndex, measuresInSystem, layout);
        systems.push({ element: system, musicEndX, measuresInSystem });
        systemsFragment.append(system);
      }

      addRests(systems, groups, totalBeats, layout);
      const beamGroups = buildBeamGroups(events, layout);
      events.forEach((event) => {
        const system = systems[event.systemIndex].element;
        event.notes.forEach((recordedNote) => {
          const isStemNote = event.stemNoteId === recordedNote.id;
          const y = noteY(recordedNote);
          const button = document.createElement("button");
          button.type = "button";
          button.className = [
            "score-note",
            `value-${event.spec.slug}`,
            event.spec.open ? "open-head" : "",
            !event.spec.stem ? "stemless" : "",
            isStemNote && event.stemDown ? "stem-down" : "",
            event.tiedFromPrevious ? "tie-continuation" : "",
            state.selectedId === recordedNote.id ? "is-selected" : ""
          ].filter(Boolean).join(" ");
          button.dataset.id = recordedNote.id;
          if (event.tiedFromPrevious) button.tabIndex = -1;
          button.style.left = `${localBeatX(event.startBeat, event.systemIndex, layout) + event.xOffset}px`;
          button.style.top = `${y}px`;
          button.style.setProperty("--head-shift", `${event.headShiftById.get(recordedNote.id)}px`);
          if (isStemNote) {
            button.style.setProperty("--chord-span", `${event.stemSpan}px`);
            button.style.setProperty("--beam-extension", `${event.beamExtension || 0}px`);
          }
          const beatInMeasure = Number(((event.startBeat % capacity) / beatUnit + 1).toFixed(2));
          button.setAttribute(
            "aria-label",
            `${spokenNote(recordedNote.spelling || recordedNote.note)}, ${event.spec.name}, beat ${beatInMeasure}, measure ${Math.floor(event.startBeat / capacity) + 1}${event.notes.length > 1 ? ", in a chord" : ""}${event.tiedFromPrevious ? ", tied continuation" : ""}. Select to edit.`
          );
          button.setAttribute("aria-pressed", state.selectedId === recordedNote.id ? "true" : "false");
          if (event.segmentIndex === 0) {
            const accidentalInfo = accidentals.get(recordedNote.id);
            if (accidentalInfo) {
              const accidental = document.createElement("span");
              accidental.className = "note-accidental";
              accidental.textContent = accidentalInfo.symbol;
              accidental.style.setProperty("--accidental-offset", `${accidentalInfo.column * 12}px`);
              button.append(accidental);
            }
          }
          const head = document.createElement("span");
          head.className = "note-head";
          button.append(head);
          if (event.spec.dotted) {
            const dot = document.createElement("span");
            dot.className = "note-dot";
            button.append(dot);
          }
          if (isStemNote && event.spec.stem) {
            const stem = document.createElement("span");
            stem.className = "note-stem";
            button.append(stem);
            if (!event.beamed) {
              for (let flagIndex = 0; flagIndex < event.spec.flags; flagIndex += 1) {
                const flag = document.createElement("span");
                flag.className = `note-flag flag-${flagIndex + 1}`;
                button.append(flag);
              }
            }
          }
          ledgerLinePositions(recordedNote).forEach((lineY) => {
            const ledger = document.createElement("span");
            ledger.className = "ledger-line";
            ledger.style.top = `${22 + lineY - y}px`;
            button.append(ledger);
          });
          system.append(button);
        });
      });
      addBeams(systems, beamGroups, layout);
      events.forEach((event) => {
        if (!event.tiedToNext) return;
        event.notes.forEach((recordedNote) => {
          const nextEvent = eventByNoteSegment.get(`${recordedNote.id}:${event.segmentIndex + 1}`);
          if (nextEvent) addTie(systems, event, nextEvent, recordedNote, layout);
        });
      });
      el.staff.append(systemsFragment);
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
    requestAnimationFrame(() => {
      el.scoreViewport.scrollTop = Math.min(
        previousViewportScroll.top,
        Math.max(0, el.scoreViewport.scrollHeight - el.scoreViewport.clientHeight)
      );
      el.scoreViewport.scrollLeft = Math.min(
        previousViewportScroll.left,
        Math.max(0, el.scoreViewport.scrollWidth - el.scoreViewport.clientWidth)
      );
    });
  }

  function scheduleScoreRender() {
    if (scoreRenderFrame !== null) return;
    scoreRenderFrame = requestAnimationFrame(() => {
      scoreRenderFrame = null;
      renderScore();
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

  function startVoice(note) {
    if (!audioContext || activeVoices.has(note)) return;
    const item = noteByName.get(note);
    const frequency = 440 * 2 ** ((item.midi - 69) / 12);
    const now = audioContext.currentTime;
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

  function recordNote(note, inputStartedAt = performance.now()) {
    if (!state.recording || state.playing) return;
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
    scheduleScoreRender();
  }

  function pressNote(note, source, allowRecording = true, inputStartedAt = performance.now()) {
    if (!noteByName.has(note)) return;
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
    ensureAudio().then((ready) => {
      if (ready && activeSources.get(note)?.size) startVoice(note);
    });
    if (allowRecording) recordNote(note, inputStartedAt);
  }

  function releaseNote(note, source, inputEndedAt = performance.now()) {
    const sources = activeSources.get(note);
    if (!sources) return;
    sources.delete(source);
    if (sources.size > 0) return;
    activeSources.delete(note);
    setKeyActive(note, false);
    stopVoice(note);
    finishRecordedNote(note, inputEndedAt);
  }

  function stopAllNotes(inputEndedAt = performance.now()) {
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
      pressNote(key.dataset.note, `pointer:${event.pointerId}`, true, event.timeStamp);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      el.piano.addEventListener(eventName, (event) => {
        const key = event.target.closest("[data-note]");
        if (key) releaseNote(key.dataset.note, `pointer:${event.pointerId}`, event.timeStamp);
      });
    });
    el.piano.addEventListener("click", (event) => {
      const key = event.target.closest("[data-note]");
      if (!key || event.detail !== 0) return;
      const source = `activation:${Date.now()}`;
      pressNote(key.dataset.note, source, true, event.timeStamp);
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
      pressNote(note, source, true, event.timeStamp);
    });
    window.addEventListener("keyup", (event) => {
      const active = activeKeyboard.get(event.code);
      if (!active) return;
      activeKeyboard.delete(event.code);
      releaseNote(active.note, active.source, event.timeStamp);
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
      const noteButton = event.target.closest(".score-note");
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
