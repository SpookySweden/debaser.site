import type { CanvasInput, Placement } from './canvas';
import { getMockCanvasRepository } from './mock-canvas-repository';
import { WATCH_DATA_SOURCE } from './repository';
import { getSupabaseCanvasRepository } from './supabase-canvas-repository';

/**
 * Where room canvases live (SPEC-stream-art.md). The same switch as the stream rooms
 * (`NEXT_PUBLIC_WATCH_DATA_SOURCE`): Supabase means `room_canvases`, `room_canvas_inputs`,
 * `room_canvas_snapshots` and the private `stream-art` bucket (supabase/migrations/*_stream_art.sql), with the
 * live strokes on a Realtime broadcast channel per room (`canvas:<room id>`); the mock keeps them in this
 * browser (localStorage, and a BroadcastChannel between its tabs), with the same rules kept by hand.
 */

/** One canvas: a room session's drawing, from GO LIVE to END STREAM (or GO PUBLIC to public off). */
export type RoomCanvasRecord = {
  id: string;
  roomId: string;
  /** Whose room it was: the piece shows their picture in the archive. */
  hostId: string;
  hostLabel: string;
  title: string;
  openedAt: string;
  /** The session ended: nothing more is drawn on it. */
  closedAt: string | null;
  /** Somebody pressed SAVE: it is documented in the archive (STREAM ART). Null until then. */
  savedAt: string | null;
  savedBy: string | null;
  savedByLabel: string | null;
  /** Taken off the archive by the house account's HIDE; never wiped. */
  hidden: boolean;
};

/** An input as the timeline holds it: its place in the server's order, once written (null while only on the wire). */
export type CanvasTimelineInput = CanvasInput & { seq: number | null };

/** Somebody who was in the room, as a snapshot records them. */
export type CanvasParticipant = { id: string; label: string; crowned: boolean };

export type CanvasCredit = { id: string | null; label: string };

/** One saved picture of the canvas: timed, dated and credited. */
export type CanvasSnapshot = {
  id: string;
  canvasId: string;
  takenAt: string;
  takenBy: string;
  takenByLabel: string;
  /** The pixels, an image the site holds; GIFs and text are not baked in but drawn live over it (`placements`). */
  imageUrl: string | null;
  placements: Placement[];
  credits: CanvasCredit[];
  participants: CanvasParticipant[];
  /** How many inputs the canvas had when it was taken: later inputs mean it changed since. */
  inputCount: number;
};

/** A saved canvas in the archive: its newest snapshot and everybody who was there. */
export type StreamArtPiece = {
  canvas: RoomCanvasRecord;
  latest: CanvasSnapshot | null;
  snapshotCount: number;
  participants: CanvasParticipant[];
};

export type SnapshotInput = {
  canvasId: string;
  takenBy: { id: string; label: string };
  png: Blob;
  placements: Placement[];
  credits: CanvasCredit[];
  participants: CanvasParticipant[];
  inputCount: number;
};

/** What travels live between the tabs in one room. */
export type CanvasWireMessage =
  /** A finished input (also written to the timeline in the next batch). */
  | { type: 'input'; canvasId: string; input: CanvasInput }
  /** A stroke while it is being drawn: its points from `start` on. */
  | { type: 'progress'; canvasId: string; input: CanvasInput & { kind: 'stroke' | 'erase' }; start: number }
  /** The canvas row changed (opened, saved, snapshot taken, closed): read it again. */
  | { type: 'canvas'; canvasId: string };

export type CanvasWire = { send: (message: CanvasWireMessage) => void; leave: () => void };

export interface CanvasRepository {
  /** The room's open canvas, or null when nobody has drawn or saved yet this session. */
  findOpenCanvas(roomId: string): Promise<RoomCanvasRecord | null>;
  /** The room's open canvas, opened now if there is none (two tabs at once get the same one). */
  openCanvas(input: { roomId: string; host: { id: string; label: string }; title: string; by: string }): Promise<RoomCanvasRecord>;
  readCanvas(canvasId: string): Promise<RoomCanvasRecord | null>;
  /** The whole timeline, in the server's order. */
  readInputs(canvasId: string): Promise<CanvasTimelineInput[]>;
  /** A batch of this tab's own inputs onto the timeline (the database refuses anybody else's). */
  writeInputs(canvasId: string, inputs: CanvasInput[], by: string): Promise<void>;
  /** SAVE: documented from now on. Saying it twice changes nothing. */
  save(canvasId: string, by: { id: string; label: string }): Promise<RoomCanvasRecord | null>;
  /** The session ended: the canvas takes no more inputs. Only the room's host closes it. */
  close(canvasId: string, by: string): Promise<void>;
  addSnapshot(input: SnapshotInput): Promise<CanvasSnapshot>;
  /** Every snapshot of a canvas, oldest first, each with its picture's address. */
  listSnapshots(canvasId: string): Promise<CanvasSnapshot[]>;
  /** The archive's STREAM ART: saved canvases, newest first; hidden ones only when asked (the house account). */
  listPieces(options: { includeHidden: boolean }): Promise<StreamArtPiece[]>;
  /** HIDE (the house account only): off the archive, never wiped. */
  setHidden(canvasId: string, hidden: boolean, by: string): Promise<void>;
  /** The live wire for one room. */
  joinWire(roomId: string, onMessage: (message: CanvasWireMessage) => void): CanvasWire;
}

let repository: CanvasRepository | null = null;

export function getCanvasRepository(): CanvasRepository {
  if (repository === null) repository = WATCH_DATA_SOURCE === 'supabase' ? getSupabaseCanvasRepository() : getMockCanvasRepository();
  return repository;
}

/** Everybody a piece's snapshots name, once each, crowned if any snapshot saw them crowned; the host first. */
export function participantsOf(hostId: string, snapshots: readonly Pick<CanvasSnapshot, 'participants'>[]): CanvasParticipant[] {
  const byId = new Map<string, CanvasParticipant>();
  for (const snapshot of snapshots) {
    for (const person of snapshot.participants) {
      const known = byId.get(person.id);
      byId.set(person.id, known === undefined ? { ...person } : { ...known, crowned: known.crowned || person.crowned });
    }
  }
  const people = [...byId.values()];
  return [...people.filter((person) => person.id === hostId), ...people.filter((person) => person.id !== hostId)];
}
