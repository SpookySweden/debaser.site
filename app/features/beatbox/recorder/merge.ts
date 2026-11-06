// Steps 9 and 10 of the plan: a pass goes into the song's patterns. Overdub adds, Replace clears
// only the span crossed, and patterns used elsewhere in the song are copied first.
import {
  freePatternNumber,
  makeNote,
  MAX_CHORD_SIZE,
  partsPerBar,
  type ChannelData,
  type NoteData,
  type SongData,
} from "../engine/songData";
import { takeToLoopNotes, type LoopNote, type QuantiseSettings } from "./convert";
import type { Take } from "./loopRecorder";

export type { QuantiseSettings };
export type RecordMode = "overdub" | "replace";

function noteSize(note: NoteData): number {
  return note.pins[0]?.size ?? 3;
}

/** Keeps the parts of a note outside a span. */
function cutSpan(note: NoteData, from: number, to: number): NoteData[] {
  if (note.end <= from || note.start >= to) return [note];
  const pieces: NoteData[] = [];
  if (note.start < from) pieces.push(makeNote(note.pitches, note.start, from, noteSize(note), note.continuesLastPattern));
  if (note.end > to) pieces.push(makeNote(note.pitches, to, note.end, noteSize(note)));
  return pieces;
}

/**
 * Puts notes together in one pattern. BeepBox can't overlap notes in a pattern, so where two
 * overlap the time is divided up, with both sounding as a chord in the shared part. Notes that
 * overlap nothing are kept exactly as they were.
 */
function layerNotes(notes: readonly NoteData[]): NoteData[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: NoteData[] = [];
  let cluster: NoteData[] = [];
  let clusterEnd = -Infinity;

  function flush() {
    if (cluster.length === 1 && cluster[0]) {
      result.push(cluster[0]);
    } else if (cluster.length > 1) {
      const edges = [...new Set(cluster.flatMap((note) => [note.start, note.end]))].sort((a, b) => a - b);
      edges.slice(0, -1).forEach((from, index) => {
        const to = edges[index + 1] as number;
        const covering = cluster.filter((note) => note.start < to && note.end > from);
        if (covering.length === 0) return;
        const pitches = [...new Set(covering.flatMap((note) => note.pitches))].slice(0, MAX_CHORD_SIZE);
        const continues = covering.some((note) => note.start === from && note.continuesLastPattern);
        result.push(makeNote(pitches, from, to, Math.max(...covering.map(noteSize)), continues));
      });
    }
    cluster = [];
  }

  for (const note of sorted) {
    if (note.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    cluster.push(note);
    clusterEnd = Math.max(clusterEnd, note.end);
  }
  flush();
  return result;
}

/** Writes notes to a bar, copying its pattern first if other bars use it too. */
function writeBar(channel: ChannelData, bar: number, notes: readonly NoteData[]): ChannelData {
  const current = channel.bars[bar] ?? 0;
  const shared = current !== 0 && channel.bars.filter((number) => number === current).length > 1;
  if (current !== 0 && !shared) {
    return {
      ...channel,
      patterns: channel.patterns.map((pattern, index) => (index === current - 1 ? { ...pattern, notes } : pattern)),
    };
  }
  const { channel: withFree, patternNumber } = freePatternNumber(channel);
  const instruments = channel.patterns[current - 1]?.instruments ?? [0];
  return {
    ...withFree,
    bars: withFree.bars.map((number, index) => (index === bar ? patternNumber : number)),
    patterns: withFree.patterns.map((pattern, index) =>
      index === patternNumber - 1 ? { notes, instruments } : pattern,
    ),
  };
}

function sameNotes(a: readonly NoteData[], b: readonly NoteData[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

/** A note crossing a bar line becomes two notes, the second carrying on from the first. */
function notesInBar(notes: readonly LoopNote[], barStart: number, barParts: number): NoteData[] {
  const barEnd = barStart + barParts;
  return notes
    .filter((note) => note.start < barEnd && note.end > barStart)
    .map((note) => {
      const continues = note.start < barStart || (note.start === barStart && note.continues);
      return makeNote(
        note.pitches,
        Math.max(note.start, barStart) - barStart,
        Math.min(note.end, barEnd) - barStart,
        note.size,
        continues,
      );
    });
}

/** Removes a new note's pitches from existing notes it exactly repeats. */
function isDuplicate(note: NoteData, existing: readonly NoteData[]): boolean {
  return existing.some(
    (other) =>
      other.start === note.start &&
      other.end === note.end &&
      note.pitches.every((pitch) => other.pitches.includes(pitch)),
  );
}

/** Puts one pass into the song. A pass with no notes changes nothing, even in Replace. */
export function commitTake(
  song: SongData,
  channelIndex: number,
  take: Take,
  mode: RecordMode,
  settings: QuantiseSettings,
): SongData {
  const channel = song.channels[channelIndex];
  if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);
  if (take.notes.length === 0) return song;

  const notes = takeToLoopNotes(take, settings);
  const barParts = partsPerBar(song);
  let next = channel;

  for (let loopBar = 0; loopBar < song.loopLength; loopBar++) {
    const barStart = loopBar * barParts;
    const bar = song.loopStart + loopBar;
    const patternNumber = next.bars[bar] ?? 0;
    const existing = patternNumber === 0 ? [] : (next.patterns[patternNumber - 1]?.notes ?? []);

    let kept: readonly NoteData[] = existing;
    if (mode === "replace") {
      const from = Math.max(0, take.crossedFrom - barStart);
      const to = Math.min(barParts, take.crossedTo - barStart);
      if (from < to) kept = existing.flatMap((note) => cutSpan(note, from, to));
    }

    const incoming = notesInBar(notes, barStart, barParts).filter((note) => !isDuplicate(note, kept));
    const merged = incoming.length === 0 ? kept : layerNotes([...kept, ...incoming]);
    if (!sameNotes(merged, existing)) next = writeBar(next, bar, merged);
  }

  if (next === channel) return song;
  return { ...song, channels: song.channels.map((other, index) => (index === channelIndex ? next : other)) };
}
