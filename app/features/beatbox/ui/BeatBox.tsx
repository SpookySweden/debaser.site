'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SongLoadError } from "../engine";
import { makeSound, soundIdOf, tryPitchOf } from "../engine/sounds";
import { NOTE_KEY_LABELS } from "../input/computerKeys";
import { QUANTISE_OPTIONS } from "../recorder/convert";
import type { NoteData, SongData } from "../engine/songData";
import { createApp } from "./app";
import { AUDIO_MODES, audioBehaviour, type AudioMode } from "./audioModes";
import { BarRow, type BarPick } from "./BarRow";
import { channelName } from "./channelLooks";
import { ChoiceGroup } from "./ChoiceGroup";
import { HelpPanel } from "./HelpPanel";
import { HintLine } from "./HintLine";
import { InOut, type SavedSong } from "./InOut";
import {
  actionFor,
  keyWords,
  loadBindings,
  saveBindings,
  STARTING_KEYS,
  strokeOf,
  type Bindings,
  type KeyAction,
  type KeyStorage,
} from "./keyBindings";
import { GLYPHS } from "./keyHelp";
import { KeysPanel } from "./KeysPanel";
import { createLiveNotes } from "./liveNotes";
import { barGlyph, barMainGlyph, glyphKey, smallKey, stripKey, titleLine } from "./looks";
import { MidiConnect } from "./MidiConnect";
import { NoteGrid, type NoteGridHandle } from "./NoteGrid";
import { Pads } from "./Pads";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { PopWindow } from "./PopWindow";
import { BeatLight, RecordPanel } from "./RecordPanel";
import { createRecordSession } from "./recordSession";
import { barsUsingPattern, replacePatternNotes, setChannelSound } from "./songEdit";
import { SoundsPanel } from "./SoundsPanel";
import { useElementSize } from "./useElementSize";
import { createWindowStore, type WindowName } from "./windowStore";

export type BeatBoxTheme = "default" | "high-contrast";

const HEAR_NOTE_MS = 250;
const CURSOR_TONE_MS = 100;
const TEMPO_STEP = 5;
// How long a new sound plays, so it can be heard. Long enough for a slow pad to get going.
const TRY_SOUND_MS = 600;
const NAMES_KEY = "debaser.beatbox.key-names.v1";

const WINDOW_KEYS: readonly { readonly name: WindowName; readonly label: string; readonly glyph: string; readonly action: KeyAction; readonly hint: string }[] = [
  { name: "sounds", label: "Sounds", glyph: GLYPHS.sounds, action: "windowSounds", hint: "Sounds: the kinds of instrument" },
  { name: "recorder", label: "Recorder", glyph: GLYPHS.recorder, action: "windowRecorder", hint: "Recorder: how recording works" },
  { name: "playing", label: "Playing", glyph: GLYPHS.playing, action: "windowPlaying", hint: "Playing: computer keys, pads and a MIDI keyboard" },
  { name: "song", label: "Song", glyph: GLYPHS.song, action: "windowSong", hint: "Song: open, save and share" },
  { name: "settings", label: "Settings", glyph: GLYPHS.settings, action: "windowSettings", hint: "Settings: how it looks and sounds, and every key" },
];

/** What's on a small key: its glyph, and its name under it for anyone who's asked for them in Settings. */
function KeyFace({ glyph, name, names }: { glyph: string; name: string; names: boolean }) {
  return (
    <>
      <span aria-hidden="true">{glyph}</span>
      {names && (
        <span aria-hidden="true" className="px-1 text-bb-cell-m uppercase">
          {name}
        </span>
      )}
    </>
  );
}

function rememberedNames(memory: KeyStorage | null): boolean {
  try {
    return memory?.getItem(NAMES_KEY) === "on";
  } catch {
    return false;
  }
}

/** A key in the words a screen reader wants. */
function ariaKeys(stroke: string): string {
  return stroke.replace("Ctrl+", "Control+").replace(/Key([A-Z])$/, "$1");
}

function startingTheme(): BeatBoxTheme {
  return window.matchMedia?.("(prefers-contrast: more)").matches ? "high-contrast" : "default";
}

export interface BeatBoxProps {
  theme?: BeatBoxTheme;
  /** A beepbox.co link or song text to open at the start. */
  initialSong?: string;
  /** Adds a Save button. Saving goes only through here. */
  onSave?: (song: SavedSong) => void;
  /** Share links start with this. Without it they open on beepbox.co. */
  shareLinkStart?: string;
  /** More controls beside Save, such as sharing or saved songs. */
  extras?: (getSong: () => SavedSong) => ReactNode;
  /** Hide the visible title, for a page that already has its own. */
  hideTitle?: boolean;
  /** Luke's own pixel art. With none, the slots stay empty. */
  art?: BeatBoxArt;
  /** Marks where the art slots are, for placing art. */
  showArtSlots?: boolean;
  /** The one key that brings the page's side panel back, or folds it again. */
  onTogglePanel?: () => void;
  /** Where the changed keys and the windows' places are remembered. Without it they last until the page closes. */
  memory?: KeyStorage | null;
}

const NO_ART: BeatBoxArt = {};

export function BeatBox({
  theme: themeProp,
  initialSong,
  onSave,
  shareLinkStart,
  extras,
  hideTitle = false,
  art = NO_ART,
  showArtSlots = false,
  onTogglePanel,
  memory = null,
}: BeatBoxProps = {}) {
  const [status, setStatus] = useState("Stopped.");
  // All one starter: React runs starters twice while developing, and a spare set
  // made from a shared app would carry on listening and recording alongside the real one.
  const [{ app, live, session }] = useState(() => {
    const newApp = createApp();
    const newLive = createLiveNotes(newApp);
    return { app: newApp, live: newLive, session: createRecordSession(newApp, newLive) };
  });
  useEffect(() => session.setAnnouncer(setStatus), [session]);
  const { engine, songs, transport } = app;
  const octave = useSyncExternalStore(live.subscribe, live.getOctave);
  const song = useSyncExternalStore(songs.subscribe, songs.getSong);
  const playing = useSyncExternalStore(transport.subscribe, transport.isPlaying);
  const recordSettings = useSyncExternalStore(session.subscribe, session.getSettings);
  const [pick, setPick] = useState<BarPick>({ channel: 0, bar: 0 });
  const [follow, setFollow] = useState(false);
  const [songNumber, setSongNumber] = useState(0);
  const [audioMode, setAudioMode] = useState<AudioMode>("practice");
  const [focusView, setFocusView] = useState(false);
  const [theme, setTheme] = useState<BeatBoxTheme>(() => themeProp ?? startingTheme());
  const [helpOpen, setHelpOpen] = useState(false);
  const [padsShown, setPadsShown] = useState(false);
  const [hand, setHand] = useState(false);
  const [names, setNames] = useState(() => rememberedNames(memory));
  const [barsFolded, setBarsFolded] = useState(false);
  const [looping, setLooping] = useState(true);
  const [bindings, setBindings] = useState<Bindings>(() => loadBindings(memory));
  const [windows] = useState(() => createWindowStore(memory));
  const openWindows = useSyncExternalStore(windows.subscribe, windows.getOpen);
  const [room, roomWidth, roomHeight] = useElementSize();
  const grid = useRef<NoteGridHandle>(null);
  const page = useRef<HTMLDivElement>(null);
  // Where the cursor was when each window opened, to go back to when it shuts.
  const cameFrom = useRef<Partial<Record<WindowName, Element | null>>>({});
  const pausedOnBar = useRef<number | null>(null);
  const spaceTaken = useRef(false);
  const cursorTone = useRef<{ pitch: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const behaviour = audioBehaviour(audioMode);

  useEffect(() => engine.setVolume(behaviour.volume), [engine, behaviour.volume]);

  // Recording goes in passes round the loop, whatever the Loop key says.
  const keepLooping = looping || recordSettings.recording || recordSettings.calibrating;
  useEffect(() => engine.setLooping(keepLooping), [engine, keepLooping]);

  useEffect(
    () =>
      transport.onEnd(() => {
        session.stopPlayback();
        setStatus("That's the end of the song.");
      }),
    [session, transport],
  );

  // The cursor is on the grid from the start, so the arrows and Enter work at once.
  useEffect(() => {
    // It doesn't scroll to get there: at high zoom the first thing to see is the main keys.
    if (document.activeElement === document.body) grid.current?.focus({ preventScroll: true });
  }, [songNumber]);

  const stop = useCallback(() => {
    const wasRecording = session.getSettings().recording;
    session.stopPlayback();
    if (!wasRecording) setStatus("Stopped.");
  }, [session]);

  function pause() {
    session.pausePlayback();
    pausedOnBar.current = pick.bar;
    setStatus(transport.isPaused() ? "Paused. Play carries on from here, Stop goes back." : "Stopped.");
  }

  function togglePlay() {
    if (transport.isPlaying()) {
      pause();
    } else if (transport.isPaused() && pausedOnBar.current === pick.bar) {
      transport.resume();
      setStatus("Playing.");
    } else {
      transport.play(pick.bar);
      setStatus(looping ? "Playing. It repeats until you stop it." : "Playing through to the end of the song.");
    }
  }

  function toggleLoop() {
    setLooping(!looping);
    setStatus(looping ? "Loop off. The song plays through to its end and stops." : "Loop on. It repeats until you stop it.");
  }

  function capture() {
    if (keepLooping) session.capture();
    else setStatus("Capture needs the loop on, so turn it on and play it round.");
  }

  function changeTempo(by: number) {
    const current = songs.getSong();
    const tempo = engine.setTempo(current.tempo + by);
    songs.edit({ ...current, tempo });
    setStatus(`Speed: ${tempo} beats a minute.`);
  }

  function shiftOctave(by: number) {
    setStatus(`Octave ${live.shiftOctave(by)}.`);
  }

  function undo() {
    setStatus(songs.undo() ? "Undone." : "Nothing to undo.");
  }

  function redo() {
    setStatus(songs.redo() ? "Redone." : "Nothing to redo.");
  }

  function toggleHand() {
    setHand(!hand);
    setStatus(hand ? "Hand off. Dragging moves the notes." : "Hand on. Dragging moves the view.");
  }

  function toggleNames() {
    const next = !names;
    setNames(next);
    try {
      if (next) memory?.setItem(NAMES_KEY, "on");
      else memory?.removeItem(NAMES_KEY);
    } catch {
      // A browser that won't keep it only forgets it next time.
    }
  }

  function toggleFollow() {
    setFollow(!follow);
    setStatus(follow ? "The notes stay on the bar you picked." : "The notes now follow the playing bar.");
  }

  function changeAudioMode(mode: AudioMode) {
    setAudioMode(mode);
    setStatus(AUDIO_MODES.find((option) => option.value === mode)?.explanation ?? "");
  }

  function cycleAudioMode() {
    const index = AUDIO_MODES.findIndex((option) => option.value === audioMode);
    const next = AUDIO_MODES[(index + 1) % AUDIO_MODES.length];
    if (next) changeAudioMode(next.value);
  }

  function toggleFocusView() {
    setFocusView(!focusView);
    setStatus(focusView ? "Focus view off." : "Focus view: the notes and little else. Press full stop to leave.");
  }

  function toggleTheme() {
    const next = theme === "default" ? "high-contrast" : "default";
    setTheme(next);
    setStatus(next === "default" ? "High contrast off." : "High contrast on.");
  }

  function goToGrid(label: string) {
    page.current?.querySelector<HTMLElement>(`[aria-label^="${label}"] [role="gridcell"][tabindex="0"]`)?.focus();
  }

  function openWindow(name: WindowName) {
    cameFrom.current[name] = document.activeElement;
    windows.open(name);
    setTimeout(() => page.current?.querySelector<HTMLElement>(`[data-window="${name}"]`)?.focus());
  }

  function closeWindow(name: WindowName) {
    windows.close(name);
    const back = cameFrom.current[name];
    setTimeout(() => {
      // Back where the cursor came from, or failing that to the key that opens this window.
      if (back instanceof HTMLElement && back.isConnected && back.getClientRects().length > 0 && !back.closest(`[data-window="${name}"]`)) back.focus();
      else page.current?.querySelector<HTMLElement>(`[data-window-key="${name}"]`)?.focus();
    });
  }

  /** Its key opens a shut window, brings forward one behind others, and shuts the one in front. */
  function pressWindowKey(name: WindowName) {
    if (!windows.isOpen(name)) openWindow(name);
    else if (windows.isFront(name)) closeWindow(name);
    else {
      windows.toFront(name);
      setTimeout(() => page.current?.querySelector<HTMLElement>(`[data-window="${name}"]`)?.focus());
    }
  }

  function changeBindings(next: Bindings) {
    setBindings(next);
    saveBindings(memory, next);
  }

  function resetBindings() {
    changeBindings(STARTING_KEYS);
    setStatus("All the keys are back as they started.");
  }

  function putWindowsBack() {
    windows.resetPlaces();
    setStatus("The windows are back where they started.");
  }

  /** Plays this channel's sound. Heard over a playing song by itself, and on its own when there's none. */
  function trySound() {
    const channel = songs.getSong().channels[pick.channel];
    if (!channel) return;
    const pitch = tryPitchOf(soundIdOf(channel.sounds[0], channel.isDrum) ?? "", channel.isDrum);
    engine.playLiveNote(pitch, pick.channel);
    setTimeout(() => engine.releaseLiveNote(pitch), TRY_SOUND_MS);
  }

  function changeSound(soundId: string) {
    const current = songs.getSong();
    const channel = current.channels[pick.channel];
    if (!channel) return;
    songs.edit(
      setChannelSound(
        current,
        pick.channel,
        channel.sounds.map((sound) => makeSound(soundId, channel.isDrum, sound)),
      ),
    );
    trySound();
    setStatus(`${channelName(current, pick.channel)} has a new sound.`);
  }

  function toggleBars() {
    const inBars = document.activeElement?.closest("[aria-label='Bars']");
    setBarsFolded(!barsFolded);
    setStatus(barsFolded ? "Bars showing." : "Bars hidden. The notes get the room.");
    if (inBars) setTimeout(() => grid.current?.focus());
  }

  /** Off the end of a bar, on to the next one. */
  function barStep(direction: 1 | -1): boolean {
    const bar = pick.bar + direction;
    if (bar < 0 || bar >= songs.getSong().barCount) {
      setStatus(direction === 1 ? "That's the end of the song." : "That's the start of the song.");
      return false;
    }
    setPick({ channel: pick.channel, bar });
    setStatus(`Bar ${bar + 1}.`);
    return true;
  }

  function cycleMode() {
    session.setMode(session.getSettings().mode === "overdub" ? "replace" : "overdub");
  }

  function cycleCountIn() {
    session.setCountIn((session.getSettings().countInBars + 1) % 3);
  }

  function cycleMetronome() {
    const order = ["off", "count-in", "always"] as const;
    const next = order[(order.indexOf(session.getSettings().metronome) + 1) % order.length];
    if (next) session.setMetronome(next);
  }

  function cycleQuantise() {
    session.setQuantise((session.getSettings().quantiseIndex + 1) % QUANTISE_OPTIONS.length);
  }

  function showOctave() {
    setStatus(`Octave ${live.getOctave()}.`);
  }

  // The newest versions, for the key listener that is only added once.
  const actions: Record<KeyAction, () => void> = {
    playPause: togglePlay,
    stop,
    loop: toggleLoop,
    slower: () => changeTempo(-TEMPO_STEP),
    faster: () => changeTempo(TEMPO_STEP),
    follow: toggleFollow,
    undo,
    redo,
    record: session.toggleRecord,
    capture,
    recordMode: cycleMode,
    countIn: cycleCountIn,
    metronome: cycleMetronome,
    quantise: cycleQuantise,
    windowSounds: () => pressWindowKey("sounds"),
    windowRecorder: () => pressWindowKey("recorder"),
    windowPlaying: () => pressWindowKey("playing"),
    windowSong: () => pressWindowKey("song"),
    windowSettings: () => pressWindowKey("settings"),
    help: () => setHelpOpen(true),
    bars: toggleBars,
    sidePanel: () => onTogglePanel?.(),
    audioMode: cycleAudioMode,
    focusView: toggleFocusView,
    contrast: toggleTheme,
    hand: toggleHand,
  };
  const latest = { actions, bindings, showOctave, closeWindow };
  const pageKeys = useRef(latest);
  useEffect(() => {
    pageKeys.current = latest;
  });

  useEffect(() => {
    function pageKeyDown(event: globalThis.KeyboardEvent) {
      const keys = pageKeys.current;
      if (event.metaKey || event.altKey) return;
      // The help panel has its own keys. Esc closes it, by itself.
      if (document.querySelector("dialog[open]")) return;
      // On a page shared with other windows, a key pressed in one of them is for that window.
      if (event.target instanceof Element && event.target !== document.body && !page.current?.contains(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      const inTextBox = target?.closest("input, textarea, select, [contenteditable]");
      // Esc shuts the window in front before it means anything else, wherever the cursor is.
      if (event.key === "Escape") {
        const front = windows.getOpen().at(-1);
        if (front) {
          keys.closeWindow(front);
          return;
        }
      }
      const stroke = strokeOf(event);
      const action = stroke === null ? null : actionFor(keys.bindings, stroke);
      if (inTextBox && event.key !== "Escape") return;
      // A set of choices and a held pad have a use for Space of their own. In the bars, these three change the pattern.
      const spaceIsTaken = stroke === "Space" && target?.closest("[role='radio'], [aria-label='Pads']");
      const barsHaveIt = (event.key === "-" || event.key === "=" || event.key === "+") && target?.closest("[aria-label^='Bars for']");
      if (action && !spaceIsTaken && !barsHaveIt) {
        event.preventDefault();
        if (event.key === " ") spaceTaken.current = true;
        if (!event.repeat || action === "undo" || action === "redo") keys.actions[action]();
        return;
      }
      if (live.keys.keyDown(event)) {
        event.preventDefault();
        if (event.code === "KeyZ" || event.code === "KeyX") keys.showOctave();
      }
    }
    function pageKeyUp(event: globalThis.KeyboardEvent) {
      // Some browsers press a focused key when Space is let go, unless told not to.
      if (event.key === " " && spaceTaken.current) {
        spaceTaken.current = false;
        event.preventDefault();
      }
      live.keys.keyUp(event);
    }
    // Keys let go while the window is in the background would otherwise stick.
    function letGoOfEverything() {
      live.releaseAll();
    }
    document.addEventListener("keydown", pageKeyDown);
    document.addEventListener("keyup", pageKeyUp);
    window.addEventListener("blur", letGoOfEverything);
    // Browsers slow a hidden tab's timers, which would spoil the timing of a pass.
    function pageVisibilityChange() {
      if (document.hidden) session.pauseForHiddenTab();
    }
    document.addEventListener("visibilitychange", pageVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", pageVisibilityChange);
      document.removeEventListener("keydown", pageKeyDown);
      document.removeEventListener("keyup", pageKeyUp);
      window.removeEventListener("blur", letGoOfEverything);
    };
  }, [live, session, windows]);

  useEffect(() => {
    live.setChannel(pick.channel);
    session.setChannel(pick.channel);
  }, [live, session, pick.channel]);

  useEffect(
    () => () => {
      transport.stop();
      engine.stopAllNotes();
    },
    [engine, transport],
  );

  useEffect(() => {
    if (!follow) return;
    return transport.subscribe(() => {
      const spot = transport.getSpot();
      if (spot) setPick((current) => (current.bar === spot.bar ? current : { ...current, bar: spot.bar }));
    });
  }, [follow, transport]);

  const openSong = useCallback(
    (text: string) => {
      try {
        const info = engine.loadSong(text);
        transport.stop();
        session.reset();
        songs.reload();
        setPick({ channel: 0, bar: 0 });
        setSongNumber((number) => number + 1);
        setStatus(
          info.hasNotes
            ? `Song opened: ${info.bars} bars, ${info.beatsPerMinute} beats a minute. Space plays it.`
            : "Song opened, but it has no notes in it yet.",
        );
      } catch (error) {
        if (!(error instanceof SongLoadError)) throw error;
        setStatus(`Problem: ${error.message}`);
      }
    },
    [engine, session, songs, transport],
  );

  // Opens the starting song once. Nothing sounds until someone presses Play.
  const openedInitialSong = useRef(false);
  useEffect(() => {
    if (initialSong && !openedInitialSong.current) {
      openedInitialSong.current = true;
      openSong(initialSong);
    }
  }, [initialSong, openSong]);

  function changeNotes(notes: readonly NoteData[], partOfLast = false) {
    const next = replacePatternNotes(songs.getSong(), pick.channel, pick.bar, notes);
    if (partOfLast) songs.reviseLatest(next);
    else songs.edit(next);
  }

  function changeSong(next: SongData, partOfLast = false) {
    if (partOfLast) songs.reviseLatest(next);
    else songs.edit(next);
  }

  /** Setting the loop means wanting it to loop. */
  function loopSet() {
    setLooping(true);
  }

  function noteToggled(pitch: number, on: boolean) {
    if (behaviour.toggleClicks) engine.playClick(on);
    if (behaviour.hearsNewNotes && on) {
      engine.playLiveNote(pitch, pick.channel);
      setTimeout(() => engine.releaseLiveNote(pitch), HEAR_NOTE_MS);
    }
  }

  function cursorMoved(pitch: number) {
    if (!behaviour.cursorTones || recordSettings.recording) return;
    if (cursorTone.current) {
      clearTimeout(cursorTone.current.timer);
      engine.releaseLiveNote(cursorTone.current.pitch);
    }
    engine.playLiveNote(pitch, pick.channel);
    cursorTone.current = {
      pitch,
      timer: setTimeout(() => {
        engine.releaseLiveNote(pitch);
        cursorTone.current = null;
      }, CURSOR_TONE_MS),
    };
  }

  const pickedChannel = song.channels[pick.channel];
  const pickedPattern = pickedChannel?.bars[pick.bar] ?? 0;
  const sharedBars = pickedChannel ? barsUsingPattern(pickedChannel, pickedPattern) : 0;
  const barsShowing = !focusView && !barsFolded;
  const keyFor = (action: KeyAction) => keyWords(bindings[action]);
  const roomSize = { width: roomWidth, height: roomHeight };

  const loopWords = `bars ${song.loopStart + 1} to ${song.loopStart + song.loopLength}`;
  const handKey = (
    <button type="button" aria-label="Hand" aria-pressed={hand} title={`Hand: dragging moves the view (${keyFor("hand")})`} onClick={toggleHand} className={glyphKey(hand)}>
      {GLYPHS.hand}
    </button>
  );

  return (
    <div
      ref={page}
      data-theme={theme}
      className="debaser-beatbox relative flex min-h-full flex-col bg-bb-nigrosine max-md:pb-16 md:h-full font-beatbox text-bb-white print:bg-bb-white"
    >
      <HelpPanel open={helpOpen} bindings={bindings} onClose={() => setHelpOpen(false)} />

      <div className="contents print:hidden">
        <div className="contents">
          {barsShowing && (
            <button type="button" onClick={() => goToGrid("Bars for")} className={`${smallKey()} sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bb-nigrosine`}>
              Go to the bars
            </button>
          )}
          <button type="button" onClick={() => goToGrid("Notes")} className={`${smallKey()} sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bb-nigrosine`}>
            Go to the notes
          </button>
        </div>
        {!hideTitle && <h1 className="text-bb-title font-bold wrap-anywhere">DEBASER_BEATBOX</h1>}

        {/* The slim bar: everything you need without looking anywhere else. */}
        <div role="group" aria-label="Main keys" className="flex flex-none flex-wrap items-stretch gap-x-1 gap-y-1 px-1 py-1 2xl:gap-x-2 2xl:px-2">
          <div role="group" aria-label="Playing the song" className="flex flex-wrap items-stretch gap-x-1">
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={togglePlay}
              title={`${playing ? "Pause" : "Play"} (${keyFor("playPause")})`}
              aria-keyshortcuts={ariaKeys(bindings.playPause)}
              className={barMainGlyph}
            >
              <KeyFace glyph={playing ? GLYPHS.pause : GLYPHS.play} name={playing ? "Pause" : "Play"} names={names} />
            </button>
            <button type="button" aria-label="Stop" onClick={stop} title={`Stop, and go back to the picked bar (${keyFor("stop")})`} className={barGlyph()}>
              <KeyFace glyph={GLYPHS.stop} name="Stop" names={names} />
            </button>
            <button
              type="button"
              aria-label={looping ? `Loop ${loopWords}` : "Loop off"}
              aria-pressed={looping}
              onClick={toggleLoop}
              title={looping ? `Loop on: ${loopWords} repeat. Press for the whole song, once (${keyFor("loop")})` : `Loop off: the whole song, once. Press to repeat ${loopWords} (${keyFor("loop")})`}
              className={focusView ? "hidden" : barGlyph(looping)}
            >
              <KeyFace glyph={GLYPHS.loop} name="Loop" names={names} />
            </button>
          </div>
          <PixelSlot name="record-light" size="light" src={art.recordLight} showEmpty={showArtSlots} />
          <button
            type="button"
            aria-pressed={recordSettings.recording}
            onClick={session.toggleRecord}
            title={`Record, or stop recording and keep playing (${keyFor("record")})`}
            aria-label={recordSettings.recording ? `Recording pass ${recordSettings.pass}` : "Record"}
            aria-keyshortcuts={ariaKeys(bindings.record)}
            className={barGlyph(recordSettings.recording)}
          >
            {recordSettings.recording ? (
              <span aria-hidden="true" className="whitespace-nowrap">
                {GLYPHS.record} {recordSettings.pass}
              </span>
            ) : (
              <KeyFace glyph={GLYPHS.record} name="Record" names={names} />
            )}
          </button>
          <button type="button" aria-label="Undo" onClick={undo} title={`Undo (${keyFor("undo")})`} aria-keyshortcuts={ariaKeys(bindings.undo)} className={focusView ? "hidden" : barGlyph()}>
            <KeyFace glyph={GLYPHS.undo} name="Undo" names={names} />
          </button>
          <button type="button" aria-label="Redo" onClick={redo} title={`Redo (${keyFor("redo")})`} aria-keyshortcuts={ariaKeys(bindings.redo)} className={focusView ? "hidden" : barGlyph()}>
            <KeyFace glyph={GLYPHS.redo} name="Redo" names={names} />
          </button>
          <div role="group" aria-label="Speed" className={focusView ? "hidden" : "flex flex-wrap items-stretch gap-x-1"}>
            <button type="button" aria-label="Slower" title={`Slower (${keyFor("slower")})`} onClick={() => changeTempo(-TEMPO_STEP)} className={barGlyph()}>
              <KeyFace glyph="-" name="Slower" names={names} />
            </button>
            <span title="The speed, in beats a minute" className="flex items-center text-bb-large font-bold whitespace-nowrap">
              <span className="sr-only">Speed </span>
              <span aria-hidden="true">{GLYPHS.beat}</span>
              {song.tempo}
            </span>
            <button type="button" aria-label="Faster" title={`Faster (${keyFor("faster")})`} onClick={() => changeTempo(TEMPO_STEP)} className={barGlyph()}>
              <KeyFace glyph="+" name="Faster" names={names} />
            </button>
          </div>
          <div role="group" aria-label="Windows" className="ml-auto flex flex-wrap items-stretch gap-x-1">
            {WINDOW_KEYS.map(({ name, label, glyph, action, hint }) => (
              <button
                key={name}
                type="button"
                data-window-key={name}
                aria-label={label}
                aria-expanded={openWindows.includes(name)}
                onClick={() => pressWindowKey(name)}
                title={`${hint} (${keyFor(action)})`}
                className={focusView && name !== "settings" ? "hidden" : barGlyph(openWindows.includes(name))}
              >
                <KeyFace glyph={glyph} name={label} names={names} />
              </button>
            ))}
            <button type="button" aria-label="All the keys" onClick={() => setHelpOpen(true)} title={`All the keys (${keyFor("help")})`} className={barGlyph()}>
              <KeyFace glyph="?" name="Keys" names={names} />
            </button>
          </div>
        </div>

        <div ref={room} className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          {/* The windows float over the page, which stays usable behind them. At high zoom there's no room to float, so they
              stack above the notes instead. */}
          <div className="md:pointer-events-none md:absolute md:inset-0 md:z-40">
            <PopWindow store={windows} name="sounds" title="Sounds" room={roomSize} wide onClose={() => closeWindow("sounds")}>
              <SoundsPanel
                song={song}
                channel={pick.channel}
                onPickChannel={(channel) => setPick({ channel, bar: pick.bar })}
                onPickSound={changeSound}
                onTrySound={trySound}
              />
            </PopWindow>

            <PopWindow store={windows} name="recorder" title="Recorder" room={roomSize} onClose={() => closeWindow("recorder")}>
              <RecordPanel session={session} keyFor={keyFor} onCapture={capture} />
            </PopWindow>

            <PopWindow store={windows} name="playing" title="Playing" room={roomSize} onClose={() => closeWindow("playing")}>
              <section aria-label="Computer keys" className="flex w-full flex-col items-start gap-bb-gutter">
                <h3 className={titleLine}>
                  <span>Computer keys</span>
                </h3>
                <p className="text-bb-large wrap-anywhere">These play notes: {NOTE_KEY_LABELS}</p>
                <div role="group" aria-label="Computer keys" className="flex flex-wrap items-center gap-bb-gutter">
                  <span className="text-bb-large font-bold uppercase">Octave {octave}</span>
                  <button type="button" aria-label="Lower" title="Lower (Z)" onClick={() => shiftOctave(-1)} className={glyphKey()}>
                    {GLYPHS.down}
                  </button>
                  <button type="button" aria-label="Higher" title="Higher (X)" onClick={() => shiftOctave(1)} className={glyphKey()}>
                    {GLYPHS.up}
                  </button>
                </div>
                <button type="button" aria-pressed={padsShown} onClick={() => setPadsShown(!padsShown)} className={smallKey(padsShown)}>
                  Pads {padsShown ? "on" : "off"}
                </button>
              </section>
              <MidiConnect live={live} />
            </PopWindow>

            <PopWindow store={windows} name="song" title="Song" room={roomSize} wide onClose={() => closeWindow("song")}>
              <InOut
                engine={engine}
                onOpen={openSong}
                onSave={onSave}
                shareLinkStart={shareLinkStart}
                extras={extras}
                onAnnounce={setStatus}
              />
            </PopWindow>

            <PopWindow store={windows} name="settings" title="Settings" room={roomSize} wide onClose={() => closeWindow("settings")}>
              <section aria-label="Seeing and hearing" className="flex w-full flex-col items-start gap-bb-gutter">
                <h3 className={titleLine}>
                  <span>Seeing and hearing</span>
                </h3>
                <ChoiceGroup label="Audio mode" keyName={keyFor("audioMode")} value={audioMode} options={AUDIO_MODES} onChange={changeAudioMode} look={stripKey} stacked />
                <div className="flex flex-wrap items-center gap-bb-gutter">
                  <button type="button" aria-pressed={theme === "high-contrast"} title={`Key: ${keyFor("contrast")}`} onClick={toggleTheme} className={smallKey(theme === "high-contrast")}>
                    High contrast {theme === "high-contrast" ? "on" : "off"}
                  </button>
                  <button type="button" aria-pressed={follow} title={`Key: ${keyFor("follow")}`} onClick={toggleFollow} className={smallKey(follow)}>
                    Follow {follow ? "on" : "off"}
                  </button>
                  <button type="button" aria-pressed={focusView} title={`Key: ${keyFor("focusView")}`} onClick={toggleFocusView} className={smallKey(focusView)}>
                    Focus view {focusView ? "on" : "off"}
                  </button>
                  <button type="button" aria-pressed={names} onClick={toggleNames} className={smallKey(names)}>
                    Names on keys {names ? "on" : "off"}
                  </button>
                  <button type="button" onClick={putWindowsBack} className={smallKey()}>
                    Put windows back
                  </button>
                </div>
              </section>
              <KeysPanel open={openWindows.includes("settings")} bindings={bindings} onChange={changeBindings} onReset={resetBindings} onAnnounce={setStatus} />
            </PopWindow>
          </div>

          <div className={barsShowing ? "contents" : "hidden"}>
            <BarRow
              key={`bars-${songNumber}`}
              song={song}
              pick={pick}
              transport={transport}
              looping={looping}
              hand={hand}
              onPick={setPick}
              onChange={changeSong}
              onLoopSet={loopSet}
              onAnnounce={setStatus}
              onOpenGrid={() => grid.current?.focus()}
              art={art}
              showArtSlots={showArtSlots}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-bb-target-min flex-none items-center gap-x-bb-gutter px-2 text-display">
              {!barsShowing && !focusView && (
                <p className="font-bold whitespace-nowrap text-bb-daffodil uppercase">
                  {channelName(song, pick.channel)} bar {pick.bar + 1}
                  {pickedPattern === 0 ? " silent" : ` pattern ${pickedPattern}`}
                  {sharedBars > 1 ? ` on ${sharedBars} bars` : ""}
                </p>
              )}
              <BeatLight session={session} />
              <HintLine page={page} status={status} live={behaviour.speaksStatus} />
              {/* Problems are always spoken, whatever the audio mode. */}
              <p role="alert" className="sr-only">
                {status.startsWith("Problem") ? status : ""}
              </p>
            </div>
            <NoteGrid
              key={`grid-${songNumber}-${pick.channel}`}
              ref={grid}
              song={song}
              channelIndex={pick.channel}
              bar={pick.bar}
              transport={transport}
              shortCellNames={behaviour.shortCellNames}
              hand={hand}
              art={art}
              showArtSlots={showArtSlots}
              onBarStep={barStep}
              onNotesChange={changeNotes}
              onToggled={noteToggled}
              onCursorMoved={cursorMoved}
              onAnnounce={setStatus}
              footKeys={
                focusView ? undefined : (
                  <>
                    {handKey}
                    <button type="button" aria-label="Bars" aria-pressed={!barsFolded} title={`Show or hide the bars (${keyFor("bars")})`} onClick={toggleBars} className={glyphKey(!barsFolded)}>
                      {GLYPHS.bars}
                    </button>
                  </>
                )
              }
            />
            {padsShown && <Pads song={song} channelIndex={pick.channel} live={live} />}
          </div>
        </div>
      </div>
    </div>
  );
}
