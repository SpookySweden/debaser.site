import { isWildcardServer, MEDIA_SERVERS, serverHost, type MediaServer, type MediaServerId } from './media-servers';
import { titleToItem, type MediaCopy, type MediaDetails } from './media-titles';
import { SafeFetchError, safeFetchText, type FetchLike } from './safe-fetch';
import { detailsUrl, searchTitles, tmdbJson, toDetails, withTmdbToken, type TmdbHit } from './tmdb';
import type { WebItem } from './types';

/**
 * Search rows for the media servers with no list file (`listPath: '*'`, media-servers.ts). SERVER ONLY.
 *
 * The words of a search go to TMDB's search (tmdb.ts, through `safe-fetch`, with the server-only
 * `TMDB_READ_TOKEN`); every film and show it finds becomes one row with a copy on each such server, so the row
 * gets a button per server. The button's address is the server's own `play.movie` or `play.tv` pattern, filled
 * by `mediaPlayUrl` with the TMDB number and, for a show, the season and episode picked from TMDB's own list. Nothing
 * here knows any server. Being read at search time, a server added this way shows at once, with no hourly update.
 *
 * Each server is asked whether it has each title, by opening that title's player page from our server (Luke, 2026-11-07: "shows us the
 * available servers that have the pieces of media"). A 404 or 410 is no: no button. Anything else is kept, a login page or a server
 * that's down included, because only the server can say it doesn't have something: PLAY still says if it isn't answering.
 */

/** The servers this applies to: every one whose `listPath` is `'*'`. */
export function wildcardServers(servers: readonly MediaServer[] = MEDIA_SERVERS): MediaServer[] {
  return servers.filter(isWildcardServer);
}

const ASK_TIMEOUT_MS = 3_000;
const ASK_MAX_BYTES = 64 * 1024;
/** One server is asked about one title at most this often, per instance, however many people search for it. */
const ASK_REMEMBER_MS = 10 * 60_000;
const asked = new Map<string, { holds: boolean; at: number }>();

/** The address of a title's player page on a server. A show asks its whole-show page, or else its first episode. */
export function playerAddress(server: MediaServer, hit: Pick<TmdbHit, 'type' | 'tmdbId'>): string {
  const pattern = hit.type === 'movie' ? server.play.movie : (server.play.series ?? server.play.tv);
  return `${server.base}${pattern.replace('{tmdb}', String(hit.tmdbId)).replace('{season}', '1').replace('{episode}', '1')}`;
}

async function serverHolds(server: MediaServer, hit: Pick<TmdbHit, 'type' | 'tmdbId'>, fetchImpl: FetchLike | undefined, now: number): Promise<boolean> {
  const address = playerAddress(server, hit);
  const known = asked.get(address);
  if (known && now - known.at < ASK_REMEMBER_MS) return known.holds;
  let holds = true;
  try {
    await safeFetchText(address, { allowedHosts: [serverHost(server)], timeoutMs: ASK_TIMEOUT_MS, maxBytes: ASK_MAX_BYTES, accept: 'text/html,*/*', ...(fetchImpl ? { fetchImpl } : {}) });
  } catch (error) {
    holds = !(error instanceof SafeFetchError && (error.status === 404 || error.status === 410));
  }
  asked.set(address, { holds, at: now });
  return holds;
}

/** One TMDB hit as a media row held by every given server. Pure. */
export function hitToItem(hit: TmdbHit, servers: readonly MediaServer[], fetchedAt: string, read?: MediaDetails): WebItem {
  const copies: MediaCopy[] = servers.map((server) =>
    // A show held whole: every season and episode TMDB lists is offered (media-titles.ts `withTmdbEpisodes`).
    hit.type === 'tv' ? { server: server.id as MediaServerId, series: true } : { server: server.id as MediaServerId },
  );
  const key = `tmdb-${hit.type}-${hit.tmdbId}`;
  // Ordered by release, so a search's rows sit newest first like everything else; a title with no date, as found.
  const publishedAt = hit.date ? new Date(`${hit.date.length === 4 ? `${hit.date}-01-01` : hit.date}T00:00:00.000Z`).toISOString() : fetchedAt;
  const details = read ?? { title: hit.title, genres: [], ...(hit.date ? { date: hit.date } : {}), ...(hit.posterPath ? { posterPath: hit.posterPath } : {}) };
  const item = titleToItem({ id: `media:${key}`, key, type: hit.type, tmdbId: hit.tmdbId, title: hit.title, copies }, { publishedAt, fetchedAt }, details);
  // TMDB's original language, for the row's flag (app/lib/web/language.ts); not stored.
  return hit.language ? { ...item, language: hit.language } : item;
}

/**
 * The rows for some words: empty when no server has `listPath: '*'`, the token is missing, or TMDB fails (the
 * other sources still show; a failure says nothing of TMDB's answer or the token).
 */
export async function wildcardSearch(
  words: string,
  // `askServer`: how a server is asked. Not `fetch`: that one keeps answers for a day, and a server's answer has to change when it gets a film.
  deps: { fetch: FetchLike; token: string | undefined; servers?: readonly MediaServer[]; now?: () => Date; askServer?: FetchLike },
): Promise<WebItem[]> {
  const servers = wildcardServers(deps.servers);
  const token = (deps.token ?? '').trim();
  if (servers.length === 0 || token.length === 0 || words.length === 0) return [];
  const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
  try {
    const asking = withTmdbToken(token, deps.fetch);
    const hits = await searchTitles(words, asking);
    // Each title's details, for a show's seasons: a title whose details fail still shows, from the search's own fields.
    const askedAt = (deps.now ?? (() => new Date()))().getTime();
    const rows = await Promise.all(hits.map(async (hit) => {
      const held = (await Promise.all(servers.map(async (server) => ((await serverHolds(server, hit, deps.askServer, askedAt)) ? server : null)))).filter((server) => server !== null);
      if (held.length === 0) return null;
      const read = await tmdbJson(detailsUrl(hit.type, hit.tmdbId), asking).then((body) => toDetails(body, hit.type) ?? undefined).catch(() => undefined);
      return hitToItem(hit, held, fetchedAt, read);
    }));
    return rows.filter((row) => row !== null);
  } catch {
    return [];
  }
}
