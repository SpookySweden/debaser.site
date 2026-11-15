import type { WatchLink } from '../watch/types';
import type { Playlist } from './library';

/**
 * **The one place that says what "add to a playlist" means** (Luke's list, 2026-11-14: the song menu's
 * `ADD TO: [ PLAYLIST ]` and MEDIA's `+ LETTER / PLAYLIST` key both come through here).
 *
 * A playlist is a saved queue of songs, videos and pictures (Luke's answer 3A to the ROOMS interview, 2026-11-14;
 * SPEC-rooms-queues.md, phase 4). A site song is held by its id, as it always was. Anything else (a video, a song
 * no shelf holds) is held whole, by its link: `{ trackId: 'link:<address>', addedAt, link }`, the shape a stored
 * queue already used. "Is it in the list already" is answered by the id, or by the link's address.
 *
 * Pure on purpose: the library is handed in (`useMusicLibrary()` in a component), so a check can drive it.
 */

/** Anything a playlist holds: its name, where it plays from, and the site song's id when it is one. */
export type PlaylistThing = { title: string; link: WatchLink; trackId?: string };

/** The part of the music library this needs (`app/components/MusicLibraryProvider.tsx`). */
export type PlaylistLibrary = {
  canWrite: boolean;
  playlists: Playlist[];
  /** `link`: kept with a thing that is no site song, so it comes back whole. */
  togglePlaylistTrack: (playlistId: string, trackId: string, link?: WatchLink) => Promise<void>;
  savePlaylist: (name: string) => Promise<Playlist>;
};

export type PlaylistChoice = { id: string; name: string; holds: boolean };

/** A site song (or a MEDIA track the shelf keeps): held by its id alone. */
function isSiteSong(thing: PlaylistThing): thing is PlaylistThing & { trackId: string } {
  return typeof thing.trackId === 'string' && thing.trackId.length > 0;
}

/** What a list files the thing under: the site song's id, or `link:<address>`. */
export function playlistKey(thing: PlaylistThing): string {
  return isSiteSong(thing) ? thing.trackId : `link:${thing.link.url}`;
}

/** Whether a playlist can hold this: anything with a site song's id or an address to keep. */
export function holdable(thing: PlaylistThing): boolean {
  return isSiteSong(thing) || thing.link.url.length > 0;
}

function holds(list: Playlist, thing: PlaylistThing): boolean {
  const key = playlistKey(thing);
  return list.items.some((item) => item.trackId === key || (!isSiteSong(thing) && item.link?.url === thing.link.url));
}

/** The id the list already holds it under (a stored queue may have filed the same address under a shelf id). */
function heldKey(list: Playlist | undefined, thing: PlaylistThing): string {
  const key = playlistKey(thing);
  if (list === undefined || isSiteSong(thing)) return key;
  return list.items.find((item) => item.trackId === key || item.link?.url === thing.link.url)?.trackId ?? key;
}

/** Every playlist of this person, each saying whether it holds the thing already. */
export function playlistChoices(library: PlaylistLibrary, thing: PlaylistThing): PlaylistChoice[] {
  return library.playlists.map((list) => ({
    id: list.id,
    name: list.name,
    holds: holds(list, thing),
  }));
}

const NOT_HOLDABLE = 'THAT ONE HAS NO ADDRESS TO KEEP.';

/** Puts the thing into the list, or takes it out when it is already there; answers which it did. */
export async function toggleInPlaylist(library: PlaylistLibrary, thing: PlaylistThing, choice: PlaylistChoice): Promise<'added' | 'removed'> {
  if (!holdable(thing)) throw new Error(NOT_HOLDABLE);
  const list = library.playlists.find((held) => held.id === choice.id);
  await library.togglePlaylistTrack(choice.id, heldKey(list, thing), isSiteSong(thing) ? undefined : thing.link);
  return choice.holds ? 'removed' : 'added';
}

/** A new list with the thing inside (a name already in use is that list); answers the name as saved. */
export async function addToNewPlaylist(library: PlaylistLibrary, thing: PlaylistThing, name: string): Promise<string> {
  if (!holdable(thing)) throw new Error(NOT_HOLDABLE);
  const made = await library.savePlaylist(name);
  if (!holds(made, thing)) await library.togglePlaylistTrack(made.id, playlistKey(thing), isSiteSong(thing) ? undefined : thing.link);
  return made.name;
}
