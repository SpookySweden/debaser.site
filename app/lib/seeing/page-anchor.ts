import type { ForumAnchor } from '../forum/types';
import { browserHref } from './address';
import { keptAddress, type SeenPage } from './pages';

/** The thread a kept page has on the board: one a page, by its id, under its own title. A private page has none. */
export function pageAnchor(page: Pick<SeenPage, 'id' | 'title'>): ForumAnchor {
  return { kind: 'page', id: page.id, label: page.title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'A KEPT PAGE', href: browserHref(keptAddress(page.id)) };
}
