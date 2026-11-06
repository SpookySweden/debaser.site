// The app's state outside React: the engine, the song with its undo steps, and the transport.
// Buttons, keys and the recorder all call these, so they can't get out of step.
import { createEngine, type Engine } from "../engine";
import { partsPerBar, partsPerStep, type SongData } from "../engine/songData";
import {
  createHistory,
  pushHistory,
  redoHistory,
  replaceHistory,
  undoHistory,
  type History,
} from "../recorder/history";

type Listener = () => void;

function createSignal() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

export interface SongStore {
  subscribe(listener: Listener): () => void;
  getSong(): SongData;
  /** An edit that is one undo step. */
  edit(next: SongData): void;
  /** Swaps the latest undo step for a new version of it. */
  reviseLatest(next: SongData): void;
  /** Takes a song the engine has just loaded. It can't be undone. */
  reload(): void;
  undo(): boolean;
  redo(): boolean;
}

function createSongStore(engine: Engine): SongStore {
  const signal = createSignal();
  let history: History<SongData> = createHistory(engine.getSong());

  function apply(next: History<SongData>): boolean {
    if (next === history) return false;
    history = next;
    engine.updateSong(history.present);
    signal.notify();
    return true;
  }

  return {
    subscribe: signal.subscribe,
    getSong: () => history.present,
    edit: (next) => void apply(pushHistory(history, next)),
    reviseLatest: (next) => void apply(replaceHistory(history, next)),
    reload() {
      history = createHistory(engine.getSong());
      signal.notify();
    },
    undo: () => apply(undoHistory(history)),
    redo: () => apply(redoHistory(history)),
  };
}

export interface PlayheadSpot {
  readonly bar: number;
  readonly step: number;
}

export interface Transport {
  subscribe(listener: Listener): () => void;
  isPlaying(): boolean;
  /** Where the playhead is, or null when stopped. It changes step by step, never in between. */
  getSpot(): PlayheadSpot | null;
  play(fromBar: number, countInBars?: number): void;
  stop(): void;
  /** Called about 50 times a second while playing. */
  onTick(listener: Listener): () => void;
}

const TICK_MS = 20;

function createTransport(engine: Engine, songs: SongStore): Transport {
  const signal = createSignal();
  const ticks = createSignal();
  let timer: ReturnType<typeof setInterval> | null = null;
  let spot: PlayheadSpot | null = null;

  function tick() {
    const song = songs.getSong();
    const position = engine.getPosition();
    const bar = Math.floor(position);
    const step = Math.floor(((position - bar) * partsPerBar(song)) / partsPerStep(song));
    if (spot?.bar !== bar || spot.step !== step) {
      spot = { bar, step };
      signal.notify();
    }
    ticks.notify();
  }

  return {
    subscribe: signal.subscribe,
    isPlaying: () => engine.isPlaying(),
    getSpot: () => spot,
    play(fromBar, countInBars = 0) {
      engine.play({ fromBar, countInBars });
      timer ??= setInterval(tick, TICK_MS);
      tick();
      signal.notify();
    },
    stop() {
      engine.stop();
      if (timer !== null) clearInterval(timer);
      timer = null;
      spot = null;
      signal.notify();
    },
    onTick: ticks.subscribe,
  };
}

export interface App {
  engine: Engine;
  songs: SongStore;
  transport: Transport;
}

export function createApp(): App {
  const engine = createEngine();
  const songs = createSongStore(engine);
  return { engine, songs, transport: createTransport(engine, songs) };
}
