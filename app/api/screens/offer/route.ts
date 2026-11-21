import { offerAnswer } from '../../../lib/screens/host-server';

/**
 * SCREENS (SPEC-screens.md, phase 3): the "hello" that starts the picture.
 *
 *   POST /api/screens/offer   (Authorization: Bearer <session token>; Content-Type: application/sdp; the browser's offer)
 *     -> 201 application/sdp, the engine's answer, with the viewer's number in `Debaser-Viewer`
 *     -> 403 for anyone but the owner (the same answer whether an engine runs or not)
 *     -> 429 after 12 hellos in a minute, 413 past 64 KiB, 502 when the engine does not answer within two seconds
 *
 * The site's server passes the offer to the engine on this PC (127.0.0.1) and nothing else: the picture and CONTROL
 * then travel by WebRTC straight between the browser and the engine. Owner only; with the mock accounts off, except
 * on a server that is NOT a production one and was started with SCREENS_DEV_OPEN=1 (impossible in a production
 * build). The rules are in `app/lib/screens/host-server.ts`. Never cached, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return offerAnswer(request);
}
