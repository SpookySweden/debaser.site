import { isMediaServerId, mediaServer, serverHost } from '../../../../lib/web/media-servers';
import { SafeFetchError, safeFetchText } from '../../../../lib/web/safe-fetch';

/**
 * Is a media server answering? (SPEC-media-servers.md decision 2: "if a server doesn't answer, say so in large
 * plain words and offer the next server".)
 *
 *   GET /api/web/media/ping?server=<an id from media-servers.ts>   ->  { up: true | false }
 *
 * The page cannot ask a friend's server itself (another site's answer is closed to it), so it asks here before
 * PLAY loads the player. One GET of the server's front page through `safe-fetch`, on that server's own host
 * only, a few seconds at most; any answer below 500 counts as up. Nothing of the answer is passed on. The
 * server comes from the fixed list in code, never from what was sent. Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TIMEOUT_MS = 6_000;
/** A front page bigger than this still answered: reading stops, and the server is up. */
const MAX_BYTES = 64 * 1024;
/** One server is asked at most once a minute per instance, however many readers press PLAY. */
const REMEMBER_MS = 60_000;
const remembered = new Map<string, { up: boolean; at: number }>();

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('server');
  if (!isMediaServerId(id)) return json({ error: 'There is no such server.' }, 400);

  const now = Date.now();
  const known = remembered.get(id);
  if (known && now - known.at < REMEMBER_MS) return json({ up: known.up }, 200);

  const server = mediaServer(id);
  let up: boolean;
  try {
    await safeFetchText(`${server.base}/`, { allowedHosts: [serverHost(server)], timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, accept: 'text/html' });
    up = true;
  } catch (error) {
    // A 404, a login page, a redirect elsewhere (not followed) or too big a page: the server answered. A
    // timeout, a refused connection, a name that does not exist or a 5xx is not answering.
    const answered = ['response too large', 'host not allowed', 'too many redirects'];
    up = error instanceof SafeFetchError && ((error.status !== undefined && error.status < 500) || answered.includes(error.message));
  }
  remembered.set(id, { up, at: now });
  return json({ up }, 200);
}
