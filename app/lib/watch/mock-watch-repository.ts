import type { AddSeriesInput, AddToQueueInput, OpenMusicRoomInput, OpenRoomInput, PlayNowInput, PlaybackPatch, RoomChange, RoomMembership, RoomSettingsInput, SendMessageInput, WatchRepository } from './repository';
import { queueRefusal } from './links';
import { getMockAuthRepository } from '../auth/mock-auth';
import { goPublicPlan } from './music-rooms';
import { companionOutState, parseCompanionWire, setRoomCompanions, subscribeToCompanionOut, type CompanionWire, type RoomCompanion } from '../companion/wire';
import { membersSignature } from './members-signature';
import { NOT_ALLOWED, ROOM_NAME_MAX, ROOM_TOPIC_MAX, TAKE_OVER_QUIET_MS, cleanRoomWords, guestNameLooksRight, hasCrown, mayEditRoom, nextPlayIndex, nextQueuePosition } from './rules';
import type { GuestNameAnswer, JoinAnswer, LiveRoom, PrivateLine, PrivateSize, PrivateFold, PrivateRoomLine, QueueMove, RoomDoor, RoomGuest, RoomMemberRow, RoomOutline, RoomPrivacy, StreamFold, WatchCrown, WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

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

/** The privacy side of a room, kept by hand as the database's rules and functions keep it (SPEC-privacy-phase-2.md). */
type Attempt = { roomId: string; userId: string; tries: number; lockedUntil: string | null };
type Tables = {
  rooms: WatchRoom[];
  queue: WatchQueueEntry[];
  messages: WatchMessage[];
  crowns: WatchCrown[];
  members: RoomMemberRow[];
  passwords: Record<string, string>;
  attempts: Attempt[];
  /** Ids of messages and queue rows made while their room was not open: the mock's `privacy_at_write`. */
  privateRows: string[];
};

let memory: Tables = { rooms: [], queue: [], messages: [], crowns: [], members: [], passwords: {}, attempts: [], privateRows: [] };

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
        ? parsed.rooms.map((room) => ({ ...room, origin: room.origin ?? 'stream', isPublic: room.isPublic ?? true, privacy: room.privacy ?? 'open', clearedAt: room.clearedAt ?? null, name: room.name ?? null, topic: room.topic ?? null, addMode: room.addMode ?? 'anyone', guestsCanTalk: room.guestsCanTalk ?? true }))
        : [],
      // Rows stored before links existed have no `link`; rows from before additions were all in the queue.
      queue: Array.isArray(parsed.queue) ? parsed.queue.map((entry) => ({ ...entry, link: entry.link ?? null, inQueue: entry.inQueue ?? true, series: entry.series ?? null })) : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      crowns: Array.isArray(parsed.crowns) ? parsed.crowns : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
      passwords: parsed.passwords ?? {},
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      privateRows: Array.isArray(parsed.privateRows) ? parsed.privateRows : [],
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

/** Who is reading, as the database's `auth.uid()` would know. */
async function currentAccountOrNull() {
  return getMockAuthRepository().getCurrentUser();
}

async function viewerId(): Promise<string | null> {
  return (await currentAccountOrNull())?.id ?? readMockGuest()?.id ?? null;
}

const MOCK_GUEST_KEY = 'debaser-mock-guest';

/** A guest with the mock accounts: one per browser, as on the live site. The database's rules about other guests' and accounts' names and about floods have nobody to test against here. */
function readMockGuest(): RoomGuest | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(MOCK_GUEST_KEY) ?? 'null') as RoomGuest | null;
  } catch {
    return null;
  }
}

function saveMockGuest(guest: RoomGuest): void {
  window.localStorage.setItem(MOCK_GUEST_KEY, JSON.stringify(guest));
}

const memberListeners = new Set<(row: RoomMemberRow) => void>();

/** The database's `room_may_talk`: nobody removed, and nobody from outside a room that is not open. */
function refuseOutsider(tables: Tables, room: WatchRoom, userId: string): void {
  const mine = tables.members.find((row) => row.roomId === room.id && row.userId === userId);
  if (mine !== undefined && mine.removedAt !== null) throw new Error(NOT_ALLOWED);
  if (room.privacy !== 'open' && mine === undefined && room.hostId !== userId) throw new Error(NOT_ALLOWED);
}

/** The database's `watch_rooms_member_host`: whoever hosts belongs. */
function addMember(tables: Tables, roomId: string, userId: string): void {
  if (tables.members.some((row) => row.roomId === roomId && row.userId === userId)) return;
  save({ ...tables, members: [...tables.members, { roomId, userId, label: 'SOMEBODY', removedAt: null }] }, null);
}

/** The database's three sizes. */
function sizeOf(words: string): PrivateSize {
  return words.length <= 20 ? 'short' : words.length <= 80 ? 'medium' : 'long';
}

/** A tag for one person in one room: the same every time, and different in the next room. */
function anonTag(roomId: string, userId: string): string {
  let hash = 7;
  for (const ch of `${roomId}:${userId}`) hash = (hash * 31 + ch.charCodeAt(0)) % 999;
  return `ANON-${hash + 1}`;
}

function outlineLines(tables: Tables, room: WatchRoom): PrivateLine[] {
  return tables.messages
    .filter((message) => message.roomId === room.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((message) => ({
      tag: anonTag(room.id, message.authorId),
      seconds: Math.max(0, Math.floor((Date.parse(message.createdAt) - Date.parse(room.startedAt)) / 1000)),
      size: sizeOf(message.body),
    }));
}

/** The mock's `privacy_at_write`: what is made while a room is not open stays its members'. */
function stampedRows(tables: Tables, room: WatchRoom, id: string): string[] {
  return room.privacy === 'open' ? tables.privateRows : [...tables.privateRows, id];
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* --- the wire ------------------------------------------------------------------------------------ */

type WireMessage =
  | { type: 'changed'; roomId: string | null }
  | { type: 'here'; roomId: string; member: WatchMember; companion?: unknown }
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

  async readDoor(roomId: string): Promise<RoomDoor> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) return { found: false, live: false, privacy: null, title: null, member: false, removed: false, lockedUntil: null };
    const me = await viewerId();
    const mine = tables.members.find((row) => row.roomId === roomId && row.userId === me);
    const attempt = tables.attempts.find((row) => row.roomId === roomId && row.userId === me);
    const locked = attempt?.lockedUntil !== null && attempt?.lockedUntil !== undefined && Date.parse(attempt.lockedUntil) > Date.now();
    return {
      found: true,
      live: room.endedAt === null && room.isPublic,
      privacy: room.privacy,
      title: me === null || readMockGuest()?.id === me ? null : (room.name ?? 'THIS ROOM'),
      member: mine !== undefined && mine.removedAt === null,
      removed: mine !== undefined && mine.removedAt !== null,
      lockedUntil: locked ? (attempt?.lockedUntil ?? null) : null,
    };
  }

  async enterRoom(roomId: string, password: string | null): Promise<JoinAnswer> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    const account = await currentAccountOrNull();
    const guest = account === null ? readMockGuest() : null;
    const me = account === null ? (guest === null ? null : { id: guest.id, displayName: guest.label }) : { id: account.id, displayName: account.displayName };
    if (room === undefined || me === null) return 'refused';
    const mine = tables.members.find((row) => row.roomId === roomId && row.userId === me.id);
    if (mine?.removedAt !== null && mine !== undefined) return 'removed';
    if (mine !== undefined) return 'joined';
    if (room.endedAt !== null || !room.isPublic) return 'ended';

    if (room.privacy === 'password') {
      const attempt = tables.attempts.find((row) => row.roomId === roomId && row.userId === me.id) ?? { roomId, userId: me.id, tries: 0, lockedUntil: null };
      if (attempt.lockedUntil !== null && Date.parse(attempt.lockedUntil) > Date.now()) return 'locked';
      const others = tables.attempts.filter((row) => row !== attempt);
      if (password === null || tables.passwords[roomId] !== password) {
        const tries = attempt.tries + 1;
        const lockedUntil = tries >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
        save({ ...tables, attempts: [...others, { ...attempt, tries: lockedUntil === null ? tries : 0, lockedUntil }] }, null);
        return lockedUntil === null ? 'wrong' : 'locked';
      }
      tables.attempts = others;
    }

    save({ ...tables, members: [...tables.members, { roomId, userId: me.id, label: me.displayName, removedAt: null }] }, null);
    return 'joined';
  }

  async readGuest(): Promise<RoomGuest | null> {
    return readMockGuest();
  }

  async becomeGuest(): Promise<RoomGuest> {
    const id = newId();
    const guest: RoomGuest = { id, label: `GUEST-${id.slice(0, 3).toUpperCase()}`, named: false };
    saveMockGuest(guest);
    return guest;
  }

  async nameGuest(name: string): Promise<GuestNameAnswer> {
    const guest = readMockGuest();
    if (guest === null || guest.named) return 'refused';
    if (!guestNameLooksRight(name) || /^(guest|anon|admin|host|mod)/i.test(name.trim())) return 'bad';
    const label = `${name.trim().replace(/\s+/g, ' ')} [GUEST]`;
    saveMockGuest({ ...guest, label, named: true });
    const tables = load();
    save({ ...tables, members: tables.members.map((row) => (row.userId === guest.id ? { ...row, label } : row)) }, null);
    return 'named';
  }

  async setGuestsCanTalk(roomId: string, allowed: boolean): Promise<void> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    const me = await currentAccountOrNull();
    if (room === undefined || me === null || room.endedAt !== null || (room.hostId !== me.id && !hasCrown(tables.crowns.filter((crown) => crown.roomId === roomId), me.id))) {
      throw new Error('ONLY THE HOST OR A CROWN CAN CHANGE THAT.');
    }
    changeRoom(roomId, (current) => ({ ...current, guestsCanTalk: allowed }));
  }

  async setRoomPrivacy(roomId: string, privacy: RoomPrivacy, password: string | null): Promise<void> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    const me = await viewerId();
    if (room === undefined || room.hostId !== me || room.endedAt !== null || room.origin !== 'stream') throw new Error('ONLY THE HOST CAN CHANGE THAT.');
    const passwords = { ...tables.passwords };
    if (privacy === 'password') {
      if (password !== null && password.length > 0) passwords[roomId] = password;
      else if (passwords[roomId] === undefined) throw new Error('THAT NEEDS A PASSWORD.');
    } else {
      delete passwords[roomId];
    }
    save({ ...tables, passwords, attempts: tables.attempts.filter((row) => row.roomId !== roomId) }, null);
    changeRoom(roomId, (current) => ({ ...current, privacy }));
  }

  async removeFromRoom(roomId: string, userId: string): Promise<void> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    const me = await viewerId();
    const allowed = room !== undefined && room.endedAt === null && room.hostId !== userId && (room.hostId === me || tables.crowns.some((crown) => crown.roomId === roomId && crown.userId === me));
    if (!allowed) throw new Error('ONLY THE HOST OR A CROWN CAN REMOVE SOMEBODY.');
    const at = stamp();
    const known = tables.members.find((row) => row.roomId === roomId && row.userId === userId);
    const members = known === undefined
      ? [...tables.members, { roomId, userId, label: 'SOMEBODY', removedAt: at }]
      : tables.members.map((row) => (row === known ? { ...row, removedAt: at } : row));
    save({ ...tables, members, crowns: tables.crowns.filter((crown) => !(crown.roomId === roomId && crown.userId === userId)) }, roomId);
    for (const listener of memberListeners) listener({ roomId, userId, label: known?.label ?? 'SOMEBODY', removedAt: at });
  }

  async readRoomOutline(roomId: string): Promise<RoomOutline | null> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined || room.privacy === 'open') return null;
    return {
      live: room.endedAt === null,
      people: tables.members.filter((row) => row.roomId === roomId && row.removedAt === null).map((row) => anonTag(roomId, row.userId)),
      messages: outlineLines(tables, room),
      queue: tables.queue.filter((entry) => entry.roomId === roomId && entry.inQueue && entry.playedAt === null).length,
      strokes: 0,
      strokePeople: 0,
    };
  }

  async listPrivateRooms(): Promise<PrivateRoomLine[]> {
    const tables = load();
    const me = await viewerId();
    return tables.rooms
      .filter((room) => room.endedAt === null && room.origin === 'stream' && room.privacy !== 'open')
      .filter((room) => !tables.members.some((row) => row.roomId === room.id && row.userId === me && row.removedAt === null))
      .map((room) => ({
        joined: tables.members.filter((row) => row.roomId === room.id && row.removedAt === null).length,
        messages: tables.messages.filter((message) => message.roomId === room.id).length,
        strokes: 0,
      }));
  }

  async readRecordOutline(threadId: string): Promise<PrivateLine[]> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.forumThreadId === threadId);
    return room === undefined ? [] : outlineLines(tables, room);
  }

  async listPrivateFolds(mediaItemIds: string[]): Promise<PrivateFold[]> {
    const tables = load();
    const me = await viewerId();
    const hidden = new Set(tables.privateRows);
    const outside = (roomId: string) => !tables.members.some((row) => row.roomId === roomId && row.userId === me && row.removedAt === null);
    return mediaItemIds.flatMap((mediaItemId) => {
      const plays = tables.queue.filter((entry) => entry.mediaItemId === mediaItemId && entry.playedAt !== null && hidden.has(entry.id) && outside(entry.roomId));
      if (plays.length === 0) return [];
      const sizes = tables.messages.filter((message) => message.mediaItemId === mediaItemId && hidden.has(message.id) && outside(message.roomId)).map((message) => sizeOf(message.body));
      return [{ mediaItemId, rooms: new Set(plays.map((entry) => entry.roomId)).size, sizes }];
    });
  }

  async listRoomMembers(roomId: string): Promise<RoomMemberRow[]> {
    return load().members.filter((row) => row.roomId === roomId);
  }

  subscribeRoomMembers(roomId: string, listener: (row: RoomMemberRow) => void): () => void {
    const heard = (row: RoomMemberRow) => {
      if (row.roomId === roomId) listener(row);
    };
    memberListeners.add(heard);
    return () => {
      memberListeners.delete(heard);
    };
  }

  async readRoom(roomId: string): Promise<WatchRoomRead | null> {
    const tables = load();
    const room = tables.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) return null;
    const me = await viewerId();
    const member = tables.members.some((row) => row.roomId === roomId && row.userId === me && row.removedAt === null);
    // The database's rules: a room that is not open is its members', and so is whatever was made while it was not.
    if (room.privacy !== 'open' && !member && room.hostId !== me) return null;
    const hidden = member ? new Set<string>() : new Set(tables.privateRows);

    return {
      room,
      queue: tables.queue.filter((entry) => entry.roomId === roomId && !hidden.has(entry.id)),
      messages: tables.messages.filter((message) => message.roomId === roomId && !hidden.has(message.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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
      // Left out by the older checks, which read rooms with nobody signed in. Everything on the site says which it wants.
      privacy: input.privacy ?? 'open',
      clearedAt: null,
      name: null,
      topic: null,
      addMode: 'anyone',
      guestsCanTalk: true,
    };
    const crown = crownFor(room.id, input.host.id, input.host.id);
    const queue = entry === null ? [] : [entry];
    tables.members = [...tables.members, { roomId: room.id, userId: input.host.id, label: input.host.label, removedAt: null }];
    if (input.privacy === 'password' && input.password !== undefined) tables.passwords = { ...tables.passwords, [room.id]: input.password };
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
        privacy: 'open',
        clearedAt: null,
        name: null,
        topic: null,
        addMode: 'anyone',
        guestsCanTalk: true,
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
    changeRoom(roomId, (room) => (room.origin !== 'music' ? null : { ...room, isPublic, privacy: isPublic ? 'open' : 'private', isPlaying: isPublic && room.isPlaying }));
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
    const tables = load();
    if (tables.members.some((row) => row.roomId === roomId && row.userId === toUserId && row.removedAt !== null)) return;
    addMember(tables, roomId, toUserId);
    changeRoom(roomId, (room) => ({ ...room, hostId: toUserId }));
  }

  async takeOver(roomId: string, goneHostId: string, callerId: string): Promise<boolean> {
    const room = load().rooms.find((candidate) => candidate.id === roomId);
    // A music room is its owner's: never taken over.
    if (room === undefined || room.origin === 'music' || room.endedAt !== null || room.hostId !== goneHostId || room.hostId === callerId) return false;
    if (Date.now() - Date.parse(room.updatedAt) < TAKE_OVER_QUIET_MS) return false;
    const tables = load();
    try {
      refuseOutsider(tables, room, callerId);
    } catch {
      return false;
    }
    addMember(tables, roomId, callerId);

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
    refuseOutsider(tables, room, input.addedBy);
    save({ ...tables, queue: [...tables.queue, entry], privateRows: stampedRows(tables, room, entry.id) }, input.roomId);
    return entry;
  }

  async addSeriesToQueue(input: AddSeriesInput): Promise<WatchQueueEntry[]> {
    const tables = load();
    const { room, crowns } = liveRoom(tables, input.roomId);
    refuseIfShut(room, input.addedBy);
    refuseIfCrownsOnly(room, crowns, input.addedBy);
    refuseOutsider(tables, room, input.addedBy);
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
    if (room.guestsCanTalk === false && readMockGuest()?.id === input.author.id) throw new Error(NOT_ALLOWED);

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
    refuseOutsider(tables, room, input.author.id);
    save({ ...tables, messages: [...tables.messages, message], privateRows: stampedRows(tables, room, message.id) }, input.roomId);
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
    const others = new Map<string, { member: WatchMember; seen: number; companion: CompanionWire | null }>();
    let left = false;
    let heardMembers = '';
    // This tab's companion rides on its presence, as on the real room's (SPEC-companion.md); a guest's never does.
    const here = (): WireMessage => ({ type: 'here', roomId, member: self, companion: self.userId === null ? null : companionOutState() });

    const emit = () => {
      if (left) return;
      const now = Date.now();
      for (const [key, { seen }] of others) if (now - seen > GONE_MS) others.delete(key);
      const companions: RoomCompanion[] = [];
      for (const [key, { member, companion }] of others) {
        if (companion === null || member.userId === null || member.userId === self.userId) continue;
        companions.push({ key, userId: member.userId, name: member.name, joinedAt: member.joinedAt, wire: companion });
      }
      setRoomCompanions(companions);
      const members = [self, ...[...others.values()].map((other) => other.member)];
      const said = membersSignature(members);
      if (said === heardMembers) return;
      heardMembers = said;
      onMembers(members);
    };

    const off = onWire((message) => {
      if (!('roomId' in message) || message.roomId !== roomId) return;
      if (message.type === 'here' && message.member.key !== self.key) {
        others.set(message.member.key, { member: message.member, seen: Date.now(), companion: parseCompanionWire(message.companion) });
        emit();
      } else if (message.type === 'bye') {
        others.delete(message.key);
        emit();
      } else if (message.type === 'hello') {
        send(here());
      }
    });
    const offCompanion = subscribeToCompanionOut(() => {
      if (!left && self.userId !== null) send(here());
    });

    send({ type: 'hello', roomId });
    send(here());
    const beat = setInterval(() => {
      send(here());
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
        offCompanion();
        setRoomCompanions([]);
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
  memory = { rooms: [], queue: [], messages: [], crowns: [], members: [], passwords: {}, attempts: [], privateRows: [] };
  if (hasStorage()) window.localStorage.removeItem(KEY);
}
