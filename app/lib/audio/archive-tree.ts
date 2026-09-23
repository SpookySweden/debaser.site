import type { ForumThread } from '../forum/types';
import { collectFiledTracks } from './forum-tracks';
import { audioTagKey, trackHasTag } from './tags';
import type { TrackSort } from './sorts';
import type { AudioTrack } from './tracks';

/**
 * The archive listing, as data.
 *
 * /music is a file browser over three places at once:
 *
 *   1. the archive's own catalogue - ten artists, twenty releases, filed by hand in
 *      `app/lib/projects/tracks.ts`;
 *   2. whatever is in the `mp3` bucket, which includes the files anybody signed in has filed
 *      from the page and an account's own song;
 *   3. every MP3 somebody attached to a post or a reply on the board.
 *
 * ## Paths, which is what makes it a directory
 *
 * A folder's whole path is its key - `HEXHAM`, `HEXHAM/GRIDLOCK` - and a file is filed by
 * path, so a file's name is simply where it is: in `HEXHAM/GRIDLOCK` a file called
 * `GLASS CORRIDOR` is listed as
 *
 *     GLASS CORRIDOR - GRIDLOCK - HEXHAM
 *
 * which is the archive's naming convention, derived rather than typed. Folders come from two
 * places and are the same thing either way: the paths the catalogue implies for its own
 * releases, and the paths anybody has created on the page. A path only a *file* mentions
 * exists too - a directory is real while something is in it - so a file whose folder row was
 * never written still appears where its name says it is.
 *
 * Everything here is pure: the grouping, the ordering, the search and the tags can all be
 * reasoned about (and checked) without a browser - see Temp/check-archive-tree.cjs.
 */

/** Where a listed file came from, in the listing's own words. */
export type ArchiveSource = 'ARCHIVE' | 'SHELF' | 'BOARD';

export const SOURCE_LABEL: Record<ArchiveSource, string> = {
  ARCHIVE: 'ARCHIVE',
  SHELF: 'SHELF',
  BOARD: 'BOARD',
};

/** A folder's whole path, artist first: `HEXHAM`, `HEXHAM/GRIDLOCK`. */
export type FolderPath = string;

/** The name the root of the archive is listed under, in a path line. */
export const ROOT_FOLDER_NAME = 'MUSIC';

/** How long a folder or file name may be, so one name cannot fill a row. */
const MAX_NAME = 64;

/** One file as the directory lists it. */
export type ArchiveRow = {
  track: AudioTrack;
  /** Who filed it: the poster of the post it came with, or its credit. */
  poster: string;
  /** How it sounds, spelled once here so the pills and the filter agree. */
  tags: string[];
  source: ArchiveSource;
  /** The folder it is filed in; `null` is the root of the archive. */
  folderPath: FolderPath | null;
  /** The post it was filed on, when it came from the board. */
  href?: string;
  threadTitle?: string;
  /**
   * When the newest post carrying this file was filed.
   *
   * Undefined for a file that exists only on the shelf or in the catalogue: there is no post to
   * date it by, and a hand-written catalogue entry given an invented date would sit above
   * somebody's actual post in a "newest first" listing.
   */
  filedAt?: string;
  /** How many posts and replies carry this file: what "popular" counts for a file. */
  filedCount: number;
};

/** One folder of the directory: its subfolders, and the files filed directly in it. */
export type ArchiveFolder = {
  /** `HEXHAM/GRIDLOCK`; `null` for the root of the archive. */
  path: FolderPath | null;
  /** The last segment: `GRIDLOCK`, or `MUSIC` for the root. */
  name: string;
  folders: ArchiveFolder[];
  files: ArchiveRow[];
  /** Files in this folder and in everything under it. */
  fileCount: number;
};

export type ArchiveTree = {
  root: ArchiveFolder;
  /** Every folder that exists, A to Z - what a "file into" choice offers. */
  paths: FolderPath[];
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
 * A name as this archive spells it: one line, spaced, uppercase, and never a path separator.
 *
 * Folders and files are named by hand and the archive's own names are shouted, so what anybody
 * types comes out in the same voice as the catalogue - and the window that files a track shows
 * the result before it is filed, so nothing is a surprise.
 */
export function normaliseArchiveName(raw: string): string {
  return raw
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, MAX_NAME);
}

/** The whole path for a folder inside another: `HEXHAM` + `GRIDLOCK` -> `HEXHAM/GRIDLOCK`. */
export function childFolderPath(parent: FolderPath | null, name: string): FolderPath {
  const clean = normaliseArchiveName(name);
  const under = parent ?? '';

  if (under.length === 0) return clean;
  return clean.length === 0 ? under : `${under}/${clean}`;
}

/**
 * A whole path as this archive spells it, each segment normalised: `my artist / my release` ->
 * `MY ARTIST/MY RELEASE`. `null` when there is nothing left of it, which is what a store
 * refuses.
 */
export function normaliseFolderPath(raw: string | null | undefined): FolderPath | null {
  const parts = (raw ?? '')
    .split('/')
    .map((part) => normaliseArchiveName(part))
    .filter((part) => part.length > 0);

  return parts.length === 0 ? null : parts.join('/');
}

/** The folder a path sits in: `HEXHAM/GRIDLOCK` -> `HEXHAM`; a top-level folder -> the root. */
export function parentFolderPath(path: FolderPath | null): FolderPath | null {
  if (path === null) return null;

  const cut = path.lastIndexOf('/');
  return cut <= 0 ? null : path.slice(0, cut);
}

/** The last segment of a path: `HEXHAM/GRIDLOCK` -> `GRIDLOCK`. */
export function folderName(path: FolderPath): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Every folder a path sits in, root-most first: `A/B/C` -> `['A', 'A/B', 'A/B/C']`.
 *
 * This is what makes a path exist: the listing is built from these rather than from folder
 * rows alone, so a file is never lost to a folder that was never written down.
 */
export function folderAncestors(path: FolderPath): FolderPath[] {
  const ancestors: FolderPath[] = [];

  for (const part of path.split('/').filter((piece) => piece.length > 0)) {
    const previous = ancestors[ancestors.length - 1];
    ancestors.push(previous === undefined ? part : `${previous}/${part}`);
  }

  return ancestors;
}

/** `MUSIC / HEXHAM / GRIDLOCK`, for a window that has to say where something is going. */
export function folderLabel(path: FolderPath | null): string {
  const under = path === null || path.length === 0 ? [] : path.split('/');
  return [ROOT_FOLDER_NAME, ...under].join(' / ');
}

/**
 * A file's name: `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]`, read off where it is filed.
 *
 * The nearest folder is the album and the one behind it the artist, which is the order the
 * convention reads in - a path is written artist first, the way a directory is. A file at the
 * root has no release to name, so its title is its name; one filed straight into an artist's
 * folder is `[TITLE] - [ARTIST]`, which is all there is to say about it.
 */
export function archiveDisplayName(title: string, folderPath?: FolderPath | null): string {
  const release =
    folderPath === undefined || folderPath === null ? [] : folderPath.split('/').reverse().filter((part) => part.length > 0);

  return [title, ...release].join(' - ');
}

/** The path a release filed in the code catalogue implies: `HEXHAM` + `GRIDLOCK`. */
export function releaseFolderPath(artist: string, album?: string | null): FolderPath | null {
  const parts = [normaliseArchiveName(artist), album === undefined || album === null ? '' : normaliseArchiveName(album)].filter(
    (part) => part.length > 0,
  );

  return parts.length === 0 ? null : parts.join('/');
}

/**
 * The rows: the player's queue in its own order first - so the directory and the bar never
 * disagree about what the shelf holds - with anything posted to a thread and not on the
 * shelf appended after it, because a linked MP3 is playable without ever being copied onto
 * the site.
 *
 * A file that is both on the shelf and on a post is listed once, and the two halves are
 * taken from the half that knows: **the shelf's own record of the file** (which is what knows
 * where it is filed, so a track referenced in a thread stays in its folder instead of falling
 * out of the directory) with **the post's poster** (which is what a listing wants to print). A
 * file that only exists on a post has only the post to speak for it - and a post has no
 * folders, so it is listed at the root.
 */
export function buildArchiveRows(queue: AudioTrack[], threads: ForumThread[]): ArchiveRow[] {
  const filed = collectFiledTracks(threads);
  const bySrc = new Map(filed.map((entry) => [entry.track.src, entry]));
  // `collectFiledTracks` is newest first, so the first entry for a file is when it was last posted,
  // and every entry is one more time it was filed.
  const newest = new Map<string, string>();
  const filings = new Map<string, number>();

  for (const entry of filed) {
    const src = entry.track.src;
    if (!newest.has(src)) newest.set(src, entry.filedAt);
    filings.set(src, (filings.get(src) ?? 0) + 1);
  }

  /** When it was last posted and how many times: what the two orderings that ask are read from. */
  const dated = (src: string): { filedCount: number; filedAt?: string } => {
    const at = newest.get(src);

    return { filedCount: filings.get(src) ?? 0, ...(at === undefined ? {} : { filedAt: at }) };
  };

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
      folderPath: track.folderPath ?? null,
      href: entry.href,
      threadTitle: entry.threadTitle,
      ...dated(src),
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
        folderPath: track.folderPath ?? null,
        ...dated(track.src),
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
      folderPath: entry.track.folderPath ?? null,
      href: entry.href,
      threadTitle: entry.threadTitle,
      ...dated(entry.track.src),
    });
  }

  return rows;
}

/**
 * The archive as a directory: folders, and the files filed in them.
 *
 * Both levels are built the same way - a folder exists because a path was mentioned, whether by
 * a folder row somebody created or by a file filed into it - so an empty folder shows (which is
 * the point of creating one) and a file never goes missing because its folder row was never
 * written. Each level reads folders A to Z, then files in running order, which is the order a
 * file browser draws them in.
 */
export function buildArchiveTree(rows: ArchiveRow[], folders: { path: FolderPath }[] = []): ArchiveTree {
  const known = new Set<FolderPath>();

  for (const folder of folders) {
    for (const path of folderAncestors(folder.path)) known.add(path);
  }

  for (const row of rows) {
    if (row.folderPath === null) continue;
    for (const path of folderAncestors(row.folderPath)) known.add(path);
  }

  const nodes = new Map<FolderPath, ArchiveFolder>();

  for (const path of known) {
    nodes.set(path, { path, name: folderName(path), folders: [], files: [], fileCount: 0 });
  }

  const root: ArchiveFolder = { path: null, name: ROOT_FOLDER_NAME, folders: [], files: [], fileCount: 0 };

  for (const node of nodes.values()) {
    const parent = parentFolderPath(node.path);
    const into = parent === null ? root : nodes.get(parent);

    // Every ancestor is in `known`, so a node always has somewhere to go.
    into?.folders.push(node);
  }

  for (const row of rows) {
    const into = row.folderPath === null ? root : nodes.get(row.folderPath);
    into?.files.push(row);
  }

  return { root: arrangeFolder(root), paths: [...known].sort((a, b) => a.localeCompare(b)) };
}

/** Folders A to Z, then files in running order, and the count kept up the way out. */
function arrangeFolder(folder: ArchiveFolder): ArchiveFolder {
  const folders = folder.folders.sort((a, b) => a.name.localeCompare(b.name)).map(arrangeFolder);
  const files = sortByTrackNumber(folder.files);

  return {
    ...folder,
    folders,
    files,
    fileCount: files.length + folders.reduce((total, child) => total + child.fileCount, 0),
  };
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

/** Who a file is filed under: the poster when the board knows one, else the track's own credit. */
export function rowUploader(row: ArchiveRow): string {
  const poster = row.poster.trim();

  return poster.length === 0 ? row.track.credit : poster;
}

/** The same rows in the order that was asked for. Ties always fall back to the name. */
export function sortArchiveRows(rows: ArchiveRow[], sort: TrackSort): ArchiveRow[] {
  const byName = (a: ArchiveRow, b: ArchiveRow) => a.track.title.localeCompare(b.track.title);

  if (sort === 'recent') {
    // An ISO stamp compares as text, and the empty one sorts lowest - so a file with no post on it
    // lands after every file that has one, which is the honest place for it.
    return [...rows].sort((a, b) => (b.filedAt ?? '').localeCompare(a.filedAt ?? '') || byName(a, b));
  }

  if (sort === 'popular') {
    return [...rows].sort((a, b) => b.filedCount - a.filedCount || byName(a, b));
  }

  if (sort === 'uploader') {
    return [...rows].sort(
      (a, b) => rowUploader(a).toLowerCase().localeCompare(rowUploader(b).toLowerCase()) || byName(a, b),
    );
  }

  return sortByDisplayName(rows);
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
 * Everything a typed word is looked in: the whole name (track, release, artist), where it is
 * filed, the poster, the year and the tags - so `idm`, `1998` and `hexham lock` all find the
 * same rows.
 */
function haystack(row: ArchiveRow): string {
  const track = row.track;

  return [track.title, row.folderPath ?? '', track.credit, track.year ?? '', row.poster, ...row.tags]
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
