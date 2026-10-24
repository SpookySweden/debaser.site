'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { selectBoardThreads, type SortMode, type SourceFilter, type TagMatchMode } from '../lib/forum/board-query';
import { paginate } from '../lib/forum/paging';
import { sortThreadsPinnedFirst } from '../lib/forum/pins';
import { makeUserTag } from '../lib/forum/tag-vocabulary';
import TagWindow from './TagWindow';
import type { ForumThread } from '../lib/forum/types';
import ForumThreadCard from './ForumThreadCard';
import ForumPinPanel from './ForumPinPanel';
import NewsTicker from './NewsTicker';
import NewPostForm from './NewPostForm';
import ForumGalleryView from './ForumGalleryView';
import { useForum } from './ForumProvider';
import { TagMark, tagMarkColour } from './TagBadge';
import { PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';

/**
 * How the board is read.
 *
 * `feed` is the board as it has always been: one row per post, collapsed, opened one at a time.
 * `gallery` is the same list read as a wall of pictures - Explorer's large-icons view - filtered to
 * the posts that carry a picture (`imageOnly` in app/lib/forum/board-query.ts) and drawn open, so
 * nothing on a tile has to be pressed before it can be read.
 */
type BoardView = 'feed' | 'gallery';

const VIEWS: { value: BoardView; label: string; title: string }[] = [
  { value: 'feed', label: '[ FEED ]', title: 'Every post as one row: the reading order the board has always had' },
  {
    value: 'gallery',
    label: '[ GALLERY ]',
    title: 'Only the posts filed with a picture, drawn open - the Explorer view',
  },
];

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'ALL SOURCES' },
  { value: 'board', label: 'BOARD THREADS' },
  { value: 'asset', label: 'ASSET THREADS' },
  { value: 'text-box', label: 'TEXT BOX THREADS' },
  // Comments left on a profile, a picture, or the track beside it: the board reads them as threads
  // of their own (app/lib/forum/profile-threads.ts), so they can be filtered like everything else.
  { value: 'profile', label: 'PROFILE COMMENTS' },
  // Posts filed under a track on the shelf (app/lib/audio/forum-tracks.ts, `trackAnchor`).
  { value: 'track', label: 'TRACK THREADS' },
];

/** Posts-per-page choices, offered in the sort / search panel. */
const PAGE_SIZES = [5, 10, 20, 50];

/** Past this many pages the foot draws a key per page as well: up to it, `[ < ]` and `[ > ]` walk it. */
const NUMBERED_PAGES_AFTER = 5;

/** The two panels that hang from the controls row: the tag wall, and sort / source / search / paging. */
type BoardMenu = 'tags' | 'controls';

/**
 * A panel hanging from the controls row: out of the flow, under the row and as wide as it, so opening
 * one lays itself over the posts instead of pushing them down (CLAUDE.md, "Reveals take their space in
 * both states"). Framed like the Start menu, because it floats over the board rather than sitting in it.
 */
const MENU_PANEL = 'absolute top-full right-0 left-0 z-menu mt-1 frame bg-paper p-2';

/**
 * The board itself: one row of controls, the collapsible thread list, the paging readout under it,
 * and the composer. All state lives in ForumProvider, so a comment filed from the home page or the
 * concepts archive lands here without a reload.
 */
export default function ForumBoard() {
  const forum = useForum();
  const clearLocalPosts = forum.clearLocalPosts;
  // Read out here rather than reached for as `forum.markThreadRead` in each deps list: it is stable
  // per account, and the four ways a post can open (a click, a tile, a `#thread-` link, filing one)
  // then share one dependency instead of depending on the whole context value.
  const markThreadRead = forum.markThreadRead;

  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  /**
   * How the board is read here, the feed or the gallery.
   *
   * Local state rather than an address, like the sort and the source filter beside it: this is the
   * same list read two ways, not somewhere else to be. So it is deliberately *not* a query
   * parameter - a link to the board means the board.
   */
  const [view, setView] = useState<BoardView>('feed');
  const [query, setQuery] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>('any');
  /** The board's music half: the switch, the sounds, and whether the whole index is open. */
  const [musicOnly, setMusicOnly] = useState(false);
  const [musicTagKeys, setMusicTagKeys] = useState<string[]>([]);
  const [tagWindowOpen, setTagWindowOpen] = useState(false);
  /** Which of the row's two panels is open, if either: the board opens with both folded away. */
  const [menu, setMenu] = useState<BoardMenu | null>(null);
  /** The keys that open the panels: ESC hands focus back to whichever one opened the panel it closes. */
  const tagsKeyRef = useRef<HTMLButtonElement>(null);
  const controlsKeyRef = useRef<HTMLButtonElement>(null);
  /** The controls row: a press outside it closes its panel. */
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [openThreadIds, setOpenThreadIds] = useState<string[]>([]);

  const visibleThreads = useMemo(
    () =>
      // A pinned post leads whatever the filters say: the point of a pin is that it is seen, and
      // a pin that vanished the moment somebody searched would not be one. It is lifted inside
      // the filtered list rather than added to it, so a search that excludes it still excludes it.
      sortThreadsPinnedFirst(
        selectBoardThreads(forum.threads, {
          query,
          sourceFilter,
          tagKeys: tagFilters,
          tagMatchMode,
          sortMode,
          musicOnly,
          musicTagKeys,
          // The gallery is a *reading* of the board, not a second board: the same filter, sort and
          // paging, narrowed to the posts that carry a picture of their own.
          imageOnly: view === 'gallery',
        }),
        forum.pins,
      ),
    [forum.threads, forum.pins, query, sourceFilter, tagFilters, tagMatchMode, sortMode, musicOnly, musicTagKeys, view],
  );

  // Paging: the page is clamped, so filtering a page away can never show a blank board.
  const slice = paginate(visibleThreads, perPage, page);
  const currentPage = slice.page;
  const totalPages = slice.totalPages;
  const pageStart = slice.start;
  const pageThreads = slice.items;
  const pageNumbers = Array.from({ length: totalPages }, (_unused, index) => index + 1);

  const toggleTagFilter = useCallback((key: string) => {
    setTagFilters((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
    setPage(1);
  }, []);

  const clearTagFilters = useCallback(() => {
    setTagFilters([]);
    setPage(1);
  }, []);

  const toggleMusicTag = useCallback((key: string) => {
    setMusicTagKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
    setPage(1);
  }, []);

  /** The music switch off is the music tags off: one question, one answer. */
  const handleMusicOnly = useCallback((value: boolean) => {
    setMusicOnly(value);
    if (!value) setMusicTagKeys([]);
    setPage(1);
  }, []);

  const goToPage = useCallback((next: number) => {
    setPage(Math.max(1, next));

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById('forum-thread-list')?.scrollIntoView({ block: 'start' });
    });
  }, []);

  const handlePerPageChange = useCallback((next: number) => {
    setPerPage(next);
    setPage(1);
  }, []);

  /** A panel's own key opens it, and a second press on that key closes it again. */
  const toggleMenu = useCallback((next: BoardMenu) => {
    setMenu((current) => (current === next ? null : next));
  }, []);

  /** The whole tag index is a window of its own: the panel folds away as it opens. */
  const openTagIndex = useCallback(() => {
    setMenu(null);
    setTagWindowOpen(true);
  }, []);

  // A panel also closes the way the Start menu does (./StartMenu.tsx): on ESC, or on a press anywhere
  // outside the row it hangs from. Each panel is written straight after its key, so the Tab key reaches
  // it next (it is drawn absolutely, under the whole row, so where it sits in the markup moves nothing). `pointerdown` rather than `mousedown`, so a tap on a phone counts.
  useEffect(() => {
    if (menu === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenu(null);
      // Back to the key that opened it, so a keyboard reader is where they were rather than at the top.
      (menu === 'tags' ? tagsKeyRef : controlsKeyRef).current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (controlsRef.current !== null && !controlsRef.current.contains(event.target as Node)) setMenu(null);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menu]);

  const handleToggle = useCallback(
    (threadId: string, open: boolean) => {
      // Opening a post is reading it: the row goes quiet from here on, and any reply filed after this
      // instant stays white on it (`app/lib/forum/read-state.ts`). Closing marks nothing.
      if (open) markThreadRead(threadId);

      setOpenThreadIds((current) => {
        if (open) return current.includes(threadId) ? current : [...current, threadId];
        return current.filter((id) => id !== threadId);
      });
    },
    [markThreadRead],
  );

  /**
   * A tile's `[ OPEN THE POST ]`: the board goes back to the feed with that post open.
   *
   * Two frames, and for the same reason the tag filter's `[ OPEN THE REPLY ]` waits for two
   * (`./ForumThreadCard.tsx`): the first lets the board re-render with the row open, and by the
   * second the row is in the document to scroll to. Without the pair the scroll happens against a
   * tile that is no longer there.
   */
  const openFromGallery = useCallback(
    (threadId: string) => {
      setView('feed');
      markThreadRead(threadId);
      setOpenThreadIds((current) => (current.includes(threadId) ? current : [...current, threadId]));

      if (typeof window === 'undefined') return;

      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() =>
          document.getElementById(threadDomId(threadId))?.scrollIntoView({ block: 'center' }),
        ),
      );
    },
    [markThreadRead],
  );

  const handleView = useCallback((next: BoardView) => {
    setView(next);
    setPage(1);
  }, []);

  const handleCreated = useCallback(
    (thread: ForumThread) => {
      setComposerOpen(false);
      setPage(1);
      // The reader has just written it, so it is read by definition.
      markThreadRead(thread.id);
      setOpenThreadIds((current) => (current.includes(thread.id) ? current : [...current, thread.id]));
      setSortMode('newest');
      setSourceFilter('all');
      setTagFilters([]);
      setQuery('');

      if (typeof window === 'undefined') return;
      window.requestAnimationFrame(() => {
        document.getElementById(threadDomId(thread.id))?.scrollIntoView({ block: 'center' });
      });
    },
    [markThreadRead],
  );

  const handleReset = useCallback(() => {
    void clearLocalPosts();
    setOpenThreadIds([]);
    setPage(1);
  }, [clearLocalPosts]);

  // Deep links: `#thread-<id>` opens a thread, `#tag-<key>` filters the board by
  // a tag badge. Runs through requestAnimationFrame so the board never calls
  // setState synchronously inside the effect body.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyHash = () => {
      const hash = window.location.hash;

      if (hash.startsWith('#tag-')) {
        const key = decodeURIComponent(hash.slice('#tag-'.length));
        setTagFilters((current) => (current.includes(key) ? current : [...current, key]));
        setPage(1);
        return;
      }

      if (!hash.startsWith('#thread-')) return;

      const id = hash.slice('#thread-'.length);
      // A link that opens a post is a reader arriving at it, so it is read the same way a click is.
      markThreadRead(id);
      setOpenThreadIds((current) => (current.includes(id) ? current : [...current, id]));
      document.getElementById(threadDomId(id))?.scrollIntoView({ block: 'center' });
    };

    const frame = window.requestAnimationFrame(applyHash);
    window.addEventListener('hashchange', applyHash);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', applyHash);
    };
  }, [markThreadRead]);

  return (
    <div className="space-y-3">
      {/* The wire: the board as one line that crawls past. It is the shape this page can
          afford - a strip across the window - and it reads the same rows the profile
          threads read, so a post or a reply looks like a comment looks. A pinned post leads
          it, which is how the announcement is seen without anybody opening it - and with
          nothing pinned it is not drawn at all (./NewsTicker.tsx). */}
      <NewsTicker />

      {/* The moderators' panel: what is pinned, by whom, and for how much longer. Drawn for
          the house account alone - everybody else sees the pins themselves. */}
      <ForumPinPanel />

      {/* The board's one row of controls: how it is read, what it is narrowed to, and the one main key.
          Everything else the board used to say above its first post - its own title, the counts, who
          is posting, how to pick tags - went, or moved into the two panels and the tips
          (SPEC-efficiency.md), so that on a phone the first post is on the first screen. The row wraps
          at phone width; `ml-auto` keeps `+ NEW POST` at the right end of whichever line it lands on. */}
      <div ref={controlsRef} className="relative flex flex-wrap items-center gap-2 text-label text-ink">
        {/* How the board is read: two plates, and the one you are standing on is pressed in
            (`PLATE_PRESSED`), which is the same way every other switch on the site says "on". The
            label is a word rather than an icon, because a pair of glyphs is a puzzle. */}
        <span className="flex items-center gap-1">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleView(option.value)}
              aria-pressed={view === option.value}
              title={option.title}
              className={view === option.value ? PLATE_PRESSED : PLATE}
            >
              {option.label}
            </button>
          ))}
        </span>

        <button
          type="button"
          ref={tagsKeyRef}
          onClick={() => toggleMenu('tags')}
          aria-expanded={menu === 'tags'}
          aria-controls="board-tags-panel"
          title="Pick tags to filter the board, or click a badge on any post to add it here"
          className={PLATE}
        >
          {menu === 'tags' ? '[ TAGS ▴ ]' : '[ TAGS ▾ ]'}
        </button>

        {/* Tag inclusion: one ranked list, most used first, with the whole index - and the board's
            music - one key away (./TagWindow.tsx). The ranking is the only order offered: what a
            board's tags are *for* is telling you what is on it, and that is a count. */}
        {menu === 'tags' ? (
          <div id="board-tags-panel" className={MENU_PANEL}>
            {/* The wall scrolls inside the panel, so a hundred chips never make the panel taller
                than the screen it opened on. */}
            <div className="flex max-h-72 flex-wrap gap-x-3 gap-y-0.75 overflow-y-auto">
              {forum.tagVocabulary.map((option) => {
                const tag = makeUserTag(option.label, option.colour);
                const active = tagFilters.includes(option.key);

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleTagFilter(option.key)}
                    aria-pressed={active}
                    title={
                      active
                        ? `Stop including ${option.label}`
                        : `Include posts tagged ${option.label} (${option.count} in use)`
                    }
                    className={`inline-flex cursor-pointer items-center gap-0.75 px-1 font-bold max-sm:min-h-tap max-sm:px-2 max-sm:text-sm ${
                      active ? 'bg-ena text-ink-bar' : 'text-ink hover:underline'
                    }`}
                  >
                    <TagMark colour={tagMarkColour(tag)} compact />
                    {option.key}
                    {option.count > 0 ? (
                      <span className={active ? 'text-ink' : 'text-ink'}>({option.count})</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 font-bold">
              <button
                type="button"
                onClick={openTagIndex}
                title="Every tag the board has, ranked, with the music filed on it"
                className={PLATE}
              >
                [ TAG INDEX... ]
              </button>

              {/* How picked tags combine, and the way to drop them all: only worth saying once
                  something is picked. */}
              {tagFilters.length === 0 ? null : (
                <>
                  <span>MATCH:</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="tag-match"
                      value="any"
                      checked={tagMatchMode === 'any'}
                      onChange={() => {
                        setTagMatchMode('any');
                        setPage(1);
                      }}
                    />
                    ANY
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="tag-match"
                      value="all"
                      checked={tagMatchMode === 'all'}
                      onChange={() => {
                        setTagMatchMode('all');
                        setPage(1);
                      }}
                    />
                    ALL
                  </label>

                  <button type="button" onClick={clearTagFilters} className={PLATE}>
                    [ CLEAR TAGS ]
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          ref={controlsKeyRef}
          onClick={() => toggleMenu('controls')}
          aria-expanded={menu === 'controls'}
          aria-controls="board-controls-panel"
          title="Sort the board, narrow it to one source, search it, or change how many posts a page holds"
          className={PLATE}
        >
          {menu === 'controls' ? '[ SORT / SEARCH ▴ ]' : '[ SORT / SEARCH ▾ ]'}
        </button>

        {/* Sort / source / search, and how many posts a page holds: folded away by default, because
            the posts themselves are the practical information on this page. */}
        {menu === 'controls' ? (
          <div id="board-controls-panel" className={`${MENU_PANEL} grid gap-3 sm:grid-cols-2`}>
            <fieldset>
              <legend className="px-1 text-label font-bold text-ink">SORT THREADS</legend>
              <label className="flex items-center gap-2 text-label font-bold text-ink">
                <input
                  type="radio"
                  name="forum-sort"
                  value="newest"
                  checked={sortMode === 'newest'}
                  onChange={() => {
                    setSortMode('newest');
                    setPage(1);
                  }}
                />
                NEWEST FIRST
              </label>
              <label className="mt-1 flex items-center gap-2 text-label font-bold text-ink">
                <input
                  type="radio"
                  name="forum-sort"
                  value="replies"
                  checked={sortMode === 'replies'}
                  onChange={() => {
                    setSortMode('replies');
                    setPage(1);
                  }}
                />
                MOST REPLIES
              </label>
              <label className="mt-1 flex items-center gap-2 text-label font-bold text-ink">
                <input
                  type="radio"
                  name="forum-sort"
                  value="tags"
                  checked={sortMode === 'tags'}
                  onChange={() => {
                    setSortMode('tags');
                    setPage(1);
                  }}
                />
                MOST SELECTED TAGS
              </label>
            </fieldset>

            <div>
              <label htmlFor="forum-source-filter" className="block text-label font-bold text-ink">
                FILTER SOURCE:
              </label>
              <select
                id="forum-source-filter"
                value={sourceFilter}
                onChange={(event) => {
                  setSourceFilter(event.target.value as SourceFilter);
                  setPage(1);
                }}
                className="mt-1 w-full frame bg-paper p-2 font-mono text-prose text-ink outline-none"
              >
                {SOURCE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="forum-search" className="block text-label font-bold text-ink">
                SEARCH TITLE / BODY / TAG / ACCOUNT:
              </label>
              <input
                id="forum-search"
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="e.g. LORE, spoiler, account name"
                className="mt-1 w-full frame bg-paper p-2 font-mono text-prose text-ink outline-none"
              />
            </div>

            <div>
              <label htmlFor="forum-per-page" className="block text-label font-bold text-ink">
                POSTS PER PAGE:
              </label>
              <select
                id="forum-per-page"
                value={perPage}
                onChange={(event) => handlePerPageChange(Number(event.target.value))}
                className="mt-1 w-full frame bg-paper p-2 font-mono text-prose text-ink outline-none"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            {/* The mock store's housekeeping: never drawn on the live board. */}
            {forum.source === 'mock' ? (
              <div>
                <button type="button" onClick={handleReset} className={PLATE}>
                  [ PURGE LOCAL POSTS ]
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Said only while it is true: a board that has synced says nothing about it. */}
        {forum.ready ? null : <span>SYNCING...</span>}
        {forum.loadError ? <span className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{forum.loadError}</span> : null}

        <button
          type="button"
          onClick={() => {
            setMenu(null);
            setComposerOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={composerOpen}
          title="Open the composer window to file a new thread"
          className={`${PLATE_MAIN} ml-auto`}
        >
          + NEW POST
        </button>
      </div>

      {/* What the board is narrowed to, after the row: each picked tag as a key that drops it, and the
          music filters the tag index can set. Drawn only while something is picked. */}
      {tagFilters.length === 0 && !musicOnly && musicTagKeys.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
          {tagFilters.map((key) => {
            const label =
              forum.tagVocabulary.find((option) => option.key === key)?.label ?? key.toUpperCase();

            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleTagFilter(key)}
                title={`Stop including ${label}`}
                className={PLATE}
              >
                [ {label} × ]
              </button>
            );
          })}

          {musicOnly ? (
            <span className="border border-ink-plate bg-ena px-1 text-label font-bold text-ink-bar">MUSIC ONLY</span>
          ) : null}
          {musicTagKeys.length === 0 ? null : (
            <span className="border border-ink-plate bg-bubble-pale px-1 text-label font-bold text-ink-bar">
              {musicTagKeys.length} MUSIC TAG(S)
            </span>
          )}
        </div>
      )}

      {visibleThreads.length === 0 ? (
        <div
          id="forum-thread-list"
          className="text-ink"
        >
          <p className="p-3 text-key font-bold text-ink">
            {forum.threads.length === 0
              ? 'THE BOARD IS EMPTY. USE + NEW POST ABOVE TO FILE THE FIRST THREAD, OR COMMENT ON A PIECE IN THE CONCEPT ARCHIVE.'
              : view === 'gallery'
                ? 'NO POST WITH A PICTURE MATCHES THIS FILTER. THE GALLERY SHOWS THE POSTS SOMEBODY FILED A DRAWING WITH.'
                : 'NO THREADS MATCH THIS FILTER.'}
          </p>
        </div>
      ) : view === 'gallery' ? (
        /* The wall of pictures. The tiles are the same posts the feed draws, already open - and
           drawn in the same reading state, from the same marks. */
        <ForumGalleryView
          threads={pageThreads}
          onOpen={openFromGallery}
          tagFilter={tagFilters}
          seenByThread={forum.seenByThread}
        />
      ) : (
        <div
          id="forum-thread-list"
          className="text-ink"
        >
          {pageThreads.map((thread) => (
            <ForumThreadCard
              key={thread.id}
              thread={thread}
              isOpen={openThreadIds.includes(thread.id)}
              tagFilter={tagFilters}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* The foot: one readout, `[ < ] 1-5 OF 7 [ > ]` - which posts these are, of how many match,
          and the way to either side. A key per page joins it only past five pages, where the arrows
          stop being a short walk; how many posts a page holds is in the sort / search panel. */}
      {visibleThreads.length === 0 ? null : (
        <nav aria-label="Board pages" className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="Previous page"
            className={PLATE}
          >
            [ &lt; ]
          </button>

          <span>{`${pageStart + 1}-${pageStart + pageThreads.length} OF ${visibleThreads.length}`}</span>

          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            aria-label="Next page"
            className={PLATE}
          >
            [ &gt; ]
          </button>

          {totalPages > NUMBERED_PAGES_AFTER
            ? pageNumbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  onClick={() => goToPage(number)}
                  aria-current={number === currentPage ? 'page' : undefined}
                  className={number === currentPage ? PLATE_PRESSED : PLATE}
                >
                  {`[ ${number} ]`}
                </button>
              ))
            : null}
        </nav>
      )}

      {/* Composer only appears when asked for */}
      {composerOpen ? (
        <NewPostForm onClose={() => setComposerOpen(false)} onCreated={handleCreated} />
      ) : null}

      {/* The whole tag index, and the board's music, in a window of its own (`[ TAG INDEX... ]` in the
          tag panel). It sets the same filter the panel does - one state, two places to reach it from. */}
      {tagWindowOpen ? (
        <TagWindow
          onClose={() => setTagWindowOpen(false)}
          tagKeys={tagFilters}
          onToggleTag={toggleTagFilter}
          onClearTags={clearTagFilters}
          matchMode={tagMatchMode}
          onMatchMode={setTagMatchMode}
          musicOnly={musicOnly}
          onMusicOnly={handleMusicOnly}
          musicTagKeys={musicTagKeys}
          onToggleMusicTag={toggleMusicTag}
          showing={visibleThreads.length}
          total={forum.threads.length}
        />
      ) : null}
    </div>
  );
}

