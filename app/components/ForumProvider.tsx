'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authorFromAccount } from '../lib/auth/author';
import { getForumRepository } from '../lib/forum/repository';
import { pinForThread as livePinForThread } from '../lib/forum/pins';
import { readTagColours, rememberTagColour as rememberTagColourInStore } from '../lib/forum/tag-colours';
import { buildTagVocabulary, canonicalTagLabel, type TagOption } from '../lib/forum/tag-vocabulary';
import type {
  AddCommentResult,
  CommentPatch,
  ForumAnchor,
  ForumAuthor,
  ForumDataSource,
  ForumPreview,
  ForumRepository,
  ForumThread,
  ForumTrack,
  PinDurationKey,
  ThreadPatch,
  ThreadPin,
} from '../lib/forum/types';
import { useAuth } from './AuthProvider';

export type CreateThreadRequest = {
  title: string;
  body: string;
  anchor: ForumAnchor;
  /** Tags chosen in the colour coded chooser. */
  userTags?: string[];
  /** Artwork attached to a general board post. */
  media?: ForumPreview;
  /** The MP3 filed with the post. */
  track?: ForumTrack;
};

export type AddCommentRequest = {
  body: string;
  /** Reply onto an existing thread... */
  threadId?: string;
  /** ...or file against an asset / text box (creates its thread when missing). */
  anchor?: ForumAnchor;
  /** Reply to an existing comment instead of the post itself. */
  parentId?: string;
  /** Tags chosen in the colour coded chooser. */
  userTags?: string[];
  /** Artwork attached to this reply. */
  media?: ForumPreview;
  /** The MP3 filed with this reply. */
  track?: ForumTrack;
};

export type ForumContextValue = {
  threads: ForumThread[];
  /**
   * The pins, newest first, lapsed ones included.
   *
   * Read with the board and updated in the same way, so a pin taken on one screen is at the top
   * of the board on every other. Screens ask `pinForThread` / `livePins` (app/lib/forum/pins.ts)
   * rather than reading this list directly, because a lapsed pin is still *in* the list - it is
   * history - while it is no longer doing anything.
   */
  pins: ThreadPin[];
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
  /**
   * Moderation, for the author and for the house account.
   *
   * A single write each: the repository hands back the changed thread and the
   * realtime subscription redraws the board, so there is nothing to keep in step
   * here. Who may make them is the database's business (see
   * app/lib/forum/types.ts).
   */
  updateThread: (threadId: string, patch: ThreadPatch) => Promise<ForumThread>;
  deleteThread: (threadId: string) => Promise<void>;
  updateComment: (commentId: string, patch: CommentPatch) => Promise<ForumThread>;
  deleteComment: (commentId: string) => Promise<void>;
  /**
   * Pinning, for the house account alone.
   *
   * The board's way of saying "read this one": a pinned post sits at the top of the list and
   * leads the wire, for a set time or forever. Both stores refuse anybody but the moderator, and
   * the database refuses again - so this pair is only what the screen calls, not what decides.
   */
  pinThread: (threadId: string, duration: PinDurationKey) => Promise<void>;
  unpinThread: (threadId: string) => Promise<void>;
  /** The live pin on that post, if a moderator has one on it. */
  pinForThread: (threadId: string) => ThreadPin | undefined;
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
  const { user } = useAuth();
  // Signed in, a post is filed under the account id (auth.users.id on the
  // Supabase backend); signed out it stays Anonymous with a null id.
  const author = useMemo(() => authorFromAccount(user), [user]);
  const repositoryRef = useRef<ForumRepository | null>(null);
  // The board starts empty and fills from the repository on mount, so the
  // server render and the first client pass agree and no placeholder posts ever
  // appear.
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [pins, setPins] = useState<ThreadPin[]>([]);
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

    // The pins come in beside the board: the same read, the same failure policy (a board that
    // cannot be read is not made worse by an empty list of pins).
    void repository
      .listPins()
      .then((next) => {
        if (!cancelled) setPins(next);
      })
      .catch(() => undefined);

    const unsubscribe = repository.subscribe((next) => {
      if (!cancelled) setThreads(next);
    });

    const unsubscribePins = repository.subscribePins((next) => {
      if (!cancelled) setPins(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribePins();
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
        track: request.track,
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
        parentId: request.parentId,
        userTags: canonicaliseUserTags(request.userTags),
        media: request.media,
        track: request.track,
      });
    },
    [author, canonicaliseUserTags],
  );

  const updateThread = useCallback(async (threadId: string, patch: ThreadPatch) => {
    const repository = repositoryRef.current ?? getForumRepository();
    const thread = await repository.updateThread(threadId, patch);
    setThreads((current) => current.map((item) => (item.id === thread.id ? thread : item)));
    return thread;
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    const repository = repositoryRef.current ?? getForumRepository();
    await repository.deleteThread(threadId);
    setThreads((current) => current.filter((item) => item.id !== threadId));
  }, []);

  const updateComment = useCallback(async (commentId: string, patch: CommentPatch) => {
    const repository = repositoryRef.current ?? getForumRepository();
    const thread = await repository.updateComment(commentId, patch);
    setThreads((current) => current.map((item) => (item.id === thread.id ? thread : item)));
    return thread;
  }, []);

  const deleteComment = useCallback(async (commentId: string) => {
    const repository = repositoryRef.current ?? getForumRepository();
    await repository.deleteComment(commentId);
    // The replies that answered it went too, so the board is re-read rather than
    // patched by hand.
    setThreads(await repository.listThreads());
  }, []);

  /**
   * Pinning, as the moderator's request. The store checks who is asking and the database checks
   * again, so nothing here decides anything - it only files the ask and keeps what comes back.
   */
  const pinThread = useCallback(
    async (threadId: string, duration: PinDurationKey) => {
      const repository = repositoryRef.current ?? getForumRepository();
      setPins(await repository.pinThread({ threadId, duration, moderator: author }));
    },
    [author],
  );

  const unpinThread = useCallback(async (threadId: string) => {
    const repository = repositoryRef.current ?? getForumRepository();
    setPins(await repository.unpinThread(threadId));
  }, []);

  const pinForThread = useCallback((threadId: string) => livePinForThread(pins, threadId), [pins]);

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
      pins,
      author,
      source,
      ready,
      tagVocabulary,
      tagColours,
      rememberTagColour,
      createThread,
      addComment,
      updateThread,
      deleteThread,
      updateComment,
      deleteComment,
      pinThread,
      unpinThread,
      pinForThread,
      threadForAnchor,
      commentCountForAnchor,
      clearLocalPosts,
    }),
    [
      threads,
      pins,
      author,
      source,
      ready,
      tagVocabulary,
      tagColours,
      rememberTagColour,
      createThread,
      addComment,
      updateThread,
      deleteThread,
      updateComment,
      deleteComment,
      pinThread,
      unpinThread,
      pinForThread,
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
