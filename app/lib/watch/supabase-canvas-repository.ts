import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import { inputData, readInput, type CanvasInput, type Placement } from './canvas';
import type {
  CanvasCredit,
  CanvasParticipant,
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

/**
 * Room canvases on Supabase (supabase/migrations/*_stream_art.sql). The tables hold the timeline and the saved
 * pieces; the live strokes ride a Realtime broadcast channel per room (`canvas:<room id>`), so the database is
 * written in batches, never once per pixel. Who may write what is the database's business (RLS and the three
 * functions); the store only says a refusal in words fit to show.
 */

const CANVASES = 'room_canvases';
const INPUTS = 'room_canvas_inputs';
const SNAPSHOTS = 'room_canvas_snapshots';
const BUCKET = 'stream-art';

const CANVAS_COLUMNS = 'id, room_id, host_id, host_label, title, opened_at, closed_at, saved_at, saved_by, saved_by_label, hidden';
const INPUT_COLUMNS = 'id, seq, author_id, author_label, kind, data, created_at';
const SNAPSHOT_COLUMNS = 'id, canvas_id, path, taken_at, taken_by, taken_by_label, placements, credits, participants, input_count';

/** The timeline is read in pages of this many rows (the API's own most per answer). */
const INPUT_PAGE = 1000;
/** The archive lists this many pieces, newest saved first. */
const PIECE_LIMIT = 200;
const SNAPSHOT_LIMIT = 5000;
/** How long a snapshot's signed address lasts: the bucket is private, read by signed-in people only. */
const SIGNED_SECONDS = 60 * 60;

type CanvasRow = {
  id: string;
  room_id: string;
  host_id: string;
  host_label: string;
  title: string;
  opened_at: string;
  closed_at: string | null;
  saved_at: string | null;
  saved_by: string | null;
  saved_by_label: string | null;
  hidden: boolean;
};

type InputRow = { id: string; seq: number | string; author_id: string; author_label: string; kind: string; data: Record<string, unknown> | null; created_at: string };

type SnapshotRow = {
  id: string;
  canvas_id: string;
  path: string;
  taken_at: string;
  taken_by: string;
  taken_by_label: string;
  placements: unknown;
  credits: unknown;
  participants: unknown;
  input_count: number;
};

function toCanvas(row: CanvasRow): RoomCanvasRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    hostId: row.host_id,
    hostLabel: row.host_label,
    title: row.title,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    savedAt: row.saved_at,
    savedBy: row.saved_by,
    savedByLabel: row.saved_by_label,
    hidden: row.hidden,
  };
}

function toInput(row: InputRow): CanvasTimelineInput | null {
  const input = readInput({ ...(row.data ?? {}), kind: row.kind, id: row.id, authorId: row.author_id, authorLabel: row.author_label, at: row.created_at });
  return input === null ? null : { ...input, seq: Number(row.seq) };
}

const list = <T>(value: unknown, keep: (entry: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const kept = keep(entry as Record<string, unknown>);
        return kept === null ? [] : [kept];
      })
    : [];

function toSnapshot(row: SnapshotRow, imageUrl: string | null): CanvasSnapshot {
  // A placement is checked again on the way in, the way a timeline input is.
  const placements = list<Placement>(row.placements, (entry) => {
    const input = readInput({ id: 'p', authorId: 'p', at: '', kind: 'place', place: entry });
    return input !== null && input.kind === 'place' ? input.place : null;
  });
  const credits = list<CanvasCredit>(row.credits, (entry) =>
    typeof entry.label === 'string' ? { id: typeof entry.id === 'string' ? entry.id : null, label: entry.label } : null,
  );
  const participants = list<CanvasParticipant>(row.participants, (entry) =>
    typeof entry.id === 'string' && typeof entry.label === 'string' ? { id: entry.id, label: entry.label, crowned: entry.crowned === true } : null,
  );
  return {
    id: row.id,
    canvasId: row.canvas_id,
    takenAt: row.taken_at,
    takenBy: row.taken_by,
    takenByLabel: row.taken_by_label,
    imageUrl,
    placements,
    credits,
    participants,
    inputCount: row.input_count,
  };
}

function refusal(error: { message?: string; code?: string } | null, fallback: string): Error {
  if (error?.code === '42501') return new Error('NOT ALLOWED.');
  return new Error(fallback);
}

class SupabaseCanvasRepository implements CanvasRepository {
  private client(): SupabaseClient {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('THE CANVAS CANNOT BE REACHED.');
    return client;
  }

  async findOpenCanvas(roomId: string): Promise<RoomCanvasRecord | null> {
    const { data, error } = await this.client().from(CANVASES).select(CANVAS_COLUMNS).eq('room_id', roomId).is('closed_at', null).limit(1).maybeSingle<CanvasRow>();
    if (error) throw refusal(error, 'THE CANVAS COULD NOT BE READ.');
    return data === null ? null : toCanvas(data);
  }

  async openCanvas(input: { roomId: string; host: { id: string; label: string }; title: string; by: string }): Promise<RoomCanvasRecord> {
    const open = await this.findOpenCanvas(input.roomId);
    if (open !== null) return open;
    const { data, error } = await this.client()
      .from(CANVASES)
      .insert({ room_id: input.roomId, host_id: input.host.id, host_label: input.host.label.slice(0, 80) || 'Unknown', title: input.title.slice(0, 120), opened_by: input.by })
      .select(CANVAS_COLUMNS)
      .single<CanvasRow>();
    if (data !== null) return toCanvas(data);
    // Two tabs opened it at once: the other one's is the room's canvas.
    const raced = await this.findOpenCanvas(input.roomId);
    if (raced !== null) return raced;
    throw refusal(error, 'THE CANVAS COULD NOT BE OPENED.');
  }

  async readCanvas(canvasId: string): Promise<RoomCanvasRecord | null> {
    const { data, error } = await this.client().from(CANVASES).select(CANVAS_COLUMNS).eq('id', canvasId).maybeSingle<CanvasRow>();
    if (error) throw refusal(error, 'THE CANVAS COULD NOT BE READ.');
    return data === null ? null : toCanvas(data);
  }

  async readInputs(canvasId: string): Promise<CanvasTimelineInput[]> {
    const out: CanvasTimelineInput[] = [];
    for (let from = 0; ; from += INPUT_PAGE) {
      const { data, error } = await this.client()
        .from(INPUTS)
        .select(INPUT_COLUMNS)
        .eq('canvas_id', canvasId)
        .order('seq', { ascending: true })
        .range(from, from + INPUT_PAGE - 1)
        .returns<InputRow[]>();
      if (error) throw refusal(error, 'THE CANVAS COULD NOT BE READ.');
      for (const row of data ?? []) {
        const input = toInput(row);
        if (input !== null) out.push(input);
      }
      if ((data ?? []).length < INPUT_PAGE) return out;
    }
  }

  async writeInputs(canvasId: string, inputs: CanvasInput[], by: string): Promise<void> {
    const own = inputs.filter((input) => input.authorId === by);
    if (own.length === 0) return;
    const rows = own.map((input) => {
      const { kind, ...data } = inputData(input);
      return { id: input.id, canvas_id: canvasId, author_id: input.authorId, author_label: input.authorLabel.slice(0, 80) || 'Unknown', kind, data };
    });
    // Sent again after a lost answer, a row already written is left as it is.
    const { error } = await this.client().from(INPUTS).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw refusal(error, 'THE DRAWING COULD NOT BE SAVED.');
  }

  async save(canvasId: string): Promise<RoomCanvasRecord | null> {
    const { error } = await this.client().rpc('room_canvas_save', { canvas: canvasId });
    if (error) throw refusal(error, 'THE CANVAS COULD NOT BE SAVED.');
    return this.readCanvas(canvasId);
  }

  async close(canvasId: string): Promise<void> {
    const { error } = await this.client().rpc('room_canvas_close', { canvas: canvasId });
    if (error) throw refusal(error, 'THE CANVAS COULD NOT BE CLOSED.');
  }

  async addSnapshot(input: SnapshotInput): Promise<CanvasSnapshot> {
    const client = this.client();
    const id = crypto.randomUUID();
    const path = `${input.canvasId}/${id}.png`;
    const upload = await client.storage.from(BUCKET).upload(path, input.png, { contentType: 'image/png', upsert: false });
    if (upload.error) throw new Error('THE SNAPSHOT COULD NOT BE STORED.');
    const { data, error } = await client
      .from(SNAPSHOTS)
      .insert({
        id,
        canvas_id: input.canvasId,
        path,
        taken_by: input.takenBy.id,
        taken_by_label: input.takenBy.label.slice(0, 80) || 'Unknown',
        placements: input.placements,
        credits: input.credits,
        participants: input.participants,
        input_count: input.inputCount,
      })
      .select(SNAPSHOT_COLUMNS)
      .single<SnapshotRow>();
    if (error || data === null) throw refusal(error, 'THE SNAPSHOT COULD NOT BE SAVED.');
    return toSnapshot(data, URL.createObjectURL(input.png));
  }

  private async signed(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const { data } = await this.client().storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
    for (const entry of data ?? []) if (entry.path !== null && entry.signedUrl) out.set(entry.path, entry.signedUrl);
    return out;
  }

  async listSnapshots(canvasId: string): Promise<CanvasSnapshot[]> {
    const { data, error } = await this.client()
      .from(SNAPSHOTS)
      .select(SNAPSHOT_COLUMNS)
      .eq('canvas_id', canvasId)
      .order('taken_at', { ascending: true })
      .limit(SNAPSHOT_LIMIT)
      .returns<SnapshotRow[]>();
    if (error) throw refusal(error, 'THE SNAPSHOTS COULD NOT BE READ.');
    const rows = data ?? [];
    const urls = await this.signed(rows.map((row) => row.path));
    return rows.map((row) => toSnapshot(row, urls.get(row.path) ?? null));
  }

  async listPieces(options: { includeHidden: boolean }): Promise<StreamArtPiece[]> {
    const client = this.client();
    let query = client.from(CANVASES).select(CANVAS_COLUMNS).not('saved_at', 'is', null);
    if (!options.includeHidden) query = query.eq('hidden', false);
    const { data, error } = await query.order('saved_at', { ascending: false }).limit(PIECE_LIMIT).returns<CanvasRow[]>();
    if (error) throw refusal(error, 'STREAM ART COULD NOT BE READ.');
    const canvases = (data ?? []).map(toCanvas);
    if (canvases.length === 0) return [];
    const snapshots = await client
      .from(SNAPSHOTS)
      .select(SNAPSHOT_COLUMNS)
      .in(
        'canvas_id',
        canvases.map((canvas) => canvas.id),
      )
      .order('taken_at', { ascending: true })
      .limit(SNAPSHOT_LIMIT)
      .returns<SnapshotRow[]>();
    if (snapshots.error) throw refusal(snapshots.error, 'STREAM ART COULD NOT BE READ.');
    const byCanvas = new Map<string, SnapshotRow[]>();
    for (const row of snapshots.data ?? []) byCanvas.set(row.canvas_id, [...(byCanvas.get(row.canvas_id) ?? []), row]);
    const latestRows = canvases.flatMap((canvas) => {
      const rows = byCanvas.get(canvas.id) ?? [];
      return rows.length === 0 ? [] : [rows[rows.length - 1]];
    });
    const urls = await this.signed(latestRows.map((row) => row.path));
    return canvases.map((canvas) => {
      const rows = byCanvas.get(canvas.id) ?? [];
      const last = rows[rows.length - 1];
      const shots = rows.map((row) => toSnapshot(row, null));
      return {
        canvas,
        latest: last === undefined ? null : toSnapshot(last, urls.get(last.path) ?? null),
        snapshotCount: rows.length,
        participants: participantsOf(canvas.hostId, shots),
      };
    });
  }

  async setHidden(canvasId: string, hidden: boolean): Promise<void> {
    const { error } = await this.client().rpc('room_canvas_hide', { canvas: canvasId, hide: hidden });
    if (error) throw refusal(error, 'THAT DID NOT WORK.');
  }

  joinWire(roomId: string, onMessage: (message: CanvasWireMessage) => void): CanvasWire {
    const client = getSupabaseBrowserClient();
    if (client === null) return { send: () => undefined, leave: () => undefined };
    // Every tab in the room must share the topic, so it cannot carry a serial; the client hands back a channel it
    // still holds for that topic (a quick close and reopen), so the old one is let go first.
    const topic = `canvas:${roomId}`;
    let channel: RealtimeChannel | null = null;
    let left = false;
    const stale = client.getChannels().filter((held) => held.topic === `realtime:${topic}`);
    void Promise.all(stale.map((held) => client.removeChannel(held))).then(() => {
      if (left) return;
      // Private: only signed-in, unbanned people hear or send on it, and only while the room is live (the
      // realtime.messages policies in 20261103205948_stream-art-safety.sql).
      channel = client.channel(topic, { config: { broadcast: { self: false }, private: true } });
      channel.on('broadcast', { event: 'canvas' }, ({ payload }) => onMessage(payload as CanvasWireMessage));
      channel.subscribe();
    });
    return {
      send: (message) => {
        if (channel !== null) void channel.send({ type: 'broadcast', event: 'canvas', payload: message });
      },
      leave: () => {
        left = true;
        if (channel !== null) void client.removeChannel(channel);
      },
    };
  }
}

let repository: SupabaseCanvasRepository | null = null;

export function getSupabaseCanvasRepository(): CanvasRepository {
  if (repository === null) repository = new SupabaseCanvasRepository();
  return repository;
}
