import type { WatchLink } from '../watch/types';
import type { Playlist } from './library';

/**
 * **The one place that says what "add to a playlist" means** (Luke's list, 2026-11-14: the song menu's
 * `ADD TO: [ PLAYLIST ]` and MEDIA's `+ LETTER / PLAYLIST` key both come through here).
 *
 * Today a playlist is a row of the music library and holds site songs by their id, so a thing is only holdable when
 * it carries a `trackId`. Luke's answer to the ROOMS interview (3A, 2026-11-14) is that a playlist becomes a saved
 * queue of songs, videos and pictures: when that is built, widen `holdable` and the three functions below to keep the
 * `link` of a thing that has no `trackId`, and every key that adds to a playlist follows without changing.
 *
 * Pure on purpose: the library is handed in (`useMusicLibrary()` in a component), so a check can drive it.
 */

/** Anything a playlist may one day hold: its name, where it plays from, and the site song's id when it is one. */
export type PlaylistThing = { title: string; link: WatchLink; trackId?: string };

/** The part of the music library this needs (`app/components/MusicLibraryProvider.tsx`). */
export type PlaylistLibrary = {
  canWrite: boolean;
  playlists: Playlist[];
  togglePlaylistTrack: (playlistId: string, trackId: string) => Promise<void>;
  savePlaylist: (name: string) => Promise<Playlist>;
};

export type PlaylistChoice = { id: string; name: string; holds: boolean };

/** Whether a playlist can hold this today: a site song (or a MEDIA track the shelf keeps), by its id. */
export function holdable(thing: PlaylistThing): thing is PlaylistThing & { trackId: string } {
  return typeof thing.trackId === 'string' && thing.trackId.length > 0;
}

/** Every playlist of this person, each saying whether it holds the thing already. */
export function playlistChoices(library: PlaylistLibrary, thing: PlaylistThing): PlaylistChoice[] {
  return library.playlists.map((list) => ({
    id: list.id,
    name: list.name,
    holds: holdable(thing) && list.items.some((item) => item.trackId === thing.trackId),
  }));
}

const NOT_HOLDABLE = 'A PLAYLIST HOLDS SITE SONGS ONLY, FOR NOW.';

/** Puts the thing into the list, or takes it out when it is already there; answers which it did. */
export async function toggleInPlaylist(library: PlaylistLibrary, thing: PlaylistThing, choice: PlaylistChoice): Promise<'added' | 'removed'> {
  if (!holdable(thing)) throw new Error(NOT_HOLDABLE);
  await library.togglePlaylistTrack(choice.id, thing.trackId);
  return choice.holds ? 'removed' : 'added';
}

/** A new list with the thing inside (a name already in use is that list); answers the name as saved. */
export async function addToNewPlaylist(library: PlaylistLibrary, thing: PlaylistThing, name: string): Promise<string> {
  if (!holdable(thing)) throw new Error(NOT_HOLDABLE);
  const made = await library.savePlaylist(name);
  if (!made.items.some((item) => item.trackId === thing.trackId)) await library.togglePlaylistTrack(made.id, thing.trackId);
  return made.name;
}
