import type { VanitySong, VanityTrack } from './vanity';

/**
 * VANITY's FOR YOU (SPEC-vanity.md step 5): picks made from what the reader's closest people play.
 *
 * The database does the private part (`music_for_you`): it scores closeness for the person asking and
 * hands back, for their closest visible people, each song and how often (capped). This module turns
 * those rows into the rows on screen, and is pure so a check can hold the rules:
 *   - a song's score is the sum over people of closeness x their plays, plus a small all-site term so a
 *     reader with no contacts still gets something (the reader's own plays left out of it);
 *   - picks lean new: the score is divided by one plus the reader's own plays (ON REPEAT has the rest);
 *   - barred songs are never picked, in any row;
 *   - the faces are the people adding most to a pick, at most three, then `+n`;
 *   - the "why this?" line names the kind of closeness that weighed most for that pick;
 *   - the reader is never one of their own faces.
 */

export type Reason = 'replies' | 'messages' | 'together' | 'visits';

/** One row of `music_for_you`: a close person, why they are close, one song they played and how often. */
export type CloseRow = { personId: string; closeness: number; reason: Reason; src: string; plays: number };

export type Face = { personId: string; plays: number };

export type Pick<T extends VanityTrack = VanityTrack> = {
  key: string;
  name: string;
  /** The artist, for an album; the artist for a song; '' for an artist. */
  sub: string;
  songs: VanitySong<T>[];
  faces: Face[];
  /** People beyond the three faces. */
  more: number;
  why: string;
  score: number;
};

export type Orbit<T extends VanityTrack = VanityTrack> = { personId: string; reason: Reason; songs: VanitySong<T>[] };

export type ForYou<T extends VanityTrack = VanityTrack> = {
  songs: Pick<T>[];
  artists: Pick<T>[];
  albums: Pick<T>[];
  onRepeat: VanitySong<T>[];
  orbits: Orbit<T>[];
  /** Every song with a score, best first: what PLAY FOR YOU draws from (never a barred song). */
  pool: Pick<T>[];
};

/** Items per row. */
export const ROW_SIZE = 8;
/** People with a row of their own. */
export const ORBIT_PEOPLE = 4;
/** What one all-site play is worth beside one play by somebody close (closeness starts at 1). */
export const POPULARITY = 0.1;
/** ON REPEAT starts at two plays: one listen is not a habit. */
export const REPEAT_FROM = 2;

const PHRASE: Record<Reason, string> = {
  replies: 'YOU TRADE REPLIES WITH',
  messages: 'YOU MESSAGE',
  together: 'YOU LISTEN WITH',
  visits: 'YOU SWAP PROFILE VISITS WITH',
};

/** `PLAYED BY 3 PEOPLE YOU TRADE REPLIES WITH`, `PLAYED BY SOMEONE YOU MESSAGE`. */
export function whyLine(reason: Reason, people: number): string {
  return `PLAYED BY ${people === 1 ? 'SOMEONE' : `${people} PEOPLE`} ${PHRASE[reason]}`;
}

export const POPULAR_LINE = 'POPULAR ON THE SITE';

/** The kind of closeness that weighs most, the way the database picks it (ties: replies, messages, together, visits). */
export function mainReason(parts: Record<Reason, number>): Reason {
  const order: Reason[] = ['replies', 'messages', 'together', 'visits'];
  return order.reduce((best, reason) => (parts[reason] > parts[best] ? reason : best), order[0]);
}

type Contribution = { person: string; reason: Reason; plays: number; weight: number };

function scorePick<T extends VanityTrack>(
  key: string,
  name: string,
  sub: string,
  songs: VanitySong<T>[],
  played: ReadonlyMap<string, Contribution[]>,
  mine: ReadonlyMap<string, number>,
): Pick<T> | null {
  const people = new Map<string, Contribution>();
  let site = 0;
  let own = 0;

  for (const song of songs) {
    const yours = mine.get(song.track.src) ?? 0;
    // Your own plays are not the site's taste: a song only you play is not POPULAR ON THE SITE.
    site += Math.max(0, song.plays - yours);
    own += yours;
    for (const part of played.get(song.track.src) ?? []) {
      const sum = people.get(part.person) ?? { ...part, plays: 0, weight: 0 };
      sum.plays += part.plays;
      sum.weight += part.weight;
      people.set(part.person, sum);
    }
  }

  const ranked = [...people.values()].sort((a, b) => b.weight - a.weight || a.person.localeCompare(b.person));
  const raw = ranked.reduce((total, part) => total + part.weight, 0) + POPULARITY * site;
  if (raw <= 0) return null;

  let why = POPULAR_LINE;
  if (ranked.length > 0) {
    const byReason: Record<Reason, number> = { replies: 0, messages: 0, together: 0, visits: 0 };
    for (const part of ranked) byReason[part.reason] += part.weight;
    const reason = mainReason(byReason);
    why = whyLine(reason, ranked.filter((part) => part.reason === reason).length);
  }

  return {
    key,
    name,
    sub,
    songs,
    faces: ranked.slice(0, 3).map((part) => ({ personId: part.person, plays: part.plays })),
    more: Math.max(0, ranked.length - 3),
    why,
    score: raw / (1 + own),
  };
}

const byScore = (a: Pick, b: Pick) => b.score - a.score || a.name.localeCompare(b.name);

/**
 * The FOR YOU rows. `songs` is every song VANITY knows (`vanitySongs`, with all-site plays); `rows` is
 * `music_for_you`; `mine` is the reader's own plays, uncapped; `barred` their barred file addresses.
 */
export function forYou<T extends VanityTrack>(input: {
  songs: readonly VanitySong<T>[];
  rows: readonly CloseRow[];
  mine: ReadonlyMap<string, number>;
  barred: ReadonlySet<string>;
  selfId: string | null;
}): ForYou<T> {
  const { mine, barred, selfId } = input;
  const songs = input.songs.filter((song) => !barred.has(song.track.src));
  const known = new Map(songs.map((song) => [song.track.src, song]));
  const rows = input.rows.filter((row) => row.personId !== selfId && row.plays > 0 && row.closeness > 0 && known.has(row.src));

  const played = new Map<string, Contribution[]>();
  for (const row of rows) {
    const list = played.get(row.src) ?? [];
    list.push({ person: row.personId, reason: row.reason, plays: row.plays, weight: row.closeness * row.plays });
    played.set(row.src, list);
  }

  const pool = songs
    .map((song) => scorePick(song.track.src, song.track.title, song.artist, [song], played, mine))
    .filter((pick): pick is Pick<T> => pick !== null)
    .sort(byScore);
  const songPicks = pool.slice(0, ROW_SIZE);

  const grouped = (keyOf: (song: VanitySong<T>) => string | null, nameOf: (song: VanitySong<T>) => [string, string]) => {
    const groups = new Map<string, VanitySong<T>[]>();
    for (const song of songs) {
      const key = keyOf(song);
      if (key === null) continue;
      groups.set(key, [...(groups.get(key) ?? []), song]);
    }
    return [...groups.entries()]
      .map(([key, list]) => scorePick(key, ...nameOf(list[0]), list, played, mine))
      .filter((pick): pick is Pick<T> => pick !== null)
      .sort(byScore)
      .slice(0, ROW_SIZE);
  };

  // Keys as `vanity.ts` makes them (case-blind), so a pick opens the same artist or album page.
  const artists = grouped((song) => song.artist.toUpperCase(), (song) => [song.artist, '']);
  const albums = grouped(
    (song) => (song.album === null ? null : `${song.artist.toUpperCase()}/${song.album.toUpperCase()}`),
    (song) => [song.album ?? '', song.artist],
  );

  const onRepeat = songs
    .filter((song) => (mine.get(song.track.src) ?? 0) >= REPEAT_FROM)
    .sort((a, b) => (mine.get(b.track.src) ?? 0) - (mine.get(a.track.src) ?? 0) || a.track.title.localeCompare(b.track.title))
    .slice(0, ROW_SIZE);

  const people = new Map<string, { closeness: number; reason: Reason; songs: { song: VanitySong<T>; plays: number }[] }>();
  for (const row of rows) {
    const person = people.get(row.personId) ?? { closeness: row.closeness, reason: row.reason, songs: [] };
    person.songs.push({ song: known.get(row.src)!, plays: row.plays });
    people.set(row.personId, person);
  }
  const orbits = [...people.entries()]
    .sort(([a, x], [b, y]) => y.closeness - x.closeness || a.localeCompare(b))
    .slice(0, ORBIT_PEOPLE)
    .map(([personId, person]) => ({
      personId,
      reason: person.reason,
      songs: person.songs
        .sort((a, b) => b.plays - a.plays || a.song.track.title.localeCompare(b.song.track.title))
        .slice(0, ROW_SIZE)
        .map((entry) => entry.song),
    }));

  return { songs: songPicks, artists, albums, onRepeat, orbits, pool };
}

export function isEmpty(picks: ForYou): boolean {
  return picks.songs.length + picks.artists.length + picks.albums.length + picks.onRepeat.length + picks.orbits.length === 0;
}

/**
 * Closeness the way `music_for_you` weighs it, for the mock (which only knows visits and listening
 * along): together = minutes / 5 (at most 3 hours a session), visits x1 (at most 20 each way).
 */
export function mockCloseness(parts: { visits: number[]; followMinutes: number[] }): { closeness: number; reason: Reason } {
  const together = parts.followMinutes.reduce((total, minutes) => total + Math.min(Math.max(minutes, 0), 180), 0) / 5;
  const visits = parts.visits.reduce((total, count) => total + Math.min(count, 20), 0);
  const weights = { replies: 0, messages: 0, together, visits };
  return { closeness: together + visits, reason: mainReason(weights) };
}

/** Songs PLAY FOR YOU adds at a time, when its queue runs low. */
export const RADIO_ROUND = 5;

/**
 * The next songs for PLAY FOR YOU: drawn from the pool weighted by score (a better pick comes up more
 * often, a weak one still can), each once per round, never one in `avoid` (barred, or played lately)
 * unless the pool has nothing else. `random` is passed in so a check can pin it.
 */
export function radioRound<P extends { key: string; score: number }>(
  pool: readonly P[],
  avoid: ReadonlySet<string>,
  random: () => number,
  size = RADIO_ROUND,
): P[] {
  const fresh = pool.filter((pick) => !avoid.has(pick.key) && pick.score > 0);
  const left = fresh.length > 0 ? [...fresh] : pool.filter((pick) => pick.score > 0);
  const round: P[] = [];

  while (round.length < size && left.length > 0) {
    const total = left.reduce((sum, pick) => sum + pick.score, 0);
    let target = random() * total;
    let index = 0;
    while (index < left.length - 1 && target >= left[index].score) {
      target -= left[index].score;
      index += 1;
    }
    round.push(left[index]);
    left.splice(index, 1);
  }

  return round;
}

/**
 * Live faces: the broadcast a face's person is playing right now, when it is one of this item's songs
 * (`srcs`; null for "anything", the orbit heading). Only live broadcasts count - a paused or silent one
 * is not "playing right now". Private queues never reach the reader at all.
 */
export function liveFor<Q extends { userId: string; trackId: string }>(
  live: readonly Q[],
  personId: string,
  srcs: ReadonlySet<string> | null,
): Q | null {
  return live.find((queue) => queue.userId === personId && (srcs === null || srcs.has(queue.trackId))) ?? null;
}
