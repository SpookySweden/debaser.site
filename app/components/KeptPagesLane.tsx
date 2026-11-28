'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { matchesWords, searchWords } from '../lib/search/site-search';
import { browserHref } from '../lib/seeing/address';
import { askToSee } from '../lib/seeing/ask';
import { keptAddress, pageWords } from '../lib/seeing/pages';
import { keptPages, keptPagesOnServer, openKeptPagesOf, subscribeToKeptPages } from '../lib/seeing/pages-store';
import { PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { explain } from '../lib/ui/explain';

const SHOWN = 6;

/**
 * Pages people kept in BROWSER (SPEC-seeing-machine.md, answer 13), as a lane: MEDIA's newest, or those a search finds; and DISCOVER's, by the
 * words that are chosen there, among the tags their keepers gave them. Nobody's words but theirs. Read in the browser, never saved into a stream.
 */
export default function KeptPagesLane({ search = null, tags = null }: { search?: string | null; tags?: readonly string[] | null }) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const router = useRouter();
  const pages = useSyncExternalStore(subscribeToKeptPages, keptPages, keptPagesOnServer);
  const [all, setAll] = useState(false);
  useEffect(() => void openKeptPagesOf(me), [me]);
  const found = useMemo(() => {
    const open = pages.filter((page) => !page.private);
    if (tags !== null) return tags.length === 0 ? [] : open.filter((page) => tags.some((tag) => page.tags.includes(tag.toUpperCase())));
    return search === null || search.trim() === '' ? open : open.filter((page) => matchesWords(searchWords(search), ...pageWords(page)));
  }, [pages, search, tags]);
  if (found.length === 0) return null;
  const shown = all ? found : found.slice(0, SHOWN);
  return (
    <section aria-label="Pages kept in BROWSER" className="mb-2" data-kept-pages={found.length}>
      <p className="text-label font-bold text-ink-quiet">{`PAGES :: ${found.length} KEPT`}</p>
      <ul>
        {shown.map((page) => (
          <li key={page.id} className="rule-pixel flex items-center gap-2 py-1">
            {/* The server's own shrunk picture, carried in the card: nothing is asked of the page's site. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {page.picture !== null ? <img src={page.picture} alt="" className="h-10 w-14 shrink-0 object-cover" /> : null}
            <button
              type="button"
              onClick={() => {
                askToSee(page.hasCopy ? keptAddress(page.id) : page.address);
                router.push(browserHref(null));
              }}
              title={page.address}
              className={`${PLATE} max-w-full min-w-0 truncate`}
              {...explain(page.hasCopy ? 'Opens the kept copy of this page in BROWSER.' : 'Opens this page in BROWSER.', page.hasCopy ? 'It is still there if the real page changes or goes.' : 'To see it without leaving the site.')}
            >
              {page.title}
            </button>
            <span className="truncate text-label text-ink-quiet">
              {page.site} · {page.ownerLabel}
            </span>
          </li>
        ))}
      </ul>
      {found.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className={`${PLATE} mt-1`} {...explain('Lists every kept page that fits here.', 'Only the first six are shown to start with.')}>
          {`[ ALL ${found.length} PAGES ]`}
        </button>
      ) : null}
    </section>
  );
}
