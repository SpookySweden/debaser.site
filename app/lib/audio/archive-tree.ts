import type { ForumThread } from '../forum/types';
import { collectFiledTracks } from './forum-tracks';
import { audioTagKey, trackHasTag } from './tags';
import type { AudioTrack } from './tracks';

/**
 * The archive listing, as data.
 *
 * The /music page is a file directory over three shelves at once:
 *
 *   1. the archive's own catalogue - ten artists, twenty releases, filed by hand in
 *      `app/lib/projects/tracks.ts`, which is the only shelf that has a release behind a
 *      file and therefore the only one that can be shown as a tree;
 *   2. whatever is in the `mp3` bucket, which includes an account's own song and anything
 *      dropped in by hand;
 *   3. every MP3 somebody attached to a post or a reply on the board.
 *
 * Files from 2 and 3 are single files with no release, so they are listed under LOOSE
 * FILES rather than filed into an artist they never had. Everything here is pure: the
 * grouping, the ordering, the search and the tag filter can all be reasoned about (and
 * checked) without a browser - see Temp/check-archive-tree.cjs.
 */

/** Where a listed file came from, in the listing's own words. */
export type ArchiveSource = 'ARCHIVE' | 'SHELF' | 'BOARD';

export const SOURCE_LABEL: Record<ArchiveSource, string> = {
  ARCHIVE: 'ARCHIVE',
  SHELF: 'SHELF',
  BOARD: 'BOARD',
};

/** The heading loose files are listed under: nothing filed them on a release. */
export const LOOSE_FILES = 'LOOSE FILES';

/** One file as the directory lists it. */
export type ArchiveRow = {
  track: AudioTrack;
  /** Who filed it: the poster of the post it came with, or its credit. */
  poster: string;
  /** How it sounds, spelled once here so the pills and the filter agree. */
  tags: string[];
  source: ArchiveSource;
  /** The post it was filed on, when it came from the board. */
  href?: string;
  threadTitle?: string;
};

/** One release's files, in running order. */
export type ArchiveAlbum = {
  name: string;
  /** The year the release carries; `''` when the file never said. */
  year: string;
  rows: ArchiveRow[];
};

/** One artist's releases, in the order they were filed. */
export type ArchiveArtist = {
  name: string;
  albums: ArchiveAlbum[];
  trackCount: number;
};

export type ArchiveTree = {
  artists: ArchiveArtist[];
  /** Files with no release behind them, in the order they arrived. */
  loose: ArchiveRow[];
};

/** The last path segment of a URL or archive path: what the file is called. */
export function fileLabel(src: string): string {
  const path = src.split('?')[0].split('#')[0];
  const last = path.split('/').pop() ?? path;

  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The rows: the player's queue in its own order first - so the directory and the bar never
 * disagree about what the shelf holds - with anything posted to a thread and not on the
 * shelf appended after it, because a linked MP3 is playable without ever being copied onto
 * the site.
 *
 * A file that is both on the shelf and on a post is listed once, and the two halves are
 * taken from the half that knows: **the shelf's own record of the file** (which is what knows
 * its release, so a track referenced in a thread stays in its artist's folder instead of
 * falling out of the catalogue) with **the post's poster** (which is what a listing wants to
 * print). A file that only exists on a post has only the post to speak for it.
 */
export function buildArchiveRows(queue: AudioTrack[], threads: ForumThread[]): ArchiveRow[] {
  const filed = collectFiledTracks(threads);
  const bySrc = new Map(filed.map((entry) => [entry.track.src, entry]));
  const rows: ArchiveRow[] = [];
  const seen = new Set<string>();

  const asBoardRow = (src: string, shelf: AudioTrack | undefined): ArchiveRow | undefined => {
    const entry = bySrc.get(src);
    if (entry === undefined) return undefined;

    const track = shelf ?? entry.track;

    return {
      track,
      poster: entry.poster,
      tags: track.tags ?? [],
      source: 'BOARD',
      href: entry.href,
      threadTitle: entry.threadTitle,
    };
  };

  for (const track of queue) {
    seen.add(track.src);

    rows.push(
      asBoardRow(track.src, track) ?? {
        track,
        poster: track.credit.length === 0 ? 'DEBASER.SITE' : track.credit,
        tags: track.tags ?? [],
        source: track.shelf === 'bucket' ? 'SHELF' : 'ARCHIVE',
      },
    );
  }

  for (const entry of filed) {
    if (seen.has(entry.track.src)) continue;
    seen.add(entry.track.src);

    rows.push({
      track: entry.track,
      poster: entry.poster,
      tags: entry.track.tags ?? [],
      source: 'BOARD',
      href: entry.href,
      threadTitle: entry.threadTitle,
    });
  }

  return rows;
}

/**
 * The shelves as a directory tree: artist, then release, then the files on it.
 *
 * Artists read A to Z, an artist's releases oldest first (a netlabel files by year), and a
 * release's tracks in running order - `trackNumber`, which is also the number its name
 * starts with, so the listing and the names agree about the order.
 */
export function buildArchiveTree(rows: ArchiveRow[]): ArchiveTree {
  const artists = new Map<string, Map<string, ArchiveAlbum>>();
  const loose: ArchiveRow[] = [];

  for (const row of rows) {
    const album = row.track.album;
    if (album === undefined || album.length === 0) {
      loose.push(row);
      continue;
    }

    const artist = row.track.credit.length === 0 ? LOOSE_FILES : row.track.credit;
    const releases = artists.get(artist) ?? new Map<string, ArchiveAlbum>();
    // Two releases can share a name across years on a real shelf; keying on both keeps them
    // apart instead of merging two records into one folder.
    const key = `${row.track.year ?? ''}::${album}`;
    const release = releases.get(key) ?? { name: album, year: row.track.year ?? '', rows: [] };

    release.rows.push(row);
    releases.set(key, release);
    artists.set(artist, releases);
  }

  const tree: ArchiveArtist[] = [...artists.entries()]
    .map(([name, releases]) => {
      const albums = [...releases.values()]
        .map((release) => ({ ...release, rows: sortByTrackNumber(release.rows) }))
        .sort((a, b) => a.year.localeCompare(b.year) || a.name.localeCompare(b.name));

      return {
        name,
        albums,
        trackCount: albums.reduce((total, release) => total + release.rows.length, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { artists: tree, loose };
}

/** Running order: the track's number, then its name for anything unnumbered. */
export function sortByTrackNumber(rows: ArchiveRow[]): ArchiveRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.track.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.track.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.track.title.localeCompare(b.track.title),
  );
}

/**
 * A flat run in the order the names read.
 *
 * This is what a search comes back as: `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]` sorts
 * a track under its own name, which is the only order a name that starts with the track can
 * honestly give - the tree is where the artist and the release do the sorting.
 */
export function sortByDisplayName(rows: ArchiveRow[]): ArchiveRow[] {
  return [...rows].sort((a, b) => a.track.title.localeCompare(b.track.title));
}

/** What the search bar and the filter row are asking for. */
export type ArchiveFilter = {
  /** What was typed into the search bar. */
  query: string;
  /** Chosen audio tag keys. */
  tagKeys: string[];
  /** True when a file must wear every chosen tag. */
  matchAll: boolean;
};

export const NO_FILTER: ArchiveFilter = { query: '', tagKeys: [], matchAll: false };

/** True when anything at all is being asked for, so the listing can say `n OF m`. */
export function isFiltering(filter: ArchiveFilter): boolean {
  return filter.query.trim().length > 0 || filter.tagKeys.length > 0;
}

/**
 * Everything a typed word is looked in: the whole name (track, release, artist), the poster,
 * the year and the tags - so `idm`, `1998` and `hexham` all find the same rows.
 */
function haystack(row: ArchiveRow): string {
  const track = row.track;

  return [track.title, track.album ?? '', track.credit, track.year ?? '', row.poster, ...row.tags]
    .join(' ')
    .toLowerCase();
}

/** Every word has to be found somewhere in the row, so more words narrow the list. */
export function matchesQuery(row: ArchiveRow, query: string): boolean {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return true;

  const text = haystack(row);

  return words.every((word) => text.includes(word));
}

/** True when the row wears what the tag filter asks for; an empty choice takes everything. */
export function matchesTags(row: ArchiveRow, keys: string[], matchAll: boolean): boolean {
  if (keys.length === 0) return true;

  const worn = keys.map((key) => trackHasTag({ tags: row.tags }, key));

  return matchAll ? worn.every(Boolean) : worn.some(Boolean);
}

/** The rows a search and a tag choice leave behind, in the order they came in. */
export function filterArchiveRows(rows: ArchiveRow[], filter: ArchiveFilter): ArchiveRow[] {
  return rows.filter((row) => matchesQuery(row, filter.query) && matchesTags(row, filter.tagKeys, filter.matchAll));
}

/** Every tag a row wears, as keys, so a caller can compare a selection against the listing. */
export function rowTagKeys(row: ArchiveRow): string[] {
  return row.tags.map((tag) => audioTagKey(tag));
}
