import { readArchiveSubtitles, readArchiveSubtitleText } from '../../../lib/web/series-files';
import { SafeFetchError } from '../../../lib/web/safe-fetch';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { isSafeIdentifier } from '../../../lib/web/urls';
import { SIGNED_OUT_REFUSAL, webSignedIn } from '../../../lib/web/web-session';

/**
 * Internet Archive subtitles for the stream room's player (SPEC-subtitles.md):
 *
 *   GET /api/web/subtitles?ia=<item>              -> { language, videos: { <video path>: [{ file, stem, language, auto }] } }
 *   GET /api/web/subtitles?ia=<item>&file=<name>  -> the file as text/vtt (SRT converted)
 *
 * archive.org sends no CORS header, so a page can't read a subtitle file itself: the text passes through here
 * when a viewer switches subtitles on, and is never stored - not on disk, not in the database, not in the
 * server's fetch cache (Luke's OK, 2026-11-03; CLAUDE.md, ARCHIVE). Subtitle text only, never video or audio.
 * Only a `.vtt`/`.srt` file the item's own metadata lists, from archive.org and its file servers, through
 * safe-fetch. Signed-in people only, like the rest of WEB.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A queue's rows ask for each item's list once (the server keeps the Archive's answer a day), so lists get a wide
// allowance; a file is asked once per pick, each one a fresh read from the Archive.
const listsPerAddress = makeRateLimiter(300, 60_000);
const filesPerAddress = makeRateLimiter(60, 60_000);
/** Fetched fresh each time, never through Next's fetch cache. */
const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

function refuse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  if (!(await webSignedIn(request))) return refuse(SIGNED_OUT_REFUSAL, 401);
  const params = new URL(request.url).searchParams;
  const id = params.get('ia') ?? '';
  if (!isSafeIdentifier(id)) return refuse('Ask for an Archive item.', 400);
  const file = params.get('file');
  if (!(file === null ? listsPerAddress : filesPerAddress).allow(clientAddress(request.headers))) return refuse('Too many requests. Wait a minute.', 429);

  try {
    if (file === null) {
      const subtitles = await readArchiveSubtitles(id, { fetch: cachedFetch });
      if (subtitles === null) return refuse('NOTHING HERE PLAYS IN A ROOM.', 404);
      // Never kept by Vercel's edge (a signed-in reader's answer); the reader's own browser may keep it a few minutes.
      return new Response(JSON.stringify(subtitles), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
    }
    const vtt = await readArchiveSubtitleText(id, file, { fetch: cachedFetch, textFetch: freshFetch });
    if (vtt === null) return refuse('NO SUCH SUBTITLES.', 404);
    return new Response(vtt, { status: 200, headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof SafeFetchError) return refuse('THE PLATFORM DID NOT ANSWER.', 502);
    return refuse('NO SUCH SUBTITLES.', 404);
  }
}
