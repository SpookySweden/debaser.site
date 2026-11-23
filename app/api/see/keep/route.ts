import { keepAnswer } from '../../../lib/seeing/server/keep';

/**
 * BROWSER (SPEC-seeing-machine.md, "Captures"): the copy KEEP PAGE keeps, made from the server's own signed-out fetch because the person
 * asking pressed for it. Nothing is stored here: it goes back to them.
 *
 *   POST /api/see/keep   (Authorization: Bearer <session token>) { address }
 *     -> { ok: true, address, card, copy } or { ok: false, reason }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return keepAnswer(request);
}
