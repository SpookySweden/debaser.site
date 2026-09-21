'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authorTag } from '../lib/auth/author';
import { threadDomId } from '../lib/forum/anchors';
import type { ForumAnchorKind, ForumTag, ForumThread } from '../lib/forum/types';
import ForumThreadCard from './ForumThreadCard';
import NewPostForm from './NewPostForm';
import { useForum } from './ForumProvider';
import { TagRow } from './TagBadge';

type SortMode = 'newest' | 'replies';
type SourceFilter = 'all' | ForumAnchorKind;

const TAG_LEGEND: ForumTag[] = [
  { id: 'legend-source', kind: 'source', label: 'SOURCE' },
  { id: 'legend-category', kind: 'category', label: 'CATEGORY' },
  { id: 'legend-content', kind: 'content', label: 'CONTENT' },
];

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'ALL SOURCES' },
  { value: 'board', label: 'BOARD THREADS' },
  { value: 'asset', label: 'ASSET THREADS' },
  { value: 'text-box', label: 'TEXT BOX THREADS' },
];

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
  const [openThreadIds, setOpenThreadIds] = useState<string[]>(() => {
    const newest = forum.threads[0];
    return newest === undefined ? [] : [newest.id];
  });

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = forum.threads.filter((thread) => {
      if (sourceFilter !== 'all' && thread.anchor.kind !== sourceFilter) return false;
      if (needle.length === 0) return true;

      return (
        thread.title.toLowerCase().includes(needle) ||
        thread.body.toLowerCase().includes(needle) ||
        thread.anchor.label.toLowerCase().includes(needle) ||
        thread.tags.some((tag) => tag.label.toLowerCase().includes(needle))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'replies' && b.comments.length !== a.comments.length) {
        return b.comments.length - a.comments.length;
      }
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [forum.threads, query, sourceFilter, sortMode]);

  const totalReplies = useMemo(
    () => forum.threads.reduce((sum, thread) => sum + thread.comments.length, 0),
    [forum.threads],
  );
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
    setOpenThreadIds(visibleThreads.map((thread) => thread.id));
  }, [visibleThreads]);

  const handleCollapseAll = useCallback(() => {
    setOpenThreadIds([]);
  }, []);

  const handleCreated = useCallback((thread: ForumThread) => {
    setOpenThreadIds((current) => (current.includes(thread.id) ? current : [...current, thread.id]));
    setSortMode('newest');
    setSourceFilter('all');
    setQuery('');

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById(threadDomId(thread.id))?.scrollIntoView({ block: 'center' });
    });
  }, []);

  const handleReset = useCallback(() => {
    void clearLocalPosts();
    setOpenThreadIds([]);
  }, [clearLocalPosts]);

  // Deep link support for `#thread-<id>` links posted by the asset comment boxes.
  // Runs through requestAnimationFrame so the board never calls setState
  // synchronously inside the effect body.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const openThreadFromHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#thread-')) return;

      const id = hash.slice('#thread-'.length);
      setOpenThreadIds((current) => (current.includes(id) ? current : [...current, id]));
      document.getElementById(threadDomId(id))?.scrollIntoView({ block: 'center' });
    };

    const frame = window.requestAnimationFrame(openThreadFromHash);
    window.addEventListener('hashchange', openThreadFromHash);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', openThreadFromHash);
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* Board status window */}
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>FORUM BOARD // ANONYMOUS POSTING ENABLED</span>
          <span>{forum.ready ? '[ SYNCED ]' : '[ SYNCING... ]'}</span>
        </div>

        <div className="space-y-2 p-3 text-[10px] font-bold text-black">
          <p>
            THREADS: {forum.threads.length} :: REPLIES: {totalReplies} :: FILED IN THIS BROWSER: {localThreads}
          </p>
          <p>
            DATA SOURCE:{' '}
            {forum.source === 'mock'
              ? 'MOCK CLIENT (LOCAL STORAGE) - SWAP TO SUPABASE IN app/lib/forum/repository.ts'
              : 'SUPABASE (forum_threads / forum_comments)'}
          </p>
          <p>POSTING AS: {authorTag(forum.author)}</p>

          <div className="flex flex-wrap items-center gap-2">
            <span>TAG KINDS:</span>
            <TagRow tags={TAG_LEGEND} />
            <span>(every badge is generated automatically from the post text)</span>
          </div>

          {forum.source === 'mock' ? (
            <button
              type="button"
              onClick={handleReset}
              className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold hover:bg-gray-300"
            >
              [ PURGE LOCAL POSTS ]
            </button>
          ) : null}
        </div>
      </section>

      {/* Controls */}
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <fieldset className="rounded-none border border-gray-600 p-2">
            <legend className="px-1 text-[10px] font-bold text-black">SORT THREADS</legend>
            <label className="flex items-center gap-2 text-[10px] font-bold text-black">
              <input
                type="radio"
                name="forum-sort"
                value="newest"
                checked={sortMode === 'newest'}
                onChange={() => setSortMode('newest')}
              />
              NEWEST FIRST
            </label>
            <label className="mt-1 flex items-center gap-2 text-[10px] font-bold text-black">
              <input
                type="radio"
                name="forum-sort"
                value="replies"
                checked={sortMode === 'replies'}
                onChange={() => setSortMode('replies')}
              />
              MOST REPLIES
            </label>
          </fieldset>

          <div>
            <label htmlFor="forum-source-filter" className="block text-[10px] font-bold text-black">
              FILTER SOURCE:
            </label>
            <select
              id="forum-source-filter"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
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
              SEARCH TITLE / BODY / TAG:
            </label>
            <input
              id="forum-search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. LORE, foundry, spoiler"
              className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExpandAll}
            className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold hover:bg-gray-300"
          >
            [ EXPAND ALL ]
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold hover:bg-gray-300"
          >
            [ COLLAPSE ALL ]
          </button>
          <span className="text-[10px] font-bold text-black">
            SHOWING {visibleThreads.length} OF {forum.threads.length} THREADS
          </span>
        </div>
      </section>

      <NewPostForm onCreated={handleCreated} />

      {visibleThreads.length === 0 ? (
        <p className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-3 text-xs font-bold text-black">
          NO THREADS MATCH THIS FILTER.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleThreads.map((thread, index) => (
            <ForumThreadCard
              key={thread.id}
              thread={thread}
              position={index + 1}
              isOpen={openThreadIds.includes(thread.id)}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
