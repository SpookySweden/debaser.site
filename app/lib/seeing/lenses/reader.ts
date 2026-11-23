import type { ThemeTokens } from '../../ui/themes';
import type { Lens, Paper, TextSize } from './lens';

export type ReaderColours = { paper: string; ink: string; link: string; quiet: string };

/** The four colours READER is set in. On the book reader's own papers a link is the words' ink, underlined: the theme's accent may not read there. */
export function readerColours(tokens: ThemeTokens, paper: Paper): ReaderColours {
  if (paper === 'theme') return { paper: tokens.paper, ink: tokens.ink, link: tokens['accent-ink'], quiet: tokens['ink-quiet'] };
  const ink = tokens[`reader-${paper}-ink`];
  return { paper: tokens[`reader-${paper}-paper`], ink, link: ink, quiet: ink };
}

/** Step 2 is the site's own prose, a little larger than its labels; each step is a tenth or so more. */
const TIMES: Record<TextSize, number> = { 1: 0.9, 2: 1, 3: 1.15, 4: 1.35, 5: 1.6, 6: 2 };

/** 02 READER: the main words and pictures in reading order, on your theme's paper or the book reader's. */
export const reader: Lens = {
  id: 'reader',
  form: 'reading',
  beside: null,
  css({ tokens, scheme, face, settings: { reader: look } }) {
    const { paper, ink, link, quiet } = readerColours(tokens, look.paper);
    const shade = look.paper === 'theme' ? scheme : look.paper === 'dark' ? 'dark' : 'light';
    return [
      `:root{color-scheme:${shade};background:${paper};color:${ink};font-family:${face};font-size:${TIMES[look.size] * 112.5}%;line-height:1.6}`,
      'body{max-width:42rem;margin:0 auto;padding:1.5rem;overflow-wrap:break-word}',
      'h1,h2,h3{font-weight:400;line-height:1.25}h1{font-size:1.6em}h2{font-size:1.3em}h3{font-size:1.1em}',
      `a{color:${link};text-decoration:underline}`,
      `blockquote{margin-left:0;padding-left:1rem;border-left:2px solid ${ink}}`,
      `figcaption,small,.see-quiet{color:${quiet};font-size:.9em}`,
      'img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{border-collapse:collapse}',
      `td,th{border:1px solid ${ink};padding:.25rem .5rem;text-align:left;font-weight:400}`,
    ].join('\n');
  },
};
