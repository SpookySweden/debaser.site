import { siteWayAnswer } from '../../../lib/screens/site-way-server';

/**
 * REMOTE's slowest way, through the site (SPEC-screens.md, "Away from home with no setup"). Owner only, by the same
 * session check as the engine's routes; the rules are in `app/lib/screens/site-way-server.ts`. HIDDEN: no page asks
 * this yet (Luke, 2026-11-28: "Wait until sound works too").
 *
 *   GET  /api/screens/site-way  -> is that way there, and how much of the month's allowance is used
 *   POST /api/screens/site-way  -> a pass for the websocket, good for 60 seconds, once
 *
 * The picture never passes through here, and neither does the engine's key. Never cached, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return siteWayAnswer(request);
}

export async function POST(request: Request): Promise<Response> {
  return siteWayAnswer(request);
}
