'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAuthor } from '../lib/auth/use-current-author';
import { getForumRepository } from '../lib/forum/repository';
import { readTagColours, rememberTagColour as rememberTagColourInStore } from '../lib/forum/tag-colours';
import { buildTagVocabulary, canonicalTagLabel, type TagOption } from '../lib/forum/tag-vocabulary';
import type {
  AddCommentResult,
  ForumAnchor,
  ForumAuthor,
  ForumDataSource,
  ForumPreview,
  ForumRepository,
  ForumThread,
} from '../lib/forum/types';

export type CreateThreadRequest = {
  title: string;
  body: string;
  anchor: ForumAnchor;
  /** Tags chosen in the colour coded chooser. */
  userTags?: string[];
  /** Artwork attached to a general board post. */
  media?: ForumPreview;
};

export type AddCommentRequest = {
  body: string;
  /** Reply onto an existing thread... */
  threadId?: string;
  /** ...or file against an asset / text box (creates its thread when missing). */
  anchor?: ForumAnchor;
  /** Tags chosen in the colour coded chooser. */
  userTags?: string[];
  /** Artwork attached to this reply. */
  media?: ForumPreview;
};

export type ForumContextValue = {
  threads: ForumThread[];
  author: ForumAuthor;
  source: ForumDataSource;
  ready: boolean;
  /** Ranked tag options: most used first, starter tags always present. */
  tagVocabulary: TagOption[];
  /** Colours chosen in the tag picker, keyed by canonical tag key. */
  tagColours: Record<string, string>;
  /** Stores a picked colour so the tag always comes back in it. */
  rememberTagColour: (label: string, colour: string) => void;
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
  // The board starts empty and fills from the repository on mount, so the
  // server render and the first client pass agree and no placeholder posts ever
  // appear.
  const [threads, setThreads] = useState<ForumThread[]>([]);
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

  const [tagColours, setTagColours] = useState<Record<string, string>>({});

  // Colours chosen in the tag picker are kept in localStorage; load them once
  // after mount (rAF keeps the setState out of the effect body itself).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTagColours(readTagColours()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const rememberTagColour = useCallback((label: string, colour: string) => {
    rememberTagColourInStore(label, colour);
    setTagColours(readTagColours());
  }, []);

  const tagVocabulary = useMemo(() => buildTagVocabulary(threads, tagColours), [threads, tagColours]);

  /**
   * Folds chosen tags onto labels already in use, so a near-duplicate spelling
   * ("lores") becomes the existing tag ("LORE") and keeps its colour - for the
   * mock board and for Supabase alike, since this runs before the repository.
   */
  const canonicaliseUserTags = useCallback(
    (labels: string[] | undefined) => {
      if (labels === undefined || labels.length === 0) return [];

      const known = tagVocabulary.map((option) => option.label);
      return labels.map((label) => canonicalTagLabel(label, known)).filter((label) => label.length > 0);
    },
    [tagVocabulary],
  );

  const createThread = useCallback(
    async (request: CreateThreadRequest) => {
      const repository = repositoryRef.current ?? getForumRepository();
      return repository.createThread({
        title: request.title.trim(),
        body: request.body.trim(),
        anchor: request.anchor,
        author,
        userTags: canonicaliseUserTags(request.userTags),
        media: request.media,
      });
    },
    [author, canonicaliseUserTags],
  );

  const addComment = useCallback(
    async (request: AddCommentRequest) => {
      const repository = repositoryRef.current ?? getForumRepository();
      return repository.addComment({
        body: request.body.trim(),
        author,
        threadId: request.threadId,
        anchor: request.anchor,
        userTags: canonicaliseUserTags(request.userTags),
        media: request.media,
      });
    },
    [author, canonicaliseUserTags],
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
      tagVocabulary,
      tagColours,
      rememberTagColour,
      createThread,
      addComment,
      threadForAnchor,
      commentCountForAnchor,
      clearLocalPosts,
    }),
    [
      threads,
      author,
      source,
      ready,
      tagVocabulary,
      tagColours,
      rememberTagColour,
      createThread,
      addComment,
      threadForAnchor,
      commentCountForAnchor,
      clearLocalPosts,
    ],
  );

  return <ForumContext.Provider value={value}>{children}</ForumContext.Provider>;
}

export function useForum(): ForumContextValue {
  const value = useContext(ForumContext);
  if (value === null) throw new Error('useForum must be used inside <ForumProvider>.');
  return value;
}
