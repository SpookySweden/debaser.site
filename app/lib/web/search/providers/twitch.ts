/**
 * Twitch's channels that are live now (SPEC-live-streams.md, Luke 2026-11-17: "official api keys if they are permenenat and
 * best"). SERVER ONLY.
 *
 * Two ways in, the official one first:
 * - **Twitch's official API (Helix)** with Luke's app keys, `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`: server-only
 *   settings he adds to `.env.local` and Vercel himself. They are swapped for an app pass (`client_credentials`, about two
 *   months), kept in this server's memory and asked for again when it is close to running out or refused.
 * - **Twitch's own site API** (`gql.twitch.tv`, the public client id Twitch's own website sends, no key of ours), when the
 *   keys are missing or Helix fails. The risk, said once: it is undocumented and Twitch can change it or start asking for
 *   an "integrity" pass at any time; then this says "TWITCH: NO ANSWER" until the keys are in.
 *
 * Metadata only: the channel's login and name, the stream's title, game or category, tags, language and when it started.
 * The viewer count is read only to order POPULAR here, on the server; it is never part of an item, an answer or a log.
 * The keys and the pass go in request headers only, never in an address, an answer, an error or a log.
 *
 * Every address is built from the validated login (`TWITCH_LOGIN`): the channel's page on www.twitch.tv, the preview
 * picture Twitch's picture server keeps of a live channel, and its player page (`?channel=`; the page adds `parent`).
 * A live is never saved into the stream: `fetchOne` answers null.
 */
import { TWITCH_LOGIN } from '../../hosts';
import { normaliseLanguage } from '../../language';
import { SafeFetchError, safeFetchJson, type FetchLike } from '../../safe-fetch';
import { plausibleIsoDate, sanitiseText } from '../../sanitise';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

const HELIX_HOST = 'api.twitch.tv';
const TOKEN_HOST = 'id.twitch.tv';
const SITE_HOST = 'gql.twitch.tv';
export const TWITCH_HOSTS = [HELIX_HOST, TOKEN_HOST, SITE_HOST] as const;
/** Twitch's own website's public client id (sent by every visitor's browser on twitch.tv): not a secret, not ours. */
export const TWITCH_SITE_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
export const TWITCH_PAGE_SIZE = 20;
/** Helix takes at most 100 logins in one `/streams` question. */
export const TWITCH_LOGINS_MAX = 100;
const TIMEOUT_MS = 6_000;

const LOGIN = new RegExp(`^${TWITCH_LOGIN}$`);
/** A Helix or site-API page cursor as Twitch writes them (base64, sometimes url-safe). */
const CURSOR = /^[A-Za-z0-9+/=_-]{1,600}$/;
/** The shape of a Twitch app's client id and secret; anything else is treated as not set up rather than sent. */
const KEY_SHAPE = /^[a-z0-9]{20,64}$/;
const PASS_SHAPE = /^[a-z0-9]{20,64}$/;

/** One live stream as both ways in describe it. `viewers` orders POPULAR here and goes no further. */
export type TwitchStream = {
  login: string;
  name?: string;
  title?: string;
  game?: string;
  tags?: readonly string[];
  language?: string;
  startedAt?: string;
  viewers?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The channel's three addresses, from a validated login. */
export function twitchAddresses(login: string): { page: string; picture: string; player: string } {
  return {
    page: buildUrl('www.twitch.tv', [login]),
    picture: buildUrl('static-cdn.jtvnw.net', ['previews-ttv', `live_user_${login}-640x360.jpg`]),
    player: buildUrl('player.twitch.tv', [], [['channel', login]]),
  };
}

/** A live stream as a WebItem, or null when its login is not one WEB accepts. */
export function twitchItem(stream: TwitchStream, fetchedAt: string): WebItem | null {
  const login = typeof stream.login === 'string' ? stream.login.toLowerCase() : '';
  if (!LOGIN.test(login)) return null;
  const { page, picture, player } = twitchAddresses(login);
  const name = sanitiseText(stream.name, 200) || login;
  const game = sanitiseText(stream.game, 200) || undefined;
  const title = sanitiseText(stream.title, 300) || `${name.toUpperCase()} ON TWITCH`;
  const tags = [...new Set([...(game ? [game] : []), ...(stream.tags ?? []).map((tag) => sanitiseText(tag, 60)).filter(Boolean)])].slice(0, 10);
  const language = normaliseLanguage(stream.language?.toLowerCase());
  const startedAt = plausibleIsoDate(stream.startedAt, fetchedAt) ?? fetchedAt;
  return {
    id: `twitch:${login}`,
    platform: 'twitch',
    externalId: login,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title,
    creator: name,
    ...(game ? { description: game } : {}),
    thumbnailUrl: picture,
    embedUrl: player,
    ...(tags.length > 0 ? { tags } : {}),
    ...(language ? { language } : {}),
    live: true,
    publishedAt: startedAt,
    fetchedAt,
  };
}

/* --- the keys and the pass ---------------------------------------------------------------------- */

export type TwitchKeys = { id: string; secret: string };

/** Luke's app keys, or null when either is missing or not shaped like one. */
export function twitchKeys(deps: SearchDeps): TwitchKeys | null {
  const id = deps.env?.TWITCH_CLIENT_ID?.trim();
  const secret = deps.env?.TWITCH_CLIENT_SECRET?.trim();
  return id && secret && KEY_SHAPE.test(id) && KEY_SHAPE.test(secret) ? { id, secret } : null;
}

type Pass = { forId: string; token: string; until: number };
let pass: Pass | null = null;

/** Forgets the kept pass (a check between runs, or Helix refusing it). */
export function forgetTwitchPass(): void {
  pass = null;
}

/** The app pass for `keys`: the kept one while it has more than five minutes left, else a new one from Twitch. */
async function appPass(keys: TwitchKeys, fetchImpl: FetchLike | undefined, now: number): Promise<string> {
  if (pass !== null && pass.forId === keys.id && pass.until - 5 * 60_000 > now) return pass.token;
  const body = await safeFetchJson(buildUrl(TOKEN_HOST, ['oauth2', 'token']), {
    allowedHosts: [TOKEN_HOST],
    fetchImpl,
    timeoutMs: TIMEOUT_MS,
    postForm: { client_id: keys.id, client_secret: keys.secret, grant_type: 'client_credentials' },
  });
  const root = record(body);
  const token = str(root?.access_token);
  const seconds = num(root?.expires_in) ?? 3600;
  if (!token || !PASS_SHAPE.test(token)) throw new Error('unexpected pass');
  pass = { forId: keys.id, token, until: now + seconds * 1000 };
  return token;
}

/* --- Helix ---------------------------------------------------------------------------------------- */

async function helix(path: readonly string[], query: readonly (readonly [string, string])[], keys: TwitchKeys, deps: SearchDeps): Promise<Record<string, unknown>> {
  const fetchImpl = deps.liveFetch ?? deps.fetch;
  const now = (deps.now?.() ?? new Date()).getTime();
  // The pass is never asked through the day-long search cache: a revoked one would be handed back for a day (code review).
  const token = await appPass(keys, deps.liveFetch ?? deps.fetch, now);
  try {
    const body = await safeFetchJson(buildUrl(HELIX_HOST, ['helix', ...path], query), {
      allowedHosts: [HELIX_HOST],
      fetchImpl,
      timeoutMs: TIMEOUT_MS,
      headers: { 'Client-Id': keys.id, Authorization: `Bearer ${token}` },
    });
    const root = record(body);
    if (!root || !Array.isArray(root.data)) throw new Error('unexpected response shape');
    return root;
  } catch (error) {
    // A pass Twitch no longer takes is forgotten, so the next question asks for a new one.
    if (error instanceof SafeFetchError && error.status === 401) forgetTwitchPass();
    throw error;
  }
}

function helixCursor(root: Record<string, unknown>): string | null {
  const cursor = str(record(root.pagination)?.cursor);
  return cursor && CURSOR.test(cursor) ? cursor : null;
}

/** `/streams` and `/search/channels` entries share most fields under different names. */
function fromHelix(entry: unknown): TwitchStream | null {
  const doc = record(entry);
  if (!doc) return null;
  const login = str(doc.user_login) ?? str(doc.broadcaster_login);
  if (!login) return null;
  // A search hit that is not live (Helix is asked for live ones only; a stale one is passed over).
  if (doc.is_live === false) return null;
  return {
    login,
    name: str(doc.user_name) ?? str(doc.display_name),
    title: str(doc.title),
    game: str(doc.game_name),
    tags: list(doc.tags).filter((tag): tag is string => typeof tag === 'string'),
    language: str(doc.language) ?? str(doc.broadcaster_language),
    startedAt: str(doc.started_at),
    viewers: num(doc.viewer_count),
  };
}

/* --- the site API ----------------------------------------------------------------------------------- */

const STREAM_FIELDS = 'title createdAt viewersCount game{ displayName } freeformTags{ name }';
const CHANNEL_FIELDS = `login displayName broadcastSettings{ language } stream{ ${STREAM_FIELDS} }`;

/** One question to Twitch's own site API; the words go as a variable, never into the question itself. */
async function site(query: string, variables: Record<string, unknown>, deps: SearchDeps): Promise<Record<string, unknown>> {
  const body = await safeFetchJson(buildUrl(SITE_HOST, ['gql']), {
    allowedHosts: [SITE_HOST],
    fetchImpl: deps.liveFetch ?? deps.fetch,
    timeoutMs: TIMEOUT_MS,
    headers: { 'Client-ID': TWITCH_SITE_CLIENT_ID },
    postJson: { query, variables },
  });
  const data = record(record(body)?.data);
  if (!data) throw new Error('unexpected response shape');
  return data;
}

/** A channel with its stream (search, users), or null when it is not live. */
function fromSiteChannel(entry: unknown): TwitchStream | null {
  const channel = record(entry);
  const stream = record(channel?.stream);
  const login = str(channel?.login);
  if (!channel || !stream || !login) return null;
  return {
    login,
    name: str(channel.displayName),
    title: str(stream.title),
    game: str(record(stream.game)?.displayName),
    tags: list(stream.freeformTags).flatMap((tag) => (typeof record(tag)?.name === 'string' ? [String(record(tag)?.name)] : [])),
    language: str(record(channel.broadcastSettings)?.language),
    startedAt: str(stream.createdAt),
    viewers: num(stream.viewersCount),
  };
}

/** A stream with its broadcaster (the top list, a category's list). */
function fromSiteStream(entry: unknown): TwitchStream | null {
  const stream = record(entry);
  const broadcaster = record(stream?.broadcaster);
  if (!stream || !broadcaster) return null;
  return fromSiteChannel({ ...broadcaster, stream });
}

/* --- what is asked ----------------------------------------------------------------------------------- */

type Found = { streams: TwitchStream[]; next: string | null };

/** Channels live now for some words. */
async function searchStreams(words: string, cursor: string | null, keys: TwitchKeys | null, deps: SearchDeps): Promise<Found> {
  if (keys !== null) {
    const root = await helix(['search', 'channels'], [['query', words], ['live_only', 'true'], ['first', String(TWITCH_PAGE_SIZE)], ...(cursor ? [['after', cursor] as const] : [])], keys, deps);
    const streams = list(root.data).flatMap((entry) => fromHelix(entry) ?? []);
    // POPULAR: Helix's search says nothing of how many watch, so `/streams` is asked for these channels; only the order uses it.
    if (deps.order === 'popular' && streams.length > 0) {
      const counted = new Map((await liveByLogin(streams.map((stream) => stream.login), keys, deps)).map((stream) => [stream.login.toLowerCase(), stream.viewers]));
      return { streams: streams.map((stream) => ({ ...stream, viewers: counted.get(stream.login.toLowerCase()) ?? 0 })), next: helixCursor(root) };
    }
    return { streams, next: helixCursor(root) };
  }
  const data = await site(
    `query($q:String!,$c:String){ searchFor(userQuery:$q, platform:"web", target:{index:CHANNEL, cursor:$c}){ channels{ cursor items{ ${CHANNEL_FIELDS} } } } }`,
    { q: words, c: cursor },
    deps,
  );
  const channels = record(record(data.searchFor)?.channels);
  const next = str(channels?.cursor);
  return { streams: list(channels?.items).flatMap((entry) => fromSiteChannel(entry) ?? []), next: next && CURSOR.test(next) ? next : null };
}

/** The most-watched lives now (Twitch's own order), optionally in one game or category. */
async function topStreams(cursor: string | null, keys: TwitchKeys | null, deps: SearchDeps, game?: string, first = TWITCH_PAGE_SIZE): Promise<Found> {
  if (keys !== null && game === undefined) {
    const root = await helix(['streams'], [['type', 'live'], ['first', String(first)], ...(cursor ? [['after', cursor] as const] : [])], keys, deps);
    return { streams: list(root.data).flatMap((entry) => fromHelix(entry) ?? []), next: helixCursor(root) };
  }
  if (game !== undefined) {
    // A category by its name: the site API answers it in one question (Helix would need its number first).
    const data = await site(`query($g:String!,$f:Int){ game(name:$g){ streams(first:$f){ edges{ node{ ${STREAM_FIELDS} broadcaster{ login displayName broadcastSettings{ language } } } } } } }`, { g: game, f: first }, deps);
    const edges = list(record(record(data.game)?.streams)?.edges);
    return { streams: edges.flatMap((edge) => fromSiteStream(record(edge)?.node) ?? []), next: null };
  }
  const data = await site(
    `query($a:Cursor,$f:Int){ streams(first:$f, after:$a){ pageInfo{ hasNextPage } edges{ cursor node{ ${STREAM_FIELDS} broadcaster{ login displayName broadcastSettings{ language } } } } } }`,
    { a: cursor, f: first },
    deps,
  );
  const streams = record(data.streams);
  const edges = list(streams?.edges);
  const last = str(record(edges[edges.length - 1])?.cursor);
  const more = record(streams?.pageInfo)?.hasNextPage === true;
  return { streams: edges.flatMap((edge) => fromSiteStream(record(edge)?.node) ?? []), next: more && last && CURSOR.test(last) ? last : null };
}

/** Which of these channels are live now: at most `TWITCH_LOGINS_MAX`, the rest are not asked. */
async function liveByLogin(logins: readonly string[], keys: TwitchKeys | null, deps: SearchDeps): Promise<TwitchStream[]> {
  const asked = [...new Set(logins.map((login) => login.toLowerCase()).filter((login) => LOGIN.test(login)))].slice(0, TWITCH_LOGINS_MAX);
  if (asked.length === 0) return [];
  if (keys !== null) {
    const root = await helix(['streams'], [['first', String(TWITCH_LOGINS_MAX)], ...asked.map((login) => ['user_login', login] as const)], keys, deps);
    return list(root.data).flatMap((entry) => fromHelix(entry) ?? []);
  }
  const data = await site(`query($l:[String!]){ users(logins:$l){ ${CHANNEL_FIELDS} } }`, { l: asked }, deps);
  return list(data.users).flatMap((entry) => fromSiteChannel(entry) ?? []);
}

/** Helix first; on any failure of it (or with no keys) the site API. Both failing is the site API's failure. */
async function eitherWay<T>(deps: SearchDeps, ask: (keys: TwitchKeys | null) => Promise<T>): Promise<T> {
  const keys = twitchKeys(deps);
  if (keys !== null) {
    try {
      return await ask(keys);
    } catch {
      // Fall through to the site API.
    }
  }
  return ask(null);
}

/** POPULAR: the most watched first, decided here; DATE: by when each started. Best match keeps Twitch's own order. */
function ordered(streams: TwitchStream[], deps: SearchDeps): TwitchStream[] {
  const order = deps.order ?? 'relevance';
  if (order === 'popular') return [...streams].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
  if (order === 'newest' || order === 'oldest') {
    const sign = order === 'newest' ? -1 : 1;
    return [...streams].sort((a, b) => sign * ((Date.parse(a.startedAt ?? '') || 0) - (Date.parse(b.startedAt ?? '') || 0)));
  }
  return streams;
}

function items(streams: readonly TwitchStream[], fetchedAt: string): WebItem[] {
  const out: WebItem[] = [];
  for (const stream of streams) {
    const item = twitchItem(stream, fetchedAt);
    if (item !== null && !out.some((seen) => seen.id === item.id)) out.push(item);
  }
  return out;
}

/** A page travels in the cursor as `h<cursor>` (Helix) or `s<cursor>` (the site API), so a next page goes back the same way. */
function readPage(page: ProviderPage | null): { way: 'h' | 's'; cursor: string } | null {
  if (typeof page !== 'string' || page.length < 2) return null;
  const way = page[0];
  const cursor = page.slice(1);
  return (way === 'h' || way === 's') && CURSOR.test(cursor) ? { way, cursor } : null;
}

export const twitchSearch: SearchProvider = {
  platform: 'twitch',
  allowedHosts: TWITCH_HOSTS,
  // The pass, then the question (Helix), then the site API if Helix failed.
  timeoutMs: 15_000,
  orders: ['popular', 'newest', 'oldest'],
  live: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, _author?: string, kind?: SearchKind): Promise<SearchPage> {
    // Twitch has video only.
    if (kind !== undefined && kind !== 'video') return { items: [], next: null };
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    const keys = twitchKeys(deps);
    const from = readPage(page);
    if (page !== null && from === null) return { items: [], next: null };
    const ask = (way: TwitchKeys | null) => (words.trim() === '' ? topStreams(from?.cursor ?? null, way, deps) : searchStreams(words, from?.cursor ?? null, way, deps));
    let found: Found;
    let way: 'h' | 's';
    try {
      if (from !== null) {
        // A next page goes back to whichever way answered the first.
        if (from.way === 'h' && keys === null) return { items: [], next: null };
        found = await ask(from.way === 'h' ? keys : null);
        way = from.way;
      } else if (keys !== null) {
        try {
          found = await ask(keys);
          way = 'h';
        } catch {
          found = await ask(null);
          way = 's';
        }
      } else {
        found = await ask(null);
        way = 's';
      }
    } catch (error) {
      throw new SearchProblemError(error instanceof SafeFetchError && error.status === undefined ? 'NO ANSWER' : 'COULD NOT READ');
    }
    return { items: items(ordered(found.streams, deps), fetchedAt), next: found.next === null ? null : `${way}${found.next}` };
  },
  // A live is over in hours: nothing of Twitch's is saved into the stream.
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};

/** Which of these channels are live now, as rows (rooms' titles, HISTORY, recommendations). Never throws: none on failure. */
export async function twitchLiveNow(logins: readonly string[], deps: SearchDeps): Promise<WebItem[]> {
  const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
  try {
    return items(await eitherWay(deps, (keys) => liveByLogin(logins, keys, deps)), fetchedAt);
  } catch {
    return [];
  }
}

/** The most-watched lives now, in Twitch's own order (or in one game or category). Never throws: none on failure. */
export async function twitchTop(deps: SearchDeps, game?: string, first = TWITCH_PAGE_SIZE): Promise<WebItem[]> {
  const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
  const name = game === undefined ? undefined : sanitiseText(game, 100);
  try {
    return items((await eitherWay(deps, (keys) => topStreams(null, keys, deps, name || undefined, first))).streams, fetchedAt);
  } catch {
    return [];
  }
}

/** Twitch's categories for some words (the recommendations match a taste's words to them). Never throws. */
export async function twitchCategories(words: string, deps: SearchDeps): Promise<string[]> {
  if (words.trim() === '') return [];
  try {
    const data = await site('query($q:String!){ searchCategories(query:$q, first:5){ edges{ node{ name } } } }', { q: words }, deps);
    return list(record(data.searchCategories)?.edges)
      .flatMap((edge) => (typeof record(record(edge)?.node)?.name === 'string' ? [String(record(record(edge)?.node)?.name)] : []))
      .map((name) => sanitiseText(name, 100))
      .filter(Boolean);
  } catch {
    return [];
  }
}
