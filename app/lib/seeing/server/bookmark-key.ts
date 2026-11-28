/**
 * The bookmarks-bar key's code as this build has it: the extension's own lens file and the strip (`bookmark/strip.js`), put together when the
 * site is built, so the key is always the lenses the site runs. SERVER ONLY.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composeBookmarkKey } from '../bookmark-key';
import { extensionFile } from './extension-files';

export async function bookmarkKeyCode(): Promise<string> {
  const lens = (await extensionFile('lens.js'))?.toString('utf8') ?? '';
  const strip = await readFile(join(process.cwd(), 'bookmark', 'strip.js'), 'utf8');
  return composeBookmarkKey(lens, strip);
}
