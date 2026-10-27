import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { OpenRoomInput, PlaybackPatch, RoomChange, RoomMembership, SendMessageInput, WatchRepository } from './repository';
import type { StreamFold, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Stream rooms on Supabase (supabase/migrations/20261027120000_watch_rooms.sql).
 *
 * The tables hold the record; Realtime Presence holds who is there. Each room has its own presence
 * channel (`watch:<id>`, keyed per tab), and every tab in a live room also says so on one site-wide
 * channel (`site-watching`), which is what the directory's `[ TV ]` key reads. Joining and leaving a
 * channel reaches other tabs in about a second; a change to what a tab already said rides Supabase's
 * slower relay (about six seconds, see HANDOFF), so only the key's tip waits on that.
 *
 * Who may write what is the database's business (RLS, the guard trigger and the two functions);
 * the store only says a refusal in words fit to show.
 */

const ROOMS = 'watch_rooms';
const QUEUE = 'watch_queue';
const MESSAGES = 'watch_messages';

const ROOM_COLUMNS =
  'id, original_host_id, original_host_label, host_id, forum_thread_id, current_entry_id, position_seconds, is_playing, started_at, updated_at, ended_at';
const QUEUE_COLUMNS = 'id, room_id, position, media_item_id, added_by, added_at, played_at, play_index';
const MESSAGE_COLUMNS = 'id, room_id, queue_entry_id, media_item_id, author_id, author_label, body, media_seconds, created_at';

/** Enough for a long night; the window draws the newest of them. */
const MESSAGE_LIMIT = 1000;
const FOLD_ROOM_LIMIT = 200;

type RoomRow = {
  id: string;
  original_host_id: string;
  original_host_label: string;
  host_id: string;
  forum_thread_id: string | null;
  current_entry_id: string | null;
  position_seconds: number | string;
  is_playing: boolean;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
};

type QueueRow = {
  id: string;
  room_id: string;
  position: number;
  media_item_id: string | null;
  added_by: string | null;
  added_at: string;
  played_at: string | null;
  play_index: number | null;
};

type MessageRow = {
  id: string;
  room_id: string;
  queue_entry_id: string | null;
  media_item_id: string | null;
  author_id: string;
  author_label: string;
  body: string;
  media_seconds: number | string;
  created_at: string;
};

function toRoom(row: RoomRow): WatchRoom {
  return {
    id: row.id,
    originalHostId: row.original_host_id,
    originalHostLabel: row.original_host_label,
    hostId: row.host_id,
    forumThreadId: row.forum_thread_id,
    currentEntryId: row.current_entry_id,
    positionSeconds: Number(row.position_seconds) || 0,
    isPlaying: row.is_playing,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

function toEntry(row: QueueRow): WatchQueueEntry {
  return {
    id: row.id,
    roomId: row.room_id,
    position: row.position,
    mediaItemId: row.media_item_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
    playedAt: row.played_at,
    playIndex: row.play_index,
  };
}

function toMessage(row: MessageRow): WatchMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    queueEntryId: row.queue_entry_id,
    mediaItemId: row.media_item_id,
    authorId: row.author_id,
    authorLabel: row.author_label,
    body: row.body,
    mediaSeconds: Number(row.media_seconds) || 0,
    createdAt: row.created_at,
  };
}

/** A refusal in plain words: no database message reaches the screen. */
function refused(error: { code?: string; message?: string } | null, fallback: string): Error {
  if (error?.code === '42501' || /row-level security/i.test(error?.message ?? '')) return new Error('NOT ALLOWED: THE STREAM MAY HAVE ENDED OR CHANGED HOST.');
  return new Error(fallback);
}

function requireClient(): SupabaseClient {
  const client = getSupabaseBrowserClient();
  if (client === null) throw new Error('STREAMS ARE OFFLINE.');
  return client;
}

/* --- the site-wide watching channel ------------------------------------------------------------- */

const WATCHING_TOPIC = 'site-watching';
const WATCHING_CLOSE_DELAY_MS = 1000;

const watchingListeners = new Set<(watching: WatchingMap | null) => void>();
let watchingChannel: RealtimeChannel | null = null;
let watchingJoined = false;
let watchingSnapshot: WatchingMap | null = null;
let watchingTracked: WatchingEntry | null = null;
let watchingCloseTimer: ReturnType<typeof setTimeout> | null = null;

function emitWatching(next: WatchingMap | null): void {
  watchingSnapshot = next;
  for (const listener of watchingListeners) listener(next);
}

function readWatchingEntry(meta: unknown): WatchingEntry | null {
  const row = meta as { user_id?: unknown; room_id?: unknown; host_name?: unknown; title?: unknown; hosting?: unknown };
  if (typeof row.user_id !== 'string' || typeof row.room_id !== 'string') return null;

  return {
    userId: row.user_id,
    roomId: row.room_id,
    hostName: typeof row.host_name === 'string' ? row.host_name : '',
    title: typeof row.title === 'string' ? row.title : '',
    hosting: row.hosting === true,
  };
}

function trackPayload(entry: WatchingEntry) {
  return { user_id: entry.userId, room_id: entry.roomId, host_name: entry.hostName, title: entry.title, hosting: entry.hosting };
}

function openWatchingChannel(): void {
  if (watchingCloseTimer !== null) {
    clearTimeout(watchingCloseTimer);
    watchingCloseTimer = null;
  }
  if (watchingChannel !== null) return;

  const client = getSupabaseBrowserClient();
  if (client === null) return;

  const channel = client.channel(WATCHING_TOPIC);
  channel.on('presence', { event: 'sync' }, () => {
    if (channel !== watchingChannel) return;
    const map: WatchingMap = {};
    for (const meta of Object.values(channel.presenceState()).flat()) {
      const entry = readWatchingEntry(meta);
      // A host's line wins over the same account's watching line in another tab.
      if (entry !== null && (map[entry.userId] === undefined || entry.hosting)) map[entry.userId] = entry;
    }
    emitWatching(map);
  });
  channel.subscribe((status) => {
    if (channel !== watchingChannel) return;
    if (status === 'SUBSCRIBED') {
      watchingJoined = true;
      if (watchingTracked !== null) void channel.track(trackPayload(watchingTracked)).catch(() => undefined);
      return;
    }
    watchingJoined = false;
    emitWatching(null);
  });
  watchingChannel = channel;
}

function scheduleWatchingClose(): void {
  if (watchingCloseTimer !== null) clearTimeout(watchingCloseTimer);

  watchingCloseTimer = setTimeout(() => {
    watchingCloseTimer = null;
    const client = getSupabaseBrowserClient();
    if (client === null || watchingChannel === null || watchingListeners.size > 0 || watchingTracked !== null) return;

    void client.removeChannel(watchingChannel);
    watchingChannel = null;
    watchingJoined = false;
    watchingSnapshot = null;
  }, WATCHING_CLOSE_DELAY_MS);
}

/* --- channel names ------------------------------------------------------------------------------- */

/**
 * The client hands back the channel already in its list for a topic, even one still being removed, so a
 * table feed takes a fresh name each time (a feed's name means nothing to the server) and a room's presence
 * - whose name is the room - waits for its own leave to finish (`leavingTopics`).
 */
let channelSerial = 0;
const leavingTopics = new Map<string, Promise<unknown>>();

/* --- the store ----------------------------------------------------------------------------------- */

class SupabaseWatchRepository implements WatchRepository {
  readonly source = 'supabase' as const;

  async readRoom(roomId: string): Promise<WatchRoomRead | null> {
    const client = requireClient();
    const [room, queue, messages] = await Promise.all([
      client.from(ROOMS).select(ROOM_COLUMNS).eq('id', roomId).maybeSingle<RoomRow>(),
      client.from(QUEUE).select(QUEUE_COLUMNS).eq('room_id', roomId).order('position').limit(500),
      client.from(MESSAGES).select(MESSAGE_COLUMNS).eq('room_id', roomId).order('created_at', { ascending: false }).limit(MESSAGE_LIMIT),
    ]);

    if (room.error || queue.error || messages.error) throw new Error('THE STREAM COULD NOT BE READ.');
    if (room.data === null) return null;

    return {
      room: toRoom(room.data),
      queue: ((queue.data ?? []) as QueueRow[]).map(toEntry),
      messages: ((messages.data ?? []) as MessageRow[]).map(toMessage).reverse(),
    };
  }

  async openRoom(input: OpenRoomInput): Promise<WatchRoomRead> {
    const client = requireClient();

    const room = await client
      .from(ROOMS)
      .insert({
        id: input.id,
        original_host_id: input.host.id,
        original_host_label: input.host.label.slice(0, 80) || 'Unknown',
        host_id: input.host.id,
        position_seconds: 0,
        is_playing: false,
      })
      .select(ROOM_COLUMNS)
      .single<RoomRow>();
    if (room.error) throw refused(room.error, 'THE STREAM COULD NOT START.');

    const entry = await client
      .from(QUEUE)
      .insert({ room_id: input.id, position: 0, media_item_id: input.mediaItemId, added_by: input.host.id, played_at: new Date().toISOString(), play_index: 0 })
      .select(QUEUE_COLUMNS)
      .single<QueueRow>();
    if (entry.error) throw refused(entry.error, 'THE STREAM COULD NOT START.');

    const live = await client
      .from(ROOMS)
      .update({ current_entry_id: entry.data.id, position_seconds: 0, is_playing: true })
      .eq('id', input.id)
      .select(ROOM_COLUMNS)
      .single<RoomRow>();
    if (live.error) throw refused(live.error, 'THE STREAM COULD NOT START.');

    return { room: toRoom(live.data), queue: [toEntry(entry.data)], messages: [] };
  }

  async attachThread(roomId: string, threadId: string): Promise<void> {
    const { error } = await requireClient().from(ROOMS).update({ forum_thread_id: threadId }).eq('id', roomId);
    if (error) throw refused(error, 'THE STREAM COULD NOT BE FILED.');
  }

  async writePlayback(roomId: string, patch: PlaybackPatch): Promise<void> {
    const { error } = await requireClient()
      .from(ROOMS)
      .update({
        current_entry_id: patch.currentEntryId,
        position_seconds: Math.max(0, Math.round(patch.positionSeconds * 1000) / 1000),
        is_playing: patch.isPlaying,
      })
      .eq('id', roomId);
    if (error) throw refused(error, 'THE STREAM COULD NOT BE UPDATED.');
  }

  async startEntry(roomId: string, entryId: string, playIndex: number): Promise<void> {
    const client = requireClient();
    const marked = await client
      .from(QUEUE)
      .update({ played_at: new Date().toISOString(), play_index: playIndex })
      .eq('id', entryId)
      .eq('room_id', roomId)
      .is('played_at', null);
    if (marked.error) throw refused(marked.error, 'THE NEXT FILE COULD NOT START.');

    await this.writePlayback(roomId, { currentEntryId: entryId, positionSeconds: 0, isPlaying: true });
  }

  async handOver(roomId: string, toUserId: string): Promise<void> {
    const { error } = await requireClient().from(ROOMS).update({ host_id: toUserId }).eq('id', roomId);
    if (error) throw refused(error, 'THE STREAM COULD NOT BE HANDED OVER.');
  }

  async takeOver(roomId: string, goneHostId: string): Promise<boolean> {
    const { data, error } = await requireClient().rpc('watch_take_over', { room: roomId, gone_host: goneHostId });
    return error === null && data === true;
  }

  async endRoom(roomId: string): Promise<void> {
    const { error } = await requireClient().from(ROOMS).update({ is_playing: false, ended_at: new Date().toISOString() }).eq('id', roomId);
    if (error) throw refused(error, 'THE STREAM COULD NOT BE ENDED.');
  }

  async closeStale(roomId: string): Promise<boolean> {
    const { data, error } = await requireClient().rpc('watch_close_stale', { room: roomId });
    return error === null && data === true;
  }

  async addToQueue(input: { roomId: string; mediaItemId: string; addedBy: string; position: number }): Promise<WatchQueueEntry> {
    const { data, error } = await requireClient()
      .from(QUEUE)
      .insert({ room_id: input.roomId, media_item_id: input.mediaItemId, added_by: input.addedBy, position: input.position })
      .select(QUEUE_COLUMNS)
      .single<QueueRow>();
    if (error) throw refused(error, 'THE FILE COULD NOT BE ADDED.');
    return toEntry(data);
  }

  async removeFromQueue(entryId: string): Promise<void> {
    const { error } = await requireClient().from(QUEUE).delete().eq('id', entryId).is('played_at', null);
    if (error) throw refused(error, 'THE FILE COULD NOT BE TAKEN OUT.');
  }

  async reorderQueue(moves: { id: string; position: number }[]): Promise<void> {
    const client = requireClient();
    const results = await Promise.all(moves.map((move) => client.from(QUEUE).update({ position: move.position }).eq('id', move.id)));
    const failed = results.find((result) => result.error !== null);
    if (failed !== undefined) throw refused(failed.error, 'THE QUEUE COULD NOT BE REORDERED.');
  }

  async sendMessage(input: SendMessageInput): Promise<WatchMessage> {
    const body = input.body.trim().slice(0, 500);
    if (body.length === 0) throw new Error('SAY SOMETHING FIRST.');

    const { data, error } = await requireClient()
      .from(MESSAGES)
      .insert({
        room_id: input.roomId,
        queue_entry_id: input.queueEntryId,
        media_item_id: input.mediaItemId,
        author_id: input.author.id,
        author_label: input.author.label.slice(0, 80) || 'Unknown',
        body,
        media_seconds: Math.max(0, Math.round(input.mediaSeconds * 10) / 10),
      })
      .select(MESSAGE_COLUMNS)
      .single<MessageRow>();
    if (error) throw refused(error, 'THE MESSAGE WAS NOT SENT.');
    return toMessage(data);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const { error } = await requireClient().from(MESSAGES).delete().eq('id', messageId);
    if (error) throw refused(error, 'THE MESSAGE COULD NOT BE DELETED.');
  }

  async listStreamFolds(mediaItemIds: string[]): Promise<Record<string, StreamFold[]>> {
    if (mediaItemIds.length === 0) return {};
    const client = requireClient();

    const plays = await client
      .from(QUEUE)
      .select('room_id, media_item_id')
      .in('media_item_id', mediaItemIds)
      .not('played_at', 'is', null)
      .order('played_at', { ascending: false })
      .limit(FOLD_ROOM_LIMIT * 4);
    if (plays.error) throw new Error('THE STREAM CHAT COULD NOT BE READ.');

    const playRows = (plays.data ?? []) as { room_id: string; media_item_id: string }[];
    const roomIds = [...new Set(playRows.map((row) => row.room_id))].slice(0, FOLD_ROOM_LIMIT);
    if (roomIds.length === 0) return {};

    const [rooms, messages] = await Promise.all([
      client.from(ROOMS).select(ROOM_COLUMNS).in('id', roomIds),
      client.from(MESSAGES).select(MESSAGE_COLUMNS).in('room_id', roomIds).in('media_item_id', mediaItemIds).order('created_at', { ascending: false }).limit(5000),
    ]);
    if (rooms.error || messages.error) throw new Error('THE STREAM CHAT COULD NOT BE READ.');

    const roomById = new Map(((rooms.data ?? []) as RoomRow[]).map((row) => [row.id, toRoom(row)]));
    // Read newest first so a limit drops the oldest lines; drawn oldest first.
    const said = ((messages.data ?? []) as MessageRow[]).map(toMessage).reverse();
    const out: Record<string, StreamFold[]> = {};

    for (const mediaId of mediaItemIds) {
      const ids = new Set(playRows.filter((row) => row.media_item_id === mediaId).map((row) => row.room_id));
      const folds = [...ids]
        .flatMap((id) => {
          const room = roomById.get(id);
          return room === undefined ? [] : [room];
        })
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((room) => ({ room, messages: said.filter((message) => message.roomId === room.id && message.mediaItemId === mediaId) }));
      if (folds.length > 0) out[mediaId] = folds;
    }

    return out;
  }

  subscribeRoom(roomId: string, onChange: (change: RoomChange) => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;

    const channel = client
      .channel(`watch-db:${roomId}:${(channelSerial += 1)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ROOMS, filter: `id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'room', room: toRoom(payload.new as RoomRow) });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: QUEUE, filter: `room_id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'entry', entry: toEntry(payload.new as QueueRow) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: QUEUE, filter: `room_id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'entry', entry: toEntry(payload.new as QueueRow) });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: MESSAGES, filter: `room_id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'message', message: toMessage(payload.new as MessageRow) });
      })
      // Deletes cannot be filtered by column, and carry only the id: the receiver drops it if it has it.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: QUEUE }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (typeof id === 'string') onChange({ kind: 'removed', table: 'queue', id });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: MESSAGES }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (typeof id === 'string') onChange({ kind: 'removed', table: 'messages', id });
      })
      .subscribe((status) => {
        // A (re)join may have missed writes: read the room again.
        if (status === 'SUBSCRIBED') onChange({ kind: 'refresh' });
      });

    return () => {
      void client.removeChannel(channel);
    };
  }

  subscribeStreamActivity(listener: () => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;

    // Plays and lines of chat, not the rooms: a live room is written every few seconds.
    const channel = client
      .channel(`watch-db-activity:${(channelSerial += 1)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: QUEUE }, () => listener())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: MESSAGES }, () => listener())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: MESSAGES }, () => listener())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }

  joinRoom(roomId: string, me: Omit<WatchMember, 'joinedAt'>, onMembers: (members: WatchMember[]) => void): RoomMembership {
    const client = getSupabaseBrowserClient();
    const self: WatchMember = { ...me, joinedAt: Date.now() };
    if (client === null) {
      onMembers([self]);
      return { leave: () => undefined };
    }

    let left = false;
    let channel: RealtimeChannel | null = null;
    const topic = `watch:${roomId}`;

    // Presence is per topic, so this channel cannot take a fresh name: a leave still in flight for the same
    // topic (a remount, guest -> signed in) is waited for, because the client hands back a channel that is
    // still in its list, and re-using one on its way out throws or never joins.
    const join = () => {
      if (left) return;
      const joined = client.channel(topic, { config: { presence: { key: self.key } } });
      channel = joined;
      joined.on('presence', { event: 'sync' }, () => {
      if (left) return;
      const members: WatchMember[] = [];
      for (const [key, metas] of Object.entries(joined.presenceState())) {
        const meta = metas[0] as { user_id?: unknown; name?: unknown; joined_at?: unknown } | undefined;
        if (meta === undefined) continue;
        members.push({
          key,
          userId: typeof meta.user_id === 'string' ? meta.user_id : null,
          name: typeof meta.name === 'string' ? meta.name : '',
          joinedAt: typeof meta.joined_at === 'number' ? meta.joined_at : Date.now(),
        });
      }
      if (!members.some((member) => member.key === self.key)) members.push(self);
      onMembers(members);
      });
      joined.subscribe((status) => {
        if (left) return;
        if (status === 'SUBSCRIBED') {
          void joined.track({ user_id: self.userId, name: self.name, joined_at: self.joinedAt }).catch(() => undefined);
        }
      });
    };

    const pending = leavingTopics.get(topic);
    if (pending === undefined) join();
    else void pending.then(join);
    onMembers([self]);

    return {
      leave: () => {
        if (left) return;
        left = true;
        if (channel === null) return;
        const removal = client
          .removeChannel(channel)
          .catch(() => undefined)
          .finally(() => {
            if (leavingTopics.get(topic) === removal) leavingTopics.delete(topic);
          });
        leavingTopics.set(topic, removal);
      },
    };
  }

  subscribeWatching(listener: (watching: WatchingMap | null) => void): () => void {
    watchingListeners.add(listener);
    openWatchingChannel();
    listener(watchingSnapshot);

    return () => {
      watchingListeners.delete(listener);
      if (watchingListeners.size === 0) scheduleWatchingClose();
    };
  }

  setWatching(entry: WatchingEntry | null): void {
    const was = watchingTracked;
    watchingTracked = entry;

    if (entry === null) {
      if (was !== null && watchingJoined && watchingChannel !== null) void watchingChannel.untrack().catch(() => undefined);
      if (watchingListeners.size === 0) scheduleWatchingClose();
      return;
    }

    openWatchingChannel();
    if (watchingJoined && watchingChannel !== null) void watchingChannel.track(trackPayload(entry)).catch(() => undefined);
  }
}

let supabaseWatchRepository: SupabaseWatchRepository | null = null;

export function getSupabaseWatchRepository(): WatchRepository {
  if (supabaseWatchRepository === null) supabaseWatchRepository = new SupabaseWatchRepository();
  return supabaseWatchRepository;
}
