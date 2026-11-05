// Step 8 of the plan: a raw take becomes BeepBox-style notes. It only ever reads from the take,
// so quantise can be changed afterwards.
import { MAX_CHORD_SIZE, NOTE_SIZE_MAX, PARTS_PER_BEAT } from "../engine/songData";
import type { RawNote, Take } from "./loopRecorder";

export interface QuantiseSettings {
  /** Size of the grid in parts, or null for no quantise. */
  readonly gridParts: number | null;
  /** 0 leaves notes where played, 1 moves them right onto the grid. */
  readonly strength: number;
  /** Notes starting this close together become one chord. */
  readonly chordWindowParts: number;
}

export interface LoopNote {
  readonly pitches: readonly number[];
  /** Whole parts from the loop start. */
  readonly start: number;
  readonly end: number;
  readonly size: number;
  /** It carries on from the end of the loop rather than starting afresh. */
  readonly continues: boolean;
}

export const QUANTISE_OPTIONS: readonly { readonly label: string; readonly gridParts: number | null }[] = [
  { label: "Off", gridParts: null },
  { label: "1/4", gridParts: PARTS_PER_BEAT },
  { label: "1/8", gridParts: PARTS_PER_BEAT / 2 },
  { label: "1/16", gridParts: PARTS_PER_BEAT / 4 },
  { label: "Triplets", gridParts: PARTS_PER_BEAT / 3 },
];

function quantise(position: number, { gridParts, strength }: QuantiseSettings): number {
  if (gridParts === null) return position;
  return position + (Math.round(position / gridParts) * gridParts - position) * strength;
}

function velocityToSize(velocity: number): number {
  return Math.max(1, Math.min(NOTE_SIZE_MAX, Math.ceil((velocity / 127) * NOTE_SIZE_MAX)));
}

interface PlacedNote {
  readonly pitch: number;
  readonly start: number;
  readonly end: number;
  readonly size: number;
  readonly continues: boolean;
}

function placeNote(raw: RawNote, settings: QuantiseSettings, loopParts: number): PlacedNote {
  const size = velocityToSize(raw.velocity);
  const shortest = settings.gridParts && settings.strength >= 1 ? settings.gridParts : 1;
  // A note carried over from the last pass keeps its start, and one still held keeps its end.
  let start = raw.continued ? 0 : Math.round(quantise(raw.start, settings));
  let end = raw.heldOver ? loopParts : Math.round(quantise(raw.end, settings));
  // A note played just before the loop start, moved onto the grid, belongs at the very start.
  if (start >= loopParts) {
    end -= start;
    start = 0;
  }
  end = Math.min(loopParts, Math.max(end, start + shortest));
  return { pitch: raw.pitch, start, end, size, continues: raw.continued };
}

export function takeToLoopNotes(take: Take, settings: QuantiseSettings): LoopNote[] {
  const placed = take.notes
    .map((raw) => placeNote(raw, settings, take.loopParts))
    .sort((a, b) => a.start - b.start);

  // Notes starting together become one chord.
  const groups: { pitches: number[]; start: number; end: number; size: number; continues: boolean }[] = [];
  for (const note of placed) {
    const group = groups[groups.length - 1];
    if (group && note.start - group.start <= settings.chordWindowParts) {
      if (!group.pitches.includes(note.pitch) && group.pitches.length < MAX_CHORD_SIZE) group.pitches.push(note.pitch);
      group.end = Math.max(group.end, note.end);
      group.size = Math.max(group.size, note.size);
      group.continues &&= note.continues;
    } else {
      groups.push({ ...note, pitches: [note.pitch] });
    }
  }

  // BeepBox plays one note at a time per pattern, so a note stops where the next one starts.
  return groups.map((group, index) => {
    const next = groups[index + 1];
    return next && group.end > next.start ? { ...group, end: next.start } : group;
  });
}
