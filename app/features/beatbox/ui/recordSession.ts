// Joins the loop recorder to the running app: it reads the audio clock, feeds played notes to
// the recorder, and puts each finished pass into the song as one undo step. It listens whenever
// the song plays, which is what lets Capture keep a pass nobody pressed record for.
import type { AudioTiming, MetronomeMode } from "../engine";
import { PARTS_PER_BEAT, partsPerBar, type SongData } from "../engine/songData";
import { calibrationOffset } from "../recorder/calibrate";
import { createLoopClock, eventToAudioTime, foldIntoLoop, partsPerSecond, type LoopClock } from "../recorder/clock";
import { QUANTISE_OPTIONS, type QuantiseSettings } from "../recorder/convert";
import { createLoopRecorder, type LoopRecorder, type Take } from "../recorder/loopRecorder";
import { commitTake, type RecordMode } from "../recorder/merge";
import type { App } from "./app";
import type { LiveNotes, PlayedNote } from "./liveNotes";

// "Notes starting within a few milliseconds become one chord."
const CHORD_WINDOW_SECONDS = 0.03;
const CALIBRATION_MS = 10_000;

export interface RecordSettings {
  readonly recording: boolean;
  /** The pass being recorded, starting at 1. */
  readonly pass: number;
  readonly mode: RecordMode;
  readonly countInBars: number;
  readonly metronome: MetronomeMode;
  readonly quantiseIndex: number;
  /** Quantise strength, 0 to 100. */
  readonly strength: number;
  readonly calibrating: boolean;
  /** The player's measured delay in milliseconds. */
  readonly calibrationMs: number;
}

export interface BeatSpot {
  /** Beat in the bar, starting at 1. */
  readonly beat: number;
  /** Bars of count-in left. 0 once the song is going. */
  readonly countIn: number;
  /** Whether this beat is in its first half: the moment the beat light is on. */
  readonly lit: boolean;
}

export interface RecordSession {
  subscribe(listener: () => void): () => void;
  /** Where the session's messages go. */
  setAnnouncer(announcer: (message: string) => void): void;
  getSettings(): RecordSettings;
  getBeat(): BeatSpot | null;
  toggleRecord(): void;
  capture(): void;
  /** Ends any pass in progress, then stops the song. */
  stopPlayback(): void;
  /** Ends any pass in progress, then holds the song where it is. A calibration can't be held, so that's a stop. */
  pausePlayback(): void;
  setChannel(channel: number): void;
  setMode(mode: RecordMode): void;
  setCountIn(bars: number): void;
  setMetronome(mode: MetronomeMode): void;
  setQuantise(index: number): void;
  setStrength(percent: number): void;
  calibrate(): void;
  pauseForHiddenTab(): void;
  /** Forgets everything in progress, for when a new song opens. */
  reset(): void;
  dispose(): void;
}

interface LatestPass {
  readonly take: Take;
  readonly before: SongData;
  readonly after: SongData;
  readonly channel: number;
  readonly mode: RecordMode;
}

export function createRecordSession(
  { engine, songs, transport }: App,
  live: LiveNotes,
): RecordSession {
  let announce: (message: string) => void = () => {};
  const listeners = new Set<() => void>();
  let settings: RecordSettings = {
    recording: false,
    pass: 0,
    mode: "overdub",
    countInBars: 1,
    metronome: "count-in",
    quantiseIndex: 3,
    strength: 100,
    calibrating: false,
    calibrationMs: 0,
  };
  let beat: BeatSpot | null = null;
  let clock: LoopClock | null = null;
  let recorder: LoopRecorder | null = null;
  let channel = 0;
  let loop = { start: 0, length: 0 };
  let captureCandidate: { take: Take; channel: number } | null = null;
  let latest: LatestPass | null = null;
  let calibrationTaps: number[] | null = null;
  let calibrationTimer: ReturnType<typeof setTimeout> | null = null;
  let metronomeBeforeCalibrating: MetronomeMode = "count-in";

  function notify() {
    for (const listener of listeners) listener();
  }

  function change(next: Partial<RecordSettings>) {
    settings = { ...settings, ...next };
    notify();
  }

  function quantiseSettings(song: SongData, index = settings.quantiseIndex): QuantiseSettings {
    return {
      gridParts: QUANTISE_OPTIONS[index]?.gridParts ?? null,
      strength: settings.strength / 100,
      chordWindowParts: CHORD_WINDOW_SECONDS * partsPerSecond(song.tempo),
    };
  }

  function audioTimeOf(eventMs: number, timing: AudioTiming, calibrationMs = settings.calibrationMs): number {
    return eventToAudioTime(eventMs, timing.clock, timing.outputLatency, calibrationMs / 1000);
  }

  function partNow(): number | null {
    const timing = engine.getTiming();
    return timing && clock ? clock.partAt(audioTimeOf(performance.now(), timing)) : null;
  }

  function commit(take: Take, forChannel: number) {
    const before = songs.getSong();
    const after = commitTake(before, forChannel, take, settings.mode, quantiseSettings(before));
    if (after === before) return false;
    songs.edit(after);
    latest = { take, before, after, channel: forChannel, mode: settings.mode };
    return true;
  }

  function keepForCapture(take: Take) {
    if (take.notes.length === 0) return;
    captureCandidate = { take, channel };
    notify();
  }

  function handleEndedPass(take: Take) {
    if (settings.recording) {
      const kept = commit(take, channel);
      const pass = settings.pass + 1;
      change({ pass });
      announce(kept ? `Pass ${pass - 1} kept. Recording pass ${pass}.` : `Recording pass ${pass}.`);
    } else {
      keepForCapture(take);
    }
  }

  /** Ends the pass in progress here. The recorder then carries on listening from this point. */
  function endPassHere(): readonly Take[] {
    const part = partNow();
    if (part === null) return [];
    const takes = recorder?.finish(part) ?? [];
    recorder = createLoopRecorder({ loopParts: loop.length, fromPart: part });
    return takes;
  }

  function stopRecording(message: string) {
    if (!settings.recording) return;
    for (const take of endPassHere()) commit(take, channel);
    change({ recording: false, pass: 0 });
    announce(message);
  }

  function restartListening(song: SongData) {
    const barParts = partsPerBar(song);
    loop = { start: song.loopStart, length: song.loopLength * barParts };
    clock = createLoopClock({ startPart: song.loopStart * barParts, lengthParts: loop.length });
    recorder = null;
  }

  function onTick() {
    const song = songs.getSong();
    const barParts = partsPerBar(song);
    const loopMoved = song.loopStart !== loop.start || song.loopLength * barParts !== loop.length;
    if (loopMoved && settings.recording) {
      change({ recording: false, pass: 0 });
      announce("The loop changed, so recording stopped.");
    }
    if (loopMoved || !clock) restartListening(song);
    const timing = engine.getTiming();
    if (!timing || !clock) return;

    const { bars, countInBarsLeft } = timing.anchor;
    const countingIn = countInBarsLeft > 0;
    const partInBar = (bars - Math.floor(bars)) * barParts;
    clock.update({
      audioTime: timing.anchor.audioTime,
      songPart: bars * barParts,
      countInParts: countingIn ? countInBarsLeft * barParts - partInBar : 0,
      partsPerSecond: partsPerSecond(song.tempo),
    });

    // Measured with no calibration, so the light keeps time with the clicks coming out.
    const heard = clock.partAt(audioTimeOf(performance.now(), timing, 0));
    if (heard !== null) updateBeat(song, heard);

    const part = clock.partAt(audioTimeOf(performance.now(), timing));
    if (part === null) return;
    recorder ??= createLoopRecorder({ loopParts: loop.length, fromPart: part });
    for (const take of recorder.advance(part)) handleEndedPass(take);
  }

  function updateBeat(song: SongData, heard: number) {
    const barParts = partsPerBar(song);
    const partInBar = foldIntoLoop(heard, barParts);
    const countIn = heard < 0 ? Math.ceil(-heard / barParts) : 0;
    const partsIntoBeat = partInBar % PARTS_PER_BEAT;
    const beatNumber = Math.floor(partInBar / PARTS_PER_BEAT) + 1;
    // At high speeds the light stays within the safe limit of 3 flashes a second.
    const beatsPerSecond = song.tempo / 60;
    const everyBeats = Math.ceil(beatsPerSecond / 2.5);
    const lit = partsIntoBeat < PARTS_PER_BEAT / 2 && (beatNumber - 1) % everyBeats === 0;
    if (beat?.beat !== beatNumber || beat.countIn !== countIn || beat.lit !== lit) {
      beat = { beat: beatNumber, countIn, lit };
      notify();
    }
  }

  function onPlayed({ event, channel: playedChannel, pitch }: PlayedNote) {
    const timing = engine.getTiming();
    if (!timing || !clock) return;

    if (calibrationTaps && event.type === "on") {
      const tap = clock.partAt(audioTimeOf(event.time, timing, 0));
      if (tap !== null) calibrationTaps.push(tap);
      return;
    }

    if (playedChannel !== channel) return;
    const part = clock.partAt(audioTimeOf(event.time, timing));
    if (part === null) return;
    recorder ??= createLoopRecorder({ loopParts: loop.length, fromPart: part });
    if (event.type === "on") recorder.noteOn(pitch, event.velocity, part);
    else recorder.noteOff(pitch, part);
  }

  function reviseLatestPass(message: string) {
    if (!latest || songs.getSong() !== latest.after) return;
    const { before, take, channel: passChannel, mode } = latest;
    const after = commitTake(before, passChannel, take, mode, quantiseSettings(before));
    songs.reviseLatest(after);
    latest = { ...latest, after };
    announce(message);
  }

  function finishCalibration() {
    calibrationTimer = null;
    const taps = calibrationTaps ?? [];
    calibrationTaps = null;
    transport.stop();
    clock = null;
    recorder = null;
    beat = null;
    engine.setMetronome(metronomeBeforeCalibrating);
    const offset = calibrationOffset(taps, partsPerSecond(songs.getSong().tempo));
    if (offset === null) {
      change({ calibrating: false });
      announce("Not enough taps to go on. Nothing changed. Try again and tap along with every click.");
      return;
    }
    const calibrationMs = Math.round(offset * 1000);
    change({ calibrating: false, calibrationMs });
    announce(`Calibrated. Recorded notes will move ${Math.abs(calibrationMs)} milliseconds ${calibrationMs >= 0 ? "earlier" : "later"}.`);
  }

  const stopTicks = transport.onTick(onTick);
  const stopPlayed = live.onPlayed(onPlayed);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAnnouncer(announcer) {
      announce = announcer;
    },
    getSettings: () => settings,
    getBeat: () => beat,

    toggleRecord() {
      if (settings.calibrating) return;
      if (settings.recording) {
        stopRecording("Recording stopped. The song keeps playing.");
        return;
      }
      const song = songs.getSong();
      if (transport.isPlaying()) {
        // Begins right here, so anything played before pressing record isn't part of this pass.
        const part = partNow();
        recorder = part === null ? null : createLoopRecorder({ loopParts: loop.length, fromPart: part });
        captureCandidate = null;
        change({ recording: true, pass: 1 });
        announce("Recording pass 1.");
        return;
      }
      restartListening(song);
      captureCandidate = null;
      transport.play(song.loopStart, settings.countInBars);
      change({ recording: true, pass: 1 });
      announce(settings.countInBars > 0 ? `Counting in ${settings.countInBars}, then recording pass 1.` : "Recording pass 1.");
    },

    capture() {
      if (!captureCandidate && !settings.recording) endPassHere().forEach(keepForCapture);
      const candidate = captureCandidate;
      if (!candidate) {
        announce("Nothing to capture yet. Play along while the loop goes round, then press Capture.");
        return;
      }
      captureCandidate = null;
      announce(commit(candidate.take, candidate.channel) ? "Captured the last pass." : "That pass is already in the song.");
    },

    stopPlayback() {
      stopRecording("Stopped. The pass so far is kept.");
      if (calibrationTimer !== null) {
        clearTimeout(calibrationTimer);
        calibrationTaps = [];
        finishCalibration();
        return;
      }
      if (transport.isPlaying()) endPassHere().forEach(keepForCapture);
      transport.stop();
      clock = null;
      recorder = null;
      beat = null;
      notify();
    },

    setChannel(next) {
      if (next === channel) return;
      const takes = endPassHere();
      if (settings.recording) {
        for (const take of takes) commit(take, channel);
        change({ pass: 1 });
      }
      captureCandidate = null;
      channel = next;
    },

    setMode(mode) {
      change({ mode });
      announce(mode === "overdub" ? "Overdub: each pass adds notes." : "Replace: each pass clears the time it crosses.");
    },

    setCountIn(bars) {
      change({ countInBars: bars });
      announce(bars === 0 ? "No count-in." : `Count-in: ${bars} ${bars === 1 ? "bar" : "bars"}.`);
    },

    setMetronome(mode) {
      engine.setMetronome(mode);
      metronomeBeforeCalibrating = mode;
      change({ metronome: mode });
      announce(mode === "off" ? "Metronome off." : mode === "always" ? "Metronome always on." : "Metronome during the count-in only.");
    },

    setQuantise(index) {
      change({ quantiseIndex: index });
      const label = QUANTISE_OPTIONS[index]?.label ?? "Off";
      announce(`Quantise ${label}.`);
      reviseLatestPass(`Quantise ${label}. The last pass moved to match.`);
    },

    setStrength(percent) {
      change({ strength: percent });
      announce(`Quantise strength ${percent} percent.`);
      reviseLatestPass(`Quantise strength ${percent} percent. The last pass moved to match.`);
    },

    pausePlayback() {
      if (settings.calibrating) {
        this.stopPlayback();
        return;
      }
      stopRecording("Paused. The pass so far is kept.");
      if (transport.isPlaying()) endPassHere().forEach(keepForCapture);
      transport.pause();
      beat = null;
      // A pause during a count-in is a stop, with nothing to carry on from.
      if (!transport.isPaused()) {
        clock = null;
        recorder = null;
      }
      notify();
    },

    calibrate() {
      if (settings.calibrating || settings.recording) return;
      if (transport.isPlaying()) this.stopPlayback();
      const song = songs.getSong();
      restartListening(song);
      metronomeBeforeCalibrating = settings.metronome;
      engine.setMetronome("always");
      calibrationTaps = [];
      change({ calibrating: true });
      transport.play(song.loopStart, 0);
      announce("Tap any note key along with the clicks for 10 seconds.");
      calibrationTimer = setTimeout(finishCalibration, CALIBRATION_MS);
    },

    pauseForHiddenTab() {
      stopRecording("Recording stopped because this tab was hidden. The pass so far is kept.");
    },

    reset() {
      change({ recording: false, pass: 0 });
      clock = null;
      recorder = null;
      beat = null;
      captureCandidate = null;
      latest = null;
    },

    dispose() {
      stopTicks();
      stopPlayed();
      if (calibrationTimer !== null) clearTimeout(calibrationTimer);
    },
  };
}
