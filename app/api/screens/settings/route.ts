import { settingsAnswer } from '../../../lib/screens/host-server';

/**
 * SCREENS (SPEC-screens.md, phase 3): what the PC sends, read and changed.
 *
 *   GET  /api/screens/settings?viewer=N   -> the engine's own /settings answer (what is asked, what is really sent)
 *   POST /api/screens/settings?viewer=N   (Content-Type: application/json; `{"shape": "16:9", "lines": 720}`)
 *     -> the same answer, after the change; 400 with the engine's plain reason when it will not take it
 *   Both: Authorization: Bearer <session token>; 403 for anyone but the owner (the same answer whether an engine runs
 *   or not); 502 when the engine does not answer.
 *
 * Passed to the engine on this PC (127.0.0.1) and nowhere else. Owner only; with the mock accounts off, except on a
 * server that is NOT a production one and was started with SCREENS_DEV_OPEN=1 (impossible in a production build).
 * The rules are in `app/lib/screens/host-server.ts`. Never cached, and nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return settingsAnswer(request);
}

export async function POST(request: Request): Promise<Response> {
  return settingsAnswer(request);
}
