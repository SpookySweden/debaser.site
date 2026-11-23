import { extensionZip } from '../../../lib/seeing/server/extension-files';

/** BROWSER's extension as one download. Made when the site is built, from the same files the list names. */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const { name, bytes } = await extensionZip();
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' } });
}
