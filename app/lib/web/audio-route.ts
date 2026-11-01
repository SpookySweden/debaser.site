import { resolveWebAudio, type WebAudioItem } from './audio-files';
import { SafeFetchError } from './safe-fetch';
import { cachedFetch } from './search/cached-fetch';
import { clientAddress, makeRateLimiter } from './search/rate-limit';
import { isBarAudioPlatform } from './web-audio';
import { isSafeIdentifier } from './urls';

/**
 * What the two WEB audio routes share (`app/api/web/audio/...`): the checks on the address, the per-visitor
 * limit, and the lookup. Server-side only.
 *
 * The limit is generous - a book's chapters each ask once as they start, and seeking re-asks none - and is
 * there only to stop one visitor using the site to hammer a platform. Openverse gets 60 lookups a day per
 * server instance, leaving most of its shared 200 for the stream's own reads.
 */
const perAddress = makeRateLimiter(120, 60_000);
const openverseDaily = makeRateLimiter(60, 24 * 60 * 60 * 1000);

export type AudioLookup = { ok: true; item: WebAudioItem } | { ok: false; status: number; error: string };

export async function lookUpWebAudio(request: Request, platform: string, rawId: string): Promise<AudioLookup> {
  if (!perAddress.allow(clientAddress(request.headers))) return { ok: false, status: 429, error: 'Too many requests. Wait a minute.' };
  let externalId: string;
  try {
    externalId = decodeURIComponent(rawId);
  } catch {
    return { ok: false, status: 404, error: 'No such item.' };
  }
  if (!isBarAudioPlatform(platform) || !isSafeIdentifier(externalId)) return { ok: false, status: 404, error: 'No such item.' };

  try {
    const item = await resolveWebAudio(platform, externalId, {
      fetch: cachedFetch,
      spendOpenverse: () => openverseDaily.allow('all'),
    });
    return item ? { ok: true, item } : { ok: false, status: 404, error: 'No playable file.' };
  } catch (error) {
    if (error instanceof SafeFetchError) return { ok: false, status: 502, error: 'The platform did not answer.' };
    return { ok: false, status: 404, error: 'No playable file.' };
  }
}

/** A found answer may be kept by Vercel's edge for a day; an error never. */
export const FOUND_CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
