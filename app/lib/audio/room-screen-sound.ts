import type { Playable } from '../watch/playable';
import type { WatchLink } from '../watch/types';
import { youtubeId } from '../watch/links';

/**
 * What your room's screen is playing, for the sound graph behind the music bar (Luke, list 4, 2026-11-16: "look into the
 * colourful audio monitor not always appearing in the black in the bottom player bar").
 *
 * Since list 3 a MEDIA video plays in your room's own player (`WatchRoom.tsx`), not the floating player the graph used
 * to watch, so the graph went dark while a video played. The room's stage shares its player here while it is drawn:
 * whether it plays, the element itself (a file whose sound may be copied, an Internet Archive video, is heard as it is),
 * and a YouTube video's id (heard through the relay, kept in step with the player). Module state, like the windows;
 * nothing here records or sends sound.
 */

export type RoomScreenSound = {
  /** The stage's player: a `<video>`, or an embedded site's player wrapped as one; null for a site's embed with none to ask. */
  element: Playable | null;
  /** Playing now (not paused, not ended). */
  playing: boolean;
  /** A YouTube video's id, for the relay; null for anything else. */
  youtubeId: string | null;
};

let current: RoomScreenSound | null = null;
const listeners = new Set<() => void>();

function tell(next: RoomScreenSound | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function roomScreenSound(): RoomScreenSound | null {
  return current;
}

export function subscribeToRoomScreenSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function youtubeIdOf(link: WatchLink | null): string | null {
  if (link === null || link.kind !== 'youtube') return null;
  try {
    return youtubeId(new URL(link.url));
  } catch {
    return null;
  }
}

const EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied'] as const;

/**
 * One thing plays at a time (Luke, list 4, item 5: "Two things played at once. I started an Internet Archive audio item,
 * then a YouTube video, and the audio kept running underneath the video."): the bar's song and your room's video, the
 * one that started last wins. `room` when the room's video should pause (the bar just started), `bar` when the bar should
 * (the video just started), `none` otherwise. A song row in a room plays on the bar and is never the room's video here.
 */
export function whoGivesWay(before: { bar: boolean; room: boolean }, now: { bar: boolean; room: boolean }): 'room' | 'bar' | 'none' {
  if (!now.bar || !now.room) return 'none';
  if (!before.bar) return 'room';
  if (!before.room) return 'bar';
  return 'none';
}

/**
 * Called by the room's stage with its player and what is on; returns the way to take it back (the stage gone or changed).
 * A null player is a site's embed that cannot say whether it plays (PeerTube, a friend's server): it counts as playing
 * while it is on, as the floating player's did, and the graph moves gently.
 */
export function shareRoomScreen(element: Playable | null, link: WatchLink | null): () => void {
  const youtubeId = youtubeIdOf(link);
  let shared: RoomScreenSound | null = null;
  const update = () => {
    const playing = element === null || (!element.paused && !element.ended);
    if (shared !== null && current === shared && shared.playing === playing) return;
    shared = { element, playing, youtubeId };
    tell(shared);
  };
  if (element !== null) for (const type of EVENTS) element.addEventListener(type, update);
  update();
  return () => {
    if (element !== null) for (const type of EVENTS) element.removeEventListener(type, update);
    if (shared !== null && current === shared) tell(null);
  };
}
