import { sealAnswer } from '../../../lib/seeing/server/open';

/**
 * BROWSER (SPEC-seeing-machine.md): signed addresses for files a page's own script put on it.
 *
 *   POST /api/see/seal   (Authorization: Bearer <session token>) { page, files: [{ address, kind }] }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return sealAnswer(request);
}
