// Recent songs: every song worked on keeps a few versions in this browser as it's edited, to go back to. Worked out from BeepBox's own
// editor/SongRecovery.ts (MIT: see CREDITS.md): the same 8 songs, and the same way of thinning versions out, so there are more of them close
// to now and fewer further back, and the same way of choosing which song goes. Nothing leaves the browser.

export interface RecentVersion {
  readonly time: number;
  /** How much work had gone into the song by then, in milliseconds. */
  readonly work: number;
  /** The song, as BeepBox's song text. */
  readonly data: string;
}

export interface RecentSong {
  readonly uid: string;
  /** Newest first. */
  readonly versions: readonly RecentVersion[];
}

export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MOST_RECENT_SONGS = 8;
// BeepBox has no limit but its thinning. One song kept for years shouldn't crowd the rest out of the browser's room.
const MOST_VERSIONS = 24;
const STORAGE_KEY = "debaser.beatbox.recent.v1";
const FIRST_WORK = 1000;
const LONGEST_WORK_PER_VERSION = 3 * 60 * 1000;
const SHORTEST_SPAN = 60 * 1000;
const SPAN_GROWTH = Math.SQRT2;
const HALF_DAY = 12 * 60 * 60 * 1000;
const WORK_HEAD_START = 5 * 60 * 1000;

export function newSongId(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(32);
}

function byNewest(a: RecentSong, b: RecentSong): number {
  return (b.versions[0]?.time ?? 0) - (a.versions[0]?.time ?? 0);
}

/** At most one version goes at a time: where two sit closer in work than their age deserves, the less memorable of them. */
function thinned(versions: readonly RecentVersion[]): readonly RecentVersion[] {
  let span = SHORTEST_SPAN;
  for (let index = 1; index < versions.length; index += 1) {
    const current = versions[index];
    const older = versions[index + 1];
    const newer = versions[index - 1];
    if (!current || !newer) break;
    if (current.work - (older?.work ?? 0) < span) {
      let going = index;
      // Of three in a row, keep the newest and the oldest, unless a long gap after the middle one makes it the end of a stretch of work.
      if (older && current.time - older.time < 0.5 * (newer.time - current.time)) going = index + 1;
      return versions.filter((_, at) => at !== going);
    }
    span *= SPAN_GROWTH;
  }
  return versions;
}

/** Older songs and ones with less work go first, and never the newest half. */
function withoutLeastImportant(songs: readonly RecentSong[], now: number): readonly RecentSong[] {
  let least: RecentSong | null = null;
  let leastWeight = Infinity;
  for (const song of songs.slice(Math.round(MOST_RECENT_SONGS / 2))) {
    const newest = song.versions[0];
    if (!newest) continue;
    const weight = (newest.work + WORK_HEAD_START) / ((now - newest.time) / HALF_DAY + 1);
    if (weight < leastWeight) {
      leastWeight = weight;
      least = song;
    }
  }
  return songs.filter((song) => song !== least);
}

/** The songs with a new version of one of them. The same song text as its newest version changes nothing. */
export function addVersion(songs: readonly RecentSong[], uid: string, data: string, now: number): readonly RecentSong[] {
  const song = songs.find((one) => one.uid === uid);
  const newest = song?.versions[0];
  if (newest?.data === data) return songs;
  const work = newest ? newest.work + Math.min(LONGEST_WORK_PER_VERSION, now - newest.time) : FIRST_WORK;
  const versions = thinned([{ time: now, work, data }, ...(song?.versions ?? [])]).slice(0, MOST_VERSIONS);
  let next: readonly RecentSong[] = [...songs.filter((one) => one !== song), { uid, versions }].sort(byNewest);
  while (next.length > MOST_RECENT_SONGS) next = withoutLeastImportant(next, now);
  return next;
}

function isVersion(value: unknown): value is RecentVersion {
  const version = value as Partial<RecentVersion> | null;
  return typeof version?.time === "number" && typeof version.work === "number" && typeof version.data === "string";
}

function isSong(value: unknown): value is RecentSong {
  const song = value as Partial<RecentSong> | null;
  return typeof song?.uid === "string" && Array.isArray(song.versions) && song.versions.length > 0 && song.versions.every(isVersion);
}

export function readRecent(storage: RecentStorage | null): readonly RecentSong[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter(isSong).sort(byNewest) : [];
  } catch {
    return [];
  }
}

export interface RecentStore {
  subscribe(listener: () => void): () => void;
  getSongs(): readonly RecentSong[];
  save(uid: string, data: string, now: number): void;
  /** Catches up with what another tab has kept. */
  refresh(): void;
}

export function createRecentStore(storage: RecentStorage | null): RecentStore {
  const listeners = new Set<() => void>();
  let songs = readRecent(storage);

  /** What's in the browser, which another tab may have added to, and what only this page has, where the browser had no room. */
  function caughtUp(): readonly RecentSong[] {
    const stored = readRecent(storage);
    return [...stored, ...songs.filter((song) => !stored.some((one) => one.uid === song.uid))].sort(byNewest);
  }

  /** Writes as many as the browser has room for, the oldest going first. The newest always stays in this page, whatever the browser says. */
  function write() {
    let keeping = songs;
    while (keeping.length > 0) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(keeping));
        songs = keeping;
        return;
      } catch {
        if (keeping.length === 1) return;
        keeping = keeping.slice(0, -1);
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSongs: () => songs,
    save(uid, data, now) {
      const current = caughtUp();
      const next = addVersion(current, uid, data, now);
      if (next === current) return;
      songs = next;
      write();
      for (const listener of listeners) listener();
    },
    refresh() {
      const current = caughtUp();
      if (JSON.stringify(current) === JSON.stringify(songs)) return;
      songs = current;
      for (const listener of listeners) listener();
    },
  };
}
