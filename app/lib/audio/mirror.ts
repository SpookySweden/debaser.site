import type { Face } from './for-you';
import type { VanitySong, VanityTrack } from './vanity';

/**
 * VANITY's MIRROR (SPEC-vanity.md step 6): an uploader's own songs, how often each is played, and the
 * faces of who plays them. Only its owner sees it.
 *
 * The database does the private part (`music_mirror`): it answers only about the asker's own files,
 * capped at 3 plays a day per person per song, without hidden accounts. A listener who switched their
 * listening off, and the uploader themself, arrive with no listener id: they count in the numbers but
 * never show a face. Pure, so a check can hold the rules.
 */

/** One row of `music_mirror`: a file, one listener (or null for one who shows no face), their plays. */
export type MirrorRow = { src: string; listenerId: string | null; plays: number };

export type MirrorSong<T extends VanityTrack = VanityTrack> = { song: VanitySong<T>; faces: Face[]; more: number };

export type Mirror<T extends VanityTrack = VanityTrack> = {
  /** The uploader's songs, most played first, each with MIRROR's own count as its `plays`. */
  songs: MirrorSong<T>[];
  total: number;
  /** Top listeners across every song. */
  top: Face[];
  more: number;
};

/** Faces per song. */
export const SONG_FACES = 3;
/** Faces across all songs. */
export const TOP_FACES = 5;

function faces(byPerson: ReadonlyMap<string, number>, limit: number): { faces: Face[]; more: number } {
  const ranked = [...byPerson.entries()]
    .map(([personId, plays]) => ({ personId, plays }))
    .sort((a, b) => b.plays - a.plays || a.personId.localeCompare(b.personId));
  return { faces: ranked.slice(0, limit), more: Math.max(0, ranked.length - limit) };
}

/** True when this reader filed at least one song: the only time the MIRROR tab is shown. */
export function hasMirror(songs: readonly VanitySong[], selfId: string | null): boolean {
  return selfId !== null && songs.some((song) => song.uploaderId === selfId);
}

export function mirror<T extends VanityTrack>(songs: readonly VanitySong<T>[], rows: readonly MirrorRow[], selfId: string | null): Mirror<T> {
  const own = selfId === null ? [] : songs.filter((song) => song.uploaderId === selfId);
  const ownSrcs = new Set(own.map((song) => song.track.src));

  const perSong = new Map<string, { plays: number; people: Map<string, number> }>();
  const overall = new Map<string, number>();
  let total = 0;

  for (const row of rows) {
    if (!ownSrcs.has(row.src) || row.plays <= 0) continue;
    const entry = perSong.get(row.src) ?? { plays: 0, people: new Map<string, number>() };
    entry.plays += row.plays;
    total += row.plays;
    // The uploader never sees their own face, whatever the source of the row says.
    if (row.listenerId !== null && row.listenerId !== selfId) {
      entry.people.set(row.listenerId, (entry.people.get(row.listenerId) ?? 0) + row.plays);
      overall.set(row.listenerId, (overall.get(row.listenerId) ?? 0) + row.plays);
    }
    perSong.set(row.src, entry);
  }

  const list = own
    .map((song) => {
      const entry = perSong.get(song.track.src);
      return { song: { ...song, plays: entry?.plays ?? 0 }, ...faces(entry?.people ?? new Map(), SONG_FACES) };
    })
    .sort((a, b) => b.song.plays - a.song.plays || a.song.track.title.localeCompare(b.song.track.title));

  const top = faces(overall, TOP_FACES);
  return { songs: list, total, top: top.faces, more: top.more };
}
