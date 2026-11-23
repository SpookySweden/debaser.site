import { askedAnswer } from '../../../lib/seeing/server/open';

/**
 * BROWSER (SPEC-seeing-machine.md): what a page's own script asks for while it runs. GETs only, with nothing of the reader's.
 *
 *   POST /api/see/ask   (Authorization: Bearer <session token>) { page, address }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return askedAnswer(request);
}
