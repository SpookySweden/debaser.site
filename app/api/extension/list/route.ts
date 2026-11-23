import { extensionList } from '../../../lib/seeing/server/extension-files';

/** BROWSER's extension: its version and its files' fingerprints, as this build has them. Made when the site is built. */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  return Response.json(await extensionList(), { headers: { 'X-Content-Type-Options': 'nosniff' } });
}
