import { looksLikeLink } from '../web/link-shape';
import { safeFetchJson, buildUrl, type FetchLike } from '../web/safe-fetch';
import { sanitiseText } from '../web/sanitise';
import { parseLink, resolveLink, type PastedLink } from '../web/search/link';
import type { SearchDeps } from '../web/search/types';
import type { LinkAnswer, LinkWord } from './types';
import { cleanWord } from './words';

/**
 * A pasted link on TAG STATION (SPEC-tag-station.md). SERVER ONLY, and every request goes through `safe-fetch`.
 *
 * **The pasted address is never fetched, followed or kept.** Which platform and id it names is read out of it by MEDIA's own
 * rules (`parseLink`), and the platform's API is asked about that id. For a music service MEDIA doesn't know, the address is only
 * ever sent as a question to MusicBrainz or that service's own oEmbed, on hosts fixed here. Nothing is saved, and nothing goes to
 * the batch tagger.
 */

const MB_HOST = 'musicbrainz.org';
const ARCHIVE_HOST = 'archive.org';
const MB_ENTITY = /^(artist|recording|release|release-group|work)$/;
const MB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** MusicBrainz asks for one request a second. */
const MB_GAP_MS = 1100;
/** Past this wait, the link goes without MusicBrainz's words rather than holding the reader up. */
const MB_MAX_WAIT_MS = 4000;
const MAX_WORDS_FROM_A_SOURCE = 15;

/** Music services whose pages MusicBrainz can look up, and their own keyless oEmbed where they have one. */
const MUSIC_HOSTS: Readonly<Record<string, { label: string; oembed?: { host: string; path: readonly string[]; query?: readonly [string, string][] } }>> = {
  'open.spotify.com': { label: 'SPOTIFY', oembed: { host: 'open.spotify.com', path: ['oembed'] } },
  'soundcloud.com': { label: 'SOUNDCLOUD', oembed: { host: 'soundcloud.com', path: ['oembed'], query: [['format', 'json']] } },
  'www.mixcloud.com': { label: 'MIXCLOUD', oembed: { host: 'www.mixcloud.com', path: ['oembed', ''], query: [['format', 'json']] } },
  'bandcamp.com': { label: 'BANDCAMP' },
  'www.discogs.com': { label: 'DISCOGS' },
  'www.deezer.com': { label: 'DEEZER' },
  'music.apple.com': { label: 'APPLE MUSIC' },
  'tidal.com': { label: 'TIDAL' },
};

/** The services a link may name, by host, with a Bandcamp artist's own subdomain counted as Bandcamp. */
function musicHostOf(host: string): (typeof MUSIC_HOSTS)[string] | null {
  if (host.endsWith('.bandcamp.com')) return MUSIC_HOSTS['bandcamp.com'];
  return Object.prototype.hasOwnProperty.call(MUSIC_HOSTS, host) ? MUSIC_HOSTS[host] : null;
}

/** A link as https, host and path only: no query, no fragment, no name or port. Null when it isn't a plain web address. */
export function plainAddress(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/^[A-Za-z0-9._~%/+:@!$'()*,;=-]*$/.test(url.pathname)) return null;
  const clean = new URL(`https://${url.hostname.toLowerCase()}${url.pathname}`);
  return clean;
}

type Deps = {
  fetch: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  search?: Pick<SearchDeps, 'env' | 'peertubeHosts' | 'now'>;
};

let nextMusicBrainzAt = 0;

/** One request to MusicBrainz, spaced out across the whole server instance. False when the queue is too long to wait for. */
async function waitForMusicBrainz(deps: Deps): Promise<boolean> {
  const now = deps.now?.() ?? Date.now();
  const wait = Math.max(0, nextMusicBrainzAt - now);
  if (wait > MB_MAX_WAIT_MS) return false;
  nextMusicBrainzAt = now + wait + MB_GAP_MS;
  if (wait > 0) await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(wait);
  return true;
}

type Named = { name?: unknown };
const namesOf = (value: unknown): string[] => (Array.isArray(value) ? (value as Named[]).map((one) => (typeof one?.name === 'string' ? one.name : '')).filter(Boolean) : []);

/** One MusicBrainz entity's genres and tags, by name only: the vote counts beside them are never read. */
async function musicBrainzEntity(entity: string, id: string, deps: Deps): Promise<{ title: string; creator: string | null; words: string[] } | null> {
  if (!MB_ENTITY.test(entity) || !MB_ID.test(id)) return null;
  if (!(await waitForMusicBrainz(deps))) return null;
  const answer = (await safeFetchJson(
    buildUrl(MB_HOST, ['ws', '2', entity, id], [['inc', entity === 'artist' || entity === 'work' ? 'tags genres' : 'tags genres artist-credits'], ['fmt', 'json']]),
    { allowedHosts: [MB_HOST], fetchImpl: deps.fetch },
  )) as { title?: unknown; name?: unknown; genres?: unknown; tags?: unknown; 'artist-credit'?: unknown };
  const credit = Array.isArray(answer['artist-credit']) ? (answer['artist-credit'] as { name?: unknown }[]).map((one) => (typeof one?.name === 'string' ? one.name : '')).filter(Boolean).join(', ') : '';
  return {
    title: sanitiseText(answer.title ?? answer.name, 300),
    creator: credit ? sanitiseText(credit, 200) : null,
    words: [...namesOf(answer.genres), ...namesOf(answer.tags)],
  };
}

/** The entity MusicBrainz has on file for a web address, or null. An address it doesn't know is a 404, which `safe-fetch` throws. */
async function musicBrainzForAddress(address: string, deps: Deps): Promise<{ title: string; creator: string | null; words: string[] } | null> {
  if (!(await waitForMusicBrainz(deps))) return null;
  const answer = (await safeFetchJson(
    buildUrl(MB_HOST, ['ws', '2', 'url'], [['resource', address], ['inc', 'artist-rels release-rels recording-rels release-group-rels'], ['fmt', 'json']]),
    { allowedHosts: [MB_HOST], fetchImpl: deps.fetch },
  )) as { relations?: { 'target-type'?: unknown; [key: string]: unknown }[] };
  const relation = (answer.relations ?? []).find((one) => typeof one['target-type'] === 'string' && MB_ENTITY.test(one['target-type'] as string));
  if (relation === undefined) return null;
  const entity = relation['target-type'] as string;
  const id = (relation[entity.replace('-', '_')] ?? relation[entity]) as { id?: unknown } | undefined;
  return typeof id?.id === 'string' ? musicBrainzEntity(entity, id.id, deps) : null;
}

/** An Internet Archive item's own subject words, from its metadata API. */
async function archiveSubjects(id: string, deps: Deps): Promise<string[]> {
  const answer = (await safeFetchJson(buildUrl(ARCHIVE_HOST, ['metadata', id, 'metadata'], []), { allowedHosts: [ARCHIVE_HOST], fetchImpl: deps.fetch })) as { result?: { subject?: unknown } };
  const subject = answer.result?.subject;
  const list = Array.isArray(subject) ? subject : typeof subject === 'string' ? subject.split(';') : [];
  return list.filter((one): one is string => typeof one === 'string');
}

const quiet = async <T>(ask: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await ask();
  } catch {
    return fallback;
  }
};

/** Outside words, tidied and once each. Anything but a short plain word is dropped. */
function tidy(found: readonly { words: readonly string[]; from: LinkWord['from'] }[]): LinkWord[] {
  const seen = new Set<string>();
  const out: LinkWord[] = [];
  for (const { words, from } of found) {
    for (const raw of words.slice(0, MAX_WORDS_FROM_A_SOURCE)) {
      const word = cleanWord(raw);
      if (word !== null && !seen.has(word)) {
        seen.add(word);
        out.push({ word, from });
      }
    }
  }
  return out;
}

const NOTHING = (outcome: LinkAnswer['outcome']): LinkAnswer => ({ outcome, item: null, card: null, words: [] });

/** What a pasted link is, and any outside words for it. Failures are outcomes, with nothing of the error passed on. */
export async function resolveStationLink(raw: unknown, peertubeHosts: ReadonlySet<string>, deps: Deps): Promise<LinkAnswer> {
  if (!looksLikeLink(raw)) return NOTHING('unknown');
  const text = raw.trim();
  const parsed: PastedLink | null = parseLink(text, peertubeHosts);

  if (parsed !== null) {
    let item;
    try {
      item = await resolveLink(parsed, { fetch: deps.fetch, peertubeHosts, ...(deps.search ?? {}) });
    } catch {
      return NOTHING('no-answer');
    }
    if (item === null) return NOTHING('not-found');
    const subjects = parsed.platform === 'internet_archive' ? await quiet(() => archiveSubjects(parsed.id, deps), []) : [];
    const known = await quiet(() => musicBrainzForAddress(item.canonicalUrl, deps), null);
    return {
      outcome: 'found',
      item,
      card: null,
      words: tidy([
        { words: item.tags ?? [], from: 'platform' },
        { words: subjects, from: 'platform' },
        { words: known?.words ?? [], from: 'musicbrainz' },
      ]),
    };
  }

  const address = plainAddress(text);
  if (address === null) return NOTHING('unknown');

  // A MusicBrainz page names its entity outright.
  if (address.hostname === MB_HOST || address.hostname === `www.${MB_HOST}`) {
    const [entity, id] = address.pathname.split('/').filter(Boolean);
    const found = await quiet(() => musicBrainzEntity(entity ?? '', id ?? '', deps), null);
    if (found === null) return NOTHING('not-found');
    return {
      outcome: 'found',
      item: null,
      card: { title: found.title, creator: found.creator, source: 'MUSICBRAINZ', link: address.toString() },
      words: tidy([{ words: found.words, from: 'musicbrainz' }]),
    };
  }

  const service = musicHostOf(address.hostname);
  if (service === null) return NOTHING('unknown');
  const asked = address.toString();
  const oembed = service.oembed;
  const [card, known] = await Promise.all([
    oembed === undefined
      ? Promise.resolve(null)
      : quiet(async () => {
          const answer = (await safeFetchJson(buildUrl(oembed.host, oembed.path, [...(oembed.query ?? []), ['url', asked]]), { allowedHosts: [oembed.host], fetchImpl: deps.fetch })) as { title?: unknown; author_name?: unknown };
          return { title: sanitiseText(answer.title, 300), creator: sanitiseText(answer.author_name, 200) || null };
        }, null),
    quiet(() => musicBrainzForAddress(asked, deps), null),
  ]);
  const title = card?.title || known?.title || '';
  if (title.length === 0 && known === null) return NOTHING('not-found');
  return {
    outcome: 'found',
    item: null,
    card: { title: title || asked, creator: card?.creator ?? known?.creator ?? null, source: service.label, link: asked },
    words: tidy([{ words: known?.words ?? [], from: 'musicbrainz' }]),
  };
}
