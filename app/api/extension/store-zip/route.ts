import { extensionZip } from '../../../lib/seeing/server/extension-files';

/** The extension as the stores take it (Chrome Web Store, Edge Add-ons): the same files, the manifest without its key. Made when the site is built. */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const { name, bytes } = await extensionZip(true);
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' } });
}
