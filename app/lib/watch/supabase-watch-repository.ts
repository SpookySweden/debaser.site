import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { AddSeriesInput, AddToQueueInput, OpenMusicRoomInput, OpenRoomInput, PlayNowInput, PlaybackPatch, RoomChange, RoomMembership, RoomSettingsInput, SendMessageInput, WatchRepository } from './repository';
import { isLinkKind, queueRefusal } from './links';
import { MUSIC_ROOM_GONE_SECONDS, goPublicPlan } from './music-rooms';
import { NOT_ALLOWED, hasCrown, nextPlayIndex, nextQueuePosition, watchClockSkewMs } from './rules';
import type { LiveRoom, QueueMove, StreamFold, WatchCrown, WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Stream rooms on Supabase (supabase/migrations/20261027120000_watch_rooms.sql; additions and crowns,
 * 20261102192043_watch_queue_additions.sql; series, 20261102224336_watch_queue_series.sql; music rooms and
 * songs, 20261103140000_music_rooms.sql).
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
const CROWNS = 'watch_crowns';

const ROOM_COLUMNS =
  'id, original_host_id, original_host_label, host_id, forum_thread_id, current_entry_id, position_seconds, is_playing, started_at, updated_at, ended_at, origin, is_public, cleared_at, name, topic, add_mode';
const QUEUE_COLUMNS =
  'id, room_id, position, in_queue, media_item_id, source_url, source_kind, source_title, series_id, series_title, series_episode, added_by, added_at, played_at, play_index';
const MESSAGE_COLUMNS = 'id, room_id, queue_entry_id, media_item_id, author_id, author_label, body, media_seconds, created_at';
const CROWN_COLUMNS = 'room_id, user_id, given_by, given_at';

/** Enough for a long night; the window draws the newest of them. */
const MESSAGE_LIMIT = 1000;
/**
 * A room's queue is read in pages of this many rows (the API's own most per answer), however long it is: a series
 * adds a row per episode and has no cap (SPEC-stream-series.md). A series is written in batches of the same size.
 */
const QUEUE_PAGE = 1000;
/**
 * A series is written as one statement but heard as one event per episode row, and a long one is a burst Realtime
 * may thin out. So the feed applies each row as it comes and, this long after the last of a burst, reads the room
 * once more: whatever was dropped is drawn then.
 */
const BURST_REREAD_MS = 800;
const FOLD_ROOM_LIMIT = 200;
/** The QUEUES list reads the rooms again at most this often while hosts' heartbeats come in. */
const LIVE_ROOMS_SETTLE_MS = 4000;

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
  origin?: string | null;
  is_public?: boolean | null;
  cleared_at?: string | null;
  name?: string | null;
  topic?: string | null;
  add_mode?: string | null;
};

type QueueRow = {
  id: string;
  room_id: string;
  position: number;
  in_queue?: boolean;
  media_item_id: string | null;
  source_url: string | null;
  source_kind: string | null;
  source_title: string | null;
  series_id?: string | null;
  series_title?: string | null;
  series_episode?: number | null;
  added_by: string | null;
  added_at: string;
  played_at: string | null;
  play_index: number | null;
};

type CrownRow = {
  room_id: string;
  user_id: string;
  given_by: string | null;
  given_at: string;
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
    origin: row.origin === 'music' ? 'music' : 'stream',
    isPublic: row.is_public !== false,
    clearedAt: row.cleared_at ?? null,
    name: row.name ?? null,
    topic: row.topic ?? null,
    addMode: row.add_mode === 'crowns' ? 'crowns' : 'anyone',
  };
}

/** A song or video row as GO PUBLIC writes it. */
function linkRow(roomId: string, link: WatchLink, addedBy: string, over: Record<string, unknown>): Record<string, unknown> {
  return { room_id: roomId, source_url: link.url, source_kind: link.kind, source_title: link.title, added_by: addedBy, ...over };
}

function toEntry(row: QueueRow): WatchQueueEntry {
  return {
    id: row.id,
    roomId: row.room_id,
    position: row.position,
    // Every row from before additions existed was in the queue.
    inQueue: row.in_queue !== false,
    mediaItemId: row.media_item_id,
    link:
      row.source_url !== null && isLinkKind(row.source_kind) ? { url: row.source_url, kind: row.source_kind, title: row.source_title ?? row.source_url } : null,
    series:
      typeof row.series_id === 'string' && typeof row.series_title === 'string' && typeof row.series_episode === 'number'
        ? { id: row.series_id, title: row.series_title, episode: row.series_episode }
        : null,
    addedBy: row.added_by,
    addedAt: row.added_at,
    playedAt: row.played_at,
    playIndex: row.play_index,
  };
}

function toCrown(row: CrownRow): WatchCrown {
  return { roomId: row.room_id, userId: row.user_id, givenBy: row.given_by, givenAt: row.given_at };
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
  if (error?.code === '42501' || /row-level security/i.test(error?.message ?? '')) return new Error(NOT_ALLOWED);
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
    const [room, queue, messages, crowns] = await Promise.all([
      client.from(ROOMS).select(ROOM_COLUMNS).eq('id', roomId).maybeSingle<RoomRow>(),
      this.readQueue(client, roomId),
      client.from(MESSAGES).select(MESSAGE_COLUMNS).eq('room_id', roomId).order('created_at', { ascending: false }).limit(MESSAGE_LIMIT),
      client.from(CROWNS).select(CROWN_COLUMNS).eq('room_id', roomId).limit(200),
    ]);

    if (room.error || queue === null || messages.error || crowns.error) throw new Error('THE STREAM COULD NOT BE READ.');
    if (room.data === null) return null;

    return {
      room: toRoom(room.data),
      queue: queue.map(toEntry),
      messages: ((messages.data ?? []) as MessageRow[]).map(toMessage).reverse(),
      crowns: ((crowns.data ?? []) as CrownRow[]).map(toCrown),
    };
  }

  /** Every queue row of a room, page by page (`QUEUE_PAGE`); null when a page failed. Ordered by id so pages never overlap. */
  private async readQueue(client: SupabaseClient, roomId: string): Promise<QueueRow[] | null> {
    // Pages are separate reads: a row added or taken out between two may show twice or be missed. Each is kept
    // once; a missed one arrives by the feed.
    const rows = new Map<string, QueueRow>();
    for (let from = 0; ; from += QUEUE_PAGE) {
      const page = await client.from(QUEUE).select(QUEUE_COLUMNS).eq('room_id', roomId).order('id').range(from, from + QUEUE_PAGE - 1);
      if (page.error) return null;
      const got = (page.data ?? []) as QueueRow[];
      for (const row of got) rows.set(row.id, row);
      if (got.length < QUEUE_PAGE) return [...rows.values()];
    }
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

    // The database crowned the host as the room was written (`watch_rooms_crown_host`).
    const crown: WatchCrown = { roomId: input.id, userId: input.host.id, givenBy: input.host.id, givenAt: room.data.started_at };
    // Empty (GO LIVE on CYTUBE): nothing on screen, the screen black until something is queued.
    if (input.mediaItemId === null) return { room: toRoom(room.data), queue: [], messages: [], crowns: [crown] };

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

    return { room: toRoom(live.data), queue: [toEntry(entry.data)], messages: [], crowns: [crown] };
  }

  async findMusicRoom(hostId: string): Promise<WatchRoom | null> {
    const { data, error } = await requireClient()
      .from(ROOMS)
      .select(ROOM_COLUMNS)
      .eq('original_host_id', hostId)
      .eq('origin', 'music')
      .maybeSingle<RoomRow>();
    if (error) throw refused(error, 'YOUR MUSIC ROOM COULD NOT BE READ.');
    return data === null ? null : toRoom(data);
  }

  async openMusicRoom(input: OpenMusicRoomInput): Promise<WatchRoomRead> {
    for (const link of [...(input.playing === null ? [] : [input.playing]), ...input.upNext]) {
      const refusal = queueRefusal(link);
      if (refusal !== null) throw new Error(refusal);
    }
    const client = requireClient();
    const failed = 'YOUR MUSIC ROOM COULD NOT OPEN.';

    let room = await this.findMusicRoom(input.host.id);
    if (room === null) {
      // The database crowns the host as the room is written (`watch_rooms_crown_host`).
      const made = await client
        .from(ROOMS)
        .insert({
          id: input.id,
          original_host_id: input.host.id,
          original_host_label: input.host.label.slice(0, 80) || 'Unknown',
          host_id: input.host.id,
          origin: 'music',
          is_public: true,
          position_seconds: 0,
          is_playing: false,
        })
        .select(ROOM_COLUMNS)
        .single<RoomRow>();
      if (made.error) throw refused(made.error, failed);
      room = toRoom(made.data);
    }

    const read = await this.readRoom(room.id);
    if (read === null) throw new Error(failed);
    const current = read.queue.find((entry) => entry.id === read.room.currentEntryId);
    const plan = goPublicPlan(read.queue, current, input.playing, input.upNext);
    let currentEntryId = read.room.currentEntryId;

    if (plan.slot !== null) {
      // Already playing: only the host files a played row (`watch_queue_plays_by_host`).
      const slotted = await client
        .from(QUEUE)
        .insert(linkRow(room.id, plan.slot, input.host.id, { position: nextQueuePosition(read.queue), played_at: new Date().toISOString(), play_index: nextPlayIndex(read.queue) }))
        .select(QUEUE_COLUMNS)
        .single<QueueRow>();
      if (slotted.error) throw refused(slotted.error, failed);
      currentEntryId = slotted.data.id;
    }

    if (plan.append.length > 0) {
      // Without their own crown the host's up-next waits on their list, like anybody's.
      const crowned = hasCrown(read.crowns, input.host.id);
      const start = nextQueuePosition(read.queue) + (plan.slot === null ? 0 : 1);
      const rows = plan.append.map((link, index) => linkRow(room.id, link, input.host.id, { position: start + index, in_queue: crowned }));
      for (let at = 0; at < rows.length; at += QUEUE_PAGE) {
        const { error } = await client.from(QUEUE).insert(rows.slice(at, at + QUEUE_PAGE));
        if (error) throw refused(error, failed);
      }
    }

    const opened = await client
      .from(ROOMS)
      .update({
        current_entry_id: currentEntryId,
        position_seconds: input.playing !== null ? Math.max(0, Math.round(input.positionSeconds * 1000) / 1000) : read.room.positionSeconds,
        is_playing: input.isPlaying && currentEntryId !== null,
        is_public: true,
      })
      .eq('id', room.id);
    if (opened.error) throw refused(opened.error, failed);

    const after = await this.readRoom(room.id);
    if (after === null) throw new Error(failed);
    return after;
  }

  async setRoomPublic(roomId: string, isPublic: boolean): Promise<void> {
    const patch = isPublic ? { is_public: true } : { is_public: false, is_playing: false };
    const { error } = await requireClient().from(ROOMS).update(patch).eq('id', roomId).eq('origin', 'music');
    if (error) throw refused(error, 'THAT DID NOT SAVE.');
  }

  /** Through the database's own function, which checks the host or a crown and writes these three fields only. */
  async saveRoomSettings(input: RoomSettingsInput): Promise<void> {
    const { error } = await requireClient().rpc('watch_room_settings', { room: input.roomId, new_name: input.name, new_topic: input.topic, new_add_mode: input.addMode });
    if (error) throw refused(error, 'THE SETTINGS DID NOT SAVE.');
  }

  async playNow(input: PlayNowInput): Promise<WatchQueueEntry> {
    const refusal = queueRefusal(input.link);
    if (refusal !== null) throw new Error(refusal);
    const { data, error } = await requireClient()
      .from(QUEUE)
      .insert(linkRow(input.roomId, input.link, input.by, { position: input.position, played_at: new Date().toISOString(), play_index: input.playIndex }))
      .select(QUEUE_COLUMNS)
      .single<QueueRow>();
    if (error) throw refused(error, 'IT COULD NOT BE PLAYED IN THE ROOM.');
    await this.writePlayback(input.roomId, { currentEntryId: data.id, positionSeconds: 0, isPlaying: true });
    return toEntry(data);
  }

  async clearRoomQueue(roomId: string, by: string): Promise<void> {
    const client = requireClient();
    // The host's alone, as the mock says it: a room write anybody else makes matches no row (RLS) rather than failing,
    // so it is asked first, before anything is taken out.
    const marked = await client.from(ROOMS).update({ cleared_at: new Date().toISOString() }).eq('id', roomId).eq('host_id', by).select('id');
    if (marked.error) throw refused(marked.error, 'THE QUEUE COULD NOT BE CLEARED.');
    if ((marked.data ?? []).length === 0) throw new Error(NOT_ALLOWED);
    // A crown's to take out (RLS); the host without their crown only starts the window blank.
    const crowned = await client.from(CROWNS).select('user_id').eq('room_id', roomId).eq('user_id', by).limit(1);
    if (crowned.error) throw refused(crowned.error, 'THE QUEUE COULD NOT BE CLEARED.');
    if ((crowned.data ?? []).length > 0) {
      const { error } = await client.from(QUEUE).delete().eq('room_id', roomId).eq('in_queue', true).is('played_at', null);
      if (error) throw refused(error, 'THE QUEUE COULD NOT BE CLEARED.');
    }
  }

  async listLiveRooms(): Promise<LiveRoom[]> {
    const client = requireClient();
    // Quiet rooms are left to the list's own rule (`listedRooms`); past half an hour none is listed.
    const since = new Date(Date.now() - watchClockSkewMs() - MUSIC_ROOM_GONE_SECONDS * 1000).toISOString();
    const rooms = await client.from(ROOMS).select(ROOM_COLUMNS).is('ended_at', null).gte('updated_at', since).order('updated_at', { ascending: false }).limit(100);
    if (rooms.error) throw refused(rooms.error, 'THE ROOMS COULD NOT BE READ.');
    const found = (rooms.data as RoomRow[]).map(toRoom);
    const ids = found.flatMap((room) => (room.currentEntryId === null ? [] : [room.currentEntryId]));
    const entries = ids.length === 0 ? { data: [] as QueueRow[], error: null } : await client.from(QUEUE).select(QUEUE_COLUMNS).in('id', ids);
    if (entries.error) throw refused(entries.error, 'THE ROOMS COULD NOT BE READ.');
    const byId = new Map((entries.data as QueueRow[]).map((row) => [row.id, toEntry(row)]));
    return found.map((room) => ({ room, current: room.currentEntryId === null ? null : (byId.get(room.currentEntryId) ?? null) }));
  }

  subscribeLiveRooms(listener: () => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;
    // Every host's heartbeat is a room write, every few seconds: the list is told at most once a few seconds.
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (waiting !== null) return;
      waiting = setTimeout(() => {
        waiting = null;
        listener();
      }, LIVE_ROOMS_SETTLE_MS);
    };
    const channel = client
      .channel(`watch-rooms:${(channelSerial += 1)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: ROOMS }, soon)
      .subscribe();
    return () => {
      if (waiting !== null) clearTimeout(waiting);
      void client.removeChannel(channel);
    };
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

  async addToQueue(input: AddToQueueInput): Promise<WatchQueueEntry> {
    const refusal = input.link === undefined ? null : queueRefusal(input.link);
    if (refusal !== null) throw new Error(refusal);
    const { data, error } = await requireClient()
      .from(QUEUE)
      .insert({
        room_id: input.roomId,
        media_item_id: input.mediaItemId ?? null,
        source_url: input.link?.url ?? null,
        source_kind: input.link?.kind ?? null,
        source_title: input.link?.title ?? null,
        added_by: input.addedBy,
        position: input.position,
        in_queue: input.inQueue === true,
      })
      .select(QUEUE_COLUMNS)
      .single<QueueRow>();
    if (error) throw refused(error, 'THE FILE COULD NOT BE ADDED.');
    return toEntry(data);
  }

  async addSeriesToQueue(input: AddSeriesInput): Promise<WatchQueueEntry[]> {
    for (const link of input.links) {
      const refusal = queueRefusal(link);
      if (refusal !== null) throw new Error(refusal);
    }
    const title = input.seriesTitle.replace(/\s+/g, ' ').trim().slice(0, 200).trim();
    if (input.links.length === 0 || title.length === 0) throw new Error('NOTHING TICKED.');
    const client = requireClient();
    // The block's id is made here, so every batch of one add names the same series.
    const seriesId = crypto.randomUUID();
    const rows = input.links.map((link, index) => ({
      room_id: input.roomId,
      source_url: link.url,
      source_kind: link.kind,
      source_title: link.title,
      series_id: seriesId,
      series_title: title,
      series_episode: index + 1,
      added_by: input.addedBy,
      position: input.position,
      in_queue: input.inQueue === true,
    }));
    const written: WatchQueueEntry[] = [];
    for (let at = 0; at < rows.length; at += QUEUE_PAGE) {
      const { data, error } = await client.from(QUEUE).insert(rows.slice(at, at + QUEUE_PAGE)).select(QUEUE_COLUMNS);
      if (error) {
        // Nothing half added: the batches already written go again.
        if (written.length > 0) await client.from(QUEUE).delete().eq('series_id', seriesId).is('played_at', null);
        throw refused(error, 'THE SERIES COULD NOT BE ADDED.');
      }
      written.push(...((data ?? []) as QueueRow[]).map(toEntry));
    }
    return written;
  }

  /** Whether a series still has an episode that has not played (so a write that reached none of it was refused). */
  private async seriesUnplayed(seriesId: string): Promise<boolean> {
    const { data, error } = await requireClient().from(QUEUE).select('id').eq('series_id', seriesId).is('played_at', null).limit(1);
    return error !== null || (data ?? []).length > 0;
  }

  async removeSeries(seriesId: string): Promise<void> {
    const { data, error } = await requireClient().from(QUEUE).delete().eq('series_id', seriesId).is('played_at', null).select('id');
    if (error) throw refused(error, 'THE SERIES COULD NOT BE TAKEN OUT.');
    // None back: refused, or every episode played a moment ago. Only a refusal leaves one unplayed.
    if ((data ?? []).length === 0 && (await this.seriesUnplayed(seriesId))) throw new Error(NOT_ALLOWED);
  }

  // A row the rules hide from a write is left alone without an error, so each write asks for its rows back:
  // none back is a refusal (`by` is the mock's; the database knows who asks).
  async removeFromQueue(entryId: string): Promise<void> {
    const { data, error } = await requireClient().from(QUEUE).delete().eq('id', entryId).is('played_at', null).select('id');
    if (error) throw refused(error, 'THE FILE COULD NOT BE TAKEN OUT.');
    if ((data ?? []).length === 0) throw new Error(NOT_ALLOWED);
  }

  async reorderQueue(moves: QueueMove[]): Promise<void> {
    const client = requireClient();
    const results = await Promise.all(
      moves.map((move) => {
        const update = client.from(QUEUE).update(move.pull === true ? { position: move.position, in_queue: true } : { position: move.position });
        // A series move is one write for every episode of that add not yet played.
        return (move.series === true ? update.eq('series_id', move.id).is('played_at', null) : update.eq('id', move.id)).select('id');
      }),
    );
    const failed = results.find((result) => result.error !== null);
    if (failed !== undefined) throw refused(failed.error, 'THE QUEUE COULD NOT BE REORDERED.');
    for (const [index, result] of results.entries()) {
      if ((result.data ?? []).length > 0) continue;
      // A series whose last queued episode started a moment ago has nothing left to move: not a refusal.
      const move = moves[index];
      if (move.series === true && !(await this.seriesUnplayed(move.id))) continue;
      throw new Error(NOT_ALLOWED);
    }
  }

  async setCrown(roomId: string, userId: string, crowned: boolean, by: string): Promise<WatchCrown | null> {
    const client = requireClient();
    if (!crowned) {
      const { error } = await client.from(CROWNS).delete().eq('room_id', roomId).eq('user_id', userId);
      if (error) throw refused(error, 'THE CROWN COULD NOT BE TAKEN.');
      return null;
    }
    const { data, error } = await client.from(CROWNS).insert({ room_id: roomId, user_id: userId, given_by: by }).select(CROWN_COLUMNS).single<CrownRow>();
    // Already crowned (two presses, or the host's own at GO LIVE): the crown they hold is the answer.
    if (error?.code === '23505') return { roomId, userId, givenBy: by, givenAt: new Date().toISOString() };
    if (error) throw refused(error, 'THE CROWN COULD NOT BE GIVEN.');
    return toCrown(data);
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

    let reread: ReturnType<typeof setTimeout> | null = null;
    let deletes = 0;
    const settle = () => {
      if (reread !== null) clearTimeout(reread);
      reread = setTimeout(() => {
        reread = null;
        deletes = 0;
        onChange({ kind: 'refresh' });
      }, BURST_REREAD_MS);
    };
    const queueRow = (row: QueueRow) => {
      onChange({ kind: 'entry', entry: toEntry(row) });
      if (typeof row.series_id === 'string') settle();
    };

    const channel = client
      .channel(`watch-db:${roomId}:${(channelSerial += 1)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ROOMS, filter: `id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'room', room: toRoom(payload.new as RoomRow) });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: QUEUE, filter: `room_id=eq.${roomId}` }, (payload) => queueRow(payload.new as QueueRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: QUEUE, filter: `room_id=eq.${roomId}` }, (payload) => queueRow(payload.new as QueueRow))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: MESSAGES, filter: `room_id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'message', message: toMessage(payload.new as MessageRow) });
      })
      // Deletes cannot be filtered by column, and carry only the id: the receiver drops it if it has it.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: QUEUE }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (typeof id === 'string') onChange({ kind: 'removed', table: 'queue', id });
        // Only the id comes, so a series taken out is told by its burst: two or more at once, read again after.
        deletes += 1;
        if (deletes >= 2) settle();
        else if (reread === null) setTimeout(() => (deletes = Math.max(0, deletes - 1)), BURST_REREAD_MS);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: MESSAGES }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (typeof id === 'string') onChange({ kind: 'removed', table: 'messages', id });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: CROWNS, filter: `room_id=eq.${roomId}` }, (payload) => {
        onChange({ kind: 'crown', crown: toCrown(payload.new as CrownRow) });
      })
      // A crown's key is the room and the person, so its delete says which room it was in.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: CROWNS }, (payload) => {
        const old = payload.old as { room_id?: string; user_id?: string };
        if (old.room_id === roomId && typeof old.user_id === 'string') onChange({ kind: 'uncrowned', userId: old.user_id });
      })
      .subscribe((status) => {
        // A (re)join may have missed writes: read the room again.
        if (status === 'SUBSCRIBED') onChange({ kind: 'refresh' });
      });

    return () => {
      if (reread !== null) clearTimeout(reread);
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

    // The join is stamped by the database's clock (`watch_now`), not this machine's: "here longest" decides
    // who hosts next, and a slow clock must not jump the queue. A failed ask falls back to this clock
    // corrected by the skew read off the room's own writes.
    const stamped = Promise.resolve(client.rpc('watch_now'))
      .then(({ data, error }) => {
        const at = error === null && typeof data === 'string' ? Date.parse(data) : Number.NaN;
        self.joinedAt = Number.isFinite(at) ? at : Date.now() - watchClockSkewMs();
      })
      .catch(() => {
        self.joinedAt = Date.now() - watchClockSkewMs();
      });
    void Promise.all([leavingTopics.get(topic), stamped]).then(join);
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
