'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { continueHref, shelves } from '../lib/books/reading-places';
import { getBooksRepository } from '../lib/books/repository';
import type { BookPlace } from '../lib/books/types';
import { getDocsRepository } from '../lib/docs/repository';
import { docPath } from '../lib/docs/rules';
import type { DocSummary } from '../lib/docs/types';
import { commentDomId, threadDomId } from '../lib/forum/anchors';
import { displayTitle } from '../lib/forum/site-author';
import { useCatalogue } from '../lib/media/catalogue';
import { browserHref } from '../lib/seeing/address';
import { SeeLine } from './SeeKey';
import { askToSee } from '../lib/seeing/ask';
import { keptAddress, pageWords } from '../lib/seeing/pages';
import { keptPages, keptPagesOnServer, openKeptPagesOf, subscribeToKeptPages } from '../lib/seeing/pages-store';
import { useRecommendationList } from '../lib/recommendations/store';
import {
  closeSearch,
  GROUP_LIMIT,
  matchesWords,
  openSearch,
  resultLine,
  searchRequested,
  searchWindowServerState,
  searchWindowState,
  searchWords,
  subscribeToSearchWindow,
  toggleSearch,
} from '../lib/search/site-search';
import { FIELD, PLATE } from '../lib/ui/controls';
import { searchEverywhere } from '../lib/web/everywhere-client';
import { getCanvasRepository, type StreamArtPiece } from '../lib/watch/canvas-repository';
import type { WebStreamItem } from '../lib/web/dedupe';
import { PLATFORM_LABELS } from '../lib/web/types';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';

type Row = { key: string; href: string; text: string; outside?: boolean; /** Opened in BROWSER by the press itself: a link alone waits for GO there. */ see?: string };

const ROW = 'block truncate py-0.5 text-prose text-ink hover:underline';

/**
 * The SEARCH window (SPEC-forum-v3.md, S1B and S2A): one box for the whole site, opened by `[ ⌕ SEARCH ]` on the top bar or
 * Ctrl+K from any page. The site's own groups answer at once, from the lists this browser already holds or reads through
 * each page's own store; the outside platforms (MEDIA's search) arrive after as OUTSIDE, so a slow platform never holds
 * the rest back. Every other search box on the site stays as it is (S3A).
 */
export default function SearchWindow() {
  const state = useSyncExternalStore(subscribeToSearchWindow, searchWindowState, searchWindowServerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = search.toString();
  const query = asked.length === 0 ? '' : `?${asked}`;

  useEffect(() => {
    if (searchRequested(query)) openSearch(search.get('search') === '1' ? '' : (search.get('search') ?? ''));
  }, [query, search]);

  // However it was shut (its [ × ], the top bar's key, Ctrl+K), `?search=` is spent with it, or the next change of the
  // address would open it again.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (state.open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!searchRequested(query)) return;
    const rest = new URLSearchParams(asked);
    rest.delete('search');
    const left = rest.toString();
    router.replace(left.length === 0 ? pathname : `${pathname}?${left}`);
  }, [state.open, query, asked, pathname, router]);

  // Ctrl+K (or Cmd+K) from anywhere, unless a page keeps that key for itself (the beat box, the workbench).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-own-undo], .debaser-beatbox') !== null && target !== null) return;
      // Not while typing somewhere else (a post, a doc, a field): the search box itself is the one place it may close from.
      const typing = target !== null && target.id !== 'site-search-box' && (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null);
      if (typing) return;
      event.preventDefault();
      toggleSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Closing spends `?search=` and nothing else of the address.
  const close = useCallback(() => {
    closeSearch();
    if (!searchRequested(query)) return;
    const rest = new URLSearchParams(asked);
    rest.delete('search');
    const left = rest.toString();
    router.replace(left.length === 0 ? pathname : `${pathname}?${left}`);
  }, [asked, pathname, query, router]);

  if (!state.open) return null;

  return (
    <DockWindow title="SEARCH" onClose={close} id="search" defaultSize={{ w: 560, h: 640 }} minSize={{ w: 360, h: 260 }}>
      <SearchBody initial={state.words} onLeave={close} />
    </DockWindow>
  );
}

function Group({ title, rows, onLeave, empty }: { title: string; rows: Row[]; onLeave: () => void; empty?: ReactNode }) {
  if (rows.length === 0 && empty === undefined) return null;
  return (
    <section className="mb-2" data-search-group={title}>
      <h3 className="title-line text-label font-bold text-ink">{title}</h3>
      {rows.length === 0 ? <p className="py-0.5 text-label text-ink">{empty}</p> : null}
      {rows.map((row) =>
        row.outside ? (
          <a key={row.key} href={row.href} target="_blank" rel="noopener noreferrer" className={ROW}>
            {row.text} ↗
          </a>
        ) : (
          <Link key={row.key} href={row.href} onClick={() => {
              if (row.see !== undefined) askToSee(row.see);
              onLeave();
            }} className={ROW}>
            {row.text}
          </Link>
        ),
      )}
    </section>
  );
}

export function SearchBody({ initial, onLeave }: { initial: string; onLeave: () => void }) {
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState(initial);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const words = useMemo(() => searchWords(asked), [asked]);
  const { user } = useAuth();
  const me = user?.id ?? null;

  // The lists the site's own groups read, each through its page's own store (and so its own database rules).
  const forum = useForum();
  const { accounts } = useComms();
  const catalogue = useCatalogue();
  const recommendations = useRecommendationList('public', me);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [places, setPlaces] = useState<BookPlace[]>([]);
  /** The art shelf's drawings (SPEC-forum-v3.md: DRAWINGS, with MADE), read once like the docs. */
  const [drawings, setDrawings] = useState<StreamArtPiece[]>([]);
  useEffect(() => {
    let live = true;
    void getCanvasRepository()
      .listPieces({ includeHidden: false })
      .then((found) => live && setDrawings(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // BROWSER's kept pages.
  const kept = useSyncExternalStore(subscribeToKeptPages, keptPages, keptPagesOnServer);
  useEffect(() => void openKeptPagesOf(me), [me]);
  useEffect(() => {
    let live = true;
    void getDocsRepository(me)
      .listDocs()
      .then((found) => live && setDocs(found))
      .catch(() => undefined);
    if (me !== null)
      void getBooksRepository()
        .places(me)
        .then((found) => live && setPlaces(found))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me]);

  const groups = useMemo(() => {
    if (words.length === 0) return null;
    const posts: Row[] = [];
    for (const thread of forum.threads) {
      if (matchesWords(words, displayTitle(thread), thread.body, thread.author.displayName))
        posts.push({ key: thread.id, href: `/forum#${threadDomId(thread.id)}`, text: `${displayTitle(thread)} · ${thread.author.displayName}` });
      for (const comment of thread.comments)
        if (matchesWords(words, comment.body, comment.author.displayName))
          posts.push({ key: comment.id, href: `/forum#${commentDomId(comment.id)}`, text: `${comment.author.displayName}: "${resultLine(comment.body, 70)}" in ${displayTitle(thread)}` });
    }
    // The directory's accounts, and anybody with an account who has written on the board (the directory may not list them yet).
    const named = new Map<string, string>();
    for (const account of accounts) named.set(account.id, account.displayName);
    for (const thread of forum.threads) {
      if (thread.author.id !== null && !named.has(thread.author.id)) named.set(thread.author.id, thread.author.displayName);
      for (const comment of thread.comments) if (comment.author.id !== null && !named.has(comment.author.id)) named.set(comment.author.id, comment.author.displayName);
    }
    const people = [...named]
      .filter(([, name]) => matchesWords(words, name))
      .map(([id, name]) => ({ key: id, href: `/profile/${encodeURIComponent(id)}`, text: name }));
    const docRows = docs
      .filter((doc) => matchesWords(words, doc.title, doc.summary))
      .map((doc) => ({ key: doc.id, href: docPath(doc), text: `${doc.title}${doc.slug === null ? '' : ' · LORE'}` }));
    const files = catalogue.items
      .filter((item) => matchesWords(words, item.title, item.kind))
      .map((item) => ({ key: item.id, href: `/files?kind=${item.kind}`, text: `${item.title} · ${item.kind.toUpperCase()}` }));
    const drawingRows = drawings
      .filter((piece) => matchesWords(words, piece.canvas.title, piece.canvas.hostLabel, piece.canvas.savedByLabel ?? ''))
      .map((piece) => ({ key: piece.canvas.id, href: '/media?art=1', text: `${piece.canvas.title || 'A DRAWING'} · ${piece.canvas.savedByLabel ?? piece.canvas.hostLabel}` }));
    const recs = (recommendations.value ?? [])
      .filter((rec) => matchesWords(words, rec.title, rec.message, rec.senderName))
      .map((rec) => ({ key: rec.id, href: rec.forumThreadId === null ? '/recommendations' : `/forum#${threadDomId(rec.forumThreadId)}`, text: `${rec.title}${rec.senderName ? ` · ${rec.senderName}` : ''}` }));
    const { reading, read } = shelves(places);
    const books = [...reading, ...read]
      .filter((place) => matchesWords(words, place.title))
      .map((place) => ({ key: place.bookRef, href: continueHref(place.bookRef), text: place.title || 'A BOOK' }));
    const pages = kept
      .filter((page) => matchesWords(words, ...pageWords(page)))
      .map((page) => ({ key: page.id, href: browserHref(null), see: page.hasCopy ? keptAddress(page.id) : page.address, text: `${page.title} · ${page.site}` }));
    return { posts, people, docRows, files, drawingRows, recs, books, pages };
  }, [kept, words, forum.threads, accounts, docs, catalogue.items, drawings, recommendations.value, places]);

  // OUTSIDE: MEDIA's own search, asked once per search and shown after the site's groups (S1B).
  const [outside, setOutside] = useState<{ for: string; items: WebStreamItem[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (asked.trim().length === 0) return;
    let live = true;
    const query = asked.trim();
    searchEverywhere(query, null)
      .then((page) => live && setOutside({ for: query, items: page.items.slice(0, GROUP_LIMIT), failed: false }))
      .catch(() => live && setOutside({ for: query, items: [], failed: true }));
    return () => {
      live = false;
    };
  }, [asked]);
  const outsideNow = outside !== null && outside.for === asked.trim() ? outside : null;

  const total = groups === null ? 0 : Object.values(groups).reduce((sum, rows) => sum + rows.length, 0);

  return (
    <div data-site-search>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAsked(text);
        }}
      >
        <label htmlFor="site-search-box" className="sr-only">
          Search the whole site
        </label>
        <input
          id="site-search-box"
          ref={box}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="POSTS, PEOPLE, DOCS, FILES, BOOKS..."
          className={`${FIELD} min-w-0 flex-1`}
          maxLength={200}
        />
        <button type="submit" className={PLATE}>
          [ SEARCH ]
        </button>
      </form>
      <SeeLine words={text} onLeave={onLeave} />

      {groups === null ? (
        <p className="p-1 text-label text-ink">THE SITE&apos;S OWN THINGS FIRST, THEN THE OUTSIDE PLATFORMS. CTRL+K OPENS THIS FROM ANY PAGE.</p>
      ) : (
        <>
          {total === 0 ? <p className="p-1 text-key font-bold text-ink">NOTHING ON THE SITE MATCHES.</p> : null}
          <Group title="POSTS & REPLIES" rows={groups.posts.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="PEOPLE" rows={groups.people.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="DOCS & LORE" rows={groups.docRows.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="FILES & TRACKS" rows={groups.files.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="DRAWINGS" rows={groups.drawingRows.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="RECOMMENDATIONS" rows={groups.recs.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="YOUR BOOKS" rows={groups.books.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group title="PAGES" rows={groups.pages.slice(0, GROUP_LIMIT)} onLeave={onLeave} />
          <Group
            title="OUTSIDE"
            rows={(outsideNow?.items ?? []).map((item) => ({
              key: `${item.platform}-${item.id}`,
              href: item.url,
              text: `${item.title}${item.creator ? ` · ${item.creator}` : ''} · ${PLATFORM_LABELS[item.platform]}`,
              outside: true,
            }))}
            onLeave={onLeave}
            empty={outsideNow === null ? 'ASKING THE OUTSIDE PLATFORMS...' : outsideNow.failed ? 'THE OUTSIDE PLATFORMS DID NOT ANSWER.' : 'NOTHING OUTSIDE.'}
          />
          <p className="pt-1">
            <Link href={`/media?q=${encodeURIComponent(asked.trim())}`} onClick={onLeave} className={PLATE}>
              [ ALL OF IT IN MEDIA → ]
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
