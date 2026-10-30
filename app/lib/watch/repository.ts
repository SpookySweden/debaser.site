import { isSupabaseConfigured } from '../supabase/client';
import { getMockWatchRepository } from './mock-watch-repository';
import { getSupabaseWatchRepository } from './supabase-watch-repository';
import type { StreamFold, WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoom, WatchRoomRead, WatchingEntry, WatchingMap } from './types';

/**
 * Where stream rooms live (SPEC-watch-together.md).
 *
 * Supabase means the `watch_rooms`, `watch_queue` and `watch_messages` tables
 * (supabase/migrations/20261027120000_watch_rooms.sql) and two kinds of Realtime Presence channel: one per
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
  mediaItemId: string;
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

/** One addition to a queue: a catalogue file or a link, never both. */
export type AddToQueueInput = { roomId: string; addedBy: string; position: number } & ({ mediaItemId: string; link?: undefined } | { link: WatchLink; mediaItemId?: undefined });

/** One write to a room, as `subscribeRoom` hands it over. `refresh` means "read it again". */
export type RoomChange =
  | { kind: 'room'; room: WatchRoom }
  | { kind: 'entry'; entry: WatchQueueEntry }
  | { kind: 'message'; message: WatchMessage }
  | { kind: 'removed'; table: 'queue' | 'messages'; id: string }
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
  /** GO LIVE: the room, its first file as play 0, on screen and playing. Throws with a sentence fit to show. */
  openRoom(input: OpenRoomInput): Promise<WatchRoomRead>;
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
  removeFromQueue(entryId: string): Promise<void>;
  reorderQueue(moves: { id: string; position: number }[]): Promise<void>;
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
