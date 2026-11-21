import type { ForumAnchor } from '../forum/types';
import { pagePath } from './rules';

/**
 * A panel's comments are an ordinary board thread (SPEC-comic.md, Q11): a `comic` anchor whose id is the panel's, so each
 * panel has exactly one thread (the board's unique index on anchor kind and id), with replies, the bell, DESK, search and
 * moderation as anywhere on the board. Its title names the place, and links back to the page with the panel's pane open.
 *
 * No picture preview: the board draws previews through Next's image optimiser, which only takes addresses the site lists
 * (next.config.ts), and listing the comic's file route there would turn every other local picture away.
 */
export function comicPanelAnchor(input: { panelId: string; chapterNumber: number; pageNumber: number; panelNumber: number }): ForumAnchor {
  return {
    kind: 'comic',
    id: input.panelId,
    label: `COMIC · CH ${input.chapterNumber} · P ${input.pageNumber} · PANEL ${input.panelNumber}`,
    href: pagePath(input.chapterNumber, input.pageNumber, input.panelId),
  };
}
