import { hostAnswer } from '../../../lib/screens/host-server';

/**
 * SCREENS (SPEC-screens.md, phase 3): is this PC's screen there for whoever is asking?
 *
 *   GET /api/screens/host   (Authorization: Bearer <session token>)
 *     -> { available: true, settings: <the engine's own /settings answer> }   the owner, while the engine answers
 *     -> { available: false }                                                everyone else, engine or no engine
 *
 * The owner is the one account in SCREENS_OWNER_ID, known from the session token only. With the mock accounts the
 * feature is off, except on a server that is NOT a production one and was started with SCREENS_DEV_OPEN=1, where
 * whoever asks is treated as the owner (for the local drive; impossible in a production build). The rules, and why,
 * are in `app/lib/screens/host-server.ts`. Never cached, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return hostAnswer(request);
}
