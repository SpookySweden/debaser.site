import { isSupabaseConfigured } from '../supabase/client';
import { getMockWatchRepository } from './mock-watch-repository';
import { getSupabaseWatchRepository } from './supabase-watch-repository';
import type { LiveRoom, QueueMove, RoomAddMode, StreamFold, WatchCrown, WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Where stream rooms live (SPEC-watch-together.md).
 *
 * Supabase means the `watch_rooms`, `watch_queue` and `watch_messages` tables
 * (supabase/migrations/20261027120000_watch_rooms.sql), `watch_crowns` and the queue's `in_queue` mark
 * (20261102192043_watch_queue_additions.sql), and two kinds of Realtime Presence channel: one per
 * room (`watch:<id>`, who is in it) and one for the site (`site-watching`, what the `[ TV ]` key reads).
 * The mock keeps it all in this browser (localStorage, and a BroadcastChannel between its tabs), like the
 * other mocks. Default is the mock:
 *
 *   NEXT_PUBLIC_WATCH_DATA_SOURCE=supabase
 */
export type WatchDataSource = 'mock' | 'supabase';

export const WATCH_DATA_SOURCE: WatchDataSource =
  process.env.NEXT_PUBLIC_WATCH_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export type OpenRoomInput = {
  /** Made by the caller, so the forum thread can name the room before either is written. */
  id: string;
  host: { id: string; label: string };
  /** The first file, as play 0; null opens the room empty, its screen black (GO LIVE on CYTUBE, SPEC-cytube.md). */
  mediaItemId: string | null;
};

/**
 * GO PUBLIC (SPEC-music-queues.md): the host's music room, opened or reopened from what their player has on
 * (`playing`, where it is and whether it plays) and their up-next. See `goPublicPlan` for what is written.
 */
export type OpenMusicRoomInput = {
  /** Made by the caller; used only when the host has no music room yet. */
  id: string;
  host: { id: string; label: string };
  playing: WatchLink | null;
  positionSeconds: number;
  isPlaying: boolean;
  upNext: WatchLink[];
};

/** The host plays something from outside the queue (SPEC-music-queues.md, off-queue plays): its row, as it is filed. */
export type PlayNowInput = { roomId: string; by: string; link: WatchLink; position: number; playIndex: number };

export type RoomSettingsInput = {
  roomId: string;
  by: string;
  name: string;
  topic: string;
  addMode: RoomAddMode;
};

export type PlaybackPatch = {
  currentEntryId: string | null;
  positionSeconds: number;
  isPlaying: boolean;
};

export type SendMessageInput = {
  roomId: string;
  queueEntryId: string | null;
  mediaItemId: string | null;
  author: { id: string; label: string };
  body: string;
  mediaSeconds: number;
};

/**
 * One addition: a catalogue file or a link, never both. `inQueue` puts it straight into the queue, which
 * only a crown may do (`addsTo` in rules.ts); otherwise it waits on the adder's own list.
 */
export type AddToQueueInput = { roomId: string; addedBy: string; position: number; inQueue: boolean } & (
  | { mediaItemId: string; link?: undefined }
  | { link: WatchLink; mediaItemId?: undefined }
);

/**
 * A series' episodes added in one go (SPEC-stream-series.md): one row per episode, all at one place and one
 * moment, sharing a new series id, numbered in the order given. The same rules as `AddToQueueInput`.
 */
export type AddSeriesInput = { roomId: string; addedBy: string; position: number; inQueue: boolean; seriesTitle: string; links: WatchLink[] };

/** One write to a room, as `subscribeRoom` hands it over. `refresh` means "read it again". */
export type RoomChange =
  | { kind: 'room'; room: WatchRoom }
  | { kind: 'entry'; entry: WatchQueueEntry }
  | { kind: 'message'; message: WatchMessage }
  | { kind: 'removed'; table: 'queue' | 'messages'; id: string }
  | { kind: 'crown'; crown: WatchCrown }
  | { kind: 'uncrowned'; userId: string }
  | { kind: 'refresh' };

/** One tab's place in a room, while it is there. */
export type RoomMembership = {
  /** Leaves the room's presence channel. */
  leave: () => void;
};

export type WatchRepository = {
  readonly source: WatchDataSource;
  /** The room with its queue and chat, or null if there is no such room. Throws on a failed read. */
  readRoom(roomId: string): Promise<WatchRoomRead | null>;
  /** GO LIVE: the room, with its first file as play 0 on screen and playing, or empty. Throws with a sentence fit to show. */
  openRoom(input: OpenRoomInput): Promise<WatchRoomRead>;
  /** The host's one music room, kept whether or not it is public; null when they never went public. */
  findMusicRoom(hostId: string): Promise<WatchRoom | null>;
  /** GO PUBLIC: opens (or reopens) the host's music room and switches it on. Throws with a sentence fit to show. */
  openMusicRoom(input: OpenMusicRoomInput): Promise<WatchRoomRead>;
  /** A music room's switch; nothing in it is cleared when it goes off. */
  setRoomPublic(roomId: string, isPublic: boolean): Promise<void>;
  /** The settings cog: the host's or a crown's. Throws with a sentence fit to show. */
  saveRoomSettings(input: RoomSettingsInput): Promise<void>;
  /**
   * An off-queue play: the host played a song from a post, a profile or PLAY FOR YOU, and it slots into the queue at
   * the current spot as playing (a played row, on screen from the start), so the queue never lies.
   */
  playNow(input: PlayNowInput): Promise<WatchQueueEntry>;
  /**
   * STORE AND START BLANK, once the queue is saved: what is still queued is taken out (a crown's to take), people's
   * additions stay on their lists, and the window shows only what plays from now (`clearedAt`, the host's to set).
   */
  clearRoomQueue(roomId: string, by: string): Promise<void>;
  /** Every room not ended (music rooms public or not), with what is on in each: the QUEUES list sorts them out. */
  listLiveRooms(): Promise<LiveRoom[]>;
  /** Fires when any room changes, for the QUEUES list. */
  subscribeLiveRooms(listener: () => void): () => void;
  attachThread(roomId: string, threadId: string): Promise<void>;
  /** The host's write: what is on, where, playing or not. Also the heartbeat. */
  writePlayback(roomId: string, patch: PlaybackPatch): Promise<void>;
  /** The host moves on to an entry: marks it played (`playIndex`) and puts it on screen from the start. */
  startEntry(roomId: string, entryId: string, playIndex: number): Promise<void>;
  /** The host hands the transport to another account in the room. */
  handOver(roomId: string, toUserId: string): Promise<void>;
  /** A watcher takes over from a host who vanished. True when this call won (`watch_take_over`). */
  takeOver(roomId: string, goneHostId: string, callerId: string): Promise<boolean>;
  endRoom(roomId: string): Promise<void>;
  /** Closes a room nobody has written for minutes. True when it was closed by this call. */
  closeStale(roomId: string): Promise<boolean>;
  addToQueue(input: AddToQueueInput): Promise<WatchQueueEntry>;
  /** A series as one block of rows, in one write however many episodes it has. */
  addSeriesToQueue(input: AddSeriesInput): Promise<WatchQueueEntry[]>;
  /**
   * Takes out what has not played: a crown, from the queue or anybody's list; or `by`'s own addition.
   * `by` (and below) is who asks: the database knows from the session, the mock keeps the rule by hand.
   */
  removeFromQueue(entryId: string, by: string): Promise<void>;
  /** Every episode of a series' add that has not played, under the same rules as `removeFromQueue`. */
  removeSeries(seriesId: string, by: string): Promise<void>;
  /** A crown's reorder, or an addition pulled in (`pull`) with the places around it; a `series` move places a whole block. */
  reorderQueue(moves: QueueMove[], by: string): Promise<void>;
  /** The host gives (`crowned`) or takes a crown, their own included: the crown given, or null once taken. */
  setCrown(roomId: string, userId: string, crowned: boolean, by: string): Promise<WatchCrown | null>;
  sendMessage(input: SendMessageInput): Promise<WatchMessage>;
  deleteMessage(messageId: string): Promise<void>;
  /** Every stream that played one of these files, newest first, each with what was said over that file. */
  listStreamFolds(mediaItemIds: string[]): Promise<Record<string, StreamFold[]>>;
  /**
   * Hears every write to the room, its queue and its chat. A change carries the written row where the
   * store has it, so the host's heartbeat (a room write every few seconds) is applied without a read.
   */
  subscribeRoom(roomId: string, onChange: (change: RoomChange) => void): () => void;
  /** Fires when any stream plays a file or anybody says something: what the archive's folds redraw on. */
  subscribeStreamActivity(listener: () => void): () => void;
  /** Joins the room's presence as this tab; `onMembers` hears everybody in it, this tab included. */
  joinRoom(roomId: string, me: Omit<WatchMember, 'joinedAt'>, onMembers: (members: WatchMember[]) => void): RoomMembership;
  /** The site-wide watching room. Null while it cannot be reached. */
  subscribeWatching(listener: (watching: WatchingMap | null) => void): () => void;
  /** This tab's line in it: joins on the first, says it again on a change, leaves on null. */
  setWatching(entry: WatchingEntry | null): void;
};

let repository: WatchRepository | null = null;

export function getWatchRepository(): WatchRepository {
  if (repository === null) {
    repository = WATCH_DATA_SOURCE === 'supabase' ? getSupabaseWatchRepository() : getMockWatchRepository();
  }

  return repository;
}

export type { WatchRoom };
