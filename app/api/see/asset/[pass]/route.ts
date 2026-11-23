import { assetRoute } from '../../../../lib/seeing/server/open';

/**
 * BROWSER (SPEC-seeing-machine.md, "Signed assets"): one file of a page, by the pass the rewriter sealed. No token, no pass, no fetch.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ pass: string }> }): Promise<Response> {
  return assetRoute(request, (await params).pass);
}
