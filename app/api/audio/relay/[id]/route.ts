import { relayAllowed, relayRefused, relaySlice } from '../../../../lib/audio/youtube-relay';
import { clientAddress } from '../../../../lib/web/search/rate-limit';

/**
 * YouTube's sound for the sound graph behind the music bar, a slice at a time (app/lib/audio/youtube-relay.ts):
 *
 *   GET /api/audio/relay/<videoId>    (Range: bytes=<start>-[end])
 *     -> 206 with at most 1 MB of the video's smallest audio file, 416 past its end, 502 when YouTube hands out nothing,
 *        429 when one address has asked too often (RELAY_LIMIT)
 *
 * Measured by the page, played by nobody; nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  // For this site's own pages only: another site's page asking through a visitor's browser is refused (browsers say
  // where a request comes from; a tool that leaves the header out is not stopped by this, only by the limit below).
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return new Response('not from this site', { status: 403 });
  // One address gets 30 slices a minute and 300 an hour (RELAY_LIMIT), counted per running server copy.
  if (!relayAllowed(clientAddress(request.headers))) return relayRefused();
  const { id } = await context.params;
  return relaySlice(id, request.headers.get('range'));
}
