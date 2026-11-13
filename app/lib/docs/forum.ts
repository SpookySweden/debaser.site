import type { ForumAnchor } from '../forum/types';
import { docPath, snippetOf } from './rules';
import type { DocSummary } from './types';

/**
 * DOCS on the forum (SPEC-live-docs.md, decision 8).
 *
 *   - `[ COMMENT ]` on every document opens its own thread, filed under a `doc` anchor (one thread per
 *     document, as for a track). Luke chose this for every document, private ones too, knowing the
 *     thread's title (the document's) then shows on the public board (2026-11-13).
 *   - A document's first move to PUBLIC or ANYONE SIGNED IN makes one board post: its title, its first
 *     lines, and the link, which the board draws as an `[ OPEN DOC ]` key.
 */

export const DOC_ANCHOR_LABEL_MAX = 120;

export function docAnchor(doc: Pick<DocSummary, 'id' | 'slug' | 'title'>): ForumAnchor {
  const title = doc.title.replace(/\s+/g, ' ').trim().slice(0, DOC_ANCHOR_LABEL_MAX);
  return { kind: 'doc', id: doc.id, label: title.length === 0 ? 'A DOCUMENT' : `DOC // ${title}`, href: docPath(doc) };
}

/** The one board post: title, first lines, and the address on its own last line. */
export function docAnnouncement(doc: Pick<DocSummary, 'id' | 'slug' | 'title'>, bodyText: string, origin: string): { title: string; body: string } {
  const lines = snippetOf(bodyText, 280);
  const link = `${origin.replace(/\/+$/, '')}${docPath(doc)}`;
  return {
    title: `NEW DOC :: ${doc.title}`.slice(0, 140),
    body: lines.length === 0 ? link : `${lines}\n\n${link}`,
  };
}

const DOC_LINK = /\n?\s*https?:\/\/[^/\s]+(\/docs\/[A-Za-z0-9-]{4,64}|\/lore\/[a-z0-9]+(?:-[a-z0-9]+)*)\s*$/;

/** A board post that ends with a document's address: the words before it, and where it opens. */
export function docLinkIn(body: string): { words: string; href: string } | null {
  const match = DOC_LINK.exec(body);
  if (match === null) return null;
  return { words: body.slice(0, match.index).trim(), href: match[1] };
}
