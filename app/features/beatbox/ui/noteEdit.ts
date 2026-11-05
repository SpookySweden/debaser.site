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

export function deleteNoteAt(notes: readonly NoteData[], start: number, end: number): readonly NoteData[] {
  const note = noteAt(notes, start, end);
  return note ? notes.filter((other) => other !== note) : notes;
}
