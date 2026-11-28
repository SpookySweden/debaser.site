import { bookmarkKeyCode } from '../../../lib/seeing/server/bookmark-key';

/**
 * The bookmarks-bar key's code (the lenses and their strip of keys), as plain words: the EXTENSION window writes the reader's colours into it
 * and makes it the address of a key to drag. Nothing of it runs as a script of this site's. Made when the site is built.
 */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  return new Response(await bookmarkKeyCode(), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
