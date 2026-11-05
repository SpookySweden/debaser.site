// Turns a song into .mid and .wav files. No outside libraries: both formats are simple.
import {
  partsPerBar,
  patternAtBar,
  pitchToMidi,
  PARTS_PER_BEAT,
  NOTE_SIZE_MAX,
  type ChannelData,
  type SongData,
} from "./songData";

// MIDI time is counted in these. Four to a BeepBox part keeps every position exact.
const TICKS_PER_PART = 4;
const TICKS_PER_BEAT = PARTS_PER_BEAT * TICKS_PER_PART;
const DRUM_MIDI_CHANNEL = 9;
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

// The General MIDI drum note for each drum row named in songData.ts.
const DRUM_ROW_NOTES = [36, 41, 45, 38, 37, 39, 48, 56, 70, 42, 46, 49];

interface TimedNote {
  readonly midi: number;
  readonly start: number;
  end: number;
  readonly velocity: number;
}

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function chunk(name: string, body: readonly number[]): number[] {
  const size = body.length;
  return [
    ...textBytes(name),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...body,
  ];
}

function nameEvent(name: string): number[] {
  const text = textBytes(name);
  return [0, 0xff, 0x03, ...variableLength(text.length), ...text];
}

const END_OF_TRACK = [0, 0xff, 0x2f, 0];

function channelNotes(song: SongData, channel: ChannelData): TimedNote[] {
  const barParts = partsPerBar(song);
  const notes: TimedNote[] = [];
  // Each pitch's latest note, so one held over a bar line stays one long note.
  const latest = new Map<number, TimedNote>();

  for (let bar = 0; bar < song.barCount; bar++) {
    const pattern = patternAtBar(channel, bar);
    if (!pattern) continue;
    const barStart = bar * barParts;
    for (const note of pattern.notes) {
      const start = (barStart + note.start) * TICKS_PER_PART;
      const end = (barStart + note.end) * TICKS_PER_PART;
      const size = note.pins[0]?.size ?? NOTE_SIZE_MAX;
      const velocity = Math.round((size / NOTE_SIZE_MAX) * 127);
      for (const pitch of note.pitches) {
        const midi = channel.isDrum ? (DRUM_ROW_NOTES[pitch] ?? 36) : pitchToMidi(song, pitch);
        if (midi < 0 || midi > 127) continue;
        const earlier = latest.get(midi);
        if (note.continuesLastPattern && earlier?.end === start) {
          earlier.end = end;
          continue;
        }
        const timed = { midi, start, end, velocity };
        notes.push(timed);
        latest.set(midi, timed);
      }
    }
  }
  return notes;
}

function channelTrack(name: string, notes: readonly TimedNote[], midiChannel: number): number[] {
  const events = notes
    .flatMap((note) => [
      { tick: note.start, status: NOTE_ON | midiChannel, midi: note.midi, velocity: note.velocity },
      { tick: note.end, status: NOTE_OFF | midiChannel, midi: note.midi, velocity: 0 },
    ])
    // Where one note stops as another starts, it stops first.
    .sort((a, b) => a.tick - b.tick || (a.status & 0xf0) - (b.status & 0xf0));

  const body = nameEvent(name);
  let now = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - now), event.status, event.midi, event.velocity);
    now = event.tick;
  }
  body.push(...END_OF_TRACK);
  return chunk("MTrk", body);
}

/**
 * A type 1 MIDI file: every bar of the song once, a track per channel with notes in it. Drums
 * use MIDI channel 10 and the standard drum notes. Pitch bends inside notes aren't included.
 */
export function songToMidi(song: SongData): Uint8Array<ArrayBuffer> {
  const microsecondsPerBeat = Math.round(60_000_000 / song.tempo);
  const tempoTrack = chunk("MTrk", [
    0,
    0xff,
    0x51,
    3,
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff,
    ...[0, 0xff, 0x58, 4, song.beatsPerBar, 2, 24, 8],
    ...END_OF_TRACK,
  ]);

  const tracks = [tempoTrack];
  let nextMidiChannel = 0;
  song.channels.forEach((channel, index) => {
    const notes = channelNotes(song, channel);
    if (notes.length === 0) return;
    if (channel.isDrum) {
      tracks.push(channelTrack(`Drums ${index + 1}`, notes, DRUM_MIDI_CHANNEL));
      return;
    }
    if (nextMidiChannel === DRUM_MIDI_CHANNEL) nextMidiChannel++;
    tracks.push(channelTrack(`Tune ${index + 1}`, notes, nextMidiChannel % 16));
    nextMidiChannel++;
  });

  const header = chunk("MThd", [
    0,
    1,
    (tracks.length >> 8) & 0xff,
    tracks.length & 0xff,
    (TICKS_PER_BEAT >> 8) & 0xff,
    TICKS_PER_BEAT & 0xff,
  ]);
  return Uint8Array.from([...header, ...tracks.flat()]);
}

export interface AudioToSave {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

/** A 16-bit stereo WAV file. */
export function audioToWav({ left, right, sampleRate }: AudioToSave): Uint8Array<ArrayBuffer> {
  const channels = 2;
  const bytesPerSample = 2;
  const frameSize = channels * bytesPerSample;
  const dataSize = left.length * frameSize;
  const HEADER_SIZE = 44;
  const bytes = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(bytes.buffer);
  const writeText = (at: number, text: string) => bytes.set(new TextEncoder().encode(text), at);

  writeText(0, "RIFF");
  view.setUint32(4, HEADER_SIZE - 8 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // plain samples, uncompressed
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * frameSize, true);
  view.setUint16(32, frameSize, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const toSample = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 0x7fff);
  for (let index = 0; index < left.length; index++) {
    const at = HEADER_SIZE + index * frameSize;
    view.setInt16(at, toSample(left[index] ?? 0), true);
    view.setInt16(at + bytesPerSample, toSample(right[index] ?? 0), true);
  }
  return bytes;
}
