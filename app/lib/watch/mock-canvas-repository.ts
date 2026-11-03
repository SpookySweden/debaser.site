import { isSiteAccount } from '../auth/builtin-account';
import { readInput, type CanvasInput } from './canvas';
import type {
  CanvasRepository,
  CanvasSnapshot,
  CanvasTimelineInput,
  CanvasWire,
  CanvasWireMessage,
  RoomCanvasRecord,
  SnapshotInput,
  StreamArtPiece,
} from './canvas-repository';
import { participantsOf } from './canvas-repository';
import { getMockWatchRepository } from './mock-watch-repository';

/**
 * Room canvases in this browser only, like the other mocks: the three tables as one localStorage record
 * (snapshots' pictures as data addresses), and a BroadcastChannel so this browser's other tabs hear the live
 * strokes. The database's rules are kept by hand: inputs only in your own name, on an open canvas in a live room;
 * nothing changed or deleted; SAVE once; only the room's host closes it; only the house account hides.
 */

const KEY = 'debaser.canvas.v1';
const WIRE = 'debaser-canvas';
/** The bucket's rate limit (one picture per account per 10 seconds), kept here by hand. */
const SNAPSHOT_EVERY_MS = 10_000;

type StoredSnapshot = Omit<CanvasSnapshot, 'imageUrl'> & { image: string };
type Tables = { canvases: RoomCanvasRecord[]; inputs: (CanvasInput & { seq: number; canvasId: string })[]; snapshots: StoredSnapshot[]; seq: number };

let memory: Tables = { canvases: [], inputs: [], snapshots: [], seq: 0 };

function load(): Tables {
  try {
    if (typeof window === 'undefined') return memory;
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return memory;
    const parsed = JSON.parse(raw) as Partial<Tables>;
    return {
      canvases: Array.isArray(parsed.canvases) ? parsed.canvases : [],
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
    };
  } catch {
    return memory;
  }
}

function save(tables: Tables): void {
  memory = tables;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(tables));
  } catch {
    // A full store keeps this tab's copy in memory.
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const refused = (words: string) => new Error(words);

/**
 * Who has a part in a canvas, from the records (the database's `room_canvas_people`): the host, the saver, who drew,
 * who chatted in the room since it opened, and who is crowned there. `mayTake` leaves out chat-only watchers.
 */
async function peopleOf(canvas: RoomCanvasRecord): Promise<{ people: Map<string, { label: string; crowned: boolean }>; mayTake: Set<string> }> {
  const read = await getMockWatchRepository().readRoom(canvas.roomId);
  const crowned = new Set((read?.crowns ?? []).map((crown) => crown.userId));
  const people = new Map<string, { label: string; crowned: boolean }>();
  const mayTake = new Set<string>([canvas.hostId, ...crowned]);
  if (read !== null) mayTake.add(read.room.hostId);
  if (canvas.savedBy !== null) mayTake.add(canvas.savedBy);
  const add = (id: string, label: string) => {
    if (!people.has(id)) people.set(id, { label, crowned: crowned.has(id) });
  };
  add(canvas.hostId, canvas.hostLabel);
  if (canvas.savedBy !== null) add(canvas.savedBy, canvas.savedByLabel ?? 'Unknown');
  for (const input of load().inputs.filter((entry) => entry.canvasId === canvas.id)) {
    add(input.authorId, input.authorLabel);
    mayTake.add(input.authorId);
  }
  for (const message of read?.messages ?? []) if (message.createdAt >= canvas.openedAt) add(message.authorId, message.authorLabel);
  for (const id of crowned) add(id, 'Unknown');
  return { people, mayTake };
}

async function roomIsOpen(roomId: string): Promise<{ live: boolean; hostId: string | null }> {
  const read = await getMockWatchRepository().readRoom(roomId);
  if (read === null) return { live: false, hostId: null };
  return { live: read.room.endedAt === null, hostId: read.room.hostId };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('THE PICTURE COULD NOT BE READ.'));
    reader.readAsDataURL(blob);
  });
}

const shown = (snapshot: StoredSnapshot): CanvasSnapshot => {
  const { image, ...rest } = snapshot;
  return { ...rest, imageUrl: image };
};

class MockCanvasRepository implements CanvasRepository {
  async findOpenCanvas(roomId: string): Promise<RoomCanvasRecord | null> {
    return load().canvases.find((canvas) => canvas.roomId === roomId && canvas.closedAt === null) ?? null;
  }

  async openCanvas(input: { roomId: string; host: { id: string; label: string }; title: string; by: string }): Promise<RoomCanvasRecord> {
    const open = await this.findOpenCanvas(input.roomId);
    if (open !== null) return open;
    const room = await roomIsOpen(input.roomId);
    if (!room.live) throw refused('THE ROOM IS NOT LIVE.');
    const canvas: RoomCanvasRecord = {
      id: newId(),
      roomId: input.roomId,
      hostId: input.host.id,
      hostLabel: input.host.label,
      title: input.title,
      openedAt: new Date().toISOString(),
      closedAt: null,
      savedAt: null,
      savedBy: null,
      savedByLabel: null,
      hidden: false,
    };
    const tables = load();
    save({ ...tables, canvases: [...tables.canvases, canvas] });
    return canvas;
  }

  async readCanvas(canvasId: string): Promise<RoomCanvasRecord | null> {
    return load().canvases.find((canvas) => canvas.id === canvasId) ?? null;
  }

  async readInputs(canvasId: string): Promise<CanvasTimelineInput[]> {
    return load()
      .inputs.filter((input) => input.canvasId === canvasId)
      .sort((a, b) => a.seq - b.seq)
      .flatMap((stored) => {
        const input = readInput(stored);
        return input === null ? [] : [{ ...input, seq: stored.seq }];
      });
  }

  async writeInputs(canvasId: string, inputs: CanvasInput[], by: string): Promise<void> {
    if (inputs.length === 0) return;
    const canvas = await this.readCanvas(canvasId);
    if (canvas === null || canvas.closedAt !== null) throw refused('THIS CANVAS IS CLOSED.');
    if (!(await roomIsOpen(canvas.roomId)).live) throw refused('THE ROOM IS NOT LIVE.');
    if (inputs.some((input) => input.authorId !== by)) throw refused('NOT ALLOWED.');
    const tables = load();
    const known = new Set(tables.inputs.map((input) => input.id));
    let seq = tables.seq;
    const added = inputs.filter((input) => !known.has(input.id)).map((input) => ({ ...input, canvasId, seq: (seq += 1) }));
    save({ ...tables, inputs: [...tables.inputs, ...added], seq });
  }

  async save(canvasId: string, by: { id: string; label: string }): Promise<RoomCanvasRecord | null> {
    const canvas = await this.readCanvas(canvasId);
    if (canvas === null) return null;
    if (canvas.savedAt !== null) return canvas;
    if (canvas.closedAt !== null || !(await roomIsOpen(canvas.roomId)).live) throw refused('THIS CANVAS IS CLOSED.');
    const saved = { ...canvas, savedAt: new Date().toISOString(), savedBy: by.id, savedByLabel: by.label };
    const tables = load();
    save({ ...tables, canvases: tables.canvases.map((entry) => (entry.id === canvasId ? saved : entry)) });
    return saved;
  }

  async close(canvasId: string, by: string): Promise<void> {
    const canvas = await this.readCanvas(canvasId);
    if (canvas === null || canvas.closedAt !== null) return;
    const room = await roomIsOpen(canvas.roomId);
    if (room.live && room.hostId !== by) throw refused('NOT ALLOWED.');
    const tables = load();
    save({ ...tables, canvases: tables.canvases.map((entry) => (entry.id === canvasId ? { ...entry, closedAt: new Date().toISOString() } : entry)) });
  }

  async addSnapshot(input: SnapshotInput): Promise<CanvasSnapshot> {
    const canvas = await this.readCanvas(input.canvasId);
    if (canvas === null || canvas.savedAt === null || canvas.closedAt !== null) throw refused('ONLY A SAVED, OPEN CANVAS TAKES SNAPSHOTS.');
    if (!(await roomIsOpen(canvas.roomId)).live) throw refused('THE ROOM IS NOT LIVE.');
    // One picture per account every 10 seconds, as the bucket's policy allows.
    const recent = load().snapshots.some((snapshot) => snapshot.takenBy === input.takenBy.id && Date.now() - Date.parse(snapshot.takenAt) < SNAPSHOT_EVERY_MS);
    if (recent) throw refused('ONE SNAPSHOT EVERY FEW SECONDS.');
    // As the database: only somebody with a part in the canvas takes one, and "who was there", crowns and credits
    // come from the records, never from what the browser sent.
    const { people, mayTake } = await peopleOf(canvas);
    if (!mayTake.has(input.takenBy.id)) throw refused('NOT ALLOWED.');
    if (!people.has(input.takenBy.id)) people.set(input.takenBy.id, { label: input.takenBy.label, crowned: false });
    const participants = [...people.entries()].map(([id, person]) => ({ id, label: person.label, crowned: person.crowned }));
    const credits = input.credits.filter((credit) => credit.id === null || people.has(credit.id));
    const inputCount = load().inputs.filter((entry) => entry.canvasId === canvas.id).length;
    const stored: StoredSnapshot = {
      id: newId(),
      canvasId: input.canvasId,
      takenAt: new Date().toISOString(),
      takenBy: input.takenBy.id,
      takenByLabel: input.takenBy.label,
      image: await blobToDataUrl(input.png),
      placements: input.placements,
      credits,
      participants: [...participants.filter((person) => person.id === canvas.hostId), ...participants.filter((person) => person.id !== canvas.hostId)],
      inputCount,
    };
    const tables = load();
    save({ ...tables, snapshots: [...tables.snapshots, stored] });
    return shown(stored);
  }

  async listSnapshots(canvasId: string): Promise<CanvasSnapshot[]> {
    return load()
      .snapshots.filter((snapshot) => snapshot.canvasId === canvasId)
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
      .map(shown);
  }

  async listPieces(options: { includeHidden: boolean }): Promise<StreamArtPiece[]> {
    const tables = load();
    return tables.canvases
      .filter((canvas) => canvas.savedAt !== null && (options.includeHidden || !canvas.hidden))
      .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
      .map((canvas) => {
        const snapshots = tables.snapshots.filter((snapshot) => snapshot.canvasId === canvas.id).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
        const latest = snapshots[snapshots.length - 1];
        return { canvas, latest: latest === undefined ? null : shown(latest), snapshotCount: snapshots.length, participants: participantsOf(canvas.hostId, snapshots) };
      });
  }

  async setHidden(canvasId: string, hidden: boolean, by: string): Promise<void> {
    if (!isSiteAccount(by)) throw refused('NOT ALLOWED.');
    const tables = load();
    save({ ...tables, canvases: tables.canvases.map((entry) => (entry.id === canvasId ? { ...entry, hidden } : entry)) });
  }

  joinWire(roomId: string, onMessage: (message: CanvasWireMessage) => void): CanvasWire {
    if (typeof BroadcastChannel === 'undefined') return { send: () => undefined, leave: () => undefined };
    const channel = new BroadcastChannel(`${WIRE}:${roomId}`);
    channel.onmessage = (event: MessageEvent<CanvasWireMessage>) => onMessage(event.data);
    return {
      send: (message) => channel.postMessage(message),
      leave: () => channel.close(),
    };
  }
}

let repository: MockCanvasRepository | null = null;

export function getMockCanvasRepository(): CanvasRepository {
  if (repository === null) repository = new MockCanvasRepository();
  return repository;
}
