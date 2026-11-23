import { openAnswer } from '../../../lib/seeing/server/open';

/**
 * BROWSER (SPEC-seeing-machine.md): a page opened by the server's eye, because the person asking wants to see it.
 *
 *   POST /api/see/open   (Authorization: Bearer <session token>) { address, scripts }
 *     -> { ok: true, document } or { ok: false, reason }
 *
 * The address is in the body, so it is in no log. The rules, and why, are in `app/lib/seeing/server/`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return openAnswer(request);
}
