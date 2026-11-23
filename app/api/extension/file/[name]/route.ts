import { EXTENSION_FILES, extensionFile } from '../../../../lib/seeing/server/extension-files';

/** BROWSER's extension: one of its files, as plain words, so nothing of it runs as a script of this site's. Made when the site is built. */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { name: string }[] {
  return EXTENSION_FILES.map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const bytes = await extensionFile((await params).name);
  if (bytes === null) return new Response('NO SUCH FILE', { status: 404 });
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
