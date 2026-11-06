// Editing the notes of one pattern, as plain functions.
// BeepBox plays one note at a time per pattern; a chord is one note with several pitches,
// all sharing a start and end. So notes in a pattern never overlap.
import { makeNote, MAX_CHORD_SIZE, NOTE_SIZE_MAX, type NoteData } from "../engine/songData";

export type ToggleChange = "added" | "removed" | "chord-full";

export function noteAt(notes: readonly NoteData[], start: number, end: number): NoteData | null {
  return notes.find((note) => note.start < end && note.end > start) ?? null;
}

function byStart(notes: readonly NoteData[]): NoteData[] {
  return [...notes].sort((a, b) => a.start - b.start);
}

export function toggleNote(
  notes: readonly NoteData[],
  pitch: number,
  start: number,
  end: number,
): { notes: readonly NoteData[]; change: ToggleChange } {
  const existing = noteAt(notes, start, end);
  if (!existing) return { notes: byStart([...notes, makeNote([pitch], start, end)]), change: "added" };

  if (existing.pitches.includes(pitch)) {
    const remaining = existing.pitches.filter((held) => held !== pitch);
    const others = notes.filter((note) => note !== existing);
    return {
      notes: remaining.length === 0 ? others : byStart([...others, { ...existing, pitches: remaining }]),
      change: "removed",
    };
  }

  if (existing.pitches.length >= MAX_CHORD_SIZE) return { notes, change: "chord-full" };
  const chord = { ...existing, pitches: [...existing.pitches, pitch] };
  return { notes: byStart([...notes.filter((note) => note !== existing), chord]), change: "added" };
}

/** Moves the end of the note under the cursor. Returns null if it can't move that way. */
export function stretchNote(
  notes: readonly NoteData[],
  pitch: number,
  part: number,
  byParts: number,
  barParts: number,
): readonly NoteData[] | null {
  const note = noteAt(notes, part, part + 1);
  if (!note || !note.pitches.includes(pitch)) return null;
  const end = note.end + byParts;
  if (end <= note.start || end > barParts) return null;
  const blocked = notes.some((other) => other !== note && other.start < end && other.end > note.start);
  if (blocked) return null;

  const stretched = {
    ...note,
    end,
    pins: stretchPins(note, end - note.start),
  };
  return notes.map((other) => (other === note ? stretched : other));
}

function stretchPins(note: NoteData, length: number): NoteData["pins"] {
  const last = note.pins[note.pins.length - 1];
  const inner = note.pins.slice(0, -1).filter((pin) => pin.time < length);
  return [...inner, { interval: last?.interval ?? 0, time: length, size: last?.size ?? NOTE_SIZE_MAX }];
}

/** Sets where a note ends, as far as the bar and the next note let it go. Returns the notes unchanged if nothing moved. */
export function setNoteEnd(notes: readonly NoteData[], note: NoteData, wanted: number, smallest: number, barParts: number): readonly NoteData[] {
  const next = notes.filter((other) => other !== note && other.start >= note.end).reduce((soonest, other) => Math.min(soonest, other.start), barParts);
  const end = Math.max(note.start + smallest, Math.min(next, wanted));
  if (end === note.end) return notes;
  const stretched = { ...note, end, pins: stretchPins(note, end - note.start) };
  return notes.map((other) => (other === note ? stretched : other));
}

/**
 * Picks a note up and sets it down somewhere else: along the bar by `byParts`, and this one pitch up or down by `byPitch` (the rest of a
 * chord stays). If the place along the bar is taken it stays where it was along the bar, and the same for a pitch the chord already has.
 */
export function moveNote(
  notes: readonly NoteData[],
  note: NoteData,
  pitch: number,
  byParts: number,
  byPitch: number,
  barParts: number,
  highestPitch: number,
): readonly NoteData[] {
  const length = note.end - note.start;
  const wantedStart = Math.max(0, Math.min(barParts - length, note.start + byParts));
  const others = notes.filter((other) => other !== note);
  const free = !others.some((other) => other.start < wantedStart + length && other.end > wantedStart);
  const start = free ? wantedStart : note.start;
  const wantedPitch = Math.max(0, Math.min(highestPitch, pitch + byPitch));
  const newPitch = note.pitches.includes(wantedPitch) && wantedPitch !== pitch ? pitch : wantedPitch;
  return byStart([...others, { ...note, start, end: start + length, pitches: note.pitches.map((held) => (held === pitch ? newPitch : held)) }]);
}

export function deleteNoteAt(notes: readonly NoteData[], start: number, end: number): readonly NoteData[] {
  const note = noteAt(notes, start, end);
  return note ? notes.filter((other) => other !== note) : notes;
}
