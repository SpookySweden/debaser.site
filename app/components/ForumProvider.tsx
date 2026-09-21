'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAuthor } from '../lib/auth/use-current-author';
import { getForumRepository } from '../lib/forum/repository';
import { SEED_THREADS } from '../lib/forum/seed';
import type {
  AddCommentResult,
  ForumAnchor,
  ForumAuthor,
  ForumDataSource,
  ForumRepository,
  ForumThread,
} from '../lib/forum/types';

export type CreateThreadRequest = {
  title: string;
  body: string;
  anchor: ForumAnchor;
};

export type AddCommentRequest = {
  body: string;
  /** Reply onto an existing thread... */
  threadId?: string;
  /** ...or file against an asset / text box (creates its thread when missing). */
  anchor?: ForumAnchor;
};

export type ForumContextValue = {
  threads: ForumThread[];
  author: ForumAuthor;
  source: ForumDataSource;
  ready: boolean;
  createThread: (request: CreateThreadRequest) => Promise<ForumThread>;
  addComment: (request: AddCommentRequest) => Promise<AddCommentResult>;
  threadForAnchor: (anchor: ForumAnchor) => ForumThread | undefined;
  commentCountForAnchor: (anchor: ForumAnchor) => number;
  clearLocalPosts: () => Promise<void>;
};

const ForumContext = createContext<ForumContextValue | null>(null);

/**
 * Board state for the whole site.
 *
 * The provider is mounted in `app/layout.tsx`, so every comment box (home page,
 * concepts page, forum page) reads and writes the same list through the
 * repository - that is what lets a comment under an asset show up as a thread
 * on /forum. Swapping `FORUM_DATA_SOURCE` to Supabase changes nothing here: the
 * initial fetch and the realtime subscription already go through the interface.
 */
export default function ForumProvider({ children }: { children: React.ReactNode }) {
  const author = useCurrentAuthor();
  const repositoryRef = useRef<ForumRepository | null>(null);
  // Seeded rows render identically on the server and on the first client pass,
  // so hydration is clean; localStorage rows arrive in the effect below.
  const [threads, setThreads] = useState<ForumThread[]>(SEED_THREADS);
  const [ready, setReady] = useState(false);
  const [source] = useState<ForumDataSource>(() => getForumRepository().source);

  useEffect(() => {
    const repository = getForumRepository();
    repositoryRef.current = repository;
    let cancelled = false;

    void repository
      .listThreads()
      .then((next) => {
        if (cancelled) return;
        setThreads(next);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const unsubscribe = repository.subscribe((next) => {
      if (!cancelled) setThreads(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const createThread = useCallback(
    async (request: CreateThreadRequest) => {
      const repository = repositoryRef.current ?? getForumRepository();
      return repository.createThread({
        title: request.title.trim(),
        body: request.body.trim(),
        anchor: request.anchor,
        author,
      });
    },
    [author],
  );

  const addComment = useCallback(
    async (request: AddCommentRequest) => {
      const repository = repositoryRef.current ?? getForumRepository();
      return repository.addComment({
        body: request.body.trim(),
        author,
        threadId: request.threadId,
        anchor: request.anchor,
      });
    },
    [author],
  );

  const threadForAnchor = useCallback(
    (anchor: ForumAnchor) =>
      threads.find((thread) => thread.anchor.kind === anchor.kind && thread.anchor.id === anchor.id),
    [threads],
  );

  const commentCountForAnchor = useCallback(
    (anchor: ForumAnchor) => threadForAnchor(anchor)?.comments.length ?? 0,
    [threadForAnchor],
  );

  const clearLocalPosts = useCallback(async () => {
    const repository = repositoryRef.current ?? getForumRepository();
    await repository.clearLocalPosts?.();
    setThreads(await repository.listThreads());
  }, []);

  const value = useMemo<ForumContextValue>(
    () => ({
      threads,
      author,
      source,
      ready,
      createThread,
      addComment,
      threadForAnchor,
      commentCountForAnchor,
      clearLocalPosts,
    }),
    [threads, author, source, ready, createThread, addComment, threadForAnchor, commentCountForAnchor, clearLocalPosts],
  );

  return <ForumContext.Provider value={value}>{children}</ForumContext.Provider>;
}

export function useForum(): ForumContextValue {
  const value = useContext(ForumContext);
  if (value === null) throw new Error('useForum must be used inside <ForumProvider>.');
  return value;
}
