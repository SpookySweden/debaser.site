// The small adapter around BeepBox's Synth. BeepBox code stays in this folder.
// Keep this API small, so the engine could be swapped later without touching the UI.
import { Config, Song, Synth } from "beepbox";
import { songToData, writeDataToSong } from "./beepboxSong";
import type { SongData } from "./songData";
import { extractSongData, SongLoadError } from "./songText";

export { SongLoadError };

export interface SongInfo {
  bars: number;
  beatsPerMinute: number;
  channels: number;
  hasNotes: boolean;
}

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface PlayOptions {
  /** The bar to start from. Leave out to carry on from where the song is. */
  fromBar?: number;
  /** Bars of metronome clicks before the song starts. */
  countInBars?: number;
}

/** What the song is doing right now, and how that lines up with the audio clock. */
export interface AudioTiming {
  /** Pairs the browser's clock (ms) with the audio clock (seconds). */
  clock: { contextTime: number; performanceTime: number };
  /** Audio delay still to subtract. Zero when `clock` already allows for it. */
  outputLatency: number;
  /** Where the song is at the end of the sound made so far. */
  anchor: { audioTime: number; bars: number; countInBarsLeft: number };
}

export type MetronomeMode = "off" | "count-in" | "always";

export interface Engine {
  /** Reads a BeepBox link, song data or JSON. Stops the old song. Throws SongLoadError. */
  loadSong(text: string): SongInfo;
  /** The song as plain values. */
  getSong(): SongData;
  /** Applies edits to the song without interrupting it. */
  updateSong(song: SongData): void;
  /** Starts the song. Call only from a click or key press: browsers block sound otherwise. */
  play(options?: PlayOptions): void;
  /** Stops the song and goes back to its start. */
  stop(): void;
  isPlaying(): boolean;
  /** Where the song is, in bars from the start of the song. */
  getPosition(): number;
  /** Null until the song has made some sound. */
  getTiming(): AudioTiming | null;
  /** Sets the speed, held within BeepBox's limits. Returns the speed actually set. */
  setTempo(beatsPerMinute: number): number;
  setMetronome(mode: MetronomeMode): void;
  /** Volume of everything the synth plays, 0 to 1. */
  setVolume(volume: number): void;
  /** A very short interface click, separate from the music. Higher for "on". */
  playClick(on: boolean): void;
  /** Starts a note on the keyboard, using BeepBox's pitch numbers. One channel at a time. */
  playLiveNote(pitch: number, channel?: number): void;
  releaseLiveNote(pitch: number): void;
  /** Silences everything sounding right now. A playing song carries on with its next notes. */
  stopAllNotes(): void;
  /** Makes the whole song as samples, without playing it out loud. Reports from 0 to 1 as it goes. */
  renderAudio(onProgress?: (done: number) => void, stop?: AbortSignal): Promise<RenderedAudio>;
  /** A link to the song that opens on beepbox.co. */
  getSongLink(): string;
  /** The song in BeepBox's JSON format. */
  getSongJson(): string;
}

const LIVE_INPUT_KEEP_ALIVE_MS = 5000;
// BeepBox only looks for live notes every few milliseconds, and the first sound takes a moment
// to start. A quick tap could be over by then and never heard. So every note sounds for at
// least this long, counted in sound made rather than in time passed.
const SHORTEST_LIVE_NOTE_SECONDS = 0.06;
const RENDER_SAMPLE_RATE = 44100;
// A short stretch at a time, with a pause between, so the page and the music keep going.
const RENDER_CHUNK_SAMPLES = 11025;
const BEEPBOX_LINK = "https://www.beepbox.co/#";
const CLICK_ON_HZ = 1760;
const CLICK_OFF_HZ = 440;
const CLICK_SECONDS = 0.03;
const CLICK_LOUDNESS = 0.15;

function parseSong(text: string): Song {
  const data = extractSongData(text);
  let song: Song;
  try {
    song = new Song(data);
  } catch {
    throw new SongLoadError("That text is not a song I can read.");
  }
  // BeepBox quietly gives up on data it doesn't recognise, leaving a song with no channels.
  if (song.channels.length === 0) {
    throw new SongLoadError(
      "That is not a BeepBox song. Links from other music makers based on BeepBox won't open here.",
    );
  }
  return song;
}

function songHasNotes(song: Song): boolean {
  return song.channels.some((channel) =>
    channel.bars.some((patternNumber) => {
      if (patternNumber === 0) return false;
      const pattern = channel.patterns[patternNumber - 1];
      return pattern !== undefined && pattern.notes.length > 0;
    }),
  );
}

// Parts of the Synth marked private that the timing and count-in depend on.
// The beepbox version is pinned, so these can only change on a deliberate upgrade.
interface SynthInternals {
  audioCtx: AudioContext | null;
  audioProcessCallback: (event: AudioProcessingEvent) => void;
}

function readAudioClock(context: AudioContext): Pick<AudioTiming, "clock" | "outputLatency"> {
  const stamp = context.getOutputTimestamp?.();
  if (stamp?.performanceTime && stamp.contextTime !== undefined) {
    // This stamp already says which sample is leaving the speakers, so no delay is left over.
    return { clock: { contextTime: stamp.contextTime, performanceTime: stamp.performanceTime }, outputLatency: 0 };
  }
  return {
    clock: { contextTime: context.currentTime, performanceTime: performance.now() },
    outputLatency: (context.outputLatency ?? 0) + (context.baseLatency ?? 0),
  };
}

export function createEngine(): Engine {
  const synth = new Synth(new Song());
  const internals = synth as unknown as SynthInternals;
  // This app is for playing along, so keep the audio delay short from the first sound.
  // Changing it later would restart the audio and its clock in the middle of a song.
  synth.preferLowerLatency = true;

  let song = songToData(requireSong());
  let livePitches: number[] = [];
  // How much sound had been made when each held note started.
  const liveNoteStarts = new Map<number, number>();
  const lateReleases = new Set<number>();
  let secondsRendered = 0;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let countInBarsLeft = 0;
  let anchor: AudioTiming["anchor"] | null = null;

  // BeepBox counts in for one bar, clearing this flag when the bar ends. Catching that
  // moment lets it count in for more bars, on the exact sample the bar ends.
  let countInFlag = false;
  Object.defineProperty(synth, "countInMetronome", {
    get: () => countInFlag,
    set: (value: boolean) => {
      if (!value && countInBarsLeft > 1) {
        countInBarsLeft--;
        return;
      }
      if (!value) countInBarsLeft = 0;
      countInFlag = value;
    },
  });

  // BeepBox always clicks during a count-in. Hiding the click's length lets "off" mean off.
  let metronomeMode: MetronomeMode = "count-in";
  let clickSamplesLeft = -1;
  Object.defineProperty(synth, "metronomeSamplesRemaining", {
    get: () => (metronomeMode === "off" ? -1 : clickSamplesLeft),
    set: (value: number) => {
      clickSamplesLeft = value;
    },
  });

  const renderBlock = internals.audioProcessCallback;
  internals.audioProcessCallback = (event) => {
    renderBlock(event);
    const blockSeconds = event.outputBuffer.length / event.outputBuffer.sampleRate;
    secondsRendered += blockSeconds;
    for (const pitch of [...lateReleases]) {
      if (hasSoundedLongEnough(pitch)) releaseNow(pitch);
    }
    const beatsPerBar = synth.song?.beatsPerBar ?? 8;
    // BeepBox doesn't move its playhead during a count-in, so read how far through the bar it is.
    const bars = countInFlag
      ? synth.getTicksIntoBar() / (beatsPerBar * Config.partsPerBeat * Config.ticksPerPart)
      : synth.playhead;
    // BeepBox runs this once more after a stop, as it shuts its audio down.
    anchor = synth.playing ? { audioTime: event.playbackTime + blockSeconds, bars, countInBarsLeft } : null;
  };

  function requireSong(): Song {
    if (synth.song === null) throw new Error("The engine always has a song.");
    return synth.song;
  }

  function stopKeepAlive(): void {
    if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  function hasSoundedLongEnough(pitch: number): boolean {
    const started = liveNoteStarts.get(pitch);
    return started === undefined || secondsRendered - started >= SHORTEST_LIVE_NOTE_SECONDS;
  }

  function releaseNow(pitch: number): void {
    lateReleases.delete(pitch);
    liveNoteStarts.delete(pitch);
    livePitches = livePitches.filter((held) => held !== pitch);
    if (livePitches.length > 0) {
      synth.liveInputPitches = livePitches;
      return;
    }
    // Leave the pitches in place so BeepBox can fade the note out, as its own editor does.
    synth.liveInputDuration = 0;
    synth.maintainLiveInput();
    stopKeepAlive();
  }

  function clearLiveNotes(): void {
    lateReleases.clear();
    liveNoteStarts.clear();
    livePitches = [];
    synth.liveInputPitches = livePitches;
    synth.liveInputDuration = 0;
    synth.liveInputStarted = false;
    stopKeepAlive();
  }

  function stop(): void {
    synth.pause();
    synth.snapToStart();
    countInBarsLeft = 0;
    countInFlag = false;
    anchor = null;
    // Without this, a note cut off by Stop would come back on the next Play.
    synth.resetEffects();
  }

  return {
    loadSong(text) {
      const loaded = parseSong(text);
      stop();
      clearLiveNotes();
      synth.setSong(loaded);
      song = songToData(loaded);
      return {
        bars: loaded.barCount,
        beatsPerMinute: loaded.getBeatsPerMinute(),
        channels: loaded.getChannelCount(),
        hasNotes: songHasNotes(loaded),
      };
    },

    getSong() {
      return song;
    },

    updateSong(next) {
      const loopMoved = next.loopStart !== song.loopStart || next.loopLength !== song.loopLength;
      writeDataToSong(requireSong(), song, next);
      song = next;
      if (loopMoved) synth.jumpIntoLoop();
    },

    play({ fromBar, countInBars = 0 } = {}) {
      if (synth.playing) return;
      if (fromBar !== undefined) {
        synth.goToBar(fromBar);
        synth.snapToBar();
      }
      if (countInBars > 0) {
        countInBarsLeft = countInBars;
        countInFlag = true;
      }
      synth.play();
    },

    stop,

    isPlaying() {
      return synth.playing;
    },

    getPosition() {
      return synth.playhead;
    },

    getTiming() {
      const context = internals.audioCtx;
      if (context === null || anchor === null) return null;
      return { ...readAudioClock(context), anchor };
    },

    setTempo(beatsPerMinute) {
      const current = requireSong();
      if (Number.isFinite(beatsPerMinute)) {
        current.tempo = Math.min(Config.tempoMax, Math.max(Config.tempoMin, Math.round(beatsPerMinute)));
      }
      song = { ...song, tempo: current.tempo };
      return current.tempo;
    },

    setMetronome(mode) {
      metronomeMode = mode;
      synth.enableMetronome = mode === "always";
    },

    setVolume(volume) {
      synth.volume = Math.max(0, Math.min(1, volume));
    },

    playClick(on) {
      synth.maintainLiveInput();
      const context = internals.audioCtx;
      if (context === null) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = on ? CLICK_ON_HZ : CLICK_OFF_HZ;
      gain.gain.value = CLICK_LOUDNESS;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + CLICK_SECONDS);
    },

    playLiveNote(pitch, channel = 0) {
      if (channel !== synth.liveInputChannel) {
        clearLiveNotes();
        synth.liveInputChannel = channel;
      }
      lateReleases.delete(pitch);
      liveNoteStarts.set(pitch, secondsRendered);
      synth.liveInputInstruments = [0];
      if (!livePitches.includes(pitch)) {
        // BeepBox sounds at most this many pitches at once; the oldest makes way.
        livePitches = [...livePitches, pitch].slice(-Config.maxChordSize);
      }
      synth.liveInputPitches = livePitches;
      synth.liveInputDuration = Number.MAX_SAFE_INTEGER;
      synth.liveInputStarted = true;
      synth.maintainLiveInput();
      // BeepBox switches its audio off after 10 quiet seconds, even with a note still held.
      keepAliveTimer ??= setInterval(() => synth.maintainLiveInput(), LIVE_INPUT_KEEP_ALIVE_MS);
    },

    releaseLiveNote(pitch) {
      if (hasSoundedLongEnough(pitch)) releaseNow(pitch);
      else lateReleases.add(pitch);
    },

    stopAllNotes() {
      clearLiveNotes();
      synth.resetEffects();
    },

    async renderAudio(onProgress, stopSignal) {
      // A second synth, so this doesn't disturb what's playing.
      const renderer = new Synth(requireSong());
      renderer.samplesPerSecond = RENDER_SAMPLE_RATE;
      renderer.loopRepeatCount = 0;
      const length = Math.ceil(renderer.getTotalBars(true, true) * renderer.getSamplesPerBar());
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      for (let done = 0; done < length; done += RENDER_CHUNK_SAMPLES) {
        const end = Math.min(length, done + RENDER_CHUNK_SAMPLES);
        renderer.synthesize(left.subarray(done, end), right.subarray(done, end), end - done);
        onProgress?.(end / length);
        await new Promise((resolve) => setTimeout(resolve));
        stopSignal?.throwIfAborted();
      }
      return { left, right, sampleRate: RENDER_SAMPLE_RATE };
    },

    getSongLink() {
      return BEEPBOX_LINK + requireSong().toBase64String();
    },

    getSongJson() {
      return JSON.stringify(requireSong().toJsonObject());
    },
  };
}
