import type { AudioTrack } from '../audio/tracks';
import { floatingState, notePlace, placeOf, playFloating, type RoomSource } from '../ui/floating-player';
import { ownRoomState } from './own-room-client';
import { floatingForLink } from './own-screen';
import { currentEntry, hostPosition, upcoming } from './rules';
import { isSongLink, songLink } from './songs';
import type { WatchLink, WatchQueueEntry, WatchRoomRead } from './types';

/**
 * What GO LIVE takes with it, and what END STREAM brings back (SPEC-rooms-queues.md, phase 3; Luke: "going live just
 * gives you different access to the same functions"). Tonight's room is a new room, so what you are playing and your
 * queue are carried into it:
 *
 * - **what is on** goes in as the room's first play, from the same spot. A song is filed as already playing where the
 *   bar has got to, so the bar's one player keeps playing with no gap. A video goes in first in the queue with its
 *   place noted, and the room's own player starts it there a moment later (it is a different player from the
 *   platform's own).
 * - **your queue** is copied in behind it, in order.
 *
 * Read at the moment START is pressed, never before: the song has been playing on behind the menu. Your own room is
 * not touched by any of this; if the stream's tab dies, your queue from before is still there.
 *
 * When the person who started the room ends it (or leaves it to a new host), `comeHome` makes their own queue what was
 * still waiting in the live one, and what was on carries on for them alone.
 */

export type CarriedThing = { link: WatchLink; mediaItemId?: undefined } | { mediaItemId: string; link?: undefined };

export type Carry = {
  /** A song on the bar: filed as playing, at this place. */
  song: { link: WatchLink; place: number; playing: boolean } | null;
  /** A video on the screen: first in the queue, started from this place. */
  video: { source: RoomSource; place: number | null } | null;
  /** What was waiting, in order. */
  waiting: CarriedThing[];
};

export const NOTHING_TO_CARRY: Carry = { song: null, video: null, waiting: [] };

/** The parts of the music player this reads (`useMusicPlayer()`). */
type Bar = { track: AudioTrack | undefined; playing: boolean; audioElement: () => HTMLAudioElement | null };

function things(entries: readonly Pick<WatchQueueEntry, 'link' | 'mediaItemId'>[]): CarriedThing[] {
  return entries.flatMap((entry): CarriedThing[] => (entry.link !== null ? [{ link: entry.link }] : entry.mediaItemId !== null ? [{ mediaItemId: entry.mediaItemId }] : []));
}

/**
 * `screenFirst`: the key on the floating player itself was pressed, so the video on the screen is what is meant,
 * even with a song playing on the bar beside it.
 */
export function whatToCarry(bar: Bar, screenFirst = false): Carry {
  const { session } = ownRoomState();
  const read = session?.read() ?? null;
  const waiting = read === null ? [] : things(upcoming([...read.queue]));

  // One thing is on: a video while the bar is quiet, otherwise the bar's song.
  const screen = floatingState().entry;
  if (screen !== null && (screenFirst || !bar.playing) && screen.room !== undefined) {
    return { song: null, video: { source: screen.room, place: placeOf(screen.id) }, waiting };
  }
  // A song that is playing, or a paused one your room has on (a song merely left on the bar is not "on").
  const on = read === null ? undefined : currentEntry(read);
  const held = bar.track !== undefined && on !== undefined && isSongLink(on.link) && on.link.url === bar.track.src;
  if (bar.track !== undefined && (bar.playing || held)) {
    const audio = bar.audioElement();
    return { song: { link: songLink(bar.track), place: audio === null ? 0 : audio.currentTime, playing: bar.playing }, video: null, waiting };
  }
  return { song: null, video: null, waiting };
}

/* --- what this tab carried, so END STREAM only ever brings home a queue that really went in --------------------- */

const CARRIED_KEY = 'debaser.go-live.carried.v1';
/** The song GO LIVE filed as playing: the room's first cue of it must not move the bar (`WatchRoom.tsx`). */
const CARRIED_SONG_MS = 60000;
let carriedSong: { entryId: string; until: number } | null = null;

/**
 * Your whole queue is in this room (said by `goLiveEmpty` once the write has landed, or when nothing was waiting).
 * Kept for the tab, so a reload mid-stream still knows; a room this tab did not fill never rewrites your queue.
 */
export function noteCarried(roomId: string): void {
  try {
    window.sessionStorage.setItem(CARRIED_KEY, roomId);
  } catch {
    // A browser with storage shut: END STREAM then leaves your own queue as it was, which loses nothing.
  }
}

export function wasCarried(roomId: string): boolean {
  try {
    return window.sessionStorage.getItem(CARRIED_KEY) === roomId;
  } catch {
    return false;
  }
}

/** Your queue has come home (or the room is gone): the note is spent. */
export function forgetCarried(roomId: string): void {
  try {
    if (window.sessionStorage.getItem(CARRIED_KEY) === roomId) window.sessionStorage.removeItem(CARRIED_KEY);
  } catch {
    // Nothing was kept.
  }
}

export function noteCarriedSong(entryId: string, now = Date.now()): void {
  carriedSong = { entryId, until: now + CARRIED_SONG_MS };
}

/** True for the row GO LIVE filed from the bar a moment ago: the bar is already playing it, where the room says. */
export function isCarriedSong(entryId: string | null, now = Date.now()): boolean {
  return carriedSong !== null && carriedSong.entryId === entryId && now <= carriedSong.until;
}

/** What was still waiting in a live room's queue, as things your own queue can hold (END STREAM brings these back). */
export function leftWaiting(queue: readonly WatchQueueEntry[]): CarriedThing[] {
  return things(upcoming([...queue]));
}

/**
 * END STREAM, for the person who started the room: your own queue becomes what was still waiting, and what was on
 * carries on for you alone, from the same spot. A song is already on the bar and plays on; `song` says where it has
 * got to. A video starts again in the floating player, where its player can be told a place. A room that was paused
 * leaves nothing playing.
 */
export function comeHome(read: WatchRoomRead, at: { now: number; origin: string; song: { place: number; playing: boolean } | null }): void {
  const { session } = ownRoomState();
  if (session === null) return;
  session.replaceWaiting(leftWaiting(read.queue));

  const on = currentEntry(read);
  if (on === undefined || on.link === null) return;
  if (isSongLink(on.link)) {
    if (at.song === null) return;
    session.started(on.link);
    session.playback(at.song.place, at.song.playing);
    return;
  }
  if (!read.room.isPlaying) return;
  const id = `own:${on.id}`;
  const place = hostPosition(read.room, at.now);
  notePlace(id, place);
  const screen = floatingForLink(on.link, id, at.origin);
  if (screen === null) return;
  playFloating(screen);
  session.started(on.link);
  session.playback(place, true);
}
