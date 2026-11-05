import type { AddSeriesInput, AddToQueueInput, OpenMusicRoomInput, OpenRoomInput, PlayNowInput, PlaybackPatch, RoomChange, RoomMembership, RoomSettingsInput, SendMessageInput, WatchRepository } from './repository';
import { queueRefusal } from './links';
import { goPublicPlan } from './music-rooms';
import { NOT_ALLOWED, ROOM_NAME_MAX, ROOM_TOPIC_MAX, TAKE_OVER_QUIET_MS, cleanRoomWords, hasCrown, mayEditRoom, nextPlayIndex, nextQueuePosition } from './rules';
import type { LiveRoom, QueueMove, StreamFold, WatchCrown, WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Stream rooms in this browser only, like the other mocks: the three tables as one localStorage record,
 * and a BroadcastChannel so this browser's other tabs hear each write and each other's presence.
 *
 * Presence here is a tab saying "here" every second and a half; a tab silent for five seconds is gone.
 * The Supabase store gets the same answers from Realtime Presence, which hears a closed tab at once.
 * The rules the database keeps (only the host writes the room, a take-over only past a quiet host; only a
 * crown moves the queue, only the host crowns, and the host is crowned at GO LIVE and on every change of host)
 * are kept here by hand, so a check against the mock means the same as one against the tables.
 */

const KEY = 'debaser.watch.v1';
const WIRE = 'debaser-watch';
const BEAT_MS = 1500;
const GONE_MS = 5000;
const STALE_MS = 3 * 60 * 1000;

type Tables = { rooms: WatchRoom[]; queue: WatchQueueEntry[]; messages: WatchMessage[]; crowns: WatchCrown[] };

let memory: Tables = { rooms: [], queue: [], messages: [], crowns: [] };

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage !== undefined;
  } catch {
    return false;
  }
}

function load(): Tables {
  if (!hasStorage()) return memory;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return memory;
    const parsed = JSON.parse(raw) as Partial<Tables>;

    return {
      // Rooms stored before music rooms were all public streams, never cleared.
      rooms: Array.isArray(parsed.rooms)
        ? parsed.rooms.map((room) => ({ ...room, origin: room.origin ?? 'stream', isPublic: room.isPublic ?? true, clearedAt: room.clearedAt ?? null, name: room.name ?? null, topic: room.topic ?? null, addMode: room.addMode ?? 'anyone' }))
        : [],
      // Rows stored before links existed have no `link`; rows from before additions were all in the queue.
      queue: Array.isArray(parsed.queue) ? parsed.queue.map((entry) => ({ ...entry, link: entry.link ?? null, inQueue: entry.inQueue ?? true, series: entry.series ?? null })) : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      crowns: Array.isArray(parsed.crowns) ? parsed.crowns : [],
    };
  } catch {
    return memory;
  }
}

/** A clock that never repeats a stamp, so two writes in one millisecond still order. */
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* --- the wire ------------------------------------------------------------------------------------ */

type WireMessage =
  | { type: 'changed'; roomId: string | null }
  | { type: 'here'; roomId: string; member: WatchMember }
  | { type: 'hello'; roomId: string }
  | { type: 'bye'; roomId: string; key: string }
  | { type: 'watching'; key: string; entry: WatchingEntry }
  | { type: 'watching-hello' }
  | { type: 'watching-bye'; key: string };

let wire: BroadcastChannel | null = null;
const wireListeners = new Set<(message: WireMessage) => void>();

function openWire(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (wire === null) {
    wire = new BroadcastChannel(WIRE);
    wire.onmessage = (event: MessageEvent<WireMessage>) => {
      for (const listener of wireListeners) listener(event.data);
    };
  }
  return wire;
}

function send(message: WireMessage): void {
  openWire()?.postMessage(message);
}

function onWire(listener: (message: WireMessage) => void): () => void {
  openWire();
  wireListeners.add(listener);
  return () => {
    wireListeners.delete(listener);
  };
}

/** This tab's own listeners: the wire does not echo to its sender. */
const localListeners = new Set<(roomId: string | null) => void>();

function save(tables: Tables, roomId: string | null): void {
  memory = tables;
  if (hasStorage()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(tables));
    } catch {
      // Storage full or blocked: this session keeps the copy in memory.
    }
  }
  for (const listener of localListeners) listener(roomId);
  send({ type: 'changed', roomId });
}

function changeRoom(roomId: string, change: (room: WatchRoom) => WatchRoom | null): void {
  const tables = load();
  const room = tables.rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined) throw new Error('NO SUCH STREAM.');
  if (room.endedAt !== null) throw new Error('THE STREAM HAS ENDED.');

  const changed = change(room);
  if (changed === null) return;
  // As the database's `watch_rooms_guard`: a room keeps its origin; a music room keeps its host and is never
  // ended; a stream room is always public.
  const next: WatchRoom =
    room.origin === 'music'
      ? { ...changed, origin: room.origin, hostId: room.hostId, endedAt: null }
      : { ...changed, origin: room.origin, isPublic: true };
  // A new host is crowned at once, as the database's `watch_rooms_crown_host` does it.
  const crowns = next.hostId === room.hostId ? tables.crowns : withCrown(tables.crowns, crownFor(roomId, next.hostId, room.hostId));
  save({ ...tables, crowns, rooms: tables.rooms.map((candidate) => (candidate.id === roomId ? { ...next, updatedAt: stamp() } : candidate)) }, roomId);
}

function crownFor(roomId: string, userId: string, givenBy: string): WatchCrown {
  return { roomId, userId, givenBy, givenAt: stamp() };
}

/** The crowns with this one added, unless that person already holds one in that room. */
function withCrown(crowns: WatchCrown[], crown: WatchCrown): WatchCrown[] {
  return crowns.some((held) => held.roomId === crown.roomId && held.userId === crown.userId) ? crowns : [...crowns, crown];
}

/** A live room and its crowns, or a refusal for an ended or missing one. */
function liveRoom(tables: Tables, roomId: string): { room: WatchRoom; crowns: WatchCrown[] } {
  const room = tables.rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined || room.endedAt !== null) throw new Error('THE STREAM HAS ENDED.');
  return { room, crowns: tables.crowns.filter((crown) => crown.roomId === roomId) };
}

/** A music room switched off is its host's alone: nobody else adds to it or talks in it (the database's rule too). */
function refuseIfShut(room: WatchRoom, userId: string): void {
  if (!room.isPublic && room.hostId !== userId) throw new Error(NOT_ALLOWED);
}

/** WHO CAN ADD on CROWNS ONLY: nobody else adds (the database's rule too). Chat stays open. */
function refuseIfCrownsOnly(room: WatchRoom, crowns: WatchCrown[], userId: string): void {
  if (room.addMode === 'crowns' && room.hostId !== userId && !hasCrown(crowns, userId)) throw new Error(NOT_ALLOWED);
}

/** A queue row as GO PUBLIC writes it. */
function songRow(roomId: string, link: WatchLink, over: Partial<WatchQueueEntry>): WatchQueueEntry {
  return { id: newId(), roomId, position: 0, inQueue: true, mediaItemId: null, link, series: null, addedBy: null, addedAt: stamp(), playedAt: null, playIndex: null, ...over };
}

/* --- the watching room (the `[ TV ]` key) ------------------------------------------------------- */

const tabKey = newId();
let myWatching: WatchingEntry | null = null;
let watchingBeat: ReturnType<typeof setInterval> | null = null;
const othersWatching = new Map<string, { entry: WatchingEntry; seen: number }>();
const watchingListeners = new Set<(watching: WatchingMap | null) => void>();
let watchingWired = false;

function watchingMap(): WatchingMap {
  const now = Date.now();
  const map: WatchingMap = {};
  for (const [key, { entry, seen }] of othersWatching) {
    if (now - seen > GONE_MS) othersWatching.delete(key);
    else map[entry.userId] = entry;
  }
  if (myWatching !== null) map[myWatching.userId] = myWatching;
  return map;
}

function emitWatching(): void {
  const map = watchingMap();
  for (const listener of watchingListeners) listener(map);
}

function wireWatching(): void {
  if (watchingWired) return;
  watchingWired = true;
  onWire((message) => {
    if (message.type === 'watching') {
      othersWatching.set(message.key, { entry: message.entry, seen: Date.now() });
      emitWatching();
    } else if (message.type === 'watching-bye') {
      othersWatching.delete(message.key);
      emitWatching();
    } else if (message.type === 'watching-hello' && myWatching !== null) {
      send({ type: 'watching', key: tabKey, entry: myWatching });
    }
  });
  if (typeof window !== 'undefined') {
    setInterval(() => emitWatching(), GONE_MS);
    window.addEventListener('pagehide', () => {
      if (myWatching !== null) send({ type: 'watching-bye', key: tabKey });
    });
  }
  send({ type: 'watching-hello' });
}

/* --- the store ----------------------------------------------------------------------------------- */

class MockWatchRepository implements WatchRepository {
  readonly source = 'mock' as const;

  async readRoom(roomId: string): Promise<WatchRoomRead | null> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) return null;

    return {
      room,
      queue: tables.queue.filter((entry) => entry.roomId === roomId),
      messages: tables.messages.filter((message) => message.roomId === roomId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      crowns: tables.crowns.filter((crown) => crown.roomId === roomId),
    };
  }

  async openRoom(input: OpenRoomInput): Promise<WatchRoomRead> {
    const tables = load();
    const at = stamp();
    // Empty (GO LIVE on CYTUBE): no first file, the screen black until something is queued.
    const entry: WatchQueueEntry | null = input.mediaItemId === null ? null : {
      id: newId(),
      roomId: input.id,
      position: 0,
      inQueue: true,
      mediaItemId: input.mediaItemId,
      link: null,
      series: null,
      addedBy: input.host.id,
      addedAt: at,
      playedAt: at,
      playIndex: 0,
    };
    const room: WatchRoom = {
      id: input.id,
      originalHostId: input.host.id,
      originalHostLabel: input.host.label,
      hostId: input.host.id,
      forumThreadId: null,
      currentEntryId: entry?.id ?? null,
      positionSeconds: 0,
      isPlaying: entry !== null,
      startedAt: at,
      updatedAt: at,
      endedAt: null,
      origin: 'stream',
      isPublic: true,
      clearedAt: null,
      name: null,
      topic: null,
      addMode: 'anyone',
    };
    const crown = crownFor(room.id, input.host.id, input.host.id);
    const queue = entry === null ? [] : [entry];
    save({ ...tables, rooms: [...tables.rooms, room], queue: [...tables.queue, ...queue], crowns: withCrown(tables.crowns, crown) }, room.id);

    return { room, queue, messages: [], crowns: [crown] };
  }

  async findMusicRoom(hostId: string): Promise<WatchRoom | null> {
    return load().rooms.find((room) => room.origin === 'music' && room.originalHostId === hostId) ?? null;
  }

  async openMusicRoom(input: OpenMusicRoomInput): Promise<WatchRoomRead> {
    for (const link of [...(input.playing === null ? [] : [input.playing]), ...input.upNext]) {
      const refusal = queueRefusal(link);
      if (refusal !== null) throw new Error(refusal);
    }
    let tables = load();
    let room = tables.rooms.find((candidate) => candidate.origin === 'music' && candidate.originalHostId === input.host.id);
    let crowns = tables.crowns;
    if (room === undefined) {
      const at = stamp();
      room = {
        id: input.id,
        originalHostId: input.host.id,
        originalHostLabel: input.host.label,
        hostId: input.host.id,
        forumThreadId: null,
        currentEntryId: null,
        positionSeconds: 0,
        isPlaying: false,
        startedAt: at,
        updatedAt: at,
        endedAt: null,
        origin: 'music',
        isPublic: true,
        clearedAt: null,
        name: null,
        topic: null,
        addMode: 'anyone',
      };
      // The host is crowned as the room is written, as GO LIVE does it.
      crowns = withCrown(crowns, crownFor(room.id, input.host.id, input.host.id));
      tables = { ...tables, rooms: [...tables.rooms, room], crowns };
    }
    const roomId = room.id;
    const queue = tables.queue.filter((entry) => entry.roomId === roomId);
    const current = queue.find((entry) => entry.id === room?.currentEntryId);
    const plan = goPublicPlan(queue, current, input.playing, input.upNext);
    const crowned = hasCrown(crowns.filter((crown) => crown.roomId === roomId), input.host.id);
    const added: WatchQueueEntry[] = [];
    let currentEntryId = room.currentEntryId;
    if (plan.slot !== null) {
      const at = stamp();
      const slotted = songRow(roomId, plan.slot, { position: nextQueuePosition(queue), addedBy: input.host.id, playedAt: at, playIndex: nextPlayIndex(queue) });
      added.push(slotted);
      currentEntryId = slotted.id;
    }
    let position = nextQueuePosition([...queue, ...added]);
    // Without their own crown the host's up-next waits on their list, like anybody's.
    for (const link of plan.append) added.push(songRow(roomId, link, { position: position++, addedBy: input.host.id, inQueue: crowned }));
    const opened: WatchRoom = {
      ...room,
      currentEntryId,
      positionSeconds: plan.slot !== null || input.playing !== null ? Math.max(0, input.positionSeconds) : room.positionSeconds,
      isPlaying: input.isPlaying && currentEntryId !== null,
      isPublic: true,
      updatedAt: stamp(),
    };
    save({ ...tables, queue: [...tables.queue, ...added], rooms: tables.rooms.map((candidate) => (candidate.id === roomId ? opened : candidate)) }, roomId);
    return (await this.readRoom(roomId)) as WatchRoomRead;
  }

  async setRoomPublic(roomId: string, isPublic: boolean): Promise<void> {
    changeRoom(roomId, (room) => (room.origin !== 'music' ? null : { ...room, isPublic, isPlaying: isPublic && room.isPlaying }));
  }

  async saveRoomSettings(input: RoomSettingsInput): Promise<void> {
    const { room, crowns } = liveRoom(load(), input.roomId);
    if (!mayEditRoom(room, crowns, input.by, true)) throw new Error(NOT_ALLOWED);
    // The stamp is when the position was true, so a save while playing walks it forward, as `watch_room_settings` does.
    changeRoom(input.roomId, (current) => ({
      ...current,
      name: cleanRoomWords(input.name, ROOM_NAME_MAX),
      topic: cleanRoomWords(input.topic, ROOM_TOPIC_MAX),
      addMode: input.addMode,
      positionSeconds: current.isPlaying ? current.positionSeconds + Math.max(0, (Date.now() - Date.parse(current.updatedAt)) / 1000) : current.positionSeconds,
    }));
  }

  async playNow(input: PlayNowInput): Promise<WatchQueueEntry> {
    const refusal = queueRefusal(input.link);
    if (refusal !== null) throw new Error(refusal);
    const tables = load();
    const { room } = liveRoom(tables, input.roomId);
    // Only the host files a play (the database's `watch_queue_plays_by_host`).
    if (room.hostId !== input.by) throw new Error(NOT_ALLOWED);
    const entry = songRow(input.roomId, input.link, { position: input.position, addedBy: input.by, playedAt: stamp(), playIndex: input.playIndex });
    save({ ...tables, queue: [...tables.queue, entry] }, input.roomId);
    changeRoom(input.roomId, (current) => ({ ...current, currentEntryId: entry.id, positionSeconds: 0, isPlaying: true }));
    return entry;
  }

  async clearRoomQueue(roomId: string, by: string): Promise<void> {
    const tables = load();
    const { room, crowns } = liveRoom(tables, roomId);
    if (room.hostId !== by) throw new Error(NOT_ALLOWED);
    // Taking out what is queued takes a crown, as `removeFromQueue` does; without one only the window starts blank.
    const queue = hasCrown(crowns, by) ? tables.queue.filter((entry) => !(entry.roomId === roomId && entry.inQueue && entry.playedAt === null)) : tables.queue;
    save({ ...tables, queue }, roomId);
    changeRoom(roomId, (current) => ({ ...current, clearedAt: stamp() }));
  }

  async listLiveRooms(): Promise<LiveRoom[]> {
    const tables = load();
    return tables.rooms
      .filter((room) => room.endedAt === null)
      .map((room) => ({ room, current: tables.queue.find((entry) => entry.id === room.currentEntryId) ?? null }));
  }

  subscribeLiveRooms(listener: () => void): () => void {
    return this.subscribeStreamActivity(listener);
  }

  async attachThread(roomId: string, threadId: string): Promise<void> {
    changeRoom(roomId, (room) => (room.forumThreadId === null ? { ...room, forumThreadId: threadId } : null));
  }

  async writePlayback(roomId: string, patch: PlaybackPatch): Promise<void> {
    changeRoom(roomId, (room) => ({ ...room, ...patch, positionSeconds: Math.max(0, patch.positionSeconds) }));
  }

  async startEntry(roomId: string, entryId: string, playIndex: number): Promise<void> {
    const tables = load();
    const at = stamp();
    const queue = tables.queue.map((entry) =>
      entry.id === entryId && entry.roomId === roomId ? { ...entry, playedAt: entry.playedAt ?? at, playIndex: entry.playIndex ?? playIndex } : entry,
    );
    save({ ...tables, queue }, roomId);
    changeRoom(roomId, (room) => ({ ...room, currentEntryId: entryId, positionSeconds: 0, isPlaying: true }));
  }

  async handOver(roomId: string, toUserId: string): Promise<void> {
    changeRoom(roomId, (room) => ({ ...room, hostId: toUserId }));
  }

  async takeOver(roomId: string, goneHostId: string, callerId: string): Promise<boolean> {
    const room = load().rooms.find((candidate) => candidate.id === roomId);
    // A music room is its owner's: never taken over.
    if (room === undefined || room.origin === 'music' || room.endedAt !== null || room.hostId !== goneHostId || room.hostId === callerId) return false;
    if (Date.now() - Date.parse(room.updatedAt) < TAKE_OVER_QUIET_MS) return false;

    changeRoom(roomId, (current) => ({ ...current, hostId: callerId }));
    return true;
  }

  async endRoom(roomId: string): Promise<void> {
    changeRoom(roomId, (room) => ({ ...room, isPlaying: false, endedAt: stamp() }));
  }

  async closeStale(roomId: string): Promise<boolean> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    // A quiet music room is kept, not closed.
    if (room === undefined || room.origin === 'music' || room.endedAt !== null || Date.now() - Date.parse(room.updatedAt) < STALE_MS) return false;

    save({ ...tables, rooms: tables.rooms.map((candidate) => (candidate.id === roomId ? { ...candidate, endedAt: candidate.updatedAt } : candidate)) }, roomId);
    return true;
  }

  async addToQueue(input: AddToQueueInput): Promise<WatchQueueEntry> {
    const tables = load();
    const { room, crowns } = liveRoom(tables, input.roomId);
    refuseIfShut(room, input.addedBy);
    refuseIfCrownsOnly(room, crowns, input.addedBy);
    // The database's link checks, and the allow-list for an `embed` link, as the Supabase store asks them.
    const refusal = input.link === undefined ? null : queueRefusal(input.link);
    if (refusal !== null) throw new Error(refusal);
    // Straight into the queue takes a crown; anything else waits on the adder's own list.
    const inQueue = input.inQueue === true;
    if (inQueue && !hasCrown(crowns, input.addedBy)) throw new Error(NOT_ALLOWED);

    const entry: WatchQueueEntry = {
      id: newId(),
      roomId: input.roomId,
      position: input.position,
      inQueue,
      mediaItemId: input.mediaItemId ?? null,
      link: input.link ?? null,
      series: null,
      addedBy: input.addedBy,
      addedAt: stamp(),
      playedAt: null,
      playIndex: null,
    };
    save({ ...tables, queue: [...tables.queue, entry] }, input.roomId);
    return entry;
  }

  async addSeriesToQueue(input: AddSeriesInput): Promise<WatchQueueEntry[]> {
    const tables = load();
    const { room, crowns } = liveRoom(tables, input.roomId);
    refuseIfShut(room, input.addedBy);
    refuseIfCrownsOnly(room, crowns, input.addedBy);
    for (const link of input.links) {
      const refusal = queueRefusal(link);
      if (refusal !== null) throw new Error(refusal);
    }
    const title = input.seriesTitle.replace(/\s+/g, ' ').trim().slice(0, 200).trim();
    if (input.links.length === 0 || title.length === 0) throw new Error('NOTHING TICKED.');
    const inQueue = input.inQueue === true;
    if (inQueue && !hasCrown(crowns, input.addedBy)) throw new Error(NOT_ALLOWED);

    // One place and one moment for the whole block, as the database's one insert gives it.
    const seriesId = newId();
    const at = stamp();
    const entries: WatchQueueEntry[] = input.links.map((link, index) => ({
      id: newId(),
      roomId: input.roomId,
      position: input.position,
      inQueue,
      mediaItemId: null,
      link,
      series: { id: seriesId, title, episode: index + 1 },
      addedBy: input.addedBy,
      addedAt: at,
      playedAt: null,
      playIndex: null,
    }));
    save({ ...tables, queue: [...tables.queue, ...entries] }, input.roomId);
    return entries;
  }

  async removeSeries(seriesId: string, by: string): Promise<void> {
    const tables = load();
    const rows = tables.queue.filter((entry) => entry.series?.id === seriesId && entry.playedAt === null);
    if (rows.length === 0) throw new Error(NOT_ALLOWED);
    const { crowns } = liveRoom(tables, rows[0].roomId);
    // Row by row, the rules `removeFromQueue` keeps; any row refused refuses the lot, as nothing is half taken.
    if (!hasCrown(crowns, by) && !rows.every((entry) => entry.addedBy === by && !entry.inQueue)) throw new Error(NOT_ALLOWED);
    const gone = new Set(rows.map((entry) => entry.id));
    save({ ...tables, queue: tables.queue.filter((candidate) => !gone.has(candidate.id)) }, rows[0].roomId);
  }

  async removeFromQueue(entryId: string, by: string): Promise<void> {
    const tables = load();
    const entry = tables.queue.find((candidate) => candidate.id === entryId);
    if (entry === undefined || entry.playedAt !== null) return;
    // A crown takes out what has not played; anybody else only their own addition, until it is pulled in.
    const { crowns } = liveRoom(tables, entry.roomId);
    if (!hasCrown(crowns, by) && !(entry.addedBy === by && !entry.inQueue)) throw new Error(NOT_ALLOWED);
    save({ ...tables, queue: tables.queue.filter((candidate) => candidate.id !== entryId) }, entry.roomId);
  }

  async reorderQueue(moves: QueueMove[], by: string): Promise<void> {
    if (moves.length === 0) return;
    const tables = load();
    // A series move reaches every episode of that add not yet played.
    const byId = new Map(moves.filter((move) => move.series !== true).map((move) => [move.id, move]));
    const bySeries = new Map(moves.filter((move) => move.series === true).map((move) => [move.id, move]));
    const moveOf = (entry: WatchQueueEntry) => byId.get(entry.id) ?? (entry.series === null ? undefined : bySeries.get(entry.series.id));
    const roomId = tables.queue.find((entry) => moveOf(entry) !== undefined)?.roomId;
    if (roomId === undefined) return;
    // Only a crown moves the queue: a row's place, or an addition into it. What played stays where it played.
    if (!hasCrown(liveRoom(tables, roomId).crowns, by)) throw new Error(NOT_ALLOWED);
    const queue = tables.queue.map((entry) => {
      const move = moveOf(entry);
      if (move === undefined || entry.roomId !== roomId || entry.playedAt !== null) return entry;
      return { ...entry, position: move.position, inQueue: entry.inQueue || move.pull === true };
    });
    save({ ...tables, queue }, roomId);
  }

  async setCrown(roomId: string, userId: string, crowned: boolean, by: string): Promise<WatchCrown | null> {
    const tables = load();
    const { room } = liveRoom(tables, roomId);
    // Only the host gives and takes crowns, their own included.
    if (room.hostId !== by) throw new Error(NOT_ALLOWED);
    if (!crowned) {
      save({ ...tables, crowns: tables.crowns.filter((crown) => !(crown.roomId === roomId && crown.userId === userId)) }, roomId);
      return null;
    }
    const held = tables.crowns.find((crown) => crown.roomId === roomId && crown.userId === userId);
    if (held !== undefined) return held;
    const crown = crownFor(roomId, userId, by);
    save({ ...tables, crowns: [...tables.crowns, crown] }, roomId);
    return crown;
  }

  async sendMessage(input: SendMessageInput): Promise<WatchMessage> {
    const body = input.body.trim();
    if (body.length === 0) throw new Error('SAY SOMETHING FIRST.');

    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === input.roomId);
    if (room === undefined || room.endedAt !== null) throw new Error('THE STREAM HAS ENDED.');
    refuseIfShut(room, input.author.id);

    const message: WatchMessage = {
      id: newId(),
      roomId: input.roomId,
      queueEntryId: input.queueEntryId,
      mediaItemId: input.mediaItemId,
      authorId: input.author.id,
      authorLabel: input.author.label,
      body: body.slice(0, 500),
      mediaSeconds: Math.max(0, input.mediaSeconds),
      createdAt: stamp(),
    };
    save({ ...tables, messages: [...tables.messages, message] }, input.roomId);
    return message;
  }

  async deleteMessage(messageId: string): Promise<void> {
    const tables = load();
    const message = tables.messages.find((candidate) => candidate.id === messageId);
    if (message === undefined) return;
    save({ ...tables, messages: tables.messages.filter((candidate) => candidate.id !== messageId) }, message.roomId);
  }

  async listStreamFolds(mediaItemIds: string[]): Promise<Record<string, StreamFold[]>> {
    const tables = load();
    const wanted = new Set(mediaItemIds);
    const out: Record<string, StreamFold[]> = {};

    for (const mediaId of wanted) {
      const roomIds = new Set(tables.queue.filter((entry) => entry.mediaItemId === mediaId && entry.playedAt !== null).map((entry) => entry.roomId));
      const folds = tables.rooms
        .filter((room) => roomIds.has(room.id))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((room) => ({
          room,
          messages: tables.messages
            .filter((message) => message.roomId === room.id && message.mediaItemId === mediaId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        }));
      if (folds.length > 0) out[mediaId] = folds;
    }

    return out;
  }

  subscribeRoom(roomId: string, onChange: (change: RoomChange) => void): () => void {
    // Reading this browser's own storage again is cheap, so every change is a refresh.
    const local = (changed: string | null) => {
      if (changed === roomId) onChange({ kind: 'refresh' });
    };
    localListeners.add(local);
    const off = onWire((message) => {
      if (message.type === 'changed' && message.roomId === roomId) onChange({ kind: 'refresh' });
    });

    return () => {
      localListeners.delete(local);
      off();
    };
  }

  subscribeStreamActivity(listener: () => void): () => void {
    const local = () => listener();
    localListeners.add(local);
    const off = onWire((message) => {
      if (message.type === 'changed') listener();
    });

    return () => {
      localListeners.delete(local);
      off();
    };
  }

  joinRoom(roomId: string, me: Omit<WatchMember, 'joinedAt'>, onMembers: (members: WatchMember[]) => void): RoomMembership {
    const self: WatchMember = { ...me, joinedAt: Date.now() };
    const others = new Map<string, { member: WatchMember; seen: number }>();
    let left = false;

    const emit = () => {
      if (left) return;
      const now = Date.now();
      for (const [key, { seen }] of others) if (now - seen > GONE_MS) others.delete(key);
      onMembers([self, ...[...others.values()].map((other) => other.member)]);
    };

    const off = onWire((message) => {
      if (!('roomId' in message) || message.roomId !== roomId) return;
      if (message.type === 'here' && message.member.key !== self.key) {
        others.set(message.member.key, { member: message.member, seen: Date.now() });
        emit();
      } else if (message.type === 'bye') {
        others.delete(message.key);
        emit();
      } else if (message.type === 'hello') {
        send({ type: 'here', roomId, member: self });
      }
    });

    send({ type: 'hello', roomId });
    send({ type: 'here', roomId, member: self });
    const beat = setInterval(() => {
      send({ type: 'here', roomId, member: self });
      emit();
    }, BEAT_MS);
    const bye = () => send({ type: 'bye', roomId, key: self.key });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', bye);
    emit();

    return {
      leave: () => {
        if (left) return;
        left = true;
        clearInterval(beat);
        off();
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', bye);
        bye();
      },
    };
  }

  subscribeWatching(listener: (watching: WatchingMap | null) => void): () => void {
    wireWatching();
    watchingListeners.add(listener);
    listener(watchingMap());

    return () => {
      watchingListeners.delete(listener);
    };
  }

  setWatching(entry: WatchingEntry | null): void {
    wireWatching();
    const was = myWatching;
    myWatching = entry;

    if (watchingBeat !== null) {
      clearInterval(watchingBeat);
      watchingBeat = null;
    }
    if (entry === null || entry.unlisted === true) {
      if (was !== null) send({ type: 'watching-bye', key: tabKey });
    } else {
      send({ type: 'watching', key: tabKey, entry });
      watchingBeat = setInterval(() => {
        if (myWatching !== null) send({ type: 'watching', key: tabKey, entry: myWatching });
      }, BEAT_MS);
    }
    emitWatching();
  }
}

let mockWatchRepository: MockWatchRepository | null = null;

export function getMockWatchRepository(): WatchRepository {
  if (mockWatchRepository === null) mockWatchRepository = new MockWatchRepository();
  return mockWatchRepository;
}

/** Test helper: forgets every room this browser (or process) holds. */
export function resetMockWatch(): void {
  memory = { rooms: [], queue: [], messages: [], crowns: [] };
  if (hasStorage()) window.localStorage.removeItem(KEY);
}
