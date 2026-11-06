/**
 * Watch together's shapes (SPEC-watch-together.md).
 *
 * A room is a pointer, like a music broadcast (`lib/audio/broadcast.ts`): which play of which file, where
 * in it, and when that was true. The video is never streamed; every viewer's browser fetches the same
 * file from the catalogue and seeks to where the host is.
 */

/** WHO CAN JOIN (SPEC-privacy-phase-2.md): new rooms are private unless their host picks otherwise. */
export type RoomPrivacy = 'private' | 'password' | 'open';

/** What a person with a room's link may know before they are in (`watch_room_door`). `title` is null with no session. */
export type RoomDoor = {
  found: boolean;
  live: boolean;
  privacy: RoomPrivacy | null;
  title: string | null;
  member: boolean;
  removed: boolean;
  lockedUntil: string | null;
};

/** The way in: `watch_join`'s answer. */
export type JoinAnswer = 'joined' | 'wrong' | 'locked' | 'removed' | 'ended' | 'refused';

/** Three sizes of bar, never the real length (decision 13). */
export type PrivateSize = 'short' | 'medium' | 'long';

/** One message as an outsider gets it: no words (SPEC-privacy-phase-3.md). */
export type PrivateLine = { tag: string; seconds: number; size: PrivateSize };

/** A private room as somebody with its link and no way in gets it (`watch_room_outline`). */
export type RoomOutline = {
  live: boolean;
  people: string[];
  messages: PrivateLine[];
  queue: number;
  strokes: number;
  strokePeople: number;
};

/** A line on the ROOM tab: counts, and no link. */
export type PrivateRoomLine = { joined: number; messages: number; strokes: number };

/** `1 PRIVATE STREAM`, in bars, under a file. */
export type PrivateFold = { mediaItemId: string; rooms: number; sizes: PrivateSize[] };

/** Somebody who joined a room, for the cog's list. */
export type RoomMemberRow = {
  roomId: string;
  userId: string;
  label: string;
  removedAt: string | null;
};

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
  /** Null while live. A music room is never ended: it is kept, and switched on and off (`isPublic`). */
  endedAt: string | null;
  /**
   * `stream`: GO LIVE on a video. `music`: somebody's music, opened by GO PUBLIC (SPEC-music-queues.md):
   * one per person, kept for good, its host always its owner, never on the board.
   */
  origin: RoomOrigin;
  /** A music room's GO PUBLIC switch; a stream room is always on. Who may join is `privacy`. */
  isPublic: boolean;
  /** Changed only through `setRoomPrivacy`. A music room's follows its switch: on is open, off is its host's alone. */
  privacy: RoomPrivacy;
  /** STORE AND START BLANK: what played before this is no longer shown in the queue window. */
  clearedAt: string | null;
  /** The settings cog (SPEC-room-settings.md). Null: the room goes by its host's name. */
  name: string | null;
  /** One line on what the room is for; null shows nothing. */
  topic: string | null;
  /** Who may add to the queue or a list of their own. */
  addMode: RoomAddMode;
};

export type RoomOrigin = 'stream' | 'music';

export type RoomAddMode = 'anyone' | 'crowns';

/** A room on the QUEUES list: the room and what is on in it (null when nothing is). */
export type LiveRoom = { room: WatchRoom; current: WatchQueueEntry | null };

/**
 * Which player a link needs (SPEC-watch-links.md). `embed` is a WEB platform's own official player in a
 * sandboxed frame (app/lib/web/official-embed.ts): queued from /web only, never from a pasted address.
 * `audio` is a song, played by the music bar from its own address (lib/watch/songs.ts, SPEC-music-queues.md).
 */
export type WatchLinkKind = 'file' | 'hls' | 'dash' | 'youtube' | 'vimeo' | 'dailymotion' | 'twitch' | 'embed' | 'audio';

/** A video link in the queue: only its address, its player and its title are kept, never the video. */
export type WatchLink = {
  url: string;
  kind: WatchLinkKind;
  title: string;
};

/**
 * Where an episode sits in a series (SPEC-stream-series.md): an Internet Archive item's videos or a YouTube
 * playlist, added in one go. Every episode is its own row; the rows of one add share `id` and their place in
 * the queue, so a block moves as one, and `episode` keeps their order inside it.
 */
export type WatchSeriesMark = {
  /** One per add: the same series added twice is two blocks. */
  id: string;
  title: string;
  /** The order inside the block (1, 2, 3...); gaps are left when a crown takes an episode out. */
  episode: number;
};

/**
 * One file or link added to a room. A play is a row: a file added twice is two rows. Until somebody with a
 * crown pulls it in, an addition waits on its adder's own list (`inQueue` false, SPEC-stream-queue.md).
 */
export type WatchQueueEntry = {
  id: string;
  roomId: string;
  /** The order of what is still to play. */
  position: number;
  /** In the room's queue; false while it is somebody's addition. Whatever played was in the queue. */
  inQueue: boolean;
  /** Null for a link, and once the file has left the catalogue. */
  mediaItemId: string | null;
  /** Set for a link instead of a catalogue file. */
  link: WatchLink | null;
  /** Set for an episode of a series: one block in the queue with the rest of its add. */
  series: WatchSeriesMark | null;
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

/**
 * Somebody holding a crown in a room: they may pull additions into the queue, reorder it and take out what
 * has not played. Only the host gives and takes crowns; the host gets one at GO LIVE and on every change of host.
 */
export type WatchCrown = {
  roomId: string;
  userId: string;
  givenBy: string | null;
  givenAt: string;
};

/**
 * A crown's write to the queue: a row's new place, and `pull` when it is an addition coming into the queue.
 * With `series` the id is a series' (`WatchSeriesMark.id`) and the place is for every episode of it not yet played.
 */
export type QueueMove = { id: string; position: number; pull?: boolean; series?: boolean };

/** A room with everything the window and the forum record draw. */
export type WatchRoomRead = {
  room: WatchRoom;
  queue: WatchQueueEntry[];
  messages: WatchMessage[];
  crowns: WatchCrown[];
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
  /** The account's lamp is off: this tab knows where it is, and tells nobody else. */
  unlisted?: boolean;
};

/** The site-wide watching room: account id -> what they are watching. */
export type WatchingMap = Record<string, WatchingEntry>;

/** One stream that played a file: the archive's fold under that file (decision 8). */
export type StreamFold = {
  room: Pick<WatchRoom, 'id' | 'originalHostId' | 'originalHostLabel' | 'startedAt' | 'updatedAt' | 'endedAt' | 'forumThreadId'>;
  messages: WatchMessage[];
};
