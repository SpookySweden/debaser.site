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
import { NOTE_KEY_LABELS } from "../input/computerKeys";
import { QUANTISE_OPTIONS } from "../recorder/convert";
import type { NoteData, SongData } from "../engine/songData";
import { createApp } from "./app";
import { AUDIO_MODES, audioBehaviour, type AudioMode } from "./audioModes";
import { BarRow, type BarPick } from "./BarRow";
import { channelName } from "./channelLooks";
import { ChoiceGroup } from "./ChoiceGroup";
import { CELL_SIZES, type CellSize } from "./gridView";
import { HelpPanel } from "./HelpPanel";
import { InOut, type SavedSong } from "./InOut";
import { createLiveNotes } from "./liveNotes";
import { barKey, barMainKey, smallKey, stripKey, titleLine } from "./looks";
import { MidiConnect } from "./MidiConnect";
import { NoteGrid, type NoteGridHandle } from "./NoteGrid";
import { Pads } from "./Pads";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { BeatLight, RecordPanel } from "./RecordPanel";
import { createRecordSession } from "./recordSession";
import { barsUsingPattern, replacePatternNotes } from "./songEdit";

export type BeatBoxTheme = "default" | "high-contrast";

const HEAR_NOTE_MS = 250;
const CURSOR_TONE_MS = 100;
const CONTROL_ELEMENTS = "button, a, input, select, textarea";
const TEMPO_STEP = 5;

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
  const [size, setSize] = useState<CellSize>("l");
  const [follow, setFollow] = useState(false);
  const [songNumber, setSongNumber] = useState(0);
  const [audioMode, setAudioMode] = useState<AudioMode>("practice");
  const [focusView, setFocusView] = useState(false);
  const [theme, setTheme] = useState<BeatBoxTheme>(() => themeProp ?? startingTheme());
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [padsShown, setPadsShown] = useState(false);
  const [barsFolded, setBarsFolded] = useState(false);
  const grid = useRef<NoteGridHandle>(null);
  const page = useRef<HTMLDivElement>(null);
  const menuKey = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const cursorTone = useRef<{ pitch: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const behaviour = audioBehaviour(audioMode);

  useEffect(() => engine.setVolume(behaviour.volume), [engine, behaviour.volume]);

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

  function togglePlay() {
    if (transport.isPlaying()) {
      stop();
    } else {
      transport.play(pick.bar);
      setStatus("Playing. It repeats until you stop it.");
    }
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

  function changeSize(direction: 1 | -1) {
    const next = CELL_SIZES[CELL_SIZES.indexOf(size) + direction];
    if (next) {
      setSize(next);
      setStatus(`Grid size ${next.toUpperCase()}.`);
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
    setStatus(focusView ? "Focus view off." : "Focus view: only the notes. Press full stop to leave.");
  }

  function toggleTheme() {
    const next = theme === "default" ? "high-contrast" : "default";
    setTheme(next);
    setStatus(next === "default" ? "High contrast off." : "High contrast on.");
  }

  function goToGrid(label: string) {
    page.current?.querySelector<HTMLElement>(`[aria-label^="${label}"] [role="gridcell"][tabindex="0"]`)?.focus();
  }

  function openMenu() {
    setMenuOpen(true);
    setTimeout(() => menuPanel.current?.focus());
  }

  function closeMenu() {
    setMenuOpen(false);
    setTimeout(() => menuKey.current?.focus());
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
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
  const latest = {
    cycleAudioMode,
    toggleFocusView,
    toggleTheme,
    togglePlay,
    stop,
    undo,
    redo,
    changeTempo,
    changeSize,
    toggleFollow,
    showOctave,
    cycleMode,
    cycleCountIn,
    cycleMetronome,
    cycleQuantise,
    toggleMenu,
    menuOpen,
    closeMenu,
    toggleBars,
    onTogglePanel,
  };
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
      const inTextBox = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
      const onControl = event.target instanceof Element && event.target.closest(CONTROL_ELEMENTS);
      if (event.key === "Escape") {
        if (keys.menuOpen) keys.closeMenu();
        else keys.stop();
        return;
      }
      if (inTextBox) return;
      if (live.keys.keyDown(event)) {
        event.preventDefault();
        if (event.code === "KeyZ" || event.code === "KeyX") keys.showOctave();
        return;
      }
      if (event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) keys.redo();
          else keys.undo();
        } else if (key === "y") {
          event.preventDefault();
          keys.redo();
        }
        return;
      }
      if (event.repeat) return;
      if (event.key === "?") {
        setHelpOpen(true);
      } else if (event.key === "/") {
        event.preventDefault();
        keys.toggleMenu();
      } else if (event.key === "\\") {
        keys.onTogglePanel?.();
      } else if (event.key === "'") {
        event.preventDefault();
        keys.toggleBars();
      } else if (event.code === "KeyI") {
        keys.cycleAudioMode();
      } else if (event.key === ".") {
        keys.toggleFocusView();
      } else if (event.key === ",") {
        keys.toggleTheme();
      } else if (event.key === " " && !onControl) {
        event.preventDefault();
        keys.togglePlay();
      } else if (event.key === "[") {
        keys.changeTempo(-TEMPO_STEP);
      } else if (event.key === "]") {
        keys.changeTempo(TEMPO_STEP);
      } else if (event.code === "KeyB") {
        keys.toggleFollow();
      } else if (event.code === "KeyR") {
        session.toggleRecord();
      } else if (event.code === "KeyC") {
        session.capture();
      } else if (event.code === "KeyV") {
        keys.cycleMode();
      } else if (event.code === "KeyN") {
        keys.cycleCountIn();
      } else if (event.code === "KeyM") {
        keys.cycleMetronome();
      } else if (event.code === "KeyQ") {
        keys.cycleQuantise();
      } else if (!(event.target instanceof Element && event.target.closest("[aria-label^='Bars for']"))) {
        if (event.key === "-") keys.changeSize(-1);
        else if (event.key === "=" || event.key === "+") keys.changeSize(1);
      }
    }
    function pageKeyUp(event: globalThis.KeyboardEvent) {
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
  }, [live, session]);

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

  function changeNotes(notes: readonly NoteData[]) {
    songs.edit(replacePatternNotes(songs.getSong(), pick.channel, pick.bar, notes));
  }

  function changeSong(next: SongData) {
    songs.edit(next);
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
  const barsShowing = !focusView && !barsFolded && !menuOpen;

  const sizeKeys = (
    <ChoiceGroup<CellSize>
      label="Size"
      keyName="- ="
      value={size}
      options={CELL_SIZES.map((option) => ({ value: option, label: option.toUpperCase() }))}
      onChange={setSize}
      look={stripKey}
    />
  );

  const menuContent = (
    <>
      <div className="flex w-full flex-wrap items-center justify-between gap-bb-gutter">
        <h2 className="text-bb-large font-bold text-bb-daffodil uppercase">Menu</h2>
        <button type="button" onClick={closeMenu} title="Close (Esc)" className={smallKey()}>
          Close
        </button>
      </div>

      <section aria-label="Seeing and hearing" className="flex w-full flex-col items-start gap-bb-gutter">
        <h3 className={titleLine}>
          <span>Seeing and hearing</span>
        </h3>
        <ChoiceGroup label="Audio mode" keyName="I" value={audioMode} options={AUDIO_MODES} onChange={changeAudioMode} />
        <div className="flex flex-wrap items-center gap-bb-gutter">
          <button type="button" aria-pressed={theme === "high-contrast"} title="Key: ," onClick={toggleTheme} className={smallKey(theme === "high-contrast")}>
            High contrast {theme === "high-contrast" ? "on" : "off"}
          </button>
          <button type="button" aria-pressed={follow} title="Key: B" onClick={toggleFollow} className={smallKey(follow)}>
            Follow {follow ? "on" : "off"}
          </button>
          <button type="button" aria-pressed={focusView} title="Key: ." onClick={toggleFocusView} className={smallKey(focusView)}>
            Focus view {focusView ? "on" : "off"}
          </button>
          <button type="button" title="Key: Ctrl+Y" onClick={redo} className={smallKey()}>
            Redo
          </button>
        </div>
      </section>

      <RecordPanel session={session} />

      <section aria-label="Playing notes" className="flex w-full flex-col items-start gap-bb-gutter">
        <h3 className={titleLine}>
          <span>Playing notes</span>
        </h3>
        <p className="text-bb-large wrap-anywhere">Computer keys play notes: {NOTE_KEY_LABELS}</p>
        <button type="button" aria-pressed={padsShown} onClick={() => setPadsShown(!padsShown)} className={smallKey(padsShown)}>
          Pads {padsShown ? "on" : "off"}
        </button>
        <div role="group" aria-label="Computer keys" className="flex flex-wrap items-center gap-bb-gutter">
          <span className="text-bb-large font-bold uppercase">Octave {octave}</span>
          <button type="button" title="Key: Z" onClick={() => shiftOctave(-1)} className={smallKey()}>
            Lower
          </button>
          <button type="button" title="Key: X" onClick={() => shiftOctave(1)} className={smallKey()}>
            Higher
          </button>
        </div>
      </section>

      <MidiConnect live={live} />

      <InOut
        engine={engine}
        onOpen={openSong}
        onSave={onSave}
        shareLinkStart={shareLinkStart}
        extras={extras}
        onAnnounce={setStatus}
      />
    </>
  );

  return (
    <div
      ref={page}
      data-theme={theme}
      className="debaser-beatbox relative flex min-h-full flex-col bg-bb-nigrosine md:h-full font-beatbox text-bb-white print:bg-bb-white"
    >
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className="contents print:hidden">
        <div className="contents">
          <button type="button" onClick={() => goToGrid("Bars for")} className={`${smallKey()} sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bb-nigrosine`}>
            Go to the bars
          </button>
          <button type="button" onClick={() => goToGrid("Notes")} className={`${smallKey()} sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bb-nigrosine`}>
            Go to the notes
          </button>
        </div>
        {!hideTitle && <h1 className="text-bb-title font-bold wrap-anywhere">DEBASER_BEATBOX</h1>}

        {/* The slim bar: everything you need without looking anywhere else. */}
        <div role="group" aria-label="Main keys" className="flex flex-none flex-wrap items-stretch gap-x-2 gap-y-1 px-2 py-1">
          <button type="button" onClick={togglePlay} title="Play or stop (Space)" aria-keyshortcuts="Space" className={barMainKey}>
            {playing ? "Stop" : "Play"}
          </button>
          <PixelSlot name="record-light" size="light" src={art.recordLight} showEmpty={showArtSlots} />
          <button
            type="button"
            aria-pressed={recordSettings.recording}
            onClick={session.toggleRecord}
            title="Record, or stop recording and keep playing (R)"
            aria-keyshortcuts="R"
            className={barKey(recordSettings.recording)}
          >
            {recordSettings.recording ? (
              <>
                Rec<span className="sr-only">ording pass</span> {recordSettings.pass}
              </>
            ) : (
              "Record"
            )}
          </button>
          <BeatLight session={session} />
          <button type="button" onClick={undo} title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z" className={barKey()}>
            Undo
          </button>
          <div role="group" aria-label="Speed" className="flex flex-wrap items-stretch gap-x-1">
            <span className="flex items-center px-1 text-bb-large font-bold whitespace-nowrap uppercase">Speed {song.tempo}</span>
            <button type="button" aria-label="Slower" title="Slower ([)" onClick={() => changeTempo(-TEMPO_STEP)} className={barKey()}>
              -
            </button>
            <button type="button" aria-label="Faster" title="Faster (])" onClick={() => changeTempo(TEMPO_STEP)} className={barKey()}>
              +
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-stretch gap-x-2">
            <button ref={menuKey} type="button" aria-expanded={menuOpen} onClick={toggleMenu} title="Everything else (/)" className={barKey(menuOpen)}>
              Menu
            </button>
            <button type="button" aria-label="All the keys" onClick={() => setHelpOpen(true)} title="All the keys (?)" className={barKey()}>
              ?
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* The menu takes the bars' place, so the notes stay in view and answer as it's changed. It stays drawn while
              shut, so a MIDI keyboard stays connected and a song being made into a sound file carries on. */}
          <div className={menuOpen ? "relative flex-none md:w-[34rem] md:border-r-(length:--frame-width) md:border-bb-white" : "hidden"}>
            <div
              ref={menuPanel}
              role="region"
              aria-label="Menu"
              tabIndex={-1}
              className="flex flex-col items-start gap-bb-gap bg-bb-nigrosine p-bb-gutter focus:outline-none md:absolute md:inset-0 md:overflow-y-auto"
            >
              {menuContent}
            </div>
          </div>

          <div className={barsShowing ? "contents" : "hidden"}>
            <BarRow
              key={`bars-${songNumber}`}
              song={song}
              pick={pick}
              transport={transport}
              onPick={setPick}
              onChange={changeSong}
              onAnnounce={setStatus}
              onOpenGrid={() => grid.current?.focus()}
              art={art}
              showArtSlots={showArtSlots}
              footKeys={barsShowing ? sizeKeys : undefined}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-none flex-wrap items-baseline gap-x-bb-gutter px-2 text-display">
              {!barsShowing && !focusView && (
                <p className="font-bold whitespace-nowrap text-bb-daffodil uppercase">
                  {channelName(song, pick.channel)} bar {pick.bar + 1}
                  {pickedPattern === 0 ? " silent" : ` pattern ${pickedPattern}`}
                  {sharedBars > 1 ? ` on ${sharedBars} bars` : ""}
                </p>
              )}
              <p role="status" aria-live={behaviour.speaksStatus ? "polite" : "off"} className="wrap-anywhere">
                {status}
              </p>
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
              size={size}
              transport={transport}
              shortCellNames={behaviour.shortCellNames}
              art={art}
              showArtSlots={showArtSlots}
              onBarStep={barStep}
              onNotesChange={changeNotes}
              onToggled={noteToggled}
              onCursorMoved={cursorMoved}
              onAnnounce={setStatus}
              footKeys={
                <>
                  {!barsShowing && sizeKeys}
                  <button type="button" aria-pressed={!barsFolded} title="Show or hide the bars (')" onClick={toggleBars} className={stripKey(!barsFolded)}>
                    Bars
                  </button>
                </>
              }
            />
            {padsShown && <Pads song={song} channelIndex={pick.channel} live={live} />}
          </div>
        </div>
      </div>
    </div>
  );
}
