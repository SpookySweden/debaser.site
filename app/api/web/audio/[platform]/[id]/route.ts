import { answerFor } from '../../../../../lib/web/audio-files';
import { FOUND_CACHE, lookUpWebAudio } from '../../../../../lib/web/audio-route';

/**
 * WEB audio for the music bar (app/lib/web/web-audio.ts):
 *
 *   GET /api/web/audio/<platform>/<id>
 *     -> { title, creator, files: [{ title, seconds }] }   (404 when the item has no playable file)
 *
 * The page turns each file into a track whose `src` is `/api/web/audio/<platform>/<id>/<n>`. The platform's
 * own file addresses are not part of this answer: only the file route hands them out, as a redirect.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ platform: string; id: string }> }): Promise<Response> {
  const { platform, id } = await context.params;
  const found = await lookUpWebAudio(request, platform, id);
  return new Response(JSON.stringify(found.ok ? answerFor(found.item) : { error: found.error }), {
    status: found.ok ? 200 : found.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': found.ok ? FOUND_CACHE : 'no-store' },
  });
}
