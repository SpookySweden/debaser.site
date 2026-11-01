import { MAX_PLAYLIST_NAME } from './library';

/**
 * VANITY's browse views (SPEC-vanity.md step 4): the site's MP3s laid out by artist, by album and by song.
 *
 * Pure, so a check can hold the rules:
 *   - the folder path decides: `ARTIST/ALBUM/file`; a file loose in a top folder is a single by that artist;
 *     deeper folders still belong to the album their second part names;
 *   - an MP3 attached to a board post is filed under the poster's name, as a single;
 *   - an archive file in no folder is filed under its credit, or UNKNOWN;
 *   - a tile wears the picture of whoever filed most of its songs (ties: the first met), or none.
 */

/** The fields of a track this needs: a structural type, so the module compiles alone for a check. */
export type VanityTrack = { id: string; src: string; title: string; credit: string; folderPath?: string | null; trackNumber?: number };

export type VanitySong<T extends VanityTrack = VanityTrack> = {
  track: T;
  artist: string;
  /** Null for a single. */
  album: string | null;
  /** The account that filed it (from its storage address), or null for a file that came with the site. */
  uploaderId: string | null;
  /** Public plays, capped (music_play_counts); 0 when nobody has listened yet. */
  plays: number;
};

export type VanityAlbum<T extends VanityTrack = VanityTrack> = {
  key: string;
  artist: string;
  name: string;
  /** In running order: track number, then title. */
  songs: VanitySong<T>[];
  plays: number;
  uploaderId: string | null;
};

export type VanityArtist<T extends VanityTrack = VanityTrack> = {
  key: string;
  name: string;
  albums: VanityAlbum<T>[];
  singles: VanitySong<T>[];
  plays: number;
  uploaderId: string | null;
  songCount: number;
};

export const UNKNOWN_ARTIST = 'UNKNOWN';

/** Where a song sits: its artist and album. `poster` is set for a board attachment. */
export function placeOf(track: VanityTrack, poster?: string): { artist: string; album: string | null } {
  if (poster !== undefined) return { artist: poster.trim() || UNKNOWN_ARTIST, album: null };

  const parts = (track.folderPath ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return { artist: track.credit.trim() || UNKNOWN_ARTIST, album: null };
  return { artist: parts[0], album: parts[1] ?? null };
}

/** Whoever filed most of these songs, or null when nobody did (files that came with the site). */
export function topUploader(songs: readonly { uploaderId: string | null }[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;

  for (const { uploaderId } of songs) {
    if (uploaderId === null) continue;
    const count = (counts.get(uploaderId) ?? 0) + 1;
    counts.set(uploaderId, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = uploaderId;
  }

  return best;
}

/**
 * Every song once: the archive's own record first, then board attachments the archive does not hold
 * (matched by file address). `uploaderOf` reads the account from a file's address.
 */
export function vanitySongs<T extends VanityTrack>(
  shelf: readonly T[],
  filed: readonly { track: T; poster: string }[],
  counts: ReadonlyMap<string, number>,
  uploaderOf: (src: string) => string | null,
): VanitySong<T>[] {
  const seen = new Set<string>();
  const songs: VanitySong<T>[] = [];

  const add = (track: T, poster?: string) => {
    if (seen.has(track.src)) return;
    seen.add(track.src);
    songs.push({ track, ...placeOf(track, poster), uploaderId: uploaderOf(track.src), plays: counts.get(track.src) ?? 0 });
  };

  for (const track of shelf) add(track);
  for (const { track, poster } of filed) add(track, poster);

  return songs;
}

const byPlaysThenName = (a: { plays: number; name: string }, b: { plays: number; name: string }) =>
  b.plays - a.plays || a.name.localeCompare(b.name);

const runningOrder = (a: VanitySong, b: VanitySong) =>
  (a.track.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.track.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
  a.track.title.localeCompare(b.track.title);

const sum = (songs: readonly VanitySong[]) => songs.reduce((total, song) => total + song.plays, 0);

/** Artists keyed case-blind, so `hexham` and `HEXHAM` are one artist; the first spelling met is kept. */
const artistKey = (name: string) => name.toUpperCase();

/** Every album, most played first (then A to Z). */
export function byAlbum<T extends VanityTrack>(songs: readonly VanitySong<T>[]): VanityAlbum<T>[] {
  const albums = new Map<string, VanityAlbum<T>>();

  for (const song of songs) {
    if (song.album === null) continue;
    const key = `${artistKey(song.artist)}/${song.album.toUpperCase()}`;
    const album = albums.get(key) ?? { key, artist: song.artist, name: song.album, songs: [], plays: 0, uploaderId: null };
    album.songs.push(song);
    albums.set(key, album);
  }

  return [...albums.values()]
    .map((album) => ({ ...album, songs: [...album.songs].sort(runningOrder), plays: sum(album.songs), uploaderId: topUploader(album.songs) }))
    .sort(byPlaysThenName);
}

/** Every artist with their albums and singles, most played first (then A to Z). */
export function byArtist<T extends VanityTrack>(songs: readonly VanitySong<T>[]): VanityArtist<T>[] {
  const artists = new Map<string, { name: string; songs: VanitySong<T>[] }>();

  for (const song of songs) {
    const key = artistKey(song.artist);
    const artist = artists.get(key) ?? { name: song.artist, songs: [] };
    artist.songs.push(song);
    artists.set(key, artist);
  }

  return [...artists.entries()]
    .map(([key, artist]) => ({
      key,
      name: artist.name,
      albums: byAlbum(artist.songs),
      singles: artist.songs.filter((song) => song.album === null).sort(bySongPlays),
      plays: sum(artist.songs),
      uploaderId: topUploader(artist.songs),
      songCount: artist.songs.length,
    }))
    .sort(byPlaysThenName);
}

/** Songs most played first, then A to Z. */
export function bySongPlays(a: VanitySong, b: VanitySong): number {
  return b.plays - a.plays || a.track.title.localeCompare(b.track.title);
}

/** `214 PLAYS`, `1 PLAY`, or '' while nobody has listened (no zeros on screen). */
export function playsLabel(plays: number): string {
  if (plays <= 0) return '';
  return `${plays} PLAY${plays === 1 ? '' : 'S'}`;
}

/** The list SAVE AS PLAYLIST makes from an album: `ARTIST - ALBUM`, cut to fit a playlist name. */
export function albumPlaylistName(artist: string, album: string): string {
  const name = `${artist} - ${album}`;
  return name.length <= MAX_PLAYLIST_NAME ? name : name.slice(0, MAX_PLAYLIST_NAME).trimEnd();
}
