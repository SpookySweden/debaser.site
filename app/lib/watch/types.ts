/**
 * Watch together's shapes (SPEC-watch-together.md).
 *
 * A room is a pointer, like a music broadcast (`lib/audio/broadcast.ts`): which play of which file, where
 * in it, and when that was true. The video is never streamed; every viewer's browser fetches the same
 * file from the catalogue and seeks to where the host is.
 */

export type WatchRoom = {
  id: string;
  /** Who pressed GO LIVE: the forum record and the file folds name this account, whoever hosts later. */
  originalHostId: string;
  originalHostLabel: string;
  /** Who runs the transport now. */
  hostId: string;
  forumThreadId: string | null;
  /** The play on screen (a `WatchQueueEntry` id). */
  currentEntryId: string | null;
  /** Where in it the host was, at `updatedAt`. */
  positionSeconds: number;
  isPlaying: boolean;
  startedAt: string;
  /** Stamped by the store on every write: the host's heartbeat, and the moment `positionSeconds` was true. */
  updatedAt: string;
  /** Null while live. */
  endedAt: string | null;
};

/** One file added to a room's queue. A play is a row: a file added twice is two rows. */
export type WatchQueueEntry = {
  id: string;
  roomId: string;
  /** The order of what is still to play. */
  position: number;
  /** Null once the file has left the catalogue. */
  mediaItemId: string | null;
  addedBy: string | null;
  addedAt: string;
  /** Set when it started playing. */
  playedAt: string | null;
  /** The order it actually played in (0, 1, 2...); null until it plays. */
  playIndex: number | null;
};

export type WatchMessage = {
  id: string;
  roomId: string;
  queueEntryId: string | null;
  mediaItemId: string | null;
  authorId: string;
  authorLabel: string;
  body: string;
  /** Where in the video it was said. */
  mediaSeconds: number;
  createdAt: string;
};

/** A room with everything the window and the forum record draw. */
export type WatchRoomRead = {
  room: WatchRoom;
  queue: WatchQueueEntry[];
  messages: WatchMessage[];
};

/** One tab in a room, as its presence channel carries it. Guests have no account. */
export type WatchMember = {
  /** One per tab, so one account in two tabs is two members. */
  key: string;
  userId: string | null;
  name: string;
  /** When this tab joined, on its own clock: the handover order. */
  joinedAt: number;
};

/** One signed-in account in a live room, as the site-wide watching channel carries it (the `[ TV ]` key). */
export type WatchingEntry = {
  userId: string;
  roomId: string;
  hostName: string;
  /** The file on screen, for the key's tip. */
  title: string;
  hosting: boolean;
};

/** The site-wide watching room: account id -> what they are watching. */
export type WatchingMap = Record<string, WatchingEntry>;

/** One stream that played a file: the archive's fold under that file (decision 8). */
export type StreamFold = {
  room: Pick<WatchRoom, 'id' | 'originalHostId' | 'originalHostLabel' | 'startedAt' | 'updatedAt' | 'endedAt' | 'forumThreadId'>;
  messages: WatchMessage[];
};
