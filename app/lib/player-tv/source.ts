import { youtubeId } from '../watch/links';

/**
 * What the player bar's TV shows (SPEC-player-tv.md): the rules only, with nothing of the page in them.
 *
 * The moving picture can only be copied from a `<video>` of the page's own. Another site's player is a frame the page
 * cannot read, so YouTube gets its three published stills and every other frame a dark screen. A song, a held picture,
 * or a file with no picture in it (audio in a `<video>`) is not a video: no TV.
 */
export type TvPicture = 'video' | 'stills' | 'dark';

/** A `<video>` of the page's own, as far as these rules care. `width` 0 once loaded means it holds sound only. */
export type TvFile = { ready: boolean; width: number };

/** Your room's screen (`room-screen-sound.ts`). `file` null: a site's player, wrapped or not. */
export type TvRoom = { playing: boolean; ended: boolean; youtubeId: string | null; file: TvFile | null };

/** The floating player (`floating-player.ts`). */
export type TvFloat = { playing: boolean; kind: 'file' | 'frame' | 'picture'; shape: 'video' | 'audio' | 'picture'; src: string; ended: boolean; file: TvFile | null };

export type TvShows = { from: 'room' | 'float'; picture: TvPicture; youtubeId: string | null };

/** The video id in a frame's own address, or null. */
export function frameYoutubeId(src: string): string | null {
  try {
    const id = youtubeId(new URL(src));
    return id === 'videoseries' ? null : id;
  } catch {
    return null;
  }
}

function ofRoom(room: TvRoom): TvShows | null {
  if (room.ended) return null;
  if (room.youtubeId !== null) return { from: 'room', picture: 'stills', youtubeId: room.youtubeId };
  if (room.file === null) return { from: 'room', picture: 'dark', youtubeId: null };
  // Nothing is known of a file until it has said its size; sound only never shows a TV.
  if (!room.file.ready || room.file.width === 0) return null;
  return { from: 'room', picture: 'video', youtubeId: null };
}

function ofFloat(float: TvFloat): TvShows | null {
  if (float.ended || float.shape !== 'video' || float.kind === 'picture') return null;
  if (float.kind === 'frame') {
    const id = frameYoutubeId(float.src);
    return { from: 'float', picture: id === null ? 'dark' : 'stills', youtubeId: id };
  }
  if (float.file === null || !float.file.ready || float.file.width === 0) return null;
  return { from: 'float', picture: 'video', youtubeId: null };
}

/**
 * One TV, one video: the one that is playing; with both or neither playing, the floating player first, as the music bar
 * and its sound graph name it.
 */
export function tvShows(room: TvRoom | null, float: TvFloat | null): TvShows | null {
  const fromRoom = room === null ? null : ofRoom(room);
  const fromFloat = float === null ? null : ofFloat(float);
  if (fromRoom !== null && fromFloat !== null) return room?.playing && !float?.playing ? fromRoom : fromFloat;
  return fromFloat ?? fromRoom;
}

/** How long each still stays when the video's length is not known. */
export const STILL_SECONDS = 20;

/** Which of the three stills (0, 1, 2): by how far through the video is, else turn about. */
export function stillIndex(seconds: number, duration: number, shownSeconds: number): number {
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(seconds)) {
    return Math.min(2, Math.max(0, Math.floor((seconds / duration) * 3)));
  }
  return Math.floor(Math.max(0, shownSeconds) / STILL_SECONDS) % 3;
}
