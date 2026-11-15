import type { RoomChange, WatchRepository } from './repository';
import { frontPosition } from './music-rooms';
import { hostPosition, nextPlayIndex, nextQueuePosition, playOrder, upcoming } from './rules';
import type { WatchLink, WatchQueueEntry, WatchRoom, WatchRoomRead } from './types';

/**
 * Your own room (SPEC-rooms-queues.md): the room you always have, with only you in it. No React and no browser here,
 * so a check can drive it.
 *
 * The room is a real row of `watch_rooms` (its kind is called `music` in the database), private and never public.
 * Its queue is the bar's up-next: it survives a reload and follows the account. What the room costs is the point of
 * how this file is written:
 *
 * - **Playing never waits for the database.** Every change is made to the browser's copy first (`RoomStore`) and the
 *   write is queued behind it (`push`). A write that cannot reach the database stays queued and goes again with the
 *   next one, or when `retry` is called (the tab comes back, the network comes back).
 * - **Nothing here runs on a clock.** A write happens when a thing starts, on pause and resume, when a seek settles
 *   and when the queue is edited. Where a song has got to is worked out from the last write (`ownRoomPlace`). A
 *   reader may leave a song playing for an hour and this writes nothing.
 * - **Rows never pile up.** At most `OWN_QUEUE_MAX` things wait, and only the last `OWN_PLAYED_KEPT` plays are kept:
 *   older ones are deleted as you play (`playsToPrune`).
 */

/** At most this many things queued (the database refuses past 500, `watch_queue_own_room_cap`). */
export const OWN_QUEUE_MAX = 200;
/** The last plays kept, the one on now among them: the red part of the queue window. */
export const OWN_PLAYED_KEPT = 20;

/** A place within this many seconds of what the room already says is the same place. */
const SAME_PLACE_SECONDS = 2;

export const OWN_QUEUE_FULL ='YOUR QUEUE IS FULL (200). TAKE SOMETHING OUT FIRST.';

/** A refusal the database gave for good (a rule, a full queue): trying the same write again would be refused again. */
export class OwnRoomRefusal extends Error {}

/** Whether this room is this person's own: the kept kind, and theirs. */
export function isOwnRoom(room: Pick<WatchRoom, 'origin' | 'hostId'>, userId: string | null): boolean {
  return userId !== null && room.origin === 'music' && room.hostId === userId;
}

/** The plays to delete so only the last `keep` are left, oldest first. What is on now is never one of them. */
export function playsToPrune(queue: readonly WatchQueueEntry[], currentEntryId: string | null, keep = OWN_PLAYED_KEPT): string[] {
  const played = playOrder([...queue]);
  const over = played.length - keep;
  if (over <= 0) return [];
  return played
    .filter((entry) => entry.id !== currentEntryId)
    .slice(0, over)
    .map((entry) => entry.id);
}

/** A day: a room left "playing" longer ago than this was a closed tab, not a listener. */
const LEFT_PLAYING_SECONDS = 24 * 60 * 60;

/**
 * Where your room had got to, for a page that has just opened: the place at the last write, walked forward if it was
 * playing then. A song left playing past its own end (the tab was closed, and nothing wrote after) starts from the top.
 */
export function ownRoomPlace(room: WatchRoom, now: number, duration?: number): number {
  if (!room.isPlaying) return Math.max(0, room.positionSeconds);
  const walked = hostPosition(room, now);
  if (walked - room.positionSeconds > LEFT_PLAYING_SECONDS) return 0;
  if (duration !== undefined && Number.isFinite(duration) && duration > 0 && walked >= duration - 1) return 0;
  return walked;
}

/** The browser's copy of a room: the same one every window reads (`use-watch-room.ts`), or a plain one in a check. */
export type RoomStore = {
  get(roomId: string): WatchRoomRead | null;
  prime(read: WatchRoomRead): void;
  apply(roomId: string, change: RoomChange): void;
};

/** Whose room: an account, or a visitor's browser-only id. */
export type OwnRoomHost = { id: string; label: string };

export type OwnRoomDeps = {
  repository: WatchRepository;
  host: OwnRoomHost;
  store: RoomStore;
  newId: () => string;
  now: () => number;
  /** Told the room's id once it is known (found, or made up for a room not written yet). */
  onRoom?: (roomId: string) => void;
  /** Told when writes are waiting on a database that cannot be reached, and when they have caught up. */
  onWaiting?: (waiting: boolean) => void;
};

type Write = { kind: 'playback' | 'other'; run: () => Promise<void> };

/** An empty room as the browser holds it before the database has one: yours, private, with your crown. */
function blankRoom(id: string, host: OwnRoomHost, at: string): WatchRoomRead {
  return {
    room: {
      id,
      originalHostId: host.id,
      originalHostLabel: host.label,
      hostId: host.id,
      forumThreadId: null,
      currentEntryId: null,
      positionSeconds: 0,
      isPlaying: false,
      startedAt: at,
      updatedAt: at,
      endedAt: null,
      origin: 'music',
      isPublic: false,
      privacy: 'private',
      clearedAt: null,
      name: null,
      topic: null,
      addMode: 'anyone',
      guestsCanTalk: true,
    },
    queue: [],
    messages: [],
    crowns: [{ roomId: id, userId: host.id, givenBy: host.id, givenAt: at }],
  };
}

export class OwnRoomSession {
  private roomId: string | null = null;
  /** True once the database holds the room (it was found, or the write that makes it has landed). */
  private made = false;
  private writes: Write[] = [];
  /** The run that is sending the writes now, or null. */
  private draining: Promise<void> | null = null;
  /** Counts every change made here, so a read that was out while one happened is not put over it. */
  private changes = 0;
  private closed = false;

  constructor(private readonly deps: OwnRoomDeps) {}

  /** The room's id, or null before `load` has answered. */
  id(): string | null {
    return this.roomId;
  }

  read(): WatchRoomRead | null {
    return this.roomId === null ? null : this.deps.store.get(this.roomId);
  }

  /** Writes still waiting to reach the database. */
  pending(): number {
    return this.writes.length;
  }

  /** Stops this session's writes: the person signed out, or another took its place. */
  close(): void {
    this.closed = true;
    this.writes = [];
  }

  /** Finds your room, or starts a blank one in the browser (written to the database with the first thing that needs it). */
  async load(): Promise<void> {
    const { repository, host } = this.deps;
    try {
      const found = await repository.findMusicRoom(host.id);
      if (this.closed) return;
      if (found !== null) {
        const read = await repository.readRoom(found.id);
        if (this.closed) return;
        if (read !== null) {
          this.made = true;
          this.adopt(read);
          return;
        }
      }
    } catch {
      // Out of reach: the room starts blank in the browser, and moves onto the real one when it can be written.
      if (this.closed) return;
    }
    this.adopt(blankRoom(this.deps.newId(), host, new Date(this.deps.now()).toISOString()));
  }

  /**
   * Reads the room again (a second device may have changed it). Nothing is read while writes are waiting: this
   * browser's copy is the newer one then, and they go first.
   */
  async refresh(): Promise<void> {
    await this.retry();
    if (this.closed || this.roomId === null || !this.made || this.writes.length > 0) return;
    const seen = this.changes;
    const read = await this.deps.repository.readRoom(this.roomId);
    // A change made here while the read was out makes this copy the newer one, even once its write has landed.
    if (this.closed || read === null || this.writes.length > 0 || seen !== this.changes) return;
    this.deps.store.prime(read);
  }

  private adopt(read: WatchRoomRead): void {
    this.roomId = read.room.id;
    this.deps.store.prime(read);
    this.deps.onRoom?.(read.room.id);
  }

  private stamp(): string {
    return new Date(this.deps.now()).toISOString();
  }

  private mine(): WatchRoomRead {
    const read = this.read();
    if (read === null) throw new Error('YOUR ROOM IS NOT READY YET.');
    return read;
  }

  private setRoom(patch: Partial<WatchRoom>): void {
    const read = this.mine();
    this.deps.store.apply(read.room.id, { kind: 'room', room: { ...read.room, ...patch, updatedAt: this.stamp() } });
  }

  /* --- the writes, one after another ---------------------------------------------------------------- */

  private push(kind: Write['kind'], run: () => Promise<void>): void {
    if (this.closed) return;
    // The room is written before the first thing that needs it.
    if (!this.made) {
      this.made = true;
      const { repository, host } = this.deps;
      const id = this.mine().room.id;
      this.writes.push({
        kind: 'other',
        run: async () => {
          try {
            const opened = await repository.openOwnRoom({ id, host });
            // Another device made the room first: this browser's copy moves onto it, and what it had queued goes along.
            if (opened.room.id !== id) this.moveOnto(opened, id);
          } catch (failure) {
            // Refused for good: the room was never made, so the next write asks for it again.
            if (failure instanceof OwnRoomRefusal) this.made = false;
            throw failure;
          }
        },
      });
    }
    // Where the song is: only the newest matters, so one still waiting is replaced.
    const last = this.writes[this.writes.length - 1];
    if (kind === 'playback' && last !== undefined && last.kind === 'playback' && !(this.draining !== null && this.writes.length === 1)) this.writes[this.writes.length - 1] = { kind, run };
    else this.writes.push({ kind, run });
    this.changes += 1;
    void this.drain();
  }

  /**
   * The browser's blank room gives way to the one the database already had. Everything this browser did meanwhile is
   * carried over in its copy: what waits, and what is on. Nothing extra is written for it: the writes still queued
   * behind the one that found this out name the room as it is when they run, so they land in the real one.
   */
  private moveOnto(opened: WatchRoomRead, from: string): void {
    const local = this.deps.store.get(from);
    this.roomId = opened.room.id;
    this.deps.store.prime(opened);
    this.deps.onRoom?.(opened.room.id);
    if (local === null) return;
    const on = local.queue.find((entry) => entry.id === local.room.currentEntryId);
    for (const entry of [...upcoming(local.queue), ...(on === undefined ? [] : [on])]) {
      this.deps.store.apply(opened.room.id, { kind: 'entry', entry: { ...entry, roomId: opened.room.id } });
    }
    if (on !== undefined) this.setRoom({ currentEntryId: on.id, positionSeconds: local.room.positionSeconds, isPlaying: local.room.isPlaying });
  }

  /**
   * Sends what is waiting, oldest first. Stops at a write that cannot reach the database; `retry` goes again. One run
   * at a time: asked again while one is out, the answer is that same run.
   */
  private drain(): Promise<void> {
    if (this.draining === null) {
      this.draining = this.send().then((outcome) => {
        this.draining = null;
        if (outcome === 'refused') void this.reread();
        // Something queued in the instant between the last write landing and this line: it goes now, not at the next press.
        if (outcome !== 'stuck' && this.writes.length > 0 && !this.closed) return this.drain();
      });
    }
    return this.draining;
  }

  /** `stuck`: a write could not reach the store and waits. `refused`: one was refused for good and let go of. */
  private async send(): Promise<'sent' | 'stuck' | 'refused'> {
    let refused = false;
    while (this.writes.length > 0 && !this.closed) {
      try {
        await this.writes[0].run();
        this.writes.shift();
      } catch (failure) {
        // A store in this browser is never out of reach: whatever it throws is a refusal.
        if (!(failure instanceof OwnRoomRefusal) && this.deps.repository.source !== 'mock') {
          this.deps.onWaiting?.(true);
          return 'stuck';
        }
        this.writes.shift();
        refused = true;
      }
    }
    this.deps.onWaiting?.(false);
    return refused ? 'refused' : 'sent';
  }

  /** After a refusal: the room is read again, so the browser's copy and the store's agree. */
  private async reread(): Promise<void> {
    if (this.closed || this.roomId === null || !this.made) return;
    const seen = this.changes;
    const read = await this.deps.repository.readRoom(this.roomId).catch(() => null);
    // Only if nothing was done here while the read was out: otherwise this copy is the newer one.
    if (read !== null && !this.closed && this.writes.length === 0 && seen === this.changes) this.deps.store.prime(read);
  }

  /** Tries the waiting writes again: the tab came back, or the network did. */
  async retry(): Promise<void> {
    if (this.writes.length > 0) await this.drain();
  }

  /** Waits for what is waiting to be sent; true when all of it reached the store (a visitor's queue is only emptied then). */
  async saved(): Promise<boolean> {
    await this.drain();
    return this.writes.length === 0;
  }

  /* --- what the bar and the screen tell the room ----------------------------------------------------- */

  /**
   * Something began playing that was not taken from the queue (a song pressed anywhere, the shelf walking on, PLAY on
   * a video): it is filed as a play, on now. The same thing already on is left as it is.
   */
  started(link: WatchLink): WatchQueueEntry | null {
    return this.begin((on) => on.link?.url === link.url, link, null);
  }

  /** The same for one of the site's own files (a FILES video): filed by the file, never copied. */
  startedFile(mediaItemId: string): WatchQueueEntry | null {
    return this.begin((on) => on.mediaItemId === mediaItemId, null, mediaItemId);
  }

  private begin(same: (on: WatchQueueEntry) => boolean, link: WatchLink | null, mediaItemId: string | null): WatchQueueEntry | null {
    if (this.closed || this.roomId === null) return null;
    const read = this.mine();
    const on = read.queue.find((entry) => entry.id === read.room.currentEntryId);
    // Already on: the bar's own play and pause say where it is (`playback`).
    if (on !== undefined && same(on)) return on;
    const at = this.stamp();
    const entry: WatchQueueEntry = {
      id: this.deps.newId(),
      roomId: read.room.id,
      position: nextQueuePosition([...read.queue]),
      inQueue: true,
      mediaItemId,
      link,
      series: null,
      addedBy: this.deps.host.id,
      addedAt: at,
      playedAt: at,
      playIndex: nextPlayIndex([...read.queue]),
    };
    this.deps.store.apply(read.room.id, { kind: 'entry', entry });
    this.setRoom({ currentEntryId: entry.id, positionSeconds: 0, isPlaying: true });
    const { repository, host } = this.deps;
    this.push('other', async () => {
      const roomId = this.mine().room.id;
      await repository.addOwnEntries(roomId, host.id, [{ ...entry, roomId }]);
      await repository.writePlayback(roomId, { currentEntryId: entry.id, positionSeconds: 0, isPlaying: true });
    });
    this.prune();
    return entry;
  }

  /** The next thing queued becomes what is on, from the top; null when nothing waits. */
  takeNext(): WatchQueueEntry | null {
    if (this.closed || this.roomId === null) return null;
    const read = this.mine();
    const next = upcoming([...read.queue])[0];
    if (next === undefined) return null;
    const playIndex = nextPlayIndex([...read.queue]);
    const entry: WatchQueueEntry = { ...next, playedAt: this.stamp(), playIndex };
    this.deps.store.apply(read.room.id, { kind: 'entry', entry });
    this.setRoom({ currentEntryId: entry.id, positionSeconds: 0, isPlaying: true });
    const { repository } = this.deps;
    this.push('other', () => repository.startEntry(this.mine().room.id, entry.id, playIndex));
    this.prune();
    return entry;
  }

  /**
   * ADD TO QUEUE (`end`) or PLAY NEXT (`next`). A thing is in the queue once: one already waiting moves instead of
   * being added twice. Throws when the queue is full.
   */
  enqueue(link: WatchLink, where: 'end' | 'next'): WatchQueueEntry {
    return this.put(link, null, where);
  }

  /** The same for one of the site's own files (a FILES video). */
  enqueueFile(mediaItemId: string, where: 'end' | 'next'): WatchQueueEntry {
    return this.put(null, mediaItemId, where);
  }

  private put(link: WatchLink | null, mediaItemId: string | null, where: 'end' | 'next'): WatchQueueEntry {
    const read = this.mine();
    const waiting = upcoming([...read.queue]);
    const position = where === 'next' ? frontPosition(read.queue) : nextQueuePosition([...read.queue]);
    const { repository, host } = this.deps;
    const held = waiting.find((entry) => entry.series === null && (link !== null ? entry.link?.url === link.url : entry.mediaItemId === mediaItemId));
    if (held !== undefined) {
      const moved = { ...held, position };
      this.deps.store.apply(read.room.id, { kind: 'entry', entry: moved });
      this.push('other', () => repository.reorderQueue([{ id: held.id, position }], host.id));
      return moved;
    }
    if (waiting.length >= OWN_QUEUE_MAX) throw new Error(OWN_QUEUE_FULL);
    const entry: WatchQueueEntry = {
      id: this.deps.newId(),
      roomId: read.room.id,
      position,
      inQueue: true,
      mediaItemId,
      link,
      series: null,
      addedBy: host.id,
      addedAt: this.stamp(),
      playedAt: null,
      playIndex: null,
    };
    this.deps.store.apply(read.room.id, { kind: 'entry', entry });
    this.push('other', () => {
      const roomId = this.mine().room.id;
      return repository.addOwnEntries(roomId, host.id, [{ ...entry, roomId }]);
    });
    return entry;
  }

  /** Several things onto the end, in order, in one write (a visitor's browser queue after they log in). */
  enqueueAll(links: readonly WatchLink[]): number {
    return this.enqueueThings(links.map((link) => ({ link })));
  }

  /**
   * The same for links and the site's own files together (LOAD A PLAYLIST): onto the end, in order, in one write.
   * A thing already waiting is not added twice, and the queue never holds more than its 200.
   */
  enqueueThings(things: readonly ({ link: WatchLink; mediaItemId?: undefined } | { mediaItemId: string; link?: undefined })[]): number {
    if (this.closed || this.roomId === null) return 0;
    const read = this.mine();
    const waiting = upcoming([...read.queue]);
    const keyOf = (thing: { link?: WatchLink | null; mediaItemId?: string | null }) => (thing.link ? thing.link.url : `file:${thing.mediaItemId}`);
    const known = new Set(waiting.map(keyOf));
    const room = Math.max(0, OWN_QUEUE_MAX - waiting.length);
    const fresh: WatchQueueEntry[] = [];
    let position = nextQueuePosition([...read.queue]);
    const at = this.stamp();
    for (const thing of things) {
      if (fresh.length >= room) break;
      if (known.has(keyOf(thing))) continue;
      known.add(keyOf(thing));
      fresh.push({ id: this.deps.newId(), roomId: read.room.id, position: position++, inQueue: true, mediaItemId: thing.mediaItemId ?? null, link: thing.link ?? null, series: null, addedBy: this.deps.host.id, addedAt: at, playedAt: null, playIndex: null });
    }
    if (fresh.length === 0) return 0;
    for (const entry of fresh) this.deps.store.apply(read.room.id, { kind: 'entry', entry });
    const { repository, host } = this.deps;
    this.push('other', () => {
      const roomId = this.mine().room.id;
      return repository.addOwnEntries(roomId, host.id, fresh.map((entry) => ({ ...entry, roomId })));
    });
    return fresh.length;
  }

  /**
   * END STREAM (SPEC-rooms-queues.md, phase 3): your own queue becomes what was still waiting in the live room's, in
   * its order. What waited here before goes (it went into the live room when you went live); the plays kept stay.
   * Two writes at most: one delete, one insert.
   */
  replaceWaiting(things: readonly ({ link: WatchLink; mediaItemId?: undefined } | { mediaItemId: string; link?: undefined })[]): number {
    if (this.closed || this.roomId === null) return 0;
    const read = this.mine();
    const { repository, host } = this.deps;
    const old = upcoming([...read.queue]).map((entry) => entry.id);
    for (const id of old) this.deps.store.apply(read.room.id, { kind: 'removed', table: 'queue', id });
    if (old.length > 0) this.push('other', () => repository.removeOwnEntries(this.mine().room.id, host.id, old));

    const at = this.stamp();
    let position = nextQueuePosition([...this.mine().queue]);
    const fresh: WatchQueueEntry[] = things.slice(0, OWN_QUEUE_MAX).map((thing) => ({
      id: this.deps.newId(),
      roomId: read.room.id,
      position: position++,
      inQueue: true,
      mediaItemId: thing.mediaItemId ?? null,
      link: thing.link ?? null,
      series: null,
      addedBy: host.id,
      addedAt: at,
      playedAt: null,
      playIndex: null,
    }));
    for (const entry of fresh) this.deps.store.apply(read.room.id, { kind: 'entry', entry });
    if (fresh.length > 0) {
      this.push('other', () => {
        const roomId = this.mine().room.id;
        return repository.addOwnEntries(roomId, host.id, fresh.map((entry) => ({ ...entry, roomId })));
      });
    }
    return fresh.length;
  }

  /** Paused, resumed, or a seek that has settled: where the thing on now is, as of this press. Never called on a clock. */
  playback(positionSeconds: number, isPlaying: boolean): void {
    if (this.closed || this.roomId === null) return;
    const read = this.mine();
    if (read.room.currentEntryId === null) return;
    const place = Math.max(0, Math.round(positionSeconds * 1000) / 1000);
    // What the room already says (a play that has just been filed, a second pause): nothing new, nothing written.
    const written = Date.parse(read.room.updatedAt);
    const said = read.room.isPlaying ? read.room.positionSeconds + Math.max(0, (this.deps.now() - (Number.isNaN(written) ? this.deps.now() : written)) / 1000) : read.room.positionSeconds;
    if (read.room.isPlaying === isPlaying && Math.abs(said - place) < SAME_PLACE_SECONDS) return;
    this.setRoom({ positionSeconds: place, isPlaying });
    const { repository } = this.deps;
    const currentEntryId = read.room.currentEntryId;
    this.push('playback', () => repository.writePlayback(this.mine().room.id, { currentEntryId, positionSeconds: place, isPlaying }));
  }

  /** What was on has finished and nothing follows it: the room says so, once. */
  stopped(): void {
    if (this.closed || this.roomId === null) return;
    const read = this.mine();
    if (read.room.currentEntryId === null || !read.room.isPlaying) return;
    this.playback(0, false);
  }

  private prune(): void {
    const read = this.mine();
    const ids = playsToPrune(read.queue, read.room.currentEntryId);
    if (ids.length === 0) return;
    for (const id of ids) this.deps.store.apply(read.room.id, { kind: 'removed', table: 'queue', id });
    const { repository, host } = this.deps;
    this.push('other', () => repository.removeOwnEntries(this.mine().room.id, host.id, ids));
  }
}
