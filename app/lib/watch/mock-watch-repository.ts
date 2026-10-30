import type { AddToQueueInput, OpenRoomInput, PlaybackPatch, RoomChange, RoomMembership, SendMessageInput, WatchRepository } from './repository';
import { TAKE_OVER_QUIET_MS } from './rules';
import type { StreamFold, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Stream rooms in this browser only, like the other mocks: the three tables as one localStorage record,
 * and a BroadcastChannel so this browser's other tabs hear each write and each other's presence.
 *
 * Presence here is a tab saying "here" every second and a half; a tab silent for five seconds is gone.
 * The Supabase store gets the same answers from Realtime Presence, which hears a closed tab at once.
 * The rules the database keeps (only the host writes the room, a take-over only past a quiet host) are
 * kept here by hand, so a check against the mock means the same as one against the tables.
 */

const KEY = 'debaser.watch.v1';
const WIRE = 'debaser-watch';
const BEAT_MS = 1500;
const GONE_MS = 5000;
const STALE_MS = 3 * 60 * 1000;

type Tables = { rooms: WatchRoom[]; queue: WatchQueueEntry[]; messages: WatchMessage[] };

let memory: Tables = { rooms: [], queue: [], messages: [] };

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
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      // Rows stored before links existed have no `link`.
      queue: Array.isArray(parsed.queue) ? parsed.queue.map((entry) => ({ ...entry, link: entry.link ?? null })) : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
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

  const next = change(room);
  if (next === null) return;
  save({ ...tables, rooms: tables.rooms.map((candidate) => (candidate.id === roomId ? { ...next, updatedAt: stamp() } : candidate)) }, roomId);
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
    };
  }

  async openRoom(input: OpenRoomInput): Promise<WatchRoomRead> {
    const tables = load();
    const at = stamp();
    const entry: WatchQueueEntry = {
      id: newId(),
      roomId: input.id,
      position: 0,
      mediaItemId: input.mediaItemId,
      link: null,
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
      currentEntryId: entry.id,
      positionSeconds: 0,
      isPlaying: true,
      startedAt: at,
      updatedAt: at,
      endedAt: null,
    };
    save({ ...tables, rooms: [...tables.rooms, room], queue: [...tables.queue, entry] }, room.id);

    return { room, queue: [entry], messages: [] };
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
    if (room === undefined || room.endedAt !== null || room.hostId !== goneHostId || room.hostId === callerId) return false;
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
    if (room === undefined || room.endedAt !== null || Date.now() - Date.parse(room.updatedAt) < STALE_MS) return false;

    save({ ...tables, rooms: tables.rooms.map((candidate) => (candidate.id === roomId ? { ...candidate, endedAt: candidate.updatedAt } : candidate)) }, roomId);
    return true;
  }

  async addToQueue(input: AddToQueueInput): Promise<WatchQueueEntry> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === input.roomId);
    if (room === undefined || room.endedAt !== null) throw new Error('THE STREAM HAS ENDED.');

    const entry: WatchQueueEntry = {
      id: newId(),
      roomId: input.roomId,
      position: input.position,
      mediaItemId: input.mediaItemId ?? null,
      link: input.link ?? null,
      addedBy: input.addedBy,
      addedAt: stamp(),
      playedAt: null,
      playIndex: null,
    };
    save({ ...tables, queue: [...tables.queue, entry] }, input.roomId);
    return entry;
  }

  async removeFromQueue(entryId: string): Promise<void> {
    const tables = load();
    const entry = tables.queue.find((candidate) => candidate.id === entryId);
    if (entry === undefined || entry.playedAt !== null) return;
    save({ ...tables, queue: tables.queue.filter((candidate) => candidate.id !== entryId) }, entry.roomId);
  }

  async reorderQueue(moves: { id: string; position: number }[]): Promise<void> {
    if (moves.length === 0) return;
    const tables = load();
    const byId = new Map(moves.map((move) => [move.id, move.position]));
    const roomId = tables.queue.find((entry) => byId.has(entry.id))?.roomId ?? null;
    save({ ...tables, queue: tables.queue.map((entry) => (byId.has(entry.id) ? { ...entry, position: byId.get(entry.id) ?? entry.position } : entry)) }, roomId);
  }

  async sendMessage(input: SendMessageInput): Promise<WatchMessage> {
    const body = input.body.trim();
    if (body.length === 0) throw new Error('SAY SOMETHING FIRST.');

    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === input.roomId);
    if (room === undefined || room.endedAt !== null) throw new Error('THE STREAM HAS ENDED.');

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
    if (entry === null) {
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
  memory = { rooms: [], queue: [], messages: [] };
  if (hasStorage()) window.localStorage.removeItem(KEY);
}
