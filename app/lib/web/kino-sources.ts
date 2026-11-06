import { freeCopyEmbed, kinoTitleKey, type FreeCopy, type KinoSources, type KinoTitle } from './kino';
import { officialEmbedUrl } from './official-embed';
import { buildUrl, safeFetchJson, type FetchLike } from './safe-fetch';
import { parseArchiveSeries } from './series-files';
import { detailsWithWatchUrl, tmdbJson, toDetails, toWatchOffer, withTmdbToken } from './tmdb';

/**
 * Where a KINO title can be watched, beyond this site (SPEC-kino-sources.md, Luke 2026-11-06). SERVER ONLY: the page
 * asks /api/web/kino/sources. Nothing here is saved; answers rest in the same day-long fetch cache as a search.
 *
 * - **Free services:** TMDB's watch-providers for the viewer's country, read in one answer with the title's details, free
 *   and free-with-ads only. The data is JustWatch's: the WATCH list credits them while it shows those names (TMDB's rule).
 * - **Free copies:** Wikidata (CC0) holds a title's TMDB number (P4947 film, P4983 show) and, often, its Internet
 *   Archive id (P724) or YouTube id (P1651). What is offered: `archiveVerdict`, `youtubeVerdict`. A copy says PUBLIC
 *   DOMAIN only when Wikidata does.
 *
 * Asking Wikidata names the project and never a person. Failures say nothing: the row just has fewer choices.
 */

export const WIKIDATA_QUERY_HOST = 'query.wikidata.org';
const ARCHIVE_HOST = 'archive.org';
const YOUTUBE_API_HOST = 'www.googleapis.com';
const AGENT = 'DebaserSiteKino/1.0 (+https://github.com/SpookySweden/debaser.site)';

/** Wikidata's "public domain", "dedicated to the public domain by its owner" and "copyrighted" (P6216, copyright status). */
const PUBLIC_DOMAIN = 'Q19652';
const DEDICATED_TO_PUBLIC_DOMAIN = 'Q88088423';
const COPYRIGHTED = 'Q50423863';
/** A video's role saying it is the film itself; any other (trailer, clip, interview...) is not a copy of the title. */
const ROLE_THE_FILM = 'Q11424';

/** A film can list several uploads; only so many are looked at. */
const ARCHIVE_PER_TITLE = 6;
const YOUTUBE_PER_TITLE = 8;
/** `videos.list` takes 50 ids a call, and one call is all a batch spends (one unit of YouTube's daily quota). */
const YOUTUBE_PER_CALL = 50;
const ANSWER_TIMEOUT_MS = 8_000;
/** A film's metadata lists every file; a big restoration runs to a few MB. */
const ARCHIVE_MAX_BYTES = 6 * 1024 * 1024;
/** A copy's name on its key's line. */
const LABEL_MAX = 80;
/** With no running time to compare against, anything shorter is taken for a trailer or a clip. */
const SHORTEST_UNKNOWN_SECONDS = 5 * 60;

export type FreeCandidates = { publicDomain: boolean; copyrighted: boolean; archive: string[]; youtube: string[] };

/** What the title's own record says, for each title asked. Trailers and other side videos are already gone. */
export type CandidateMap = Map<string, FreeCandidates>;

/** The one question for a page of titles. Only checked numbers go in, and no value from any answer. */
export function freeCopyQuery(titles: readonly KinoTitle[]): string {
  const numbers = (type: KinoTitle['type']) =>
    titles
      .filter((title) => title.type === type && Number.isInteger(title.tmdbId) && title.tmdbId > 0)
      .map((title) => `"${title.tmdbId}"`)
      .join(' ');
  const blocks = [
    numbers('movie') ? `{ VALUES ?tmdb { ${numbers('movie')} } ?item wdt:P4947 ?tmdb . BIND("movie" AS ?type) }` : '',
    numbers('tv') ? `{ VALUES ?tmdb { ${numbers('tv')} } ?item wdt:P4983 ?tmdb . BIND("tv" AS ?type) }` : '',
  ].filter((block) => block.length > 0);
  // The optimizer stays off: left to itself, Wikidata starts from every video link there is and times out (live-checked
  // 2026-11-06: over 60 seconds, against half a second in the order written here).
  return `SELECT ?type ?tmdb ?site ?value ?role ?status WHERE { hint:Query hint:optimizer "None" .
{ ${blocks.join(' UNION ')} }
{ ?item p:P724 ?st . ?st ps:P724 ?value . BIND("archive" AS ?site) } UNION { ?item p:P1651 ?st . ?st ps:P1651 ?value . BIND("youtube" AS ?site) }
?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
OPTIONAL { ?st pq:P3831 ?role } OPTIONAL { ?item wdt:P6216 ?status } }`;
}

export function freeCopyUrl(titles: readonly KinoTitle[]): string {
  return buildUrl(WIKIDATA_QUERY_HOST, ['sparql'], [['query', freeCopyQuery(titles)], ['format', 'json']]);
}

const entityId = (value: unknown): string | null => {
  const match = typeof value === 'string' ? /\/entity\/(Q[0-9]+)$/.exec(value) : null;
  return match ? match[1] : null;
};

/** Wikidata's answer per title. Pure. A value that could not be a player address on its site is dropped here. */
export function parseCandidates(body: unknown): CandidateMap {
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const results = root.results as Record<string, unknown> | undefined;
  const bindings = Array.isArray(results?.bindings) ? (results.bindings as Record<string, { value?: unknown } | undefined>[]) : [];
  const found: CandidateMap = new Map();
  /** A value with any role but the film's own is out, however many rows also list it without one. */
  const sideVideos = new Set<string>();

  for (const row of bindings) {
    const type = row.type?.value;
    const tmdb = row.tmdb?.value;
    const site = row.site?.value;
    const value = row.value?.value;
    if ((type !== 'movie' && type !== 'tv') || typeof tmdb !== 'string' || !/^[1-9][0-9]{0,8}$/.test(tmdb)) continue;
    if ((site !== 'archive' && site !== 'youtube') || typeof value !== 'string') continue;
    const key = `${type}-${tmdb}`;
    const entry = found.get(key) ?? { publicDomain: false, copyrighted: false, archive: [], youtube: [] };
    found.set(key, entry);
    const status = entityId(row.status?.value);
    if (status === PUBLIC_DOMAIN || status === DEDICATED_TO_PUBLIC_DOMAIN) entry.publicDomain = true;
    if (status === COPYRIGHTED) entry.copyrighted = true;
    if (officialEmbedUrl(freeCopyEmbed({ platform: site === 'archive' ? 'internet_archive' : 'youtube', id: value })) === null) continue;
    const role = row.role?.value;
    if (role !== undefined && entityId(role) !== ROLE_THE_FILM) sideVideos.add(`${key}|${site}|${value}`);
    const list = entry[site];
    if (!list.includes(value)) list.push(value);
  }
  for (const [key, entry] of found) {
    entry.archive = entry.archive.filter((value) => !sideVideos.has(`${key}|archive|${value}`)).slice(0, ARCHIVE_PER_TITLE);
    entry.youtube = entry.youtube.filter((value) => !sideVideos.has(`${key}|youtube|${value}`)).slice(0, YOUTUBE_PER_TITLE);
  }
  return found;
}

/** The whole title rather than a trailer: at least half its running time, or (running time unknown) more than a clip's. */
export function longEnough(seconds: number, runtimeMinutes: number | undefined): boolean {
  return runtimeMinutes !== undefined ? seconds >= runtimeMinutes * 30 : seconds >= SHORTEST_UNKNOWN_SECONDS;
}

/** What tells a copy from the others, as plain text for the row. Only what's there: a blank name or an unknown length is left out. */
function copyFacts(label: unknown, seconds: number | null): Pick<FreeCopy, 'label' | 'seconds'> {
  const name = typeof label === 'string' ? label.trim().slice(0, LABEL_MAX) : '';
  return { ...(name.length > 0 ? { label: name } : {}), ...(seconds !== null && seconds > 0 ? { seconds } : {}) };
}

/**
 * Whether one Archive item is offered as a free copy of the title. Pure. It must be a public video item (not dark, not
 * access-restricted, not a book scan of the novel), long enough to be the title, and not called copyrighted by Wikidata.
 * No evidence of the public domain is asked for (Luke, 2026-11-06).
 */
export function archiveVerdict(id: string, body: unknown, candidates: Pick<FreeCandidates, 'publicDomain' | 'copyrighted'>, runtimeMinutes: number | undefined, type: KinoTitle['type'] = 'movie'): FreeCopy | null {
  if (candidates.copyrighted) return null;
  const read = parseArchiveSeries(id, body);
  if (read === null || read.episodes.length === 0) return null;
  const metadata = ((body as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
  if (metadata.mediatype !== 'movies') return null;
  // A film must be one video: the Archive's player starts on its own choice of an item's videos and stops at the end of it,
  // so a DVD rip (live-checked 2026-11-06) plays a 10-second menu. A show's item may hold its episodes.
  if (type === 'movie' && read.episodes.length !== 1) return null;
  // The Archive lists a length for nearly every video. One it doesn't is still playable.
  const seconds = read.episodes[0].seconds ?? 0;
  if (seconds > 0 && !longEnough(seconds, runtimeMinutes)) return null;
  return { platform: 'internet_archive', id, publicDomain: candidates.publicDomain, ...copyFacts(metadata.title, seconds) };
}

/** An ISO 8601 length (`PT1H24M3S`, `P1DT2H`) in seconds, or null. */
export function isoSeconds(value: unknown): number | null {
  const match = typeof value === 'string' ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value) : null;
  if (match === null || value === 'P') return null;
  return Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
}

export function youtubeStatusUrl(ids: readonly string[], key: string): string {
  return buildUrl(YOUTUBE_API_HOST, ['youtube', 'v3', 'videos'], [
    ['part', 'status,contentDetails,snippet'],
    ['id', ids.join(',')],
    ['key', key],
    ['maxResults', String(YOUTUBE_PER_CALL)],
  ]);
}

/**
 * Whether one `videos.list` entry is offered as a free copy of the title. Pure. Every upload Wikidata links as the film is
 * served if it will play: public, embeddable, not age-locked, not blocked in the viewer's country, long enough to be the
 * title (Luke, 2026-11-06: "serve the YouTube videos that are found"). Rights decide nothing here, only the label.
 */
export function youtubeVerdict(doc: unknown, candidates: Pick<FreeCandidates, 'publicDomain' | 'copyrighted'>, runtimeMinutes: number | undefined, country: string): FreeCopy | null {
  const item = (typeof doc === 'object' && doc !== null ? doc : {}) as Record<string, unknown>;
  const status = (item.status ?? {}) as Record<string, unknown>;
  const details = (item.contentDetails ?? {}) as Record<string, unknown>;
  const id = item.id;
  if (typeof id !== 'string' || officialEmbedUrl(freeCopyEmbed({ platform: 'youtube', id })) === null) return null;
  if (status.privacyStatus !== 'public' || status.embeddable !== true) return null;
  const rating = (details.contentRating ?? {}) as Record<string, unknown>;
  if (rating.ytRating === 'ytAgeRestricted') return null;
  const region = (details.regionRestriction ?? {}) as Record<string, unknown>;
  if (Array.isArray(region.blocked) && region.blocked.includes(country)) return null;
  if (Array.isArray(region.allowed) && !region.allowed.includes(country)) return null;
  const seconds = isoSeconds(details.duration);
  if (seconds === null || !longEnough(seconds, runtimeMinutes)) return null;
  const snippet = (item.snippet ?? {}) as Record<string, unknown>;
  return { platform: 'youtube', id, publicDomain: candidates.publicDomain && !candidates.copyrighted, ...copyFacts(snippet.channelTitle, seconds) };
}

const FALLBACK_COUNTRY = 'US';

/** The viewer's two-letter country: Vercel's reading of the address, then the browser's language, then the US. Never kept. */
export function viewerCountry(headers: Headers): string {
  const said = (headers.get('x-vercel-ip-country') ?? '').toUpperCase();
  if (/^[A-Z]{2}$/.test(said)) return said;
  const language = /^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(headers.get('accept-language') ?? '');
  return language ? language[1].toUpperCase() : FALLBACK_COUNTRY;
}

export type KinoSourcesDeps = { fetch: FetchLike; tmdbToken?: string | undefined; youtubeKey?: string | undefined };

async function readTmdb(title: KinoTitle, country: string, fetchImpl: FetchLike | null): Promise<{ watch: KinoSources['watch']; runtime: number | undefined }> {
  if (fetchImpl === null) return { watch: null, runtime: undefined };
  try {
    const body = await tmdbJson(detailsWithWatchUrl(title.type, title.tmdbId), fetchImpl);
    return { watch: toWatchOffer(body, country), runtime: toDetails(body, title.type)?.runtimeMinutes };
  } catch {
    return { watch: null, runtime: undefined };
  }
}

async function readCandidates(titles: readonly KinoTitle[], fetchImpl: FetchLike): Promise<CandidateMap> {
  try {
    const body = await safeFetchJson(freeCopyUrl(titles), {
      allowedHosts: [WIKIDATA_QUERY_HOST],
      fetchImpl,
      userAgent: AGENT,
      timeoutMs: ANSWER_TIMEOUT_MS,
      accept: 'application/sparql-results+json',
    });
    return parseCandidates(body);
  } catch {
    return new Map();
  }
}

async function archiveCopies(candidates: FreeCandidates, runtime: number | undefined, type: KinoTitle['type'], fetchImpl: FetchLike): Promise<FreeCopy[]> {
  if (candidates.copyrighted) return [];
  const answers = await Promise.all(
    candidates.archive.map(async (id) => {
      try {
        const body = await safeFetchJson(buildUrl(ARCHIVE_HOST, ['metadata', id]), { allowedHosts: [ARCHIVE_HOST], fetchImpl, userAgent: AGENT, timeoutMs: ANSWER_TIMEOUT_MS, maxBytes: ARCHIVE_MAX_BYTES });
        return archiveVerdict(id, body, candidates, runtime, type);
      } catch {
        return null;
      }
    }),
  );
  return answers.filter((copy) => copy !== null);
}

async function readYoutube(ids: readonly string[], key: string | undefined, fetchImpl: FetchLike): Promise<Map<string, unknown>> {
  const usable = (key ?? '').trim();
  // Without the key nothing can be checked, and an unchecked upload is never offered.
  if (ids.length === 0 || usable.length === 0) return new Map();
  try {
    const body = await safeFetchJson(youtubeStatusUrl(ids.slice(0, YOUTUBE_PER_CALL), usable), { allowedHosts: [YOUTUBE_API_HOST], fetchImpl, timeoutMs: ANSWER_TIMEOUT_MS });
    const items = (body as Record<string, unknown> | null)?.items;
    return new Map((Array.isArray(items) ? items : []).flatMap((raw): [string, unknown][] => {
      const id = (raw as Record<string, unknown> | null)?.id;
      return typeof id === 'string' ? [[id, raw]] : [];
    }));
  } catch {
    return new Map();
  }
}

/** Every asked title's sources, by `kinoTitleKey`. Never throws: what fails is simply not offered. */
export async function readKinoSources(titles: readonly KinoTitle[], country: string, deps: KinoSourcesDeps): Promise<Record<string, KinoSources>> {
  const token = (deps.tmdbToken ?? '').trim();
  const tmdbFetch = token.length > 0 ? withTmdbToken(token, deps.fetch) : null;
  const [tmdb, candidates] = await Promise.all([Promise.all(titles.map((title) => readTmdb(title, country, tmdbFetch))), readCandidates(titles, deps.fetch)]);

  const youtubeIds = [...new Set([...candidates.values()].flatMap((entry) => entry.youtube))];
  const [archive, youtube] = await Promise.all([
    Promise.all(titles.map(async (title, index) => {
      const entry = candidates.get(kinoTitleKey(title));
      return entry === undefined ? [] : archiveCopies(entry, tmdb[index].runtime, title.type, deps.fetch);
    })),
    readYoutube(youtubeIds, deps.youtubeKey, deps.fetch),
  ]);

  const answer: Record<string, KinoSources> = {};
  titles.forEach((title, index) => {
    const key = kinoTitleKey(title);
    const entry = candidates.get(key);
    // Every copy that will play, so the row can offer the choice (Luke, 2026-11-06).
    const free: FreeCopy[] = [...archive[index]];
    for (const id of entry?.youtube ?? []) {
      const verdict = youtubeVerdict(youtube.get(id), entry as FreeCandidates, tmdb[index].runtime, country);
      if (verdict !== null) free.push(verdict);
    }
    answer[key] = { watch: tmdb[index].watch, free };
  });
  return answer;
}

