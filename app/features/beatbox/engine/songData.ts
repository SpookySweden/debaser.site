// Song data as plain values, in BeepBox's shape, with no BeepBox code.
// The UI and the recorder work on this, so neither needs the synth. Nothing here is ever
// changed in place: an edit makes new objects, so a change can be spotted by comparing objects.

export const PARTS_PER_BEAT = 24;
export const NOTE_SIZE_MAX = 3;
export const MAX_CHORD_SIZE = 4;
export const DRUM_ROW_COUNT = 12;
export const MAX_PITCH = 84;
export const MAX_BARS = 128;

export interface NotePin {
  readonly interval: number;
  readonly time: number;
  readonly size: number;
}

export interface NoteData {
  readonly pitches: readonly number[];
  /** Parts from the start of the bar. */
  readonly start: number;
  readonly end: number;
  readonly pins: readonly NotePin[];
  readonly continuesLastPattern: boolean;
}

export interface PatternData {
  readonly notes: readonly NoteData[];
  readonly instruments: readonly number[];
}

export interface ChannelData {
  readonly isDrum: boolean;
  /** BeepBox's starting view for the channel, in octaves. It doesn't change the sound. */
  readonly octave: number;
  /** The pattern each bar plays: 0 is silence, 1 is the first pattern. */
  readonly bars: readonly number[];
  readonly patterns: readonly PatternData[];
}

export interface SongData {
  /** 0 is C, 1 is C sharp, and so on. */
  readonly key: number;
  readonly tempo: number;
  readonly beatsPerBar: number;
  readonly stepsPerBeat: number;
  readonly barCount: number;
  readonly loopStart: number;
  readonly loopLength: number;
  readonly channels: readonly ChannelData[];
}

export function makeNote(
  pitches: readonly number[],
  start: number,
  end: number,
  size: number = NOTE_SIZE_MAX,
  continuesLastPattern = false,
): NoteData {
  return {
    pitches,
    start,
    end,
    pins: [
      { interval: 0, time: 0, size },
      { interval: 0, time: end - start, size },
    ],
    continuesLastPattern,
  };
}

export function partsPerBar(song: SongData): number {
  return song.beatsPerBar * PARTS_PER_BEAT;
}

/** BeepBox's freehand rhythm has 24 steps a beat: too fine to show as cells. */
export function gridStepsPerBeat(song: SongData): number {
  return song.stepsPerBeat > 8 ? 4 : song.stepsPerBeat;
}

export function partsPerStep(song: SongData): number {
  return PARTS_PER_BEAT / gridStepsPerBeat(song);
}

export function stepsPerBar(song: SongData): number {
  return song.beatsPerBar * gridStepsPerBeat(song);
}

export function patternAtBar(channel: ChannelData, bar: number): PatternData | null {
  const patternNumber = channel.bars[bar] ?? 0;
  return patternNumber === 0 ? null : (channel.patterns[patternNumber - 1] ?? null);
}

/** The number of a pattern that's empty and on no bar, adding one if there is none. */
export function freePatternNumber(channel: ChannelData): { channel: ChannelData; patternNumber: number } {
  const free = channel.patterns.findIndex(
    (pattern, index) => pattern.notes.length === 0 && !channel.bars.includes(index + 1),
  );
  if (free !== -1) return { channel, patternNumber: free + 1 };
  const empty: PatternData = { notes: [], instruments: [0] };
  return { channel: { ...channel, patterns: [...channel.patterns, empty] }, patternNumber: channel.patterns.length + 1 };
}

/** The MIDI note number a BeepBox pitch sounds at. Pitch 0 is C0 in the key of C. */
export function pitchToMidi(song: SongData, pitch: number): number {
  return 12 + song.key + pitch;
}

/** The BeepBox pitch for a MIDI note, or null if it's outside BeepBox's range. */
export function midiToPitch(song: SongData, midi: number): number | null {
  const pitch = midi - 12 - song.key;
  return pitch >= 0 && pitch <= MAX_PITCH ? pitch : null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DRUM_NAMES = [
  "Kick",
  "Low tom",
  "Mid tom",
  "Snare",
  "Rim",
  "Clap",
  "High tom",
  "Bell",
  "Shake",
  "Hat",
  "Open hat",
  "Crash",
];

export function pitchName(song: SongData, channel: ChannelData, pitch: number): string {
  if (channel.isDrum) return DRUM_NAMES[pitch] ?? `Drum ${pitch + 1}`;
  const midi = pitchToMidi(song, pitch);
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** How many pitches this channel can play. Pitches run from 0 upwards. */
export function pitchCount(channel: ChannelData): number {
  return channel.isDrum ? DRUM_ROW_COUNT : MAX_PITCH + 1;
}
