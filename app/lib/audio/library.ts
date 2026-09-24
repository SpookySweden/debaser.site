/**
 * A reader's own music: what they liked, and the lists they made.
 *
 * This is the *per-account* half of the archive. Everything in `./tracks.ts` is the shelf - files
 * anybody can play - and this is what *one* account thinks of them. The split matters because it is
 * the same split the rest of the site keeps: a post is public and a comment is signed, and a
 * favourite is the second of those.
 *
 * Nothing here holds a track's title, credit or tags. A like is an *id* and a time, and the row it
 * points at is read from the shelf when the list is drawn - so a track that gets re-titled or
 * re-credited is not a favourite pointing at a stale name. A track the shelf has forgotten is dropped
 * from the list rather than drawn as a half-row (see `resolveLikes`).
 */

/** A track this account liked. */
export type LikedTrack = {
  /** The `AudioTrack.id` it points at: a storage path, a manifest id, or a slug. */
  trackId: string;
  likedAt: string;
};

/** A list an account made. */
export type Playlist = {
  id: string;
  /** The account that owns it. Nobody else may write to it, and only they see it. */
  ownerId: string;
  name: string;
  createdAt: string;
  /**
   * The tracks in it, oldest first. Kept *with* the list rather than in a third table because a
   * playlist is short, ordered, and always read whole - the same reasoning `PROJECT_SECTIONS` uses
   * for the shelves, and it means one read rather than a read and a join.
   */
  items: PlaylistItem[];
};

export type PlaylistItem = {
  trackId: string;
  addedAt: string;
};

/** Longest a playlist name may be, shared by the form and the store. */
export const MAX_PLAYLIST_NAME = 40;

export function validatePlaylistName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'A PLAYLIST NEEDS A NAME.';
  if (trimmed.length > MAX_PLAYLIST_NAME) return `PLAYLIST NAMES ARE ${MAX_PLAYLIST_NAME} CHARACTERS OR FEWER.`;
  return undefined;
}

/**
 * The id a new list gets.
 *
 * Derived from the owner and the name, which is what makes adding a second list with the same name an
 * *edit* rather than a duplicate - the same reasoning the welcome tag uses for its own derived id. Two
 * accounts may both have a `LATE NIGHT` and they are different rows, because the owner is in the key.
 */
export function playlistId(ownerId: string, name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${ownerId}:${slug}`;
}

/**
 * What a list of stored likes looks like against the shelf that is actually loaded.
 *
 * Two jobs, and both are about not lying. A like whose track is gone is dropped, because a row with no
 * title is worse than no row. And the order is the shelf's order, not the liking order - so "my music"
 * reads like the rest of the archive rather than like a second, differently-sorted listing of it.
 * `likedAt` is kept on the returned rows so a caller that wants newest-first can sort them.
 *
 * **The dropped ones are handed back rather than swallowed.** A like whose track has been deleted and a
 * like whose *shelf read fell short* look identical from here - both are an id with no track - and the
 * difference matters enormously to the reader: one is a file that is gone, the other is their song that
 * will be back when the next read answers fully. So this reports the count and lets the screen say so.
 * Silently drawing a short list is how a reader concludes they never liked a song they did.
 */
export type ResolvedList<T> = {
  /** The rows, in this list's own order, with the shelf's own fields on them. */
  rows: (T & { likedAt: string })[];
  /** How many stored likes could not be drawn, because the loaded shelf does not hold them. */
  missing: number;
};

export function resolveLikes<T extends { id: string }>(
  likes: readonly LikedTrack[],
  shelf: readonly T[],
): ResolvedList<T> {
  const byId = new Map(shelf.map((track) => [track.id, track]));

  let missing = 0;
  const rows: (T & { likedAt: string })[] = [];

  for (const like of likes) {
    const track = byId.get(like.trackId);

    if (track === undefined) {
      missing += 1;
      continue;
    }

    rows.push({ ...track, likedAt: like.likedAt });
  }

  return { rows, missing };
}

/**
 * The same, for a playlist's items - in the order the *list* holds them, because that is its point.
 *
 * Reports its drops for the same reason `resolveLikes` does, and `addedAt` is the field name so a
 * caller can sort a playlist by when each track went in without a second pass.
 */
export function resolvePlaylistItems<T extends { id: string }>(
  playlist: Playlist,
  shelf: readonly T[],
): ResolvedList<T> {
  const byId = new Map(shelf.map((track) => [track.id, track]));

  let missing = 0;
  const rows: (T & { likedAt: string })[] = [];

  for (const item of playlist.items) {
    const track = byId.get(item.trackId);

    if (track === undefined) {
      missing += 1;
      continue;
    }

    rows.push({ ...track, likedAt: item.addedAt });
  }

  return { rows, missing };
}

/**
 * The ids in a set of likes, as a `Set` - built once per render rather than scanned once per row.
 *
 * `isLiked(likes, id)` is a linear scan, and a row asks it for its own id, so answering every row that
 * way is quadratic in the length of the list. A `Set` is the same answer in constant time, and it is
 * built once: the screen makes one, hands it to every row, and the whole list costs one pass.
 */
export function likedIds(likes: readonly LikedTrack[]): Set<string> {
  return new Set(likes.map((like) => like.trackId));
}

/** The same, for one playlist's items. */
export function playlistIds(playlist: Playlist | null): Set<string> {
  return new Set((playlist?.items ?? []).map((item) => item.trackId));
}

/** Whether a track is in the liked set, for a caller that has not built the `Set`. */
export function isLiked(likes: readonly LikedTrack[], trackId: string): boolean {
  return likes.some((like) => like.trackId === trackId);
}

/** Whether a track is in a particular list, for a caller that has not built the `Set`. */
export function isInPlaylist(playlist: Playlist, trackId: string): boolean {
  return playlist.items.some((item) => item.trackId === trackId);
}
