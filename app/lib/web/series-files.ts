/**
 * The episodes of a series for a stream room (SPEC-stream-series.md). Server-side only: it reads each
 * platform's own listing through `safe-fetch` and never a video - the viewers' browsers fetch each episode
 * from the platform as it plays.
 *
 *   Internet Archive  the public metadata API (archive.org/metadata/{id}), the same request the music bar's
 *                     audio reader makes (audio-files.ts), so the two share the day-long cache. Its video files,
 *                     one copy per episode, best playable format first, in track or name order.
 *   YouTube           a playlist: the Data API's `playlistItems` with the key WEB search uses (1 unit a page of
 *                     50), and InnerTube's `browse` (the JSON YouTube's own playlist page reads, no key, no quota)
 *                     when there is no key or the Data API fails. InnerTube is unofficial and may change; the
 *                     risk is the same as WEB search's (youtube-innertube.ts), and the Data API is the way back.
 *
 * Both feed one shape (`SeriesRead`, app/lib/watch/series.ts), which the page checks again before anything goes
 * in a room. No cap on how many episodes (Luke, 2026-11-02): an Archive item is one read whatever its size; a
 * playlist is read page by page until it ends or `PLAYLIST_DEADLINE_MS` runs out (then `partial`).
 */
import { secondsOf } from './audio-files';
import { IA_ALLOWED_HOSTS } from './adapters/internet-archive';
import { INNERTUBE_HOSTS } from './search/providers/youtube-innertube';
import { SafeFetchError, safeFetchJson, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { buildUrl, isSafeIdentifier } from './urls';
import { LINK_TITLE_MAX } from '../watch/links';
import type { SeriesEpisode, SeriesRead, SeriesTarget } from '../watch/series';

/**
 * The Archive's video formats a browser plays, best first (h.264, then MPEG4, then the small 512Kb copy). An item
 * keeps each episode's upload and the copies the Archive made of it: a copy (`source: derivative`) is used when
 * one plays, the upload only when none does (an .mkv or .mov upload often will not play in a browser).
 */
export const IA_VIDEO_FORMATS = ['h.264', 'h.264 IA', 'MPEG4', 'HiRes MPEG4', '512Kb MPEG4', 'WebM', 'Ogg Video'];
/** An item with thousands of files can pass the usual 2 MB answer; this is still one read. */
const IA_METADATA_MAX_BYTES = 12 * 1024 * 1024;

const YT_API_HOSTS = ['www.googleapis.com'] as const;
const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
/** How long one playlist read may take, page after page, before it answers with what it has. */
export const PLAYLIST_DEADLINE_MS = 20_000;
/** A page of InnerTube's playlist is about 1 MB. */
const INNERTUBE_MAX_BYTES = 4 * 1024 * 1024;
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } as const;
const UNAVAILABLE = /^\[?(private|deleted) video\]?$/i;

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string');
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** A file's name without its folder or its ending: `Disc 1/Episode 02.mp4` -> `Episode 02`. */
function bareName(name: string): string {
  const last = name.split('/').pop() ?? name;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

/* --- the Internet Archive --------------------------------------------------------------------------- */

/**
 * An Archive metadata answer as episodes: every video the item holds, one copy each. Null when the item may not
 * be played (dark, or access-restricted) or has no files list; its title either way when it has one.
 */
export function parseArchiveSeries(id: string, body: unknown): Omit<SeriesRead, 'target' | 'partial'> | null {
  const root = record(body);
  if (!root || root.is_dark === true || !Array.isArray(root.files)) return null;
  const metadata = record(root.metadata) ?? {};
  const restricted = str(metadata['access-restricted-item']);
  if (restricted !== undefined && restricted.trim().toLowerCase() === 'true') return null;
  const title = sanitiseText(str(metadata.title), LINK_TITLE_MAX) || id;

  const files = root.files.flatMap((raw) => {
    const file = record(raw);
    if (!file || typeof file.name !== 'string' || str(file.private) === 'true') return [];
    const name = file.name;
    if (name.length > 500 || name.split('/').some((part) => part === '' || part === '.' || part === '..')) return [];
    return [{ file, name, format: typeof file.format === 'string' ? file.format : '' }];
  });
  const byName = new Map(files.map((entry) => [entry.name, entry.file]));

  // One episode per upload: a copy belongs to the upload it was made from (`original`), an upload to itself.
  const groups = new Map<string, { copies: typeof files; uploads: typeof files }>();
  for (const entry of files) {
    if (!IA_VIDEO_FORMATS.includes(entry.format)) continue;
    const original = str(entry.file.original);
    const derived = str(entry.file.source) === 'derivative' && original !== undefined && original.length > 0;
    const key = derived ? original : entry.name;
    const group = groups.get(key) ?? { copies: [], uploads: [] };
    (derived ? group.copies : group.uploads).push(entry);
    groups.set(key, group);
  }

  const rank = (format: string) => IA_VIDEO_FORMATS.indexOf(format);
  const episodes = [...groups.entries()]
    .map(([key, group]) => {
      const pool = group.copies.length > 0 ? group.copies : group.uploads;
      const chosen = [...pool].sort((a, b) => rank(a.format) - rank(b.format) || a.name.localeCompare(b.name))[0];
      const upload = byName.get(key);
      const track = Number.parseInt(str(upload?.track) ?? str(chosen.file.track) ?? '', 10);
      return { key, chosen, upload, track };
    })
    // The Archive's own track numbers when it has them, the name otherwise ("Episode 2" before "Episode 10").
    .sort((a, b) =>
      Number.isFinite(a.track) && Number.isFinite(b.track) && a.track !== b.track ? a.track - b.track : a.key.localeCompare(b.key, 'en', { numeric: true }),
    )
    .map(({ chosen, upload }): SeriesEpisode => ({
      title: sanitiseText(str(chosen.file.title) ?? str(upload?.title) ?? bareName(chosen.name), LINK_TITLE_MAX) || bareName(chosen.name).slice(0, LINK_TITLE_MAX),
      // Path parts are encoded one by one: a file may sit in a folder inside the item.
      url: buildUrl('archive.org', ['download', id, ...chosen.name.split('/')]),
      kind: 'file',
      seconds: secondsOf(chosen.file.length) ?? secondsOf(upload?.length),
    }));

  return { title, episodes };
}

/* --- YouTube --------------------------------------------------------------------------------------- */

/** One page of the Data API's `playlistItems`: its videos (private and deleted ones left out) and the next page. */
export function parseYoutubeApiPage(body: unknown): { episodes: SeriesEpisode[]; next: string | null } {
  const root = record(body);
  if (!root || !Array.isArray(root.items)) throw new Error('unexpected response shape');
  const episodes: SeriesEpisode[] = [];
  for (const raw of root.items) {
    const snippet = record(record(raw)?.snippet);
    const id = str(record(snippet?.resourceId)?.videoId);
    const title = sanitiseText(str(snippet?.title), LINK_TITLE_MAX);
    if (!id || !YT_VIDEO.test(id) || UNAVAILABLE.test(title)) continue;
    episodes.push({ title: title || id, url: `https://www.youtube.com/watch?v=${id}`, kind: 'youtube', seconds: null });
  }
  const next = typeof root.nextPageToken === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(root.nextPageToken) ? root.nextPageToken : null;
  return { episodes, next };
}

/** The Data API's playlist title (`playlists.list`), or null when it has none. */
export function parseYoutubeApiTitle(body: unknown): string | null {
  const first = record((record(body)?.items as unknown[] | undefined)?.[0]);
  const title = sanitiseText(str(record(first?.snippet)?.title), LINK_TITLE_MAX);
  return title.length > 0 ? title : null;
}

/** InnerTube's text: `{ content }`, `{ simpleText }` or `{ runs: [{ text }] }`. */
function text(value: unknown): string | undefined {
  const node = record(value);
  if (!node) return undefined;
  if (typeof node.content === 'string') return node.content;
  if (typeof node.simpleText === 'string') return node.simpleText;
  const runs = Array.isArray(node.runs) ? node.runs.map((run) => record(run)?.text) : [];
  return runs.length > 0 && runs.every((run) => typeof run === 'string') ? runs.join('') : undefined;
}

/** A video's running time out of a lockup's thumbnail badge ("23:45"), or null. */
function badgeSeconds(node: unknown): number | null {
  let found: number | null = null;
  const walk = (value: unknown, depth: number) => {
    if (found !== null || depth > 12) return;
    const here = record(value);
    if (here) {
      const badge = record(here.thumbnailBadgeViewModel);
      if (badge && typeof badge.text === 'string') found = secondsOf(badge.text);
      for (const child of Object.values(here)) walk(child, depth + 1);
    } else if (Array.isArray(value)) for (const child of value) walk(child, depth + 1);
  };
  walk(node, 0);
  return found;
}

/**
 * One page of InnerTube's playlist (`browse`): its videos in order, the next page's token, and on a first page the
 * playlist's title. Two shapes are read, the newer `lockupViewModel` (live-checked 2026-11-02) and the older
 * `playlistVideoRenderer`. A first page is read from `contents`, a next one from `onResponseReceivedActions`, so
 * the side column's suggestions never join the list. A thrown error when neither shape is there.
 */
export function parseInnertubePlaylist(body: unknown, first: boolean): { title: string | null; episodes: SeriesEpisode[]; next: string | null } {
  const root = record(body);
  const scope = first ? root?.contents : root?.onResponseReceivedActions;
  if (scope === undefined) throw new Error('unexpected response shape');
  const episodes: SeriesEpisode[] = [];
  let next: string | null = null;
  let seen = 0;

  const add = (id: unknown, title: string | undefined, seconds: number | null) => {
    seen += 1;
    if (typeof id !== 'string' || !YT_VIDEO.test(id)) return;
    const clean = sanitiseText(title, LINK_TITLE_MAX);
    if (UNAVAILABLE.test(clean) || episodes.some((episode) => episode.url.endsWith(id))) return;
    episodes.push({ title: clean || id, url: `https://www.youtube.com/watch?v=${id}`, kind: 'youtube', seconds });
  };
  /** The token inside a "more" item (`continuationItemViewModel`, or the older `continuationItemRenderer`). */
  const tokenIn = (value: unknown, depth: number): string | null => {
    if (depth > 12) return null;
    const here = record(value);
    if (!here) return Array.isArray(value) ? value.reduce<string | null>((found, child) => found ?? tokenIn(child, depth + 1), null) : null;
    const token = record(here.continuationCommand)?.token;
    if (typeof token === 'string' && /^[A-Za-z0-9_%=-]{20,1200}$/.test(token)) return token;
    return Object.values(here).reduce<string | null>((found, child) => found ?? tokenIn(child, depth + 1), null);
  };
  const isVideo = (value: unknown) => {
    const here = record(value);
    return record(here?.lockupViewModel)?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' || record(here?.playlistVideoRenderer) !== undefined;
  };
  const walk = (value: unknown, depth: number) => {
    if (depth > 40) return;
    if (Array.isArray(value)) {
      // The list's own "more" item sits at the end of the list of videos. Other "more" items on the page (a shelf of
      // suggested playlists under it, live-checked 2026-11-02) lead somewhere else and are never followed.
      const holdsVideos = value.some(isVideo);
      for (const child of value) {
        const more = record(child);
        if (more && (more.continuationItemViewModel !== undefined || more.continuationItemRenderer !== undefined)) {
          if (holdsVideos) next = tokenIn(more, 0) ?? next;
          continue;
        }
        walk(child, depth + 1);
      }
      return;
    }
    const here = record(value);
    if (!here) return;
    const lockup = record(here.lockupViewModel);
    if (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      add(lockup.contentId, text(record(record(lockup.metadata)?.lockupMetadataViewModel)?.title), badgeSeconds(lockup.contentImage));
      return;
    }
    const renderer = record(here.playlistVideoRenderer);
    if (renderer) {
      add(renderer.videoId, text(renderer.title), secondsOf(renderer.lengthSeconds));
      return;
    }
    for (const child of Object.values(here)) walk(child, depth + 1);
  };
  walk(scope, 0);

  if (first && seen === 0 && next === null) throw new Error('unreadable answer');
  const title = first ? sanitiseText(str(record(record(root?.metadata)?.playlistMetadataRenderer)?.title), LINK_TITLE_MAX) : '';
  return { title: title.length > 0 ? title : null, episodes, next };
}

/* --- reading ---------------------------------------------------------------------------------------- */

export type SeriesDeps = { fetch?: FetchLike; env?: Record<string, string | undefined>; now?: () => number };

async function readArchive(id: string, deps: SeriesDeps): Promise<SeriesRead | null> {
  const body = await safeFetchJson(buildUrl('archive.org', ['metadata', id]), { allowedHosts: IA_ALLOWED_HOSTS, fetchImpl: deps.fetch, maxBytes: IA_METADATA_MAX_BYTES });
  const parsed = parseArchiveSeries(id, body);
  return parsed === null ? null : { ...parsed, target: { source: 'internet_archive', id }, partial: false };
}

async function readPlaylistApi(list: string, key: string, deps: SeriesDeps, deadline: number): Promise<SeriesRead> {
  const ask = (path: string, query: [string, string][]) =>
    safeFetchJson(buildUrl('www.googleapis.com', ['youtube', 'v3', path], [...query, ['key', key]]), { allowedHosts: YT_API_HOSTS, fetchImpl: deps.fetch });
  const title = parseYoutubeApiTitle(await ask('playlists', [['part', 'snippet'], ['id', list]]));
  if (title === null) throw new Error('no such playlist');
  const episodes: SeriesEpisode[] = [];
  let page: string | null = null;
  do {
    const query: [string, string][] = [['part', 'snippet'], ['maxResults', '50'], ['playlistId', list]];
    if (page !== null) query.push(['pageToken', page]);
    const answer = parseYoutubeApiPage(await ask('playlistItems', query));
    episodes.push(...answer.episodes);
    page = answer.next;
  } while (page !== null && (deps.now ?? Date.now)() < deadline);
  return { title, target: { source: 'youtube', list }, episodes, partial: page !== null };
}

async function readPlaylistInnertube(list: string, deps: SeriesDeps, deadline: number): Promise<SeriesRead> {
  const url = buildUrl(INNERTUBE_HOSTS[0], ['youtubei', 'v1', 'browse'], [['prettyPrint', 'false']]);
  const ask = (payload: Record<string, unknown>) =>
    safeFetchJson(url, { allowedHosts: INNERTUBE_HOSTS, fetchImpl: deps.fetch, maxBytes: INNERTUBE_MAX_BYTES, postJson: { context: { client: CLIENT }, ...payload } });
  const firstPage = parseInnertubePlaylist(await ask({ browseId: `VL${list}` }), true);
  const episodes = [...firstPage.episodes];
  let next = firstPage.next;
  while (next !== null && (deps.now ?? Date.now)() < deadline) {
    const page = parseInnertubePlaylist(await ask({ continuation: next }), false);
    for (const episode of page.episodes) if (!episodes.some((known) => known.url === episode.url)) episodes.push(episode);
    next = page.next;
  }
  return { title: firstPage.title ?? 'YOUTUBE PLAYLIST', target: { source: 'youtube', list }, episodes, partial: next !== null };
}

/**
 * A series' episodes, or null when the platform has nothing that may be played. Throws `SafeFetchError` when the
 * platform did not answer (and, for a playlist, neither way of asking worked).
 */
export async function readSeries(target: SeriesTarget, deps: SeriesDeps = {}): Promise<SeriesRead | null> {
  if (target.source === 'internet_archive') return isSafeIdentifier(target.id) ? readArchive(target.id, deps) : null;
  if (!/^(?!RD)[A-Za-z0-9_-]{10,64}$/.test(target.list)) return null;
  const deadline = (deps.now ?? Date.now)() + PLAYLIST_DEADLINE_MS;
  const key = deps.env?.YOUTUBE_API_KEY?.trim();
  if (key) {
    try {
      return await readPlaylistApi(target.list, key, deps, deadline);
    } catch {
      // The key refused, the day's quota spent, or no such playlist to it: InnerTube is asked instead.
    }
  }
  try {
    return await readPlaylistInnertube(target.list, deps, deadline);
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    return null;
  }
}

/** How many episodes each Archive item holds (only items with two or more are named), for the SERIES marks. */
export async function readSeriesCounts(ids: readonly string[], deps: SeriesDeps = {}, together = 4): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const queue = ids.filter((id) => isSafeIdentifier(id));
  const work = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const read = await readArchive(id, deps);
        if (read !== null && read.episodes.length >= 2) counts[id] = read.episodes.length;
      } catch {
        // A platform that did not answer leaves that row unmarked; the next look asks again.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(together, queue.length) }, work));
  return counts;
}
