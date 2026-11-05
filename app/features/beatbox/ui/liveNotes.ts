// Turns the note stream into sound: works out the pitch for the picked channel, plays it,
// and remembers what's held so pads can light up and every note gets released.
import { midiToPitch } from "../engine/songData";
import { createComputerKeys, type ComputerKeys } from "../input/computerKeys";
import { createNoteStream, noteToDrumRow, type NoteEvent, type NoteStream } from "../input/noteEvents";
import type { App } from "./app";

export interface PlayedNote {
  readonly event: NoteEvent;
  readonly channel: number;
  /** BeepBox pitch on that channel. */
  readonly pitch: number;
}

type PlayedListener = (played: PlayedNote) => void;

export interface LiveNotes {
  stream: NoteStream;
  keys: ComputerKeys;
  setChannel(channel: number): void;
  /** Notes held right now, as BeepBox pitches. Changes only when a note starts or stops. */
  getHeld(): ReadonlySet<number>;
  getOctave(): number;
  shiftOctave(by: number): number;
  subscribe(listener: () => void): () => void;
  /** Each note on and off as played, for the recorder. */
  onPlayed(listener: PlayedListener): () => void;
  releaseAll(): void;
}

function heldKey(event: NoteEvent): string {
  return `${event.source}:${event.note}`;
}

export function createLiveNotes({ engine, songs }: App): LiveNotes {
  const stream = createNoteStream();
  const keys = createComputerKeys(stream.emit);
  const listeners = new Set<() => void>();
  const playedListeners = new Set<PlayedListener>();
  const sounding = new Map<string, { pitch: number; channel: number }>();
  let held: ReadonlySet<number> = new Set();
  let channel = 0;

  function refresh() {
    held = new Set([...sounding.values()].map((note) => note.pitch));
    for (const listener of listeners) listener();
  }

  function pitchFor(event: NoteEvent, channelIndex: number): number | null {
    const song = songs.getSong();
    if (song.channels[channelIndex]?.isDrum) return noteToDrumRow(event.note, event.source);
    return midiToPitch(song, event.note);
  }

  function announce(event: NoteEvent, pitch: number, channelIndex: number) {
    for (const listener of playedListeners) listener({ event, channel: channelIndex, pitch });
  }

  stream.subscribe((event) => {
    const key = heldKey(event);
    if (event.type === "on") {
      const pitch = pitchFor(event, channel);
      if (pitch === null) return;
      sounding.set(key, { pitch, channel });
      engine.playLiveNote(pitch, channel);
      announce(event, pitch, channel);
    } else {
      const note = sounding.get(key);
      if (!note) return;
      sounding.delete(key);
      // Two ways of playing can hold the same pitch: it only stops when both have let go.
      const stillHeld = [...sounding.values()].some((other) => other.pitch === note.pitch);
      if (!stillHeld) engine.releaseLiveNote(note.pitch);
      announce(event, note.pitch, note.channel);
    }
    refresh();
  });

  function releaseAll() {
    const time = performance.now();
    keys.releaseAll(time);
    for (const key of [...sounding.keys()]) {
      const [source, note] = key.split(":");
      stream.emit({ type: "off", note: Number(note), velocity: 0, time, source: source as NoteEvent["source"] });
    }
  }

  return {
    stream,
    keys,
    setChannel(next) {
      if (next === channel) return;
      releaseAll();
      channel = next;
    },
    getHeld: () => held,
    getOctave: () => keys.getOctave(),
    shiftOctave(by) {
      const octave = keys.shiftOctave(by);
      refresh();
      return octave;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onPlayed(listener) {
      playedListeners.add(listener);
      return () => {
        playedListeners.delete(listener);
      };
    },
    releaseAll,
  };
}
