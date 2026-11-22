import { iceAnswer } from '../../../lib/screens/relay-server';

/**
 * SCREENS: the connection helpers for this browser (SPEC-screens.md, "the relay for anywhere"): Cloudflare's STUN
 * always, and for the owner short-lived passes for Cloudflare's TURN relay when the relay key is set. The key itself
 * never leaves the site's server. Rules in `app/lib/screens/relay-server.ts`. Never cached.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return iceAnswer(request);
}
