import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { peertubeHosts } from '../../../lib/web/search/peertube-index';

/**
 * The PeerTube instances the page may show, link and frame (SPEC-web-search.md):
 *
 *   GET /api/web/peertube-hosts  ->  { hosts: string[] }
 *
 * The public instances index, read and checked on the server (lib/web/search/peertube-index.ts), so the page
 * re-checks every PeerTube address against the same list the search used. The same for everyone, so Vercel's
 * edge keeps it for six hours.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const hosts = [...(await peertubeHosts(cachedFetch))].sort();
  return new Response(JSON.stringify({ hosts }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=21600' },
  });
}
