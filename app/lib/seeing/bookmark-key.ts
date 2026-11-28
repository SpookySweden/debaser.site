/**
 * The bookmarks-bar key (Luke, 2026-11-27, asked which install routes to build: "Bookmarks-bar key (no install)"): the lenses as one address a
 * reader drags to their bookmarks bar. All of its code is inside the address: the extension's own lens file and a strip of keys
 * (`bookmark/strip.js`), put together when the site is built. It loads nothing and asks the network for nothing.
 */

/** Where the reader's colours are written in when the key is drawn. */
export const BOOKMARK_THEME_SLOT = '"__DEBASER_THEME__"';

/** Whole-line comments and indents out: nothing else is touched, so the code is the files' own. */
function plain(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The code the bookmark runs: the lenses, then the strip, on the page in front. */
export function composeBookmarkKey(lens: string, strip: string, site = 'https://debaser.site'): string {
  return `(()=>{${plain(lens)}\n${plain(strip)}\nglobalThis.debaserKey(globalThis.debaserSee,${BOOKMARK_THEME_SLOT},${JSON.stringify(site)});})();`;
}

export type BookmarkTheme = { paper: string; ink: string; accent: string; quiet: string; fault: string; faultInk: string; sun: string };

/** The address to drag: the code with these colours in it. Anything that isn't a colour is left for the strip to refuse. */
export function bookmarkAddress(code: string, theme: BookmarkTheme): string {
  const colours = Object.fromEntries(Object.entries(theme).filter(([, value]) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)));
  return 'javascript:' + encodeURIComponent(code.replace(BOOKMARK_THEME_SLOT, JSON.stringify(colours)));
}
