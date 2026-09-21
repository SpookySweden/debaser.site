/**
 * Domain types for the Debaser forum / message board.
 *
 * These types are deliberately storage agnostic: the mock repository
 * (app/lib/forum/mock-repository.ts) and the Supabase repository
 * (app/lib/forum/supabase-repository.ts) both speak this shape, so swapping the
 * backing store never touches a UI component.
 */

export type ForumDataSource = 'mock' | 'supabase';

export type TagKind = 'category' | 'content' | 'source' | 'user';

/** Retro pill badge rendered next to a post. */
export type ForumTag = {
  id: string;
  kind: TagKind;
  label: string;
  /** Colour chosen in the picker (user tags only); falls back to a palette hash. */
  colour?: string;
};

/** Where a thread came from: the board itself, a hand-drawn asset, or a text box. */
export type ForumAnchorKind = 'board' | 'asset' | 'text-box';

/** Artwork preview shown when hovering a link back to the item. */
export type ForumPreview = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export type ForumAnchor = {
  kind: ForumAnchorKind;
  /** Stable id of the asset / text box the thread is attached to. */
  id: string;
  /** Human readable label rendered in the Win95 window chrome. */
  label: string;
  /** Where the item lives on the site, so a thread can link back to it. */
  href?: string;
  /** Present when the item is artwork, so the link can show a preview. */
  preview?: ForumPreview;
};

/**
 * Author of a thread or comment.
 *
 * `id` stays null while auth is switched off (see app/lib/auth/author.ts) and
 * becomes `auth.users.id` once Supabase Auth is wired up.
 */
export type ForumAuthor = {
  id: string | null;
  displayName: string;
};

export type ForumComment = {
  id: string;
  threadId: string;
  body: string;
  author: ForumAuthor;
  createdAt: string;
  tags: ForumTag[];
  /** Artwork attached to this reply. */
  media?: ForumPreview;
};

export type ForumThread = {
  id: string;
  title: string;
  body: string;
  author: ForumAuthor;
  createdAt: string;
  anchor: ForumAnchor;
  tags: ForumTag[];
  comments: ForumComment[];
  /** Artwork attached to a general board post. */
  media?: ForumPreview;
  /** 'seed' rows ship with the mock board, 'user' rows were filed in the browser. */
  origin: 'seed' | 'user';
};

export type CreateThreadInput = {
  title: string;
  body: string;
  anchor: ForumAnchor;
  author: ForumAuthor;
  /** Tags the poster picked in the chooser, in display order. */
  userTags?: string[];
  /** Artwork attached to a general board post. */
  media?: ForumPreview;
};

export type CreateCommentInput = {
  body: string;
  author: ForumAuthor;
  /** Reply straight onto an existing thread... */
  threadId?: string;
  /** ...or attach to an asset / text box, creating its thread when missing. */
  anchor?: ForumAnchor;
  /** Tags the poster picked in the chooser, in display order. */
  userTags?: string[];
  /** Artwork attached to this reply. */
  media?: ForumPreview;
};

export type AddCommentResult = {
  thread: ForumThread;
  comment: ForumComment;
  createdThread: boolean;
};

/**
 * Storage contract for the board.
 *
 * Supabase swap-in plan (build order step 4):
 *   `listThreads`  -> `select *, forum_comments(*) from forum_threads`
 *   `createThread` -> `insert into forum_threads`
 *   `addComment`   -> find-or-insert thread by anchor, then `insert into forum_comments`
 *   `subscribe`    -> `supabase.channel('forum').on('postgres_changes', ...)`
 * RLS: every row keeps `author_id`, and policies restrict update/delete to
 * `auth.uid() = author_id` while leaving select public.
 */
export type ForumRepository = {
  readonly source: ForumDataSource;
  listThreads(): Promise<ForumThread[]>;
  createThread(input: CreateThreadInput): Promise<ForumThread>;
  addComment(input: CreateCommentInput): Promise<AddCommentResult>;
  /** Realtime hook: fires with a fresh snapshot whenever the board changes. */
  subscribe(listener: (threads: ForumThread[]) => void): () => void;
  /** Mock-only helper so local test posts can be purged. */
  clearLocalPosts?(): Promise<void>;
};
