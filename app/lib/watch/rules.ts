import type { ForumAnchor, ForumThread } from '../forum/types';
import type { QueueMove, WatchCrown, WatchMember, WatchQueueEntry, WatchRoom, WatchRoomRead } from './types';

/**
 * Watch together's rules, pure so each can be checked without two browsers (SPEC-watch-together.md).
 *
 * **Timing.** The host writes the room on every change and on a heartbeat. Followers read the pair
 * `positionSeconds` + `updatedAt` the way the music follower does (`lib/audio/broadcast.ts`): where the
 * host is now is the position plus the row's age, so the two clocks never have to agree on the hour.
 */

/** How often a live host writes the room, playing or paused: the row's age is also the host's pulse. */
export const WATCH_HEARTBEAT_MS = 3000;

/**
 * A live room whose host has not written for this long reads as over (the record stops saying LIVE).
 * A minute and a half, not seconds: a paused host in a background tab may be throttled to a beat a minute.
 */
export const ROOM_QUIET_SECONDS = 90;

/** A room quiet this long is closed by whoever reads it (`watch_close_stale` holds the same 3 minutes). */
export const STALE_CLOSE_SECONDS = 3 * 60 + 5;

/** The database refuses a take-over until the host has been quiet this long (`watch_take_over`). */
export const TAKE_OVER_QUIET_MS = 8000;

/** How often the longest-present watcher asks to take over while the host is missing from the room. */
export const TAKE_OVER_RETRY_MS = 2000;

/** Followers jump when they are this far off; inside it they nudge their speed. */
export const SEEK_GAP_SECONDS = 2;
/** Inside this nobody is nudged: two machines reading one row are never closer than this. */
export const SETTLE_GAP_SECONDS = 0.35;
/** The nudge: a touch fast to catch up, a touch slow to let the host catch up. */
export const CATCH_UP_RATE = 1.1;
export const HOLD_BACK_RATE = 0.92;

export const MESSAGE_MAX_LENGTH = 500;

/** A write the room's rules refused: both stores say it in these words (no database message reaches the screen). */
export const NOT_ALLOWED = 'NOT ALLOWED: THE STREAM MAY HAVE ENDED, OR ITS HOST OR CROWNS CHANGED.';

/* --- the clock ----------------------------------------------------------------------------------- */

/**
 * How far this device's clock runs ahead of the database's, as best it can be told: each room row that
 * arrives by realtime was written a moment ago, so `now - updatedAt` is the skew plus a little network.
 * The smallest recent reading wins (the `calibrateClock` rule in broadcast.ts).
 */
const skewReadings: number[] = [];

export function calibrateWatchClock(updatedAt: string, now: number): void {
  const written = Date.parse(updatedAt);
  if (Number.isNaN(written)) return;

  const reading = now - written;
  if (Math.abs(reading) > 120000) return;

  skewReadings.push(reading);
  if (skewReadings.length > 12) skewReadings.shift();
}

export function watchClockSkewMs(): number {
  return skewReadings.length < 2 ? 0 : Math.min(...skewReadings);
}

export function resetWatchClock(): void {
  skewReadings.length = 0;
}

/** Seconds since the host last wrote the room, on the database's clock. */
export function roomAgeSeconds(room: Pick<WatchRoom, 'updatedAt'>, now: number): number {
  const written = Date.parse(room.updatedAt);

  return Number.isNaN(written) ? 0 : Math.max(0, (now - watchClockSkewMs() - written) / 1000);
}

/** Live: not ended, and the host has written recently. */
export function roomIsLive(room: Pick<WatchRoom, 'endedAt' | 'updatedAt'>, now: number): boolean {
  return room.endedAt === null && roomAgeSeconds(room, now) <= ROOM_QUIET_SECONDS;
}

/**
 * Where the host is now, in seconds of the file: walked forward while playing, held while paused,
 * and never past the end (`duration`, when known) - a host at the end is about to loop or advance.
 */
export function hostPosition(room: WatchRoom, now: number, duration?: number): number {
  const at = room.isPlaying ? room.positionSeconds + roomAgeSeconds(room, now) : room.positionSeconds;
  const floor = Math.max(0, at);

  return duration !== undefined && Number.isFinite(duration) && duration > 0 ? Math.min(floor, duration) : floor;
}

/* --- the queue ----------------------------------------------------------------------------------- */

/** What has played (and is playing), in the order it played: the forum record's list. */
export function playOrder(queue: WatchQueueEntry[]): WatchQueueEntry[] {
  return queue.filter((entry) => entry.playIndex !== null).sort((a, b) => (a.playIndex ?? 0) - (b.playIndex ?? 0));
}

/** What is still to play, in queue order: rows in the queue, never somebody's waiting addition. */
export function upcoming(queue: WatchQueueEntry[]): WatchQueueEntry[] {
  return queue
    .filter((entry) => entry.inQueue && entry.playedAt === null)
    .sort((a, b) => a.position - b.position || a.addedAt.localeCompare(b.addedAt));
}

/** Additions waiting on people's own lists for a crown to pull them in, oldest first (SPEC-stream-queue.md). */
export function waitingAdditions(queue: WatchQueueEntry[]): WatchQueueEntry[] {
  return queue.filter((entry) => !entry.inQueue && entry.playedAt === null).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export function currentEntry(read: WatchRoomRead): WatchQueueEntry | undefined {
  return read.queue.find((entry) => entry.id === read.room.currentEntryId);
}

/** The next play's index: one past the highest so far. */
export function nextPlayIndex(queue: WatchQueueEntry[]): number {
  return queue.reduce((highest, entry) => Math.max(highest, entry.playIndex ?? -1), -1) + 1;
}

/** Where a new entry goes: after everything still to play. */
export function nextQueuePosition(queue: WatchQueueEntry[]): number {
  return queue.reduce((highest, entry) => Math.max(highest, entry.position), -1) + 1;
}

/** `3 OF 5`: the play on screen among everything played and still to play. */
export function queueBadge(read: WatchRoomRead): string {
  const played = playOrder(read.queue);
  const current = currentEntry(read);
  const index = current === undefined ? played.length : played.findIndex((entry) => entry.id === current.id) + 1;

  return `${Math.max(1, index)} OF ${Math.max(1, played.length + upcoming(read.queue).length)}`;
}

/**
 * The reorder the host asked for: `entryId` swaps with its neighbour among the upcoming entries.
 * Returns the two new positions to write, or [] when it is already at that end.
 */
export function moveInQueue(queue: WatchQueueEntry[], entryId: string, direction: -1 | 1): { id: string; position: number }[] {
  const waiting = upcoming(queue);
  const at = waiting.findIndex((entry) => entry.id === entryId);
  const other = waiting[at + direction];
  if (at === -1 || other === undefined) return [];

  const mine = waiting[at];
  // Positions can tie (two adds in one moment); a swap of equal numbers would change nothing.
  const [low, high] = [Math.min(mine.position, other.position), Math.max(mine.position, other.position)];
  const lowFor = direction === 1 ? other : mine;
  const highFor = direction === 1 ? mine : other;

  return [
    { id: lowFor.id, position: low },
    { id: highFor.id, position: high === low ? low + 1 : high },
  ];
}

/**
 * A crown's drop (SPEC-stream-queue.md): `entryId` - an addition, or a row already in the queue - lands at
 * `index` among what is still to play, counted without it. From where the queue starts now, each row takes
 * the next place in turn; only the rows whose place changes are written, with `pull` on an addition coming
 * in. [] when nothing would change, or for something that has played.
 */
export function placeInQueue(queue: WatchQueueEntry[], entryId: string, index: number): QueueMove[] {
  const entry = queue.find((candidate) => candidate.id === entryId);
  if (entry === undefined || entry.playedAt !== null) return [];

  const waiting = upcoming(queue);
  const rest = waiting.filter((candidate) => candidate.id !== entryId);
  const at = Math.max(0, Math.min(Math.floor(index), rest.length));
  const order = [...rest.slice(0, at), entry, ...rest.slice(at)];
  // An empty queue keeps the entry's own number: only being in it matters then.
  const start = waiting.length > 0 ? Math.min(...waiting.map((each) => each.position)) : entry.position;

  return order.flatMap((each, offset) => {
    const position = start + offset;
    const pull = each.id === entryId && !each.inQueue;
    if (each.position === position && !pull) return [];
    return [pull ? { id: each.id, position, pull: true } : { id: each.id, position }];
  });
}

/** Where a pointer at height `y` drops among rows whose middles are `middles`, top to bottom: 0 is above them all. */
export function dropSlot(middles: number[], y: number): number {
  return middles.filter((middle) => y > middle).length;
}

/* --- crowns (SPEC-stream-queue.md) ---------------------------------------------------------------- */

export function hasCrown(crowns: WatchCrown[], userId: string | null): boolean {
  return userId !== null && crowns.some((crown) => crown.userId === userId);
}

/** What one person may do in a room's queue window. The database holds the same rules (watch_queue_guard). */
export type QueueRights = {
  /** Signed in and the room is live. */
  add: boolean;
  /** Where ADD puts a video: straight into the queue with a crown, otherwise onto their own list. */
  addsTo: 'queue' | 'list';
  /** Pull additions in, reorder the queue, take out what has not played: a crown, host or not. */
  arrange: boolean;
  /** Give and take crowns, their own included: the host alone. */
  crown: boolean;
  /** The right half: everybody's folds (the host and the crowned), only their own list, or nothing at all. */
  sees: 'people' | 'mine' | 'nothing';
};

export function queueRights(room: Pick<WatchRoom, 'hostId' | 'endedAt'>, crowns: WatchCrown[], userId: string | null, live: boolean): QueueRights {
  const open = live && room.endedAt === null && userId !== null;
  const crowned = open && hasCrown(crowns, userId);
  const hosting = open && room.hostId === userId;

  return {
    add: open,
    addsTo: crowned ? 'queue' : 'list',
    arrange: crowned,
    crown: hosting,
    sees: !open ? 'nothing' : hosting || crowned ? 'people' : 'mine',
  };
}

/** Your own addition is yours to take back until a crown pulls it in. */
export function mayTakeBack(entry: WatchQueueEntry, userId: string | null): boolean {
  return userId !== null && entry.addedBy === userId && !entry.inQueue && entry.playedAt === null;
}

/** One person in the right half the host and the crowned see. */
export type AdditionsPerson = {
  userId: string;
  /** As the room's presence has it; empty for somebody who has left (the window asks their profile). */
  name: string;
  host: boolean;
  crowned: boolean;
  present: boolean;
  /** Their additions still waiting, oldest first. */
  additions: WatchQueueEntry[];
};

/**
 * Who the right half lists for the host and the crowned: everybody in the room now, and anybody with an
 * addition waiting or a crown even after leaving, so anybody present can be crowned and any crown taken off.
 * The host first, then the room in the order people came in, then those who have left, by when their first
 * waiting addition or their crown arrived.
 */
export function additionsPeople(read: Pick<WatchRoomRead, 'room' | 'queue' | 'crowns'>, members: WatchMember[]): AdditionsPerson[] {
  const waiting = waitingAdditions(read.queue);
  const people = new Map<string, AdditionsPerson>();
  const list = (userId: string, name: string, present: boolean) => {
    if (people.has(userId)) return;
    people.set(userId, {
      userId,
      name,
      host: userId === read.room.hostId,
      crowned: hasCrown(read.crowns, userId),
      present,
      additions: waiting.filter((entry) => entry.addedBy === userId),
    });
  };

  const here = accountsPresent(members);
  const host = here.find((member) => member.userId === read.room.hostId);
  list(read.room.hostId, host?.name ?? '', host !== undefined);
  for (const member of here) if (member.userId !== null) list(member.userId, member.name, true);

  const since = new Map<string, string>();
  for (const entry of waiting) if (entry.addedBy !== null && !since.has(entry.addedBy)) since.set(entry.addedBy, entry.addedAt);
  for (const crown of read.crowns) {
    const known = since.get(crown.userId);
    if (known === undefined || crown.givenAt < known) since.set(crown.userId, crown.givenAt);
  }
  for (const [userId] of [...since].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))) list(userId, '', false);

  return [...people.values()];
}

/* --- who is in the room -------------------------------------------------------------------------- */

/** The accounts in the room, each once, by the earliest tab it has there. Guests are not accounts. */
export function accountsPresent(members: WatchMember[]): WatchMember[] {
  const byUser = new Map<string, WatchMember>();
  for (const member of members) {
    if (member.userId === null) continue;
    const known = byUser.get(member.userId);
    if (known === undefined || member.joinedAt < known.joinedAt) byUser.set(member.userId, member);
  }

  return [...byUser.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.key.localeCompare(b.key));
}

export function guestsPresent(members: WatchMember[]): number {
  return members.filter((member) => member.userId === null).length;
}

/** Who hosts when `leavingId` goes: the signed-in account in the room longest, or null if nobody else. */
export function handoverTo(members: WatchMember[], leavingId: string): WatchMember | null {
  return accountsPresent(members).find((member) => member.userId !== leavingId) ?? null;
}

/**
 * Whether this tab is the one that should take over from a host who is missing from the room: it is
 * the earliest tab of the longest-present account that is not the host.
 */
export function shouldTakeOver(members: WatchMember[], hostId: string, myKey: string): boolean {
  if (members.some((member) => member.userId === hostId)) return false;

  const heir = handoverTo(members, hostId);
  return heir !== null && heir.key === myKey;
}

/* --- following ----------------------------------------------------------------------------------- */

export type ViewerClock = {
  seconds: number;
  duration: number;
  playing: boolean;
  ended: boolean;
};

export type ViewerStep = {
  /** Where to put the playhead, or undefined to leave it. */
  at: number | undefined;
  rate: number;
  playing: boolean;
};

/**
 * One step of following the host: jump when well off, nudge the speed when a little off, hold when
 * close; pause with a paused host. At the end of the file (the host is about to loop or move on) it
 * waits rather than restarting the file itself.
 */
export function viewerStep(room: WatchRoom, mine: ViewerClock, now: number): ViewerStep {
  const target = hostPosition(room, now, mine.duration);
  const nearEnd = Number.isFinite(mine.duration) && mine.duration > 0 && target >= mine.duration - 0.3;

  if (!room.isPlaying) {
    return { at: Math.abs(target - mine.seconds) > 0.5 ? target : undefined, rate: 1, playing: false };
  }

  if (mine.ended && nearEnd) return { at: undefined, rate: 1, playing: false };

  const gap = target - mine.seconds;
  if (Math.abs(gap) > SEEK_GAP_SECONDS) return { at: target, rate: 1, playing: true };
  if (gap > SETTLE_GAP_SECONDS) return { at: undefined, rate: CATCH_UP_RATE, playing: true };
  if (gap < -SETTLE_GAP_SECONDS) return { at: undefined, rate: HOLD_BACK_RATE, playing: true };

  return { at: undefined, rate: 1, playing: true };
}

/* --- words --------------------------------------------------------------------------------------- */

/** Where in a video something was said: `02:14`, or `1:02:14` past the hour. */
export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';

  const whole = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${pad(minutes)}:${pad(whole % 60)}`;
}

/** The day a stream started, as the site stamps days (UTC, `2026-10-27`). */
export function streamDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The forum thread's title (decision 9). */
export function streamThreadTitle(hostName: string, startedAt: string): string {
  return `STREAM :: ${hostName.toUpperCase()} :: ${streamDate(startedAt)}`;
}

/** The fold under a file (decision 8). */
export function streamFoldLabel(hostName: string, startedAt: string, messages: number): string {
  return `${streamDate(startedAt)} :: HOSTED BY ${hostName.toUpperCase()} :: ${messages} MESSAGE${messages === 1 ? '' : 'S'}`;
}

/* --- the forum record ---------------------------------------------------------------------------- */

const STREAM_ANCHOR_PREFIX = 'watch:';

/**
 * The board anchor a stream's thread is filed under. A *board* anchor, so the one-thread-per-item
 * rule (`forum_threads_anchor_key`, non-board anchors only) never applies; the id names the room.
 */
export function streamAnchor(roomId: string): ForumAnchor {
  return { kind: 'board', id: `${STREAM_ANCHOR_PREFIX}${roomId}`, label: 'STREAM' };
}

/** The room a thread is the record of, or null for every other thread. */
export function streamRoomId(anchor: ForumAnchor): string | null {
  return anchor.kind === 'board' && anchor.id.startsWith(STREAM_ANCHOR_PREFIX) ? anchor.id.slice(STREAM_ANCHOR_PREFIX.length) : null;
}

export function isStreamThread(thread: Pick<ForumThread, 'anchor'>): boolean {
  return streamRoomId(thread.anchor) !== null;
}
