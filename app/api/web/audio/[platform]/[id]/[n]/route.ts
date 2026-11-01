import { FOUND_CACHE, lookUpWebAudio } from '../../../../../../lib/web/audio-route';

/**
 * One WEB audio file, as the music bar's `src` (app/lib/web/web-audio.ts):
 *
 *   GET /api/web/audio/<platform>/<id>/<n>  ->  302 to the platform's own file
 *
 * A redirect and nothing else: the listener's browser fetches the audio straight from the platform, so no
 * byte of it passes through the site (CLAUDE.md, WEB: never re-host). The address is the one the platform's
 * official listing gives for that item (app/lib/web/audio-files.ts), never one the caller supplies.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ platform: string; id: string; n: string }> }): Promise<Response> {
  const { platform, id, n } = await context.params;
  if (!/^(0|[1-9]\d{0,2})$/.test(n)) return new Response('No such file.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const found = await lookUpWebAudio(request, platform, id);
  const file = found.ok ? found.item.files[Number(n)] : undefined;
  if (!file) {
    return new Response(found.ok ? 'No such file.' : found.error, { status: found.ok ? 404 : found.status, headers: { 'Cache-Control': 'no-store' } });
  }

  return new Response(null, {
    status: 302,
    // No referrer goes with the browser to the platform, the same as every thumbnail and player on /web.
    headers: { Location: file.url, 'Cache-Control': FOUND_CACHE, 'Referrer-Policy': 'no-referrer' },
  });
}
