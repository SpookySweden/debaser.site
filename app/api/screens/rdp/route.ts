import { rdpAnswer } from '../../../lib/screens/rdp-server';

/**
 * SCREENS, the server by Windows Remote Desktop (SPEC-screens.md). Owner only, by the same session check as the
 * engine's routes; the rules are in `app/lib/screens/rdp-server.ts`.
 *
 *   GET  /api/screens/rdp  -> is the Remote Desktop way in there (the gateway on the PC answers, a secret is set)
 *   POST /api/screens/rdp  -> a pass for the websocket, good for 60 seconds, once
 *
 * The server's address and Windows sign-in never pass through here. Never cached, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return rdpAnswer(request);
}

export async function POST(request: Request): Promise<Response> {
  return rdpAnswer(request);
}
