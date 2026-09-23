'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authorTag } from '../lib/auth/author';
import { threadDomId } from '../lib/forum/anchors';
import { selectBoardThreads, type SortMode, type SourceFilter, type TagMatchMode } from '../lib/forum/board-query';
import { paginate } from '../lib/forum/paging';
import { sortThreadsPinnedFirst } from '../lib/forum/pins';
import { groupByNamespace, makeUserTag } from '../lib/forum/tag-vocabulary';
import type { ForumThread } from '../lib/forum/types';
import ForumThreadCard from './ForumThreadCard';
import ForumPinPanel from './ForumPinPanel';
import NewsTicker from './NewsTicker';
import NewPostForm from './NewPostForm';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import { useForum } from './ForumProvider';
import { TagMark, tagMarkColour } from './TagBadge';
import { PANEL, PLATE, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'ALL SOURCES' },
  { value: 'board', label: 'BOARD THREADS' },
  { value: 'asset', label: 'ASSET THREADS' },
  { value: 'text-box', label: 'TEXT BOX THREADS' },
];

/** Posts-per-page choices offered at the foot of the board. */
const PAGE_SIZES = [5, 10, 20, 50];

/**
 * The board itself: status window, filters, composer and the collapsible
 * thread list. All state lives in ForumProvider, so a comment filed from the
 * home page or the concepts archive lands here without a reload.
 */
export default function ForumBoard() {
  const forum = useForum();
  const clearLocalPosts = forum.clearLocalPosts;

  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [query, setQuery] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>('any');
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
        }),
        forum.pins,
      ),
    [forum.threads, forum.pins, query, sourceFilter, tagFilters, tagMatchMode, sortMode],
  );

  const totalReplies = useMemo(
    () => forum.threads.reduce((sum, thread) => sum + thread.comments.length, 0),
    [forum.threads],
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
  const localThreads = useMemo(
    () => forum.threads.filter((thread) => thread.origin === 'user').length,
    [forum.threads],
  );

  const handleToggle = useCallback((threadId: string, open: boolean) => {
    setOpenThreadIds((current) => {
      if (open) return current.includes(threadId) ? current : [...current, threadId];
      return current.filter((id) => id !== threadId);
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setOpenThreadIds(pageThreads.map((thread) => thread.id));
  }, [pageThreads]);

  const handleCollapseAll = useCallback(() => {
    setOpenThreadIds([]);
  }, []);

  const handleCreated = useCallback((thread: ForumThread) => {
    setComposerOpen(false);
    setPage(1);
    setOpenThreadIds((current) => (current.includes(thread.id) ? current : [...current, thread.id]));
    setSortMode('newest');
    setSourceFilter('all');
    setTagFilters([]);
    setQuery('');

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById(threadDomId(thread.id))?.scrollIntoView({ block: 'center' });
    });
  }, []);

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
      setOpenThreadIds((current) => (current.includes(id) ? current : [...current, id]));
      document.getElementById(threadDomId(id))?.scrollIntoView({ block: 'center' });
    };

    const frame = window.requestAnimationFrame(applyHash);
    window.addEventListener('hashchange', applyHash);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', applyHash);
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* The wire: the board as one line that crawls past. It is the shape this page can
          afford - a strip across the window - and it reads the same rows the profile
          threads read, so a post or a reply looks like a comment looks. A pinned post leads
          it, which is how the announcement is seen without anybody opening it. */}
      <NewsTicker />

      {/* The moderators' panel: what is pinned, by whom, and for how much longer. Drawn for
          the house account alone - everybody else sees the pins themselves. */}
      <ForumPinPanel />

      {/* Board status window */}
      <section className={PANEL}>
        <div className={TITLE_BAR}>
          <span className="truncate">FORUM BOARD // ANONYMOUS POSTING ENABLED</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={composerOpen}
              title="Open the composer window to file a new thread"
              className={TITLE_BAR_BUTTON}
            >
              + NEW POST...
            </button>
            <span>{forum.ready ? '[ SYNCED ]' : '[ SYNCING... ]'}</span>
          </span>
        </div>

        <div className="space-y-1.5 p-2 text-[10px] font-bold text-black">
          {/* One compact status line instead of a paragraph of housekeeping. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              POSTS: {forum.threads.length} :: REPLIES: {totalReplies} :: FILED HERE: {localThreads}
            </span>
            <span>
              POSTING AS:{' '}
              <ProfileLink author={forum.author} className="font-bold">
                <ProfileName author={forum.author}>{authorTag(forum.author)}</ProfileName>
              </ProfileLink>
            </span>
          </p>

          {/* Tag inclusion, filed by namespace: toggle tags in, choose ANY/ALL, and the
              "MOST SELECTED TAGS" sort ranks posts by how many they include.

              The list is grouped the way the tags themselves are written (`theme:design`,
              `user:mechanics`) rather than poured into one row of chips: the namespace is what tells
              a reader whether a word is a theme, a warning or something somebody typed, so the
              filter says it too - and a text row per namespace holds more tags in less height than a
              chip did. Selecting one is a Win95 list selection: the navy this site selects in. */}
          <div className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#f0f0f0] p-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[10px] font-bold text-black">TAG FILTER ({tagFilters.length} INCLUDED):</p>
              <p className="text-[10px] text-gray-700">
                THEME = READ FROM THE POST :: WARN = BEFORE YOU OPEN IT :: USER = TYPED BY THE POSTER
              </p>
            </div>

            <div className="mt-1 space-y-[2px]">
              {groupByNamespace(forum.tagVocabulary).map((group) => (
                <div key={group.namespace} className="flex flex-wrap items-baseline gap-x-3 gap-y-[3px] text-[10px]">
                  <span className="w-12 shrink-0 font-bold text-gray-700">{group.namespace}:</span>

                  {group.items.map((option) => {
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
                        className={`inline-flex cursor-pointer items-center gap-[3px] px-1 font-bold max-sm:min-h-11 max-sm:px-2 max-sm:text-sm ${
                          active ? 'bg-[#000080] text-white' : 'text-black hover:underline'
                        }`}
                      >
                        <TagMark colour={tagMarkColour(tag)} compact />
                        {option.key}
                        {option.count > 0 ? (
                          <span className={active ? 'text-gray-300' : 'text-gray-700'}>({option.count})</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {tagFilters.length === 0 ? (
              <p className="mt-1 text-[10px] text-black">
                PICK TAGS ABOVE, OR CLICK A BADGE ON ANY POST TO ADD IT HERE.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
                <span>INCLUDED:</span>
                {tagFilters.map((key) => {
                  const label =
                    forum.tagVocabulary.find((option) => option.key === key)?.label ?? key.toUpperCase();

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleTagFilter(key)}
                      title={`Stop including ${label}`}
                      className="cursor-pointer rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold hover:bg-gray-300"
                    >
                      {label} ×
                    </button>
                  );
                })}

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

                <button
                  type="button"
                  onClick={clearTagFilters}
                  className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold hover:bg-gray-300"
                >
                  [ CLEAR TAGS ]
                </button>
              </div>
            )}
          </div>

          {/* Sort / filter / search / paging are collapsed by default: the posts
              themselves are the practical information on this page. */}
          <details className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#f0f0f0] p-2">
            <summary className="cursor-pointer select-none text-[10px] font-bold text-black">
              [ BOARD CONTROLS ] SORT :: SOURCE :: SEARCH :: PAGING
            </summary>

            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <fieldset className="rounded-none border border-gray-600 p-2">
                <legend className="px-1 text-[10px] font-bold text-black">SORT THREADS</legend>
                <label className="flex items-center gap-2 text-[10px] font-bold text-black">
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
                <label className="mt-1 flex items-center gap-2 text-[10px] font-bold text-black">
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
                <label className="mt-1 flex items-center gap-2 text-[10px] font-bold text-black">
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
                <label htmlFor="forum-source-filter" className="block text-[10px] font-bold text-black">
                  FILTER SOURCE:
                </label>
                <select
                  id="forum-source-filter"
                  value={sourceFilter}
                  onChange={(event) => {
                    setSourceFilter(event.target.value as SourceFilter);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
                >
                  {SOURCE_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="forum-search" className="block text-[10px] font-bold text-black">
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
                  className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
                />
              </div>
            </div>
          </details>
        </div>

        {/* List controls: always on screen, one row above the threads. */}
        <div className="flex flex-wrap items-center gap-2 border-t-2 border-gray-600 bg-[#c0c0c0] px-2 py-[3px]">
          <button
            type="button"
            onClick={handleExpandAll}
            className={PLATE}
          >
            [ EXPAND ALL ]
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className={PLATE}
          >
            [ COLLAPSE ALL ]
          </button>
          <span className="text-[10px] font-bold text-black">
            SHOWING {visibleThreads.length === 0 ? 0 : pageStart + 1}-{pageStart + pageThreads.length} OF{' '}
            {visibleThreads.length} MATCHING ({forum.threads.length} TOTAL)
          </span>
          {forum.source === 'mock' ? (
            <button
              type="button"
              onClick={handleReset}
              className={`${PLATE} ml-auto`}
            >
              [ PURGE LOCAL POSTS ]
            </button>
          ) : null}
        </div>
      </section>

      <div
        id="forum-thread-list"
        className="divide-y divide-gray-300 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white text-black"
      >
        {visibleThreads.length === 0 ? (
          <p className="p-3 text-xs font-bold text-black">
            {forum.threads.length === 0
              ? 'THE BOARD IS EMPTY. USE [+ NEW POST...] ABOVE TO FILE THE FIRST THREAD, OR COMMENT ON A PIECE IN THE CONCEPT ARCHIVE.'
              : 'NO THREADS MATCH THIS FILTER.'}
          </p>
        ) : (
          pageThreads.map((thread) => (
            <ForumThreadCard
              key={thread.id}
              thread={thread}
              isOpen={openThreadIds.includes(thread.id)}
              tagFilter={tagFilters}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>

      {/* Paging controls, at the foot of the board */}
      {visibleThreads.length === 0 ? null : (
        <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-bold text-black">
            <span>
              SHOWING {pageStart + 1}-{pageStart + pageThreads.length} OF {visibleThreads.length} THREADS :: PAGE{' '}
              {currentPage} OF {totalPages}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-1 text-[10px] font-bold hover:bg-gray-300 disabled:cursor-default disabled:opacity-50"
              >
                [ &lt;&lt; PREV ]
              </button>

              <label htmlFor="forum-page">PAGE:</label>
              <select
                id="forum-page"
                value={currentPage}
                onChange={(event) => goToPage(Number(event.target.value))}
                className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none"
              >
                {pageNumbers.map((number) => (
                  <option key={number} value={number}>
                    {number} OF {totalPages}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-1 text-[10px] font-bold hover:bg-gray-300 disabled:cursor-default disabled:opacity-50"
              >
                [ NEXT &gt;&gt; ]
              </button>

              <label htmlFor="forum-per-page">POSTS PER PAGE:</label>
              <select
                id="forum-per-page"
                value={perPage}
                onChange={(event) => handlePerPageChange(Number(event.target.value))}
                className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {totalPages > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {pageNumbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  onClick={() => goToPage(number)}
                  aria-current={number === currentPage ? 'page' : undefined}
                  className={
                    number === currentPage
                      ? 'cursor-pointer rounded-none border-t-2 border-l-2 border-black border-r border-b border-white bg-gray-300 px-2 py-1 text-[10px] font-bold text-black'
                      : 'cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-1 text-[10px] font-bold text-black hover:bg-gray-300'
                  }
                >
                  {number}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {/* Composer only appears when asked for */}
      {composerOpen ? (
        <NewPostForm onClose={() => setComposerOpen(false)} onCreated={handleCreated} />
      ) : null}
    </div>
  );
}
