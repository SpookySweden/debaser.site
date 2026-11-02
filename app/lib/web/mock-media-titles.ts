import { MEDIA_SERVER_IDS } from './media-servers';
import { groupTitles, parseList, titleToItem, type MediaDetails } from './media-titles';
import type { WebItem } from './types';

/**
 * The mock's media-server titles (SPEC-media-servers.md): two fake list files, one per placeholder server, in
 * the list's real shape, read by the same `parseList` / `groupTitles` the hourly update uses. Every title says
 * MOCK and its TMDB numbers are made up (nothing here asks TMDB). The placeholder servers do not exist, so
 * PLAY on any of them shows the NOT ANSWERING state.
 *
 * - MOCK FILM 01 is on both servers: one row, two SERVER buttons.
 * - MOCK SHOW 02 is a show: server 1 holds three episodes over two seasons, server 2 only the first.
 * - MOCK HOME VIDEO 03 has no TMDB number: the list's own words, on server 2 only.
 * - MOCK FILM 04 has a TMDB number TMDB has no details for: the list's title alone.
 * - MOCK SERIES FILM 05 (server 1) and 06 (server 2) share a made-up TMDB collection: ONE row, MOCK FILM SERIES,
 *   with a FILM picker (media-collections.ts).
 * - MOCK SHOW 07 is listed as a whole show on server 1: only WHOLE SERIES plays it.
 */

const NOW = '2026-11-01T12:00:00.000Z';

const SERVER_1_LIST = [
  { title: 'MOCK FILM 01: a fake film', type: 'movie', tmdb_id: '999999901', provider: 'ignored' },
  { title: 'MOCK SHOW 02: a fake show', type: 'tv', tmdb_id: '999999902', season: '1', episode: '1' },
  { title: 'MOCK SHOW 02: a fake show', type: 'tv', tmdb_id: '999999902', season: '1', episode: '2' },
  { title: 'MOCK SHOW 02: a fake show', type: 'tv', tmdb_id: '999999902', season: '2', episode: '1' },
  { title: 'MOCK FILM 04: a number TMDB does not know', type: 'movie', tmdb_id: '999999904' },
  { title: 'MOCK SERIES FILM 05: part one', type: 'movie', tmdb_id: '999999905' },
  // A show listed whole (no season and episode): only the WHOLE SERIES player can open it.
  { title: 'MOCK SHOW 07: listed as a whole show', type: 'tv', tmdb_id: '999999907' },
];

const SERVER_2_LIST = [
  { title: 'Mock Film 01 (the second server spells it differently)', type: 'movie', tmdb_id: '999999901' },
  { title: 'MOCK SERIES FILM 06: part two', type: 'movie', tmdb_id: '999999906' },
  { title: 'MOCK SHOW 02: a fake show', type: 'tv', tmdb_id: '999999902', season: '1', episode: '1' },
  {
    title: 'MOCK HOME VIDEO 03: made by a friend',
    type: 'movie',
    id: 'home-video-03',
    creator: 'Mock Friend',
    description: 'Mock description from the list file itself: TMDB does not know this video.',
    date: '2026-10-12',
    duration: 754,
    // Off the server's own host: dropped, so the row shows the missing-picture slot.
    thumbnail: 'https://elsewhere.example/pictures/home-video-03.jpg',
  },
];

/** Made-up details standing in for TMDB's. No poster: there is no real picture to borrow. */
const DETAILS: Record<string, MediaDetails> = {
  'tmdb-movie-999999901': {
    title: 'MOCK FILM 01: a fake film',
    date: '2001-02-03',
    overview: 'Mock overview standing in for TMDB\'s. On both servers, so it shows SERVER 1 and SERVER 2.',
    runtimeMinutes: 101,
    genres: ['Mock', 'Test pattern'],
  },
  'tmdb-tv-999999902': {
    title: 'MOCK SHOW 02: a fake show',
    date: '2010-04-05',
    overview: 'Mock overview of a show. Pick a season and an episode; only the servers holding it can play it.',
    runtimeMinutes: 24,
    genres: ['Mock'],
    seasons: [
      { season: 1, episodes: 6 },
      { season: 2, episodes: 6 },
    ],
  },
  // Two films of one made-up TMDB collection, one on each server: one row, a FILM picker, both SERVER buttons.
  'tmdb-movie-999999905': {
    title: 'MOCK SERIES FILM 05: part one',
    date: '1999-05-01',
    overview: 'Mock overview of the first film of a fake film series.',
    runtimeMinutes: 120,
    genres: ['Mock'],
    collection: { id: 999999990, name: 'MOCK FILM SERIES (a fake collection)' },
  },
  'tmdb-movie-999999906': {
    title: 'MOCK SERIES FILM 06: part two',
    date: '2002-05-01',
    overview: 'Mock overview of the second film of a fake film series.',
    runtimeMinutes: 130,
    genres: ['Mock'],
    collection: { id: 999999990, name: 'MOCK FILM SERIES (a fake collection)' },
  },
  'tmdb-tv-999999907': {
    title: 'MOCK SHOW 07: listed as a whole show',
    date: '2015-01-01',
    overview: 'Mock overview of a show a server lists as a whole: press WHOLE SERIES.',
    genres: ['Mock'],
  },
};

/** When each title first appeared (newest first in the stream, above the other mock items). */
const FIRST_SEEN: Record<string, string> = {
  'tmdb-movie-999999901': '2026-11-01T10:00:00.000Z',
  'tmdb-tv-999999902': '2026-11-01T09:00:00.000Z',
  'tmdb-movie-999999904': '2026-11-01T07:00:00.000Z',
  'tmdb-movie-999999906': '2026-11-01T11:30:00.000Z',
  'tmdb-movie-999999905': '2026-11-01T11:00:00.000Z',
  'tmdb-tv-999999907': '2026-11-01T10:30:00.000Z',
};
const HOME_VIDEO_SEEN = '2026-11-01T08:00:00.000Z';

// The first two listed servers play "server 1" and "server 2" (one server listed: it holds both lists), so the
// mock follows whatever the Debaser Servers program has saved.
const FIRST = MEDIA_SERVER_IDS[0];
const SECOND = MEDIA_SERVER_IDS[1] ?? FIRST;

// No server listed: no mock titles (there is nothing to hold them).
export const MOCK_MEDIA_ITEMS: readonly WebItem[] = FIRST === undefined ? [] : groupTitles([...parseList(SERVER_1_LIST, FIRST, NOW), ...parseList(SERVER_2_LIST, SECOND, NOW)]).map((title) =>
  titleToItem(title, { publishedAt: FIRST_SEEN[title.key] ?? (title.key.endsWith('-home-video-03') ? HOME_VIDEO_SEEN : NOW), fetchedAt: NOW }, DETAILS[title.key]),
);
