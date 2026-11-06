import { dedupeKey, readStreamPage } from './dedupe';
import { collectionOf, readMediaPage, withSeriesName } from './media-collections';
import { mergeStreamPages } from './media-merge';
import { MOCK_MEDIA_ITEMS } from './mock-media-titles';
import { pageOf, type StreamDirection } from './paging';
import type { WebRepository } from './repository';
import { authorList, matchesAuthor, matchesSearch, searchWords } from './search';
import type { WebItem, WebSource } from './types';

/**
 * Twenty-two clearly fake items (more than one page, so LOAD MORE shows), for building and checking the page without the network.
 *
 * Titles and descriptions are invented and say MOCK. The first five borrow real LibriVox identifiers
 * (from `scripts/fixtures/web/internet-archive-librivox.json`) so the thumbnail, the link and the
 * click-to-load player can be tried against the real Archive; the other seven have no thumbnail and
 * no player, and link to the LibriVox collection page, so the missing-picture slot and the link-only
 * row are on the page too.
 *
 * Items 13-20, two per other platform (PeerTube, Openverse, podcast, YouTube), borrow real identifiers
 * from that platform's fixture in `scripts/fixtures/web/` the same way, so every source label and every
 * official player is on the page.
 */

const FETCHED_AT = '2026-10-31T12:00:00.000Z';
const COLLECTION = 'https://archive.org/details/librivoxaudio';

function borrowed(n: number, externalId: string, publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const page = `https://archive.org/details/${externalId}`;
  return {
    id: `internet_archive:${externalId}`,
    platform: 'internet_archive',
    externalId,
    kind: 'audio',
    url: page,
    canonicalUrl: page,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: a fake title over a real recording`,
    creator: 'Mock Creator',
    description: 'Mock description. The words are invented; the picture and the player are the real item on the Internet Archive.',
    thumbnailUrl: `https://archive.org/services/img/${externalId}`,
    embedUrl: `https://archive.org/embed/${externalId}`,
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

function invented(n: number, kind: WebItem['kind'], publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const externalId = `mock-item-${String(n).padStart(2, '0')}`;
  return {
    id: `internet_archive:${externalId}`,
    platform: 'internet_archive',
    externalId,
    kind,
    url: COLLECTION,
    canonicalUrl: COLLECTION,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: an invented ${kind} item`,
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

/** A PeerTube video on tilvids.com, borrowed from `scripts/fixtures/web/peertube-tilvids.json`. */
function peertube(n: number, uuid: string, thumbFile: string, publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const page = `https://tilvids.com/videos/watch/${uuid}`;
  return {
    id: `peertube:${uuid}`,
    platform: 'peertube',
    externalId: uuid,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: a fake title over a real PeerTube video`,
    creator: 'Mock Channel',
    description: 'Mock description. The words are invented; the picture and the player are the real video on tilvids.com.',
    thumbnailUrl: `https://tilvids.com/lazy-static/thumbnails/${thumbFile}`,
    embedUrl: `https://tilvids.com/videos/embed/${uuid}`,
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

/** An Openverse image or sound, borrowed from `scripts/fixtures/web/openverse-*.json`. Link only: Openverse has no player. */
function openverse(n: number, kind: 'image' | 'audio', id: string, publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const page = `https://openverse.org/${kind}/${id}`;
  return {
    id: `openverse:${id}`,
    platform: 'openverse',
    externalId: id,
    kind,
    url: page,
    canonicalUrl: page,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: a fake title over a real Openverse ${kind}`,
    creator: 'Mock Creator',
    thumbnailUrl: `https://api.openverse.org/v1/${kind === 'image' ? 'images' : 'audio'}/${id}/thumb/`,
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

/** A Hacker Public Radio episode, borrowed from `scripts/fixtures/web/podcast-hpr.xml`. Link only: podcasts have no player. */
function podcast(n: number, episode: number, externalId: string, publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const page = `https://hackerpublicradio.org/eps/hpr${episode}/index.html`;
  return {
    id: `podcast:${externalId}`,
    platform: 'podcast',
    externalId,
    kind: 'audio',
    url: page,
    canonicalUrl: page,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: a fake title over a real podcast episode`,
    creator: 'Mock Host',
    description: 'Mock description. The words are invented; the link is the real episode page on Hacker Public Radio.',
    thumbnailUrl: 'https://hackerpublicradio.org/images/hpr_feed_small.png',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

/** A video from Blender's YouTube channel, borrowed from `scripts/fixtures/web/youtube-blender.xml`. */
function youtube(n: number, videoId: string, publishedAt: string, extra: Partial<WebItem> = {}): WebItem {
  const page = `https://youtu.be/${videoId}`;
  return {
    id: `youtube:${videoId}`,
    platform: 'youtube',
    externalId: videoId,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title: `MOCK ITEM ${String(n).padStart(2, '0')}: a fake title over a real YouTube video`,
    creator: 'Mock Channel',
    description: 'Mock description. The words are invented; the picture and the player are the real video on YouTube.',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    publishedAt,
    fetchedAt: FETCHED_AT,
    ...extra,
  };
}

export const MOCK_WEB_ITEMS: readonly WebItem[] = [
  borrowed(1, 'principlesofscientificmanagement_2610_librivox', '2026-10-30T21:27:20.000Z'),
  borrowed(2, 'burningofrome_2610_librivox', '2026-10-30T01:55:45.000Z', { creator: 'Mock Reader; Another Mock Reader' }),
  invented(3, 'video', '2026-10-29T18:00:00.000Z', {
    creator: 'Mock Studio',
    description:
      'Mock description long enough to need clamping. It goes on to show what happens when a platform sends a paragraph rather than a line: the row keeps two lines and the rest is cut, so one chatty item cannot push the stream down the page for everybody reading below it.',
  }),
  borrowed(4, 'hypvol01issue46_2610_librivox', '2026-10-29T09:12:00.000Z', { description: undefined }),
  invented(5, 'image', '2026-10-28T15:30:00.000Z', { creator: 'Mock Photographer', description: 'Mock description of an invented picture.' }),
  borrowed(6, 'commandments_2610_librivox', '2026-10-27T22:45:00.000Z', { creator: undefined }),
  invented(7, 'text', '2026-10-26T11:00:00.000Z', { creator: 'Mock Author', description: 'Mock description of an invented book.' }),
  borrowed(8, 'greatamericanfortunesvol3_2610_librivox', '2026-10-25T08:00:00.000Z'),
  invented(9, 'other', '2026-10-24T20:20:00.000Z', { description: 'Mock description of something that is none of the four kinds.' }),
  invented(10, 'audio', '2026-10-23T07:05:00.000Z', { creator: 'Mock Band', description: 'Mock description of an invented recording with no player.' }),
  invented(11, 'video', '2026-10-22T13:40:00.000Z', { creator: 'Mock Channel' }),
  // The same moment as 11: the tie is broken by id, and paging must not drop or repeat either.
  invented(12, 'text', '2026-10-22T13:40:00.000Z', { description: 'Mock description of a second item published at the same second.' }),
  peertube(13, '75458950-1377-42fb-be1c-34a2c5b9f98c', 'b539f182-326e-4d77-986e-ab2b6abd8f2b.jpg', '2026-10-30T14:18:10.000Z', { durationSeconds: 1784 }),
  peertube(14, '60ab47ba-51b7-4173-8d3c-847000b310ea', 'cacdcaba-07e8-40b2-a6c2-da21bdf14b98.jpg', '2026-10-28T13:49:17.000Z', { licenseUrl: undefined }),
  openverse(15, 'image', '1a2d45e7-e109-4433-8417-a5d3869248c1', '2026-10-29T22:10:00.000Z'),
  openverse(16, 'audio', '5d08a8ad-73b2-45e8-a26d-e1363add3c85', '2026-10-27T10:00:00.000Z', {
    durationSeconds: 72,
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
  }),
  podcast(17, 4760, 'hpr-fef60efdeea933c2042792be8cf4e4d6', '2026-10-30T00:00:00.000Z'),
  podcast(18, 4758, 'hpr-038ee410a54afc6213a8ce0d2fed77e7', '2026-10-28T00:00:00.000Z', { durationSeconds: 1925 }),
  youtube(19, 'H5TGt-susIY', '2026-10-30T20:22:59.000Z'),
  youtube(20, 'YsKxkP_kGbE', '2026-10-26T15:00:00.000Z', { description: undefined }),
  // A duplicate pair (dedupe.ts): one title and creator once tidied, durations within 3%. 21 is newer, so
  // it is the row and 22 is listed on it as ALSO ON; 22 never gets a row of its own.
  invented(21, 'audio', '2026-10-21T10:00:00.000Z', {
    title: 'MOCK ITEM 21: one work, filed twice',
    creator: 'Mock Reader',
    description: 'Mock description of a work found in two places.',
    durationSeconds: 3600,
    tags: ['mock', 'duplicate'],
  }),
  invented(22, 'audio', '2026-10-20T10:00:00.000Z', {
    title: 'MOCK ITEM 21 - One Work (Filed Twice)',
    creator: 'mock reader',
    description: 'Mock description of the second copy.',
    durationSeconds: 3620,
  }),
];

export const MOCK_WEB_SOURCES: readonly WebSource[] = [
  {
    id: 'mock-source-librivox',
    platform: 'internet_archive',
    ref: 'collection:librivoxaudio AND mediatype:audio',
    label: 'LIBRIVOX (MOCK)',
    enabled: true,
    lastCheckedAt: FETCHED_AT,
  },
];

/** Every copy sharing a page's fingerprints; under a search, only the matching ones may lead a row. */
function mockGroup(matches: ((item: WebItem) => boolean) | null) {
  return async (keys: string[]) => {
    const siblings = MOCK_WEB_ITEMS.filter((item) => keys.includes(dedupeKey(item) ?? ''));
    return { siblings, rivals: matches ? siblings.filter(matches) : siblings };
  };
}

/** The media titles' page, film series collapsed to one row each (media-collections.ts), as the Supabase repository does. */
function mockMedia(all: readonly WebItem[], cursor: string | null | undefined, limit: unknown, direction: StreamDirection = 'desc') {
  return readMediaPage(
    async (at) => pageOf(all, at, limit, direction),
    async (collections) => all.filter((item) => collections.includes(collectionOf(item)?.id ?? -1)),
    cursor ?? null,
  );
}

let instance: WebRepository | null = null;

export function getMockWebRepository(): WebRepository {
  instance ??= {
    source: 'mock',
    // The media servers' titles (mock-media-titles.ts) join the stream as the Supabase repository joins them.
    async listItems({ cursor, limit }) {
      const stream = await readStreamPage(async (at) => pageOf(MOCK_WEB_ITEMS, at, limit), mockGroup(null), cursor ?? null);
      return mergeStreamPages(stream, await mockMedia(MOCK_MEDIA_ITEMS, cursor, limit), limit);
    },
    async searchItems({ query, from, cursor, limit, anyWord, oldestFirst }) {
      const direction: StreamDirection = oldestFirst ? 'asc' : 'desc';
      const wanted = searchWords(query);
      const authors = authorList(from);
      if (!wanted && !authors) return { items: [], nextCursor: null };
      // A film's series name counts as part of its title (as the Supabase repository searches it).
      const matches = (item: WebItem) => (!wanted || (anyWord ? wanted.some((word) => matchesSearch(withSeriesName(item), [word])) : matchesSearch(withSeriesName(item), wanted))) && (!authors || matchesAuthor(item, authors));
      const found = MOCK_WEB_ITEMS.filter(matches);
      const stream = await readStreamPage(async (at) => pageOf(found, at, limit, direction), mockGroup(matches), cursor ?? null);
      return mergeStreamPages(stream, await mockMedia(MOCK_MEDIA_ITEMS.filter(matches), cursor, limit, direction), limit, direction);
    },
    async listSources() {
      return MOCK_WEB_SOURCES.map((source) => ({ ...source }));
    },
    async itemWords() {
      // The mock has no batch job behind it, so its rows are ordered by their own tags alone.
      return new Map<string, string[]>();
    },
    async getItem(id) {
      const item = MOCK_WEB_ITEMS.find((candidate) => candidate.id === id);
      return item === undefined ? null : { ...item };
    },
    async mediaTitles(ids) {
      return MOCK_MEDIA_ITEMS.filter((item) => ids.includes(item.id)).map((item) => ({ ...item }));
    },
    async getItemByExternal(platform, externalId) {
      const item = MOCK_WEB_ITEMS.find((candidate) => candidate.platform === platform && candidate.externalId === externalId);
      return item === undefined ? null : { ...item };
    },
  };
  return instance;
}
