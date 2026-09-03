(() => {
  "use strict";

  const STORAGE_KEY = "melody-catcher-aic-2026-0017-v1";
  const ACCOUNTS_KEY = "melody-catcher-device-accounts-v1";
  const ACTIVE_ACCOUNT_KEY = "melody-catcher-active-account-v1";
  const CHORD_WINDOW_MS = 10;
  const BEAT_SPACING = 88;
  const SCORE_START_X = 108;
  const SCORE_END_PADDING = 18;
  const NOTE_EDGE_PADDING = 24;
  const STEM_LENGTH = 42;
  const RHYTHM_QUANTUM = window.MelodyRhythm?.STRAIGHT_STEP || 0.125;
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
    { beats: 0.375, name: "dotted sixteenth note", slug: "dotted-sixteenth", open: false, stem: true, flags: 2, dotted: true },
    { beats: 0.25, name: "sixteenth note", slug: "sixteenth", open: false, stem: true, flags: 2, dotted: false },
    { beats: 0.125, name: "thirty-second note", slug: "thirty-second", open: false, stem: true, flags: 3, dotted: false }
  ];
  const FLAT_SPELLINGS = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const RANGE_OPTIONS = ["C1-C3", "C2-C4", "C3-C5", "C4-C6", "C5-C7"];
  const WALLPAPER_OPTIONS = ["paper", "sage", "sky", "rose"];
  const DECORATION_OPTIONS = ["none", "notes", "stars"];
  const DEFAULT_BINDINGS = [
    "a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k",
    "o", "l", "p", ";", "'", "z", "x", "c", "v", "b", "n", "m"
  ];

  function noteFromMidi(midi) {
    const pitchClass = NOTE_NAMES[midi % 12];
    return `${pitchClass}${Math.floor(midi / 12) - 1}`;
  }

  function createRangeNotes(rangeKey) {
    const [startLabel, endLabel] = rangeKey.split("-");
    const startOctave = Number(startLabel.slice(1));
    const endOctave = Number(endLabel.slice(1));
    const startMidi = (startOctave + 1) * 12;
    const endMidi = (endOctave + 1) * 12;
    const result = [];
    let whiteIndex = -1;
    for (let midi = startMidi; midi <= endMidi; midi += 1) {
      const pitchClass = NOTE_NAMES[midi % 12];
      const isBlack = pitchClass.includes("#");
      if (!isBlack) whiteIndex += 1;
      result.push({ note: noteFromMidi(midi), midi, isBlack, whiteIndex });
    }
    return result;
  }

  const allPianoNotes = [];
  for (let midi = 24; midi <= 108; midi += 1) {
    const pitchClass = NOTE_NAMES[midi % 12];
    const isBlack = pitchClass.includes("#");
    allPianoNotes.push({ note: noteFromMidi(midi), midi, isBlack });
  }

  const noteByName = new Map(allPianoNotes.map((item) => [item.note, item]));
  let notesInRange = createRangeNotes("C3-C5");
  let defaultBindingMap = Object.fromEntries(notesInRange.map((item, index) => [item.note, DEFAULT_BINDINGS[index]]));

  const state = {
    notes: [],
    undoStack: [],
    redoStack: [],
    selectedKeys: new Set(),
    recording: true,
    playing: false,
    instrument: "piano",
    volume: 70,
    tempo: 100,
    timeSignature: "4/4",
    range: "C3-C5",
    profileName: "",
    ideaTitle: "Untitled idea",
    activeAccount: null,
    wallpaper: "paper",
    decoration: "none",
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
    importOpen: document.querySelector("#import-open"),
    importFile: document.querySelector("#import-file"),
    emptyScore: document.querySelector("#empty-score"),
    staff: document.querySelector("#staff"),
    scoreViewport: document.querySelector("#score-viewport"),
    selectionBar: document.querySelector("#selection-bar"),
    selectionLabel: document.querySelector("#selection-label"),
    deleteNote: document.querySelector("#delete-note"),
    clearSelection: document.querySelector("#clear-selection"),
    instrumentTitle: document.querySelector("#piano-title"),
    instrumentSelect: document.querySelector("#instrument-select"),
    volume: document.querySelector("#volume"),
    volumeOutput: document.querySelector("#volume-output"),
    tempo: document.querySelector("#tempo"),
    tempoOutput: document.querySelector("#tempo-output"),
    timeSignature: document.querySelector("#time-signature-select"),
    metronomeToggle: document.querySelector("#metronome-toggle"),
    metronomeToggleLabel: document.querySelector("#metronome-toggle-label"),
    metronomeBeats: document.querySelector("#metronome-beats"),
    metronomeCount: document.querySelector("#metronome-count"),
    range: document.querySelector("#range-select"),
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
    personalizationHelp: document.querySelector("#personalization-help"),
    personalizationControls: document.querySelector("#personalization-controls"),
    settingsSignIn: document.querySelector("#settings-sign-in"),
    wallpaper: document.querySelector("#wallpaper-select"),
    decoration: document.querySelector("#decoration-select"),
    accountDialog: document.querySelector("#account-dialog"),
    accountOpen: document.querySelector("#account-open"),
    accountClose: document.querySelector("#account-close"),
    accountLabel: document.querySelector("#account-label"),
    accountGuestView: document.querySelector("#account-guest-view"),
    accountMemberView: document.querySelector("#account-member-view"),
    accountMemberName: document.querySelector("#account-member-name"),
    accountForm: document.querySelector("#account-form"),
    accountName: document.querySelector("#account-name"),
    accountPasscode: document.querySelector("#account-passcode"),
    accountError: document.querySelector("#account-error"),
    accountCreate: document.querySelector("#account-create"),
    accountLogout: document.querySelector("#account-logout"),
    exportDialog: document.querySelector("#export-dialog"),
    exportSummary: document.querySelector("#export-summary"),
    exportPreview: document.querySelector("#export-preview"),
    exportState: document.querySelector("#export-state"),
    printScore: document.querySelector("#print-score"),
    downloadSvg: document.querySelector("#download-svg"),
    downloadProject: document.querySelector("#download-project"),
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
  let metronomeEnabled = false;
  let metronomeTimer = null;
  let metronomeBeatIndex = 0;
  let metronomeNextTickAt = 0;
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

  function bindingFromPhysicalCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return {
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backslash: "\\",
      BracketLeft: "[",
      BracketRight: "]",
      Minus: "-",
      Equal: "=",
      Backquote: "`"
    }[code] || "";
  }

  function noteSelectionKey(id) {
    return `note:${id}`;
  }

  function restSelectionKey(startBeat, durationBeats) {
    return `rest:${cleanBeat(startBeat)}:${cleanBeat(durationBeats)}`;
  }

  function normalizeAccountName(value) {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
  }

  function readDeviceAccounts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeDeviceAccounts(accounts) {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      return true;
    } catch (error) {
      showToast("This browser could not save the device account.", "error");
      return false;
    }
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashPasscode(passcode, salt) {
    const bytes = new TextEncoder().encode(`${salt}:${passcode}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function applyPersonalization() {
    document.body.dataset.wallpaper = WALLPAPER_OPTIONS.includes(state.wallpaper) ? state.wallpaper : "paper";
    document.body.dataset.decoration = DECORATION_OPTIONS.includes(state.decoration) ? state.decoration : "none";
  }

  function activeAccountRecord() {
    return state.activeAccount ? readDeviceAccounts()[state.activeAccount] || null : null;
  }

  function renderAccountState() {
    const account = activeAccountRecord();
    const loggedIn = Boolean(account);
    el.accountLabel.textContent = loggedIn ? account.displayName : "Account";
    el.accountGuestView.hidden = loggedIn;
    el.accountMemberView.hidden = !loggedIn;
    el.accountMemberName.textContent = account?.displayName || "Piano player";
    el.personalizationControls.hidden = !loggedIn;
    el.settingsSignIn.hidden = loggedIn;
    el.personalizationHelp.textContent = loggedIn
      ? `Personal touches are saved for ${account.displayName} on this device.`
      : "Create or log in to a device account to unlock wallpapers and decorations.";
    el.wallpaper.value = state.wallpaper;
    el.decoration.value = state.decoration;
  }

  function loadActiveAccount() {
    let key = null;
    try {
      key = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    } catch (error) {
      key = null;
    }
    const account = key ? readDeviceAccounts()[key] : null;
    if (!account) return;
    state.activeAccount = key;
    state.wallpaper = WALLPAPER_OPTIONS.includes(account.wallpaper) ? account.wallpaper : "paper";
    state.decoration = DECORATION_OPTIONS.includes(account.decoration) ? account.decoration : "none";
  }

  function saveAccountPreferences() {
    if (!state.activeAccount) return;
    const accounts = readDeviceAccounts();
    const account = accounts[state.activeAccount];
    if (!account) return;
    account.wallpaper = state.wallpaper;
    account.decoration = state.decoration;
    account.displayName = state.profileName || account.displayName;
    if (writeDeviceAccounts(accounts)) renderAccountState();
  }

  function rangeLabel(rangeKey = state.range) {
    return rangeKey.replace("-", "–");
  }

  function applyRange(rangeKey, preserveBindings = true) {
    const nextRange = RANGE_OPTIONS.includes(rangeKey) ? rangeKey : "C3-C5";
    const previousBindings = preserveBindings
      ? notesInRange.map((item, index) => state.bindings[item.note] || DEFAULT_BINDINGS[index])
      : DEFAULT_BINDINGS;
    notesInRange = createRangeNotes(nextRange);
    defaultBindingMap = Object.fromEntries(
      notesInRange.map((item, index) => [item.note, DEFAULT_BINDINGS[index]])
    );
    state.range = nextRange;
    state.bindings = Object.fromEntries(
      notesInRange.map((item, index) => [item.note, previousBindings[index] || DEFAULT_BINDINGS[index]])
    );
  }

  function bestRangeForNotes(notes) {
    const midis = notes.map((note) => note.midi).filter(Number.isFinite);
    if (!midis.length) return state.range;
    const center = (Math.min(...midis) + Math.max(...midis)) / 2;
    return RANGE_OPTIONS.reduce((best, rangeKey) => {
      const rangeNotes = createRangeNotes(rangeKey);
      const rangeCenter = (rangeNotes[0].midi + rangeNotes.at(-1).midi) / 2;
      return Math.abs(rangeCenter - center) < Math.abs(best.center - center)
        ? { rangeKey, center: rangeCenter }
        : best;
    }, { rangeKey: "C3-C5", center: 60 }).rangeKey;
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
      if (durations.size === 1) return `${pitches} — ${recordedDurationName(group.notes[0])}`;
      return `[${group.notes.map((note) => `${displayNote(note.spelling || note.note)} — ${recordedDurationName(note)}`).join("; ")}]`;
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

  function clearMetronomeTimer() {
    if (metronomeTimer !== null) window.clearTimeout(metronomeTimer);
    metronomeTimer = null;
  }

  function renderMetronomeBeats() {
    const { numerator } = timeSignatureParts();
    el.metronomeBeats.replaceChildren();
    for (let index = 0; index < numerator; index += 1) {
      const beat = document.createElement("span");
      beat.className = `metronome-beat${index === 0 ? " is-downbeat" : ""}`;
      el.metronomeBeats.append(beat);
    }
    el.metronomeCount.textContent = `Ready · ${numerator} ${numerator === 1 ? "beat" : "beats"}`;
  }

  function paintMetronomeBeat(index) {
    const beats = [...el.metronomeBeats.children];
    beats.forEach((beat, beatIndex) => beat.classList.toggle("is-current", beatIndex === index));
    const { numerator } = timeSignatureParts();
    el.metronomeCount.textContent = `Beat ${index + 1} of ${numerator} · ${beatUnitName()}`;
  }

  function scheduleMetronomeTick() {
    if (!metronomeEnabled || document.hidden) return;
    const delay = Math.max(0, metronomeNextTickAt - performance.now());
    metronomeTimer = window.setTimeout(() => {
      if (!metronomeEnabled || document.hidden) return;
      const { numerator } = timeSignatureParts();
      paintMetronomeBeat(metronomeBeatIndex);
      metronomeBeatIndex = (metronomeBeatIndex + 1) % numerator;
      metronomeNextTickAt += beatDurationMs();
      const now = performance.now();
      if (metronomeNextTickAt <= now) {
        const skipped = Math.floor((now - metronomeNextTickAt) / beatDurationMs()) + 1;
        metronomeBeatIndex = (metronomeBeatIndex + skipped) % numerator;
        metronomeNextTickAt += skipped * beatDurationMs();
      }
      scheduleMetronomeTick();
    }, delay);
  }

  function restartMetronomeClock() {
    clearMetronomeTimer();
    if (!metronomeEnabled || document.hidden) return;
    metronomeBeatIndex = 0;
    metronomeNextTickAt = performance.now();
    scheduleMetronomeTick();
  }

  function setMetronomeEnabled(enabled, announce = true) {
    metronomeEnabled = enabled;
    el.metronomeToggle.classList.toggle("is-on", enabled);
    el.metronomeToggle.setAttribute("aria-pressed", String(enabled));
    el.metronomeToggle.setAttribute("aria-label", `${enabled ? "Stop" : "Start"} visual metronome`);
    el.metronomeToggleLabel.textContent = enabled ? "Stop" : "Start";
    if (enabled) {
      restartMetronomeClock();
      if (announce) showToast(`Visual metronome started at ${state.tempo} BPM.`);
    } else {
      clearMetronomeTimer();
      renderMetronomeBeats();
      if (announce) showToast("Visual metronome stopped.");
    }
  }

  function quarterUnitsFromMs(milliseconds) {
    return milliseconds / beatDurationMs() * beatUnitQuarterLength();
  }

  function millisecondsFromQuarterUnits(quarterUnits) {
    return quarterUnits / beatUnitQuarterLength() * beatDurationMs();
  }

  function quantizeBeat(value) {
    return window.MelodyRhythm
      ? window.MelodyRhythm.quantizeStraight(value, RHYTHM_QUANTUM)
      : Math.round(value / RHYTHM_QUANTUM) * RHYTHM_QUANTUM;
  }

  function cleanBeat(value) {
    return window.MelodyRhythm
      ? window.MelodyRhythm.cleanBeat(value)
      : Math.round(value * 1000000) / 1000000;
  }

  function nextCompositionBeat() {
    const noteEnd = state.notes.length
      ? Math.max(...state.notes.map((note) => note.startBeat + (note.durationBeats || 1)))
      : 0;
    return cleanBeat(Math.max(noteEnd, state.timelineEndBeat || 0));
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
    const rawStartBeat = cleanBeat(
      recordingClock.startBeat + quarterUnitsFromMs(startedAt - recordingClock.startedAt)
    );
    let startBeat = quantizeBeat(rawStartBeat);
    if (lastOnsetBeat !== null) startBeat = Math.max(startBeat, lastOnsetBeat + RHYTHM_QUANTUM);
    currentOnsetWindow = { id: createOnsetId(), startedAt, rawStartBeat, startBeat: cleanBeat(startBeat) };
    lastOnsetBeat = startBeat;
    return currentOnsetWindow;
  }

  function clearTupletMetadata(recordedNote) {
    delete recordedNote.tupletId;
    delete recordedNote.tupletIndex;
    delete recordedNote.tupletCount;
    delete recordedNote.tupletNotesOccupied;
    delete recordedNote.tupletBaseSlug;
    delete recordedNote.tupletBaseDuration;
    delete recordedNote.tupletUnitBeats;
  }

  function applyRecognizedRhythm() {
    if (!window.MelodyRhythm) return;
    const groups = onsetGroups();
    const performedGroups = groups
      .map((group) => {
        const rawStarts = group.notes
          .map((note) => note.rawStartBeat)
          .filter(Number.isFinite);
        return rawStarts.length
          ? { ...group, rawStartBeat: Math.min(...rawStarts) }
          : null;
      })
      .filter(Boolean);
    if (!performedGroups.length) return;

    const recognized = window.MelodyRhythm.recognizeOnsets(performedGroups);
    const recognitionById = new Map(recognized.map((item) => [item.id, item]));
    const startByOnsetId = new Map();

    performedGroups.forEach((group) => {
      const rhythm = recognitionById.get(group.id);
      if (!rhythm) return;
      startByOnsetId.set(group.id, rhythm.startBeat);
      group.notes.forEach((recordedNote) => {
        recordedNote.startBeat = rhythm.startBeat;
        clearTupletMetadata(recordedNote);
        const rawDuration = Number.isFinite(recordedNote.rawDurationBeats)
          ? recordedNote.rawDurationBeats
          : recordedNote.durationBeats;
        recordedNote.durationBeats = Math.max(RHYTHM_QUANTUM, quantizeBeat(rawDuration));
        if (rhythm.tuplet) {
          recordedNote.durationBeats = rhythm.tuplet.unitBeats;
          recordedNote.tupletId = rhythm.tuplet.id;
          recordedNote.tupletIndex = rhythm.tuplet.index;
          recordedNote.tupletCount = rhythm.tuplet.count;
          recordedNote.tupletNotesOccupied = rhythm.tuplet.notesOccupied;
          recordedNote.tupletBaseSlug = rhythm.tuplet.baseSlug;
          recordedNote.tupletBaseDuration = rhythm.tuplet.baseDuration;
          recordedNote.tupletUnitBeats = rhythm.tuplet.unitBeats;
        }
      });
    });

    performedGroups.forEach((group) => {
      group.notes.forEach((recordedNote) => {
        if (recordedNote.tupletCount || !recordedNote.joinToOnsetId) return;
        const joinedOnset = startByOnsetId.get(recordedNote.joinToOnsetId)
          ?? state.notes.find((note) => note.onsetId === recordedNote.joinToOnsetId)?.startBeat;
        if (!Number.isFinite(joinedOnset) || joinedOnset <= recordedNote.startBeat) return;
        recordedNote.durationBeats = Math.max(
          recordedNote.durationBeats,
          cleanBeat(joinedOnset - recordedNote.startBeat)
        );
      });
    });

    performedGroups.flatMap((group) => group.notes).forEach((recordedNote) => {
      recordedNote.duration = millisecondsFromQuarterUnits(recordedNote.durationBeats) / 1000;
    });
    const latest = recognized.at(-1);
    if (latest && recordingClock) lastOnsetBeat = latest.startBeat;
    if (latest && currentOnsetWindow) {
      const current = recognitionById.get(currentOnsetWindow.id);
      if (current) currentOnsetWindow.startBeat = current.startBeat;
    }
  }

  function durationName(beats) {
    const exact = NOTE_VALUES.find((value) => Math.abs(value.beats - beats) < 0.001);
    if (exact) return exact.name;
    return `${Number(beats.toFixed(2))} beats (tied)`;
  }

  function recordedDurationName(recordedNote) {
    if (recordedNote.tupletCount) {
      const baseName = recordedNote.tupletBaseSlug === "eighth" ? "eighth notes" : "sixteenth notes";
      return `${recordedNote.tupletCount}-note tuplet in ${baseName}`;
    }
    return durationName(recordedNote.durationBeats || RHYTHM_QUANTUM);
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
        range: state.range,
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
      if (RANGE_OPTIONS.includes(parsed.range)) applyRange(parsed.range, false);
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
              const startBeat = Number.isFinite(item.startBeat)
                ? Math.max(0, item.tupletCount ? cleanBeat(item.startBeat) : quantizeBeat(item.startBeat))
                : restoredBeat;
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
                ? Math.max(
                  item.tupletUnitBeats || RHYTHM_QUANTUM,
                  item.tupletCount ? cleanBeat(item.durationBeats) : quantizeBeat(item.durationBeats)
                )
                : 1,
              startBeat: restoredOnsets.get(onsetId),
              rawStartBeat: Number.isFinite(item.rawStartBeat) ? cleanBeat(item.rawStartBeat) : null,
              rawDurationBeats: Number.isFinite(item.rawDurationBeats)
                ? Math.max(0, cleanBeat(item.rawDurationBeats))
                : null,
              joinToOnsetId: typeof item.joinToOnsetId === "string" ? item.joinToOnsetId : null,
              preferredStaff: ["treble", "bass"].includes(item.preferredStaff) ? item.preferredStaff : null,
              preferredVoice: typeof item.preferredVoice === "string" && item.preferredVoice ? item.preferredVoice : null,
              sourceType: item.sourceType === "import" ? "import" : "recording",
              tupletId: typeof item.tupletId === "string" ? item.tupletId : undefined,
              tupletIndex: Number.isFinite(item.tupletIndex) ? item.tupletIndex : undefined,
              tupletCount: Number.isFinite(item.tupletCount) ? item.tupletCount : undefined,
              tupletNotesOccupied: Number.isFinite(item.tupletNotesOccupied) ? item.tupletNotesOccupied : undefined,
              tupletBaseSlug: item.tupletBaseSlug === "eighth" ? "eighth" : item.tupletBaseSlug === "sixteenth" ? "sixteenth" : undefined,
              tupletBaseDuration: Number.isFinite(item.tupletBaseDuration) ? item.tupletBaseDuration : undefined,
              tupletUnitBeats: Number.isFinite(item.tupletUnitBeats) ? item.tupletUnitBeats : undefined,
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
      applyRecognizedRhythm();
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
    el.piano.setAttribute("aria-label", `Playable piano from ${rangeLabel()}`);
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
    return staffByRecordedNote.get(recordedNote.id)
      || recordedNote.preferredStaff
      || (recordedNote.midi < 60 ? "bass" : "treble");
  }

  function updateChordStaffAssignments(groups) {
    staffByRecordedNote.clear();
    groups.forEach((group) => {
      const midis = group.notes.map((note) => note.midi);
      const lowest = Math.min(...midis);
      const highest = Math.max(...midis);
      const isCompactChord = group.notes.length > 1 && highest - lowest <= 12;
      const sharedStaff = isCompactChord && !group.notes.some((note) => note.preferredStaff)
        ? (midis.reduce((sum, midi) => sum + midi, 0) / midis.length < 60 ? "bass" : "treble")
        : null;
      group.notes.forEach((note) => {
        staffByRecordedNote.set(note.id, note.preferredStaff || sharedStaff || (note.midi < 60 ? "bass" : "treble"));
      });
    });
  }

  function scoreLayout(totalMeasures) {
    const capacity = measureCapacity();
    const viewportWidth = el.scoreViewport.clientWidth || 960;
    const horizontalPadding = viewportWidth <= 780 ? 40 : 68;
    const contentWidth = Math.max(280, viewportWidth - horizontalPadding);
    const measureColumns = new Map();
    buildEngravedSegments(totalMeasures * capacity).forEach((segment) => {
      const measure = Math.floor(segment.startBeat / capacity);
      if (!measureColumns.has(measure)) measureColumns.set(measure, new Set());
      measureColumns.get(measure).add(cleanBeat(segment.startBeat));
    });
    const densestMeasure = Math.max(1, ...[...measureColumns.values()].map((columns) => columns.size));
    // Count rhythmic columns instead of every voice. This keeps simultaneous
    // notes aligned while reserving enough room for accidentals and beams.
    const minimumMeasureWidth = Math.min(
      920,
      Math.max(440, capacity * BEAT_SPACING, 180 + densestMeasure * 42)
    );
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
      systemHeight: 330,
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

  function staffRestSegments(groups, totalBeats, staff) {
    const intervals = groups
      .flatMap((group) => group.notes)
      .filter((note) => !staff || noteStaff(note) === staff)
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

  function globalRestSegments(groups, totalBeats) {
    return staffRestSegments(groups, totalBeats, null);
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
    const { numerator, denominator } = timeSignatureParts();
    const compoundBeat = denominator === 8 && numerator >= 6 && numerator % 3 === 0 ? 1.5 : null;
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
      const spec = NOTE_VALUES.find((value) => {
        if (value.beats > available + 0.001) return false;
        if (value.dotted) {
          return Boolean(
            compoundBeat
            && Math.abs(value.beats - compoundBeat) < 0.001
            && Math.abs(positionInMeasure / compoundBeat - Math.round(positionInMeasure / compoundBeat)) < 0.001
          );
        }
        return Math.abs(positionInMeasure / value.beats - Math.round(positionInMeasure / value.beats)) < 0.001;
      }) || NOTE_VALUES.at(-1);
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
        const notesByVoice = new Map();
        group.notes
          .filter((note) => noteStaff(note) === staff)
          .sort((a, b) => a.midi - b.midi)
          .forEach((note) => {
            const voiceKey = note.preferredVoice || "recorded";
            if (!notesByVoice.has(voiceKey)) notesByVoice.set(voiceKey, []);
            notesByVoice.get(voiceKey).push(note);
          });
        notesByVoice.forEach((notes, voiceKey) => {
          const tupletNote = notes.find((note) => note.tupletId);
          const tuplet = tupletNote
            ? {
              id: tupletNote.tupletId,
              index: tupletNote.tupletIndex,
              count: tupletNote.tupletCount,
              notesOccupied: tupletNote.tupletNotesOccupied,
              baseSlug: tupletNote.tupletBaseSlug,
              baseDuration: tupletNote.tupletBaseDuration,
              unitBeats: tupletNote.tupletUnitBeats
            }
            : null;
          const durationBeats = tuplet
            ? tuplet.unitBeats
            : Math.max(...notes.map((note) => note.durationBeats || RHYTHM_QUANTUM));
          eventsByStaff[staff].push({
            id: `${group.id}-${staff}-${voiceKey}`,
            startBeat: group.startBeat,
            durationBeats,
            endBeat: group.startBeat + durationBeats,
            notes,
            tuplet
          });
        });
      });
    });

    // Fast keyboard playing often has a tiny physical key overlap even when
    // the player intended one continuous melodic run. Trim only those very
    // small recorded overlaps for engraving so neighbouring short notes can
    // stay in one voice and share the expected beam. Longer held notes remain
    // separate voices and keep their independent stems and ties.
    Object.values(eventsByStaff).forEach((events) => {
      const ordered = events.sort((first, second) => first.startBeat - second.startBeat || first.endBeat - second.endBeat);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const current = ordered[index];
        const next = ordered[index + 1];
        if (current.tuplet || next.startBeat <= current.startBeat + 0.001) continue;
        if (current.notes.some((note) => note.sourceType === "import")) continue;
        const overlap = current.endBeat - next.startBeat;
        const onsetDistance = next.startBeat - current.startBeat;
        if (overlap <= 0.001 || overlap > RHYTHM_QUANTUM * 2 + 0.001) continue;
        current.durationBeats = Math.max(RHYTHM_QUANTUM, cleanBeat(onsetDistance));
        current.endBeat = cleanBeat(current.startBeat + current.durationBeats);
      }
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
          if (event.tuplet) {
            const baseIsEighth = event.tuplet.baseSlug === "eighth";
            lane.pieces.push({
              id: `${event.id}-tuplet`,
              sourceId: event.id,
              startBeat: event.startBeat,
              spec: {
                beats: event.tuplet.unitBeats,
                name: `${event.tuplet.count}-note ${event.tuplet.baseSlug}-note tuplet`,
                slug: `${event.tuplet.baseSlug}-tuplet`,
                vexBase: baseIsEighth ? "8" : "16",
                dotted: false,
                flags: baseIsEighth ? 1 : 2
              },
              notes: event.notes,
              tuplet: event.tuplet,
              tiedFromPrevious: false,
              tiedToNext: false
            });
            return;
          }
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
      lanesByStaff[staff].sort((first, second) => {
        const averageMidi = (lane) => {
          const notes = lane.events.flatMap((event) => event.notes);
          return notes.length ? notes.reduce((sum, note) => sum + note.midi, 0) / notes.length : 0;
        };
        return averageMidi(second) - averageMidi(first);
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

  function measureRestTrackSegments(restSegments, measureStart, measureEnd, staff) {
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
          hiddenRest: false
        });
        cursor = Math.max(cursor, segment.startBeat + segment.spec.beats);
      });

    if (cursor < measureEnd - 0.001) addHiddenTime(cursor, measureEnd - cursor);
    return result;
  }

  function vexDuration(spec, isRest) {
    const base = spec.vexBase || {
      measure: "w",
      whole: "w",
      "dotted-half": "h",
      half: "h",
      "dotted-quarter": "q",
      quarter: "q",
      "dotted-eighth": "8",
      eighth: "8",
      "dotted-sixteenth": "16",
      sixteenth: "16",
      "thirty-second": "32"
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
      const voiceDirection = laneCount > 1
        ? (laneIndex < laneCount / 2 ? VF.Stem.UP : VF.Stem.DOWN)
        : null;
      vexNote.setStemDirection(voiceDirection || (furthestNote.step >= middleLineStep ? VF.Stem.DOWN : VF.Stem.UP));
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

  function createEngravedTuplets(VF, entries) {
    const grouped = new Map();
    entries.forEach((entry) => {
      if (!entry.segment.tuplet || entry.isRest) return;
      const id = entry.segment.tuplet.id;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(entry);
    });

    const tuplets = [];
    grouped.forEach((tupletEntries) => {
      tupletEntries.sort((a, b) => a.segment.tuplet.index - b.segment.tuplet.index);
      const tuplet = tupletEntries[0].segment.tuplet;
      if (tupletEntries.length !== tuplet.count) return;
      const notes = tupletEntries.map((entry) => entry.vexNote);
      const averageDirection = notes.reduce((sum, note) => sum + note.getStemDirection(), 0);
      tuplets.push(new VF.Tuplet(notes, {
        num_notes: tuplet.count,
        notes_occupied: tuplet.notesOccupied,
        ratioed: false,
        bracketed: false,
        location: averageDirection < 0 ? VF.Tuplet.LOCATION_BOTTOM : VF.Tuplet.LOCATION_TOP
      }));
    });
    return tuplets;
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
      const noteX = entry.vexNote.getAbsoluteX();
      const noteYs = entry.vexNote.getYs();
      if (entry.isRest) {
        if (entry.hiddenRest || !entry.segment.selectableRest) return;
        const key = restSelectionKey(entry.segment.startBeat, entry.segment.spec.beats);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `score-hit-target rest-hit-target${state.selectedKeys.has(key) ? " is-selected" : ""}`;
        button.dataset.selectionKey = key;
        button.dataset.kind = "rest";
        button.style.left = `${noteX - 15}px`;
        button.style.top = `${(noteYs[0] || (entry.staff === "treble" ? 82 : 224)) - 16}px`;
        button.setAttribute("aria-label", `${entry.segment.spec.name} rest. Select to delete this silence.`);
        button.setAttribute("aria-pressed", state.selectedKeys.has(key) ? "true" : "false");
        system.append(button);
        return;
      }
      entry.notes.forEach((recordedNote, noteIndex) => {
        if (Math.abs(recordedNote.startBeat - entry.segment.startBeat) > 0.001) return;
        const key = noteSelectionKey(recordedNote.id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `score-hit-target${state.selectedKeys.has(key) ? " is-selected" : ""}`;
        button.dataset.id = recordedNote.id;
        button.dataset.selectionKey = key;
        button.dataset.kind = "note";
        button.style.left = `${noteX - 12}px`;
        button.style.top = `${noteYs[noteIndex] - 12}px`;
        button.setAttribute("aria-label", `${spokenNote(recordedNote.spelling || recordedNote.note)}, ${entry.segment.spec.name}. Select to edit.`);
        button.setAttribute("aria-pressed", state.selectedKeys.has(key) ? "true" : "false");
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
    const confirmedRests = {
      treble: staffRestSegments(groups, confirmedRestEnd, "treble"),
      bass: staffRestSegments(groups, confirmedRestEnd, "bass")
    };
    const selectableRests = globalRestSegments(groups, confirmedRestEnd);
    const beamOptions = {
      groups: VF.Beam.getDefaultBeamGroups(state.timeSignature),
      beam_rests: false,
      maintain_stem_directions: false
    };

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
        const trebleStave = new VF.Stave(x, 48, layout.measureWidth);
        const bassStave = new VF.Stave(x, 190, layout.measureWidth);
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
            // Tuplets adjust rhythmic ticks before the automatic beam pass;
            // this keeps all notes in a tuplet under one correctly grouped beam.
            const tuplets = createEngravedTuplets(VF, entries);
            const beams = VF.Beam.generateBeams(notes, beamOptions);
            const voice = new VF.Voice({ num_beats: numerator, beat_value: denominator })
              .setStrict(false)
              .addTickables(notes);
            voiceModels.push({ staff, stave, laneKey, entries, notes, voice, beams, tuplets });
          });

          const restEntries = measureRestTrackSegments(
            confirmedRests[staff],
            measureStart,
            measureEnd,
            staff
          ).map((segment) => {
            if (!segment.hiddenRest) {
              segment.selectableRest = selectableRests.some((candidate) => (
                Math.abs(candidate.startBeat - segment.startBeat) < 0.001
                && Math.abs(candidate.spec.beats - segment.spec.beats) < 0.001
              ));
            }
            return createEngravedEntry(VF, segment, staff, new Map());
          });
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
              voice,
              beams: [],
              tuplets: []
            });
          }
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

        voiceModels.forEach(({ beams, tuplets, entries, laneKey }) => {
          beams.forEach((beam) => beam.setContext(context).draw());
          tuplets.forEach((tuplet) => tuplet.setContext(context).draw());
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
    const selectedNoteCount = [...state.selectedKeys].filter((key) => key.startsWith("note:")).length;
    const selectedRestCount = [...state.selectedKeys].filter((key) => key.startsWith("rest:")).length;
    const selectedCount = selectedNoteCount + selectedRestCount;
    el.selectionBar.hidden = selectedCount === 0;
    if (selectedCount) {
      const parts = [];
      if (selectedNoteCount) parts.push(`${selectedNoteCount} ${selectedNoteCount === 1 ? "note" : "notes"}`);
      if (selectedRestCount) parts.push(`${selectedRestCount} ${selectedRestCount === 1 ? "rest" : "rests"}`);
      el.selectionLabel.textContent = `${parts.join(" and ")} selected`;
      el.deleteNote.textContent = `Delete ${selectedCount} selected`;
    }
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

  function bridgeShortGapTo(onsetBeat, silenceDurationMs = null, onsetId = null) {
    const previousGroup = onsetGroups()
      .filter((group) => group.startBeat < onsetBeat - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat)
      .at(-1);
    if (!previousGroup) return;
    if (previousGroup.notes.every((recordedNote) => recordedNote.sourceType === "import")) return;
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
      if (onsetId) recordedNote.joinToOnsetId = onsetId;
    });
  }

  function bridgeAllShortGaps() {
    const groups = onsetGroups();
    for (let index = 1; index < groups.length; index += 1) {
      const previousGroup = groups[index - 1];
      if (previousGroup.notes.every((recordedNote) => recordedNote.sourceType === "import")) continue;
      const nextOnset = groups[index].startBeat;
      const previousEnd = Math.max(...previousGroup.notes.map(
        (recordedNote) => recordedNote.startBeat + (recordedNote.durationBeats || RHYTHM_QUANTUM)
      ));
      const silentGap = nextOnset - previousEnd;
      if (silentGap <= 0.001 || silentGap >= MIN_REST_BEATS - 0.001) continue;
      previousGroup.notes.forEach((recordedNote) => {
        recordedNote.joinToOnsetId = groups[index].id;
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
        const heldFrom = Number.isFinite(heldNote.rawStartBeat) ? heldNote.rawStartBeat : heldNote.startBeat;
        const heldUntil = Number.isFinite(onset.rawStartBeat) ? onset.rawStartBeat : onset.startBeat;
        heldNote.rawDurationBeats = Math.max(
          heldNote.rawDurationBeats || RHYTHM_QUANTUM,
          cleanBeat(heldUntil - heldFrom)
        );
      });
      bridgeShortGapTo(onset.startBeat, silenceDurationMs, onset.id);
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
      rawStartBeat: onset.rawStartBeat,
      rawDurationBeats: RHYTHM_QUANTUM,
      joinToOnsetId: null,
      createdAt: Date.now()
    });
    applyRecognizedRhythm();
    const recorded = state.notes.find((recordedNote) => recordedNote.id === id);
    state.timelineEndBeat = Math.max(state.timelineEndBeat || 0, recorded?.startBeat || onset.startBeat);
    activeRecordIds.set(note, id);
    recordStartTimes.set(id, inputStartedAt);
    state.selectedKeys.clear();
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
      record.rawDurationBeats = Math.max(RHYTHM_QUANTUM, cleanBeat(quarterUnitsFromMs(durationMs)));
      record.durationBeats = Math.max(RHYTHM_QUANTUM, quantizeBeat(record.rawDurationBeats));
    }
    activeRecordIds.delete(note);
    recordStartTimes.delete(id);
    applyRecognizedRhythm();
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
    state.selectedKeys.clear();
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
    state.selectedKeys.clear();
    resetRecordingClock();
    saveAll();
    renderScore();
    showToast("Change restored.");
  }

  function deleteSelectedItems() {
    const selectedNoteIds = new Set(
      [...state.selectedKeys]
        .filter((key) => key.startsWith("note:"))
        .map((key) => key.slice(5))
    );
    const currentGlobalRests = globalRestSegments(onsetGroups(), state.timelineEndBeat || 0);
    const selectedRests = [...state.selectedKeys]
      .filter((key) => key.startsWith("rest:"))
      .map((key) => {
        const [, start, duration] = key.split(":");
        return { startBeat: Number(start), durationBeats: Number(duration) };
      })
      .filter((selection) => currentGlobalRests.some((rest) => (
        Math.abs(rest.startBeat - selection.startBeat) < 0.001
        && Math.abs(rest.spec.beats - selection.durationBeats) < 0.001
      )))
      .sort((first, second) => first.startBeat - second.startBeat);
    const deletedNotes = state.notes.filter((note) => selectedNoteIds.has(note.id));
    if (!deletedNotes.length && !selectedRests.length) {
      state.selectedKeys.clear();
      renderScore();
      return;
    }
    pushHistory();
    const removedOnsets = new Set(deletedNotes.map((note) => note.onsetId));
    state.notes = state.notes.filter((note) => !selectedNoteIds.has(note.id));
    let removedBeats = 0;
    selectedRests.forEach((rest) => {
      const shiftedStart = cleanBeat(rest.startBeat - removedBeats);
      const shiftedEnd = cleanBeat(shiftedStart + rest.durationBeats);
      state.notes.forEach((note) => {
        if (note.startBeat < shiftedEnd - 0.001) return;
        note.startBeat = cleanBeat(Math.max(0, note.startBeat - rest.durationBeats));
        if (Number.isFinite(note.rawStartBeat)) {
          note.rawStartBeat = cleanBeat(Math.max(0, note.rawStartBeat - rest.durationBeats));
        }
      });
      removedBeats = cleanBeat(removedBeats + rest.durationBeats);
    });
    state.notes.forEach((note) => {
      if (note.joinToOnsetId && removedOnsets.has(note.joinToOnsetId)
        && !state.notes.some((candidate) => candidate.onsetId === note.joinToOnsetId)) {
        note.joinToOnsetId = null;
      }
    });
    state.timelineEndBeat = Math.max(
      latestOnsetBeat(),
      cleanBeat(Math.max(0, (state.timelineEndBeat || 0) - removedBeats))
    );
    state.selectedKeys.clear();
    resetRecordingClock();
    saveAll();
    renderScore();
    const parts = [];
    if (deletedNotes.length) parts.push(`${deletedNotes.length} ${deletedNotes.length === 1 ? "note" : "notes"}`);
    if (selectedRests.length) parts.push(`${selectedRests.length} ${selectedRests.length === 1 ? "rest" : "rests"}`);
    showToast(`${parts.join(" and ")} deleted. Undo is available.`);
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
    state.selectedKeys.clear();
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

  function showAccountError(message) {
    el.accountError.textContent = message;
    el.accountError.hidden = false;
  }

  function readAccountCredentials() {
    const displayName = el.accountName.value.trim();
    const key = normalizeAccountName(displayName);
    const passcode = el.accountPasscode.value;
    if (displayName.length < 3 || key.length < 3) {
      showAccountError("Use at least 3 characters for your account name.");
      return null;
    }
    if (passcode.length < 4) {
      showAccountError("Use at least 4 characters for your passcode.");
      return null;
    }
    return { displayName, key, passcode };
  }

  function finishAccountLogin(key, account, message) {
    state.activeAccount = key;
    state.wallpaper = WALLPAPER_OPTIONS.includes(account.wallpaper) ? account.wallpaper : "paper";
    state.decoration = DECORATION_OPTIONS.includes(account.decoration) ? account.decoration : "none";
    if (!state.profileName) state.profileName = account.displayName;
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, key);
    } catch (error) {
      showAccountError("This browser could not keep you logged in.");
      return;
    }
    el.accountForm.reset();
    el.accountError.hidden = true;
    applyPersonalization();
    renderAccountState();
    saveAll();
    closeDialog(el.accountDialog);
    showToast(message);
  }

  async function createDeviceAccount() {
    const credentials = readAccountCredentials();
    if (!credentials) return;
    const accounts = readDeviceAccounts();
    if (accounts[credentials.key]) {
      showAccountError("That account name already exists on this device. Try logging in.");
      return;
    }
    try {
      const salt = randomSalt();
      const account = {
        displayName: credentials.displayName,
        salt,
        passcodeHash: await hashPasscode(credentials.passcode, salt),
        wallpaper: "paper",
        decoration: "none",
        createdAt: new Date().toISOString()
      };
      accounts[credentials.key] = account;
      if (!writeDeviceAccounts(accounts)) return;
      finishAccountLogin(credentials.key, account, "Account created. Personalization is now unlocked.");
    } catch (error) {
      showAccountError("This browser could not create the account. Try a modern browser.");
    }
  }

  async function loginDeviceAccount(event) {
    event.preventDefault();
    const credentials = readAccountCredentials();
    if (!credentials) return;
    const account = readDeviceAccounts()[credentials.key];
    if (!account) {
      showAccountError("No account with that name exists on this device.");
      return;
    }
    try {
      const hash = await hashPasscode(credentials.passcode, account.salt);
      if (hash !== account.passcodeHash) {
        showAccountError("The passcode is not correct.");
        return;
      }
      finishAccountLogin(credentials.key, account, `Welcome back, ${account.displayName}.`);
    } catch (error) {
      showAccountError("This browser could not log in. Try a modern browser.");
    }
  }

  function openAccount() {
    el.accountError.hidden = true;
    el.accountForm.reset();
    renderAccountState();
    openDialog(el.accountDialog);
  }

  function logoutDeviceAccount() {
    state.activeAccount = null;
    state.wallpaper = "paper";
    state.decoration = "none";
    try {
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    } catch (error) {
      // The visual logout still applies for this visit.
    }
    applyPersonalization();
    renderAccountState();
    showToast("Logged out. Your piano and saved idea are still available.");
  }

  function openSettings() {
    el.profileName.value = state.profileName;
    el.ideaTitle.value = state.ideaTitle === "Untitled idea" ? "" : state.ideaTitle;
    el.wallpaper.value = state.wallpaper;
    el.decoration.value = state.decoration;
    el.bindingsError.hidden = true;
    renderAccountState();
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
    if (state.activeAccount) {
      state.wallpaper = WALLPAPER_OPTIONS.includes(el.wallpaper.value) ? el.wallpaper.value : "paper";
      state.decoration = DECORATION_OPTIONS.includes(el.decoration.value) ? el.decoration.value : "none";
      saveAccountPreferences();
      applyPersonalization();
    }
    saveAll();
    renderPiano();
    renderScore();
    closeDialog(el.settingsDialog);
    showToast("Settings saved. Piano labels and personal style are updated.");
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

  function safeFileName() {
    return state.ideaTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "melody-idea";
  }

  function projectSnapshot() {
    return {
      format: "melody-catcher-project",
      version: 2,
      ideaTitle: state.ideaTitle,
      instrument: state.instrument,
      range: state.range,
      timeSignature: state.timeSignature,
      tempo: state.tempo,
      volume: state.volume,
      timelineEndBeat: state.timelineEndBeat,
      bindings: state.bindings,
      notes: cloneNotes()
    };
  }

  function scoreSvgMarkup() {
    const sourceSvgs = [...el.staff.querySelectorAll(".score-engraving svg")];
    if (!sourceSvgs.length) throw new Error("There is no engraved score to export.");
    const gap = 22;
    const headerHeight = 72;
    const widths = sourceSvgs.map((svg) => Number(svg.getAttribute("width")) || svg.viewBox?.baseVal?.width || 960);
    const heights = sourceSvgs.map((svg) => Number(svg.getAttribute("height")) || svg.viewBox?.baseVal?.height || 330);
    const width = Math.max(...widths);
    const height = headerHeight + heights.reduce((sum, value) => sum + value, 0) + gap * (sourceSvgs.length - 1);
    let top = headerHeight;
    const systems = sourceSvgs.map((svg, index) => {
      const inner = svg.innerHTML;
      const result = `<g transform="translate(0 ${top})">${inner}</g>`;
      top += heights[index] + gap;
      return result;
    }).join("");
    const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
    const title = escapeXml(state.ideaTitle);
    const meta = escapeXml(el.scoreMeta.textContent);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#111412" stroke="#111412" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#fff" stroke="none"/><text x="10" y="30" fill="#111412" stroke="none" font-family="Georgia, Times New Roman, serif" font-size="24">${title}</text><text x="10" y="51" fill="#5d635f" stroke="none" font-family="Arial, sans-serif" font-size="11">${meta}</text>${systems}</svg>`;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openExport() {
    if (!state.notes.length) return;
    const groups = onsetGroups();
    const beats = Math.max(...groups.map((group) => group.startBeat + group.durationBeats));
    const measures = Math.ceil(beats / measureCapacity());
    el.exportSummary.textContent = `${state.ideaTitle} has ${measures} ${measures === 1 ? "measure" : "measures"}. The preview below is the artwork that will be printed or downloaded.`;
    try {
      el.exportPreview.innerHTML = scoreSvgMarkup();
    } catch (error) {
      el.exportPreview.textContent = "The score preview is not ready yet.";
    }
    el.exportState.className = "export-state";
    el.exportState.textContent = "Choose a printable format above.";
    openDialog(el.exportDialog);
  }

  function setExportState(message, type) {
    el.exportState.className = `export-state ${type === "success" ? "is-success" : "is-error"}`;
    el.exportState.textContent = message;
  }

  function printScore() {
    closeDialog(el.exportDialog);
    showToast("Opening the print window. Choose Save as PDF to keep a PDF copy.");
    window.setTimeout(() => window.print(), 60);
  }

  function downloadScoreSvg() {
    try {
      const svg = scoreSvgMarkup();
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFileName()}.svg`);
      setExportState("Downloaded the engraved score as a printable SVG.", "success");
    } catch (error) {
      setExportState("The SVG could not be created. Close this window and try Export again.", "error");
    }
  }

  function downloadProject() {
    try {
      const json = JSON.stringify(projectSnapshot(), null, 2);
      downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${safeFileName()}.melody.json`);
      setExportState("Downloaded an editable project you can import later.", "success");
    } catch (error) {
      setExportState("The editable project could not be downloaded. Please try again.", "error");
    }
  }

  function xmlChildren(node, name) {
    return [...(node?.children || [])].filter((child) => child.localName === name);
  }

  function xmlChild(node, name) {
    return xmlChildren(node, name)[0] || null;
  }

  function xmlText(node, name) {
    return xmlChild(node, name)?.textContent?.trim() || "";
  }

  function musicXmlDuration(noteNode, divisions) {
    const durationValue = Number(xmlText(noteNode, "duration"));
    if (Number.isFinite(durationValue) && durationValue > 0) return durationValue / divisions;
    const type = xmlText(noteNode, "type");
    const base = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125 }[type] || 1;
    const dots = xmlChildren(noteNode, "dot").length;
    let value = base;
    let addition = base / 2;
    for (let index = 0; index < dots; index += 1) {
      value += addition;
      addition /= 2;
    }
    const modification = xmlChild(noteNode, "time-modification");
    const actual = Number(xmlText(modification, "actual-notes"));
    const normal = Number(xmlText(modification, "normal-notes"));
    return actual > 0 && normal > 0 ? value * normal / actual : value;
  }

  function parseMusicXml(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror") || xml.documentElement?.localName !== "score-partwise") {
      throw new Error("This is not a readable MusicXML partwise score.");
    }

    const partNames = new Map();
    [...xml.getElementsByTagName("score-part")].forEach((part) => {
      partNames.set(part.getAttribute("id"), xmlText(part, "part-name"));
    });
    const parts = [...xml.getElementsByTagName("part")];
    const pianoPart = parts.find((part) => /piano|keyboard/i.test(partNames.get(part.getAttribute("id")) || "")) || parts[0];
    if (!pianoPart) throw new Error("No playable part was found in this MusicXML file.");

    const importedNotes = [];
    const onsets = new Map();
    const activeTuplets = new Map();
    const openTies = new Map();
    let divisions = 1;
    let importedTime = "4/4";
    let currentMeasureTime = "4/4";
    let foundTimeSignature = false;
    let importedTempo = 100;
    let measureStart = 0;
    let serial = 0;
    let skipped = 0;

    const soundWithTempo = [...xml.getElementsByTagName("sound")].find((sound) => Number(sound.getAttribute("tempo")) > 0);
    if (soundWithTempo) importedTempo = Math.round(Number(soundWithTempo.getAttribute("tempo")));
    const perMinute = [...xml.getElementsByTagName("per-minute")][0]?.textContent;
    if (!soundWithTempo && Number(perMinute) > 0) importedTempo = Math.round(Number(perMinute));

    xmlChildren(pianoPart, "measure").forEach((measure) => {
      const attributes = xmlChild(measure, "attributes");
      const nextDivisions = Number(xmlText(attributes, "divisions"));
      if (nextDivisions > 0) divisions = nextDivisions;
      const timeNode = xmlChild(attributes, "time");
      const candidateTime = `${xmlText(timeNode, "beats")}/${xmlText(timeNode, "beat-type")}`;
      if (TIME_SIGNATURES.includes(candidateTime)) {
        currentMeasureTime = candidateTime;
        if (!foundTimeSignature) {
          importedTime = candidateTime;
          foundTimeSignature = true;
        }
      }
      const [numerator, denominator] = currentMeasureTime.split("/").map(Number);
      const measureBeats = numerator * 4 / denominator;
      let cursor = measureStart;
      let lastNoteStart = cursor;
      let furthestCursor = cursor;
      let lastTupletAtStart = new Map();

      [...measure.children].forEach((node) => {
        if (node.localName === "backup" || node.localName === "forward") {
          const amount = Number(xmlText(node, "duration")) / divisions;
          if (Number.isFinite(amount)) cursor += node.localName === "backup" ? -amount : amount;
          cursor = Math.max(measureStart, cursor);
          return;
        }
        if (node.localName !== "note" || xmlChild(node, "grace")) return;
        const durationBeats = musicXmlDuration(node, divisions);
        const isChord = Boolean(xmlChild(node, "chord"));
        const startBeat = cleanBeat(isChord ? lastNoteStart : cursor);
        if (!isChord) lastNoteStart = startBeat;
        if (!xmlChild(node, "rest")) {
          const pitch = xmlChild(node, "pitch");
          const step = xmlText(pitch, "step");
          const alter = Number(xmlText(pitch, "alter") || 0);
          const octave = Number(xmlText(pitch, "octave"));
          const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
          const midi = (octave + 1) * 12 + pitchClass + alter;
          if (!Number.isFinite(midi) || !noteByName.has(noteFromMidi(midi))) {
            skipped += 1;
          } else {
            const canonicalNote = noteFromMidi(midi);
            const spelling = `${step}${alter === 1 ? "#" : alter === -1 ? "b" : ""}${octave}`;
            const onsetKey = startBeat.toFixed(6);
            if (!onsets.has(onsetKey)) onsets.set(onsetKey, `import-onset-${onsets.size + 1}`);
            const imported = {
              id: `import-note-${serial + 1}`,
              onsetId: onsets.get(onsetKey),
              note: canonicalNote,
              spelling: /^[A-G](?:#|b)?\d$/.test(spelling) ? spelling : canonicalNote,
              midi,
              duration: millisecondsFromQuarterUnits(durationBeats) / 1000,
              durationBeats: cleanBeat(durationBeats),
              startBeat,
              rawStartBeat: null,
              rawDurationBeats: null,
              joinToOnsetId: null,
              preferredStaff: xmlText(node, "staff") === "2" ? "bass" : xmlText(node, "staff") === "1" ? "treble" : null,
              preferredVoice: xmlText(node, "voice") || null,
              sourceType: "import",
              createdAt: Date.now() + serial
            };

            const modification = xmlChild(node, "time-modification");
            const actual = Number(xmlText(modification, "actual-notes"));
            const normal = Number(xmlText(modification, "normal-notes"));
            if (actual > 1 && normal > 0) {
              const type = xmlText(node, "type");
              const baseSlug = type === "eighth" ? "eighth" : "sixteenth";
              const voice = xmlText(node, "voice") || "1";
              const notationTuplet = [...node.getElementsByTagName("tuplet")][0];
              const number = notationTuplet?.getAttribute("number") || "1";
              const key = `${voice}-${number}-${actual}-${normal}-${baseSlug}`;
              const sameStart = lastTupletAtStart.get(`${onsetKey}-${key}`);
              if (sameStart) {
                Object.assign(imported, sameStart);
              } else {
                const tupleType = notationTuplet?.getAttribute("type");
                if (tupleType === "start" || !activeTuplets.has(key)) {
                  activeTuplets.set(key, { id: `import-tuplet-${serial + 1}`, index: 0 });
                }
                const active = activeTuplets.get(key);
                const tupletData = {
                  tupletId: active.id,
                  tupletIndex: active.index,
                  tupletCount: actual,
                  tupletNotesOccupied: normal,
                  tupletBaseSlug: baseSlug,
                  tupletBaseDuration: baseSlug === "eighth" ? 0.5 : 0.25,
                  tupletUnitBeats: cleanBeat(durationBeats)
                };
                Object.assign(imported, tupletData);
                lastTupletAtStart.set(`${onsetKey}-${key}`, tupletData);
                active.index += 1;
                if (tupleType === "stop" || active.index >= actual) activeTuplets.delete(key);
              }
            }
            const voice = xmlText(node, "voice") || "1";
            const staffNumber = xmlText(node, "staff") || "1";
            const tieTypes = xmlChildren(node, "tie").map((tie) => tie.getAttribute("type"));
            const tieKey = `${voice}-${staffNumber}-${midi}`;
            const tiedFromPrevious = tieTypes.includes("stop") && openTies.has(tieKey);
            if (tiedFromPrevious) {
              const previous = openTies.get(tieKey);
              previous.durationBeats = cleanBeat(previous.durationBeats + durationBeats);
              previous.duration = millisecondsFromQuarterUnits(previous.durationBeats) / 1000;
              if (!tieTypes.includes("start")) openTies.delete(tieKey);
            } else {
              importedNotes.push(imported);
              serial += 1;
              if (tieTypes.includes("start")) openTies.set(tieKey, imported);
            }
          }
        }
        if (!isChord) cursor = cleanBeat(cursor + durationBeats);
        furthestCursor = Math.max(furthestCursor, cursor, startBeat + durationBeats);
      });

      const implicit = measure.getAttribute("implicit") === "yes";
      measureStart = cleanBeat(implicit ? furthestCursor : Math.max(furthestCursor, measureStart + measureBeats));
    });

    if (!importedNotes.length) throw new Error("No notes between C1 and C8 were found in this score.");
    const title = [...xml.getElementsByTagName("movement-title")][0]?.textContent?.trim()
      || [...xml.getElementsByTagName("work-title")][0]?.textContent?.trim()
      || "Imported score";
    return {
      ideaTitle: title.slice(0, 60),
      instrument: "piano",
      range: bestRangeForNotes(importedNotes),
      timeSignature: importedTime,
      tempo: Math.max(40, Math.min(200, importedTempo)),
      volume: state.volume,
      timelineEndBeat: measureStart,
      notes: importedNotes,
      skipped
    };
  }

  function normalizeProject(data) {
    if (!data || !Array.isArray(data.notes)) throw new Error("This project file has no notes.");
    const notes = data.notes.map((item, index) => {
      const named = typeof item.note === "string" ? noteByName.get(item.note) : null;
      if (!named) return null;
      const startBeat = Math.max(0, cleanBeat(Number(item.startBeat) || 0));
      const durationBeats = Math.max(RHYTHM_QUANTUM, cleanBeat(Number(item.durationBeats) || 1));
      return {
        ...item,
        id: String(item.id || `project-note-${index + 1}`),
        onsetId: String(item.onsetId || `project-onset-${index + 1}`),
        note: named.note,
        spelling: typeof item.spelling === "string" && /^[A-G](?:#|b)?\d$/.test(item.spelling) ? item.spelling : named.note,
        midi: named.midi,
        startBeat,
        durationBeats,
        duration: millisecondsFromQuarterUnits(durationBeats) / 1000,
        rawStartBeat: Number.isFinite(item.rawStartBeat) ? cleanBeat(item.rawStartBeat) : null,
        rawDurationBeats: Number.isFinite(item.rawDurationBeats) ? cleanBeat(item.rawDurationBeats) : null,
        preferredStaff: ["treble", "bass"].includes(item.preferredStaff) ? item.preferredStaff : null,
        preferredVoice: typeof item.preferredVoice === "string" && item.preferredVoice ? item.preferredVoice : null,
        sourceType: item.sourceType === "import" ? "import" : "recording",
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now() + index
      };
    }).filter(Boolean);
    if (!notes.length) throw new Error("This project contains no supported piano notes.");
    return {
      ideaTitle: typeof data.ideaTitle === "string" && data.ideaTitle.trim() ? data.ideaTitle.trim().slice(0, 60) : "Imported score",
      instrument: ["piano", "electric", "organ"].includes(data.instrument) ? data.instrument : "piano",
      range: RANGE_OPTIONS.includes(data.range) ? data.range : bestRangeForNotes(notes),
      timeSignature: TIME_SIGNATURES.includes(data.timeSignature) ? data.timeSignature : "4/4",
      tempo: Number.isFinite(data.tempo) ? Math.max(40, Math.min(200, Math.round(data.tempo))) : 100,
      volume: Number.isFinite(data.volume) ? Math.max(0, Math.min(100, data.volume)) : state.volume,
      timelineEndBeat: Number.isFinite(data.timelineEndBeat) ? Math.max(0, cleanBeat(data.timelineEndBeat)) : 0,
      bindings: data.bindings,
      notes,
      skipped: 0
    };
  }

  function applyImportedComposition(imported) {
    stopAllNotes();
    pushHistory();
    applyRange(imported.range, false);
    state.notes = imported.notes;
    state.instrument = imported.instrument;
    state.timeSignature = imported.timeSignature;
    state.tempo = imported.tempo;
    state.volume = imported.volume;
    state.ideaTitle = imported.ideaTitle;
    if (imported.bindings && typeof imported.bindings === "object") {
      const values = notesInRange.map((item, index) => normalizeBinding(String(imported.bindings[item.note] || "")) || DEFAULT_BINDINGS[index]);
      if (new Set(values).size === values.length && !values.includes(" ")) {
        state.bindings = Object.fromEntries(notesInRange.map((item, index) => [item.note, values[index]]));
      }
    }
    state.timelineEndBeat = Math.max(
      imported.timelineEndBeat || 0,
      ...state.notes.map((note) => note.startBeat + note.durationBeats)
    );
    state.selectedKeys.clear();
    resetRecordingClock();
    renderPiano();
    renderBindings();
    el.instrumentSelect.value = state.instrument;
    el.instrumentTitle.textContent = instrumentLabel();
    el.range.value = state.range;
    el.timeSignature.value = state.timeSignature;
    el.tempo.value = String(state.tempo);
    el.tempoOutput.value = `${state.tempo} BPM`;
    el.volume.value = String(state.volume);
    el.volumeOutput.value = `${state.volume}%`;
    saveAll();
    renderScore();
  }

  async function importScoreFile() {
    const file = el.importFile.files?.[0];
    if (!file) return;
    el.importOpen.disabled = true;
    setAppStatus("Importing score…", "playing");
    try {
      const text = await file.text();
      const trimmed = text.trim();
      const imported = trimmed.startsWith("{")
        ? normalizeProject(JSON.parse(trimmed))
        : parseMusicXml(text);
      applyImportedComposition(imported);
      const skippedMessage = imported.skipped ? ` ${imported.skipped} unsupported notes were skipped.` : "";
      showToast(`Imported ${imported.notes.length} notes from ${file.name}.${skippedMessage}`);
    } catch (error) {
      console.error(error);
      showToast(error instanceof SyntaxError ? "This project file is not valid JSON." : error.message || "The score could not be imported.", "error");
      updateStatus();
    } finally {
      el.importFile.value = "";
      el.importOpen.disabled = false;
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
      const possibleBindings = new Set([
        normalizeBinding(event.key),
        bindingFromPhysicalCode(event.code)
      ].filter(Boolean));
      const note = notesInRange.find((item) => possibleBindings.has(state.bindings[item.note]))?.note;
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
      if (document.hidden) {
        stopAllNotes();
        clearMetronomeTimer();
      } else if (metronomeEnabled) {
        restartMetronomeClock();
      }
    });
    el.recordToggle.addEventListener("click", toggleRecording);
    el.playScore.addEventListener("click", playComposition);
    el.metronomeToggle.addEventListener("click", () => setMetronomeEnabled(!metronomeEnabled));
    el.undo.addEventListener("click", undo);
    el.redo.addEventListener("click", redo);
    el.deleteNote.addEventListener("click", deleteSelectedItems);
    el.clearSelection.addEventListener("click", () => {
      state.selectedKeys.clear();
      renderScore();
      el.staff.focus();
    });
    el.clearScore.addEventListener("click", clearComposition);
    el.importOpen.addEventListener("click", () => el.importFile.click());
    el.importFile.addEventListener("change", importScoreFile);
    el.exportOpen.addEventListener("click", openExport);
    el.staff.addEventListener("click", (event) => {
      const target = event.target.closest(".score-hit-target");
      const selectionKey = target?.dataset.selectionKey;
      if (!selectionKey) return;
      if (state.selectedKeys.has(selectionKey)) state.selectedKeys.delete(selectionKey);
      else state.selectedKeys.add(selectionKey);
      renderScore();
    });
    el.staff.addEventListener("keydown", (event) => {
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedKeys.size) {
        event.preventDefault();
        deleteSelectedItems();
      }
    });
    el.instrumentSelect.addEventListener("change", () => {
      state.instrument = el.instrumentSelect.value;
      el.instrumentTitle.textContent = instrumentLabel();
      saveAll();
      stopAllNotes();
      showToast(`${instrumentLabel()} selected.`);
    });
    el.range.addEventListener("change", () => {
      stopAllNotes();
      applyRange(el.range.value, true);
      renderPiano();
      renderBindings();
      saveAll();
      requestAnimationFrame(() => {
        el.pianoWrap.scrollLeft = Math.max(0, (el.pianoWrap.scrollWidth - el.pianoWrap.clientWidth) / 2);
      });
      showToast(`${rangeLabel()} selected. Your existing score stays unchanged.`);
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
      if (metronomeEnabled) restartMetronomeClock();
      saveAll();
      renderScore();
    });
    el.timeSignature.addEventListener("change", () => {
      stopAllNotes();
      state.timeSignature = TIME_SIGNATURES.includes(el.timeSignature.value) ? el.timeSignature.value : "4/4";
      resetRecordingClock();
      renderMetronomeBeats();
      if (metronomeEnabled) restartMetronomeClock();
      saveAll();
      renderScore();
      showToast(`${state.timeSignature} time selected. Measures and rests were recalculated.`);
    });
    el.settingsOpen.addEventListener("click", openSettings);
    el.settingsClose.addEventListener("click", () => closeDialog(el.settingsDialog));
    el.settingsCancel.addEventListener("click", () => closeDialog(el.settingsDialog));
    el.settingsForm.addEventListener("submit", saveSettings);
    el.accountOpen.addEventListener("click", openAccount);
    el.accountClose.addEventListener("click", () => closeDialog(el.accountDialog));
    el.accountForm.addEventListener("submit", loginDeviceAccount);
    el.accountCreate.addEventListener("click", createDeviceAccount);
    el.accountLogout.addEventListener("click", logoutDeviceAccount);
    el.settingsSignIn.addEventListener("click", () => {
      closeDialog(el.settingsDialog);
      openAccount();
    });
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
    el.printScore.addEventListener("click", printScore);
    el.downloadSvg.addEventListener("click", downloadScoreSvg);
    el.downloadProject.addEventListener("click", downloadProject);
    document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    }));
  }

  function initialize() {
    loadSavedState();
    loadActiveAccount();
    applyPersonalization();
    renderPiano();
    renderBindings();
    bindEvents();
    renderAccountState();
    el.instrumentSelect.value = state.instrument;
    el.instrumentTitle.textContent = instrumentLabel();
    el.volume.value = String(state.volume);
    el.volumeOutput.value = `${state.volume}%`;
    el.tempo.value = String(state.tempo);
    el.tempoOutput.value = `${state.tempo} BPM`;
    el.timeSignature.value = state.timeSignature;
    el.range.value = state.range;
    renderMetronomeBeats();
    renderScore();
    requestAnimationFrame(() => {
      el.pianoWrap.scrollLeft = Math.max(0, (el.pianoWrap.scrollWidth - el.pianoWrap.clientWidth) / 2);
    });
    if (state.notes.length) showToast(`Recovered ${state.notes.length} saved ${state.notes.length === 1 ? "note" : "notes"}.`);
  }

  initialize();
})();
