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
  /**
   * True while the house account has that account banned (supabase/schema.sql,
   * section 12). A banned author's rows are hidden from everybody else by the
   * database, so the admin is the only one who still sees them - marked, so the
   * name does not just look quiet for no reason.
   */
  banned?: boolean;
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
  /**
   * The comment this one replies to. Missing on top-level replies, which answer
   * the post (or the item the thread is filed under) directly.
   */
  parentId?: string;
};

/**
 * How long a pin lasts: the choices the moderator's panel offers.
 *
 * `forever` is the standing notice; the rest are the numbered windows. It lives here rather than
 * in ./pins so that the storage contract can name it without importing the rules.
 */
export type PinDurationKey = 'hour' | 'day' | 'week' | 'month' | 'forever';

/**
 * A pinned post.
 *
 * A pin is a moderator's mark on somebody's post: it puts the post at the top of the board and
 * leads the wire, until a set time runs out or forever. It is a row of its own rather than a
 * column on the thread, because it is not part of what was written - it is the archive's
 * decision about it, and it can be taken back without touching the post.
 *
 * `expiresAt` is null for a pin that never runs out ("forever"); anything else is the moment it
 * stops counting. Nothing has to be swept up when one lapses: `isPinLive` in ./pins decides
 * whether a pin is still doing anything, and the database's read policy hides the ones that are
 * not (supabase/schema.sql, section 18).
 */
export type ThreadPin = {
  threadId: string;
  /** Who pinned it. Null if that account is gone; the label is what to print. */
  pinnedById: string | null;
  pinnedByName: string;
  pinnedAt: string;
  /** When the pin lapses, or null for one that never does. */
  expiresAt: string | null;
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
  /** Reply to an existing comment instead of the post itself. */
  parentId?: string;
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

/** What an edit may change on a post. */
export type ThreadPatch = {
  title?: string;
  body?: string;
};

/** What an edit may change on a reply. */
export type CommentPatch = {
  body?: string;
};

/**
 * Storage contract for the board.
 *
 * Supabase swap-in plan (build order step 4):
 *   `listThreads`  -> `select *, forum_comments(*) from forum_threads`
 *   `createThread` -> `insert into forum_threads`
 *   `addComment`   -> find-or-insert thread by anchor, then `insert into forum_comments`
 *                     (`parent_id` carries the comment being replied to, or null)
 *   `subscribe`    -> `supabase.channel('forum').on('postgres_changes', ...)`
 *   `updateThread` / `updateComment` -> `update ... where id = $1`
 *   `deleteThread` / `deleteComment` -> `delete from ... where id = $1`
 * RLS: every row keeps `author_id`, and policies restrict update/delete to
 * `auth.uid() = author_id`, while leaving select public. The house account is the
 * exception: the `is_admin()` policies let it edit or remove anybody's row, which
 * is what makes the moderation controls on the board work (supabase/schema.sql).
 *
 * DDL note for the reply threads (additive, so existing rows keep working):
 *   alter table public.forum_comments
 *     add column parent_id uuid references public.forum_comments (id) on delete cascade;
 */
export type ForumRepository = {
  readonly source: ForumDataSource;
  listThreads(): Promise<ForumThread[]>;
  createThread(input: CreateThreadInput): Promise<ForumThread>;
  addComment(input: CreateCommentInput): Promise<AddCommentResult>;
  /**
   * Editing and removing posts, for the author and for the admin.
   *
   * Both are ordinary writes as far as this interface is concerned: who is allowed
   * to make them is decided by the database (author, or the house account). The
   * board only offers the controls to the admin - see
   * app/components/ForumModerationControls.tsx.
   */
  updateThread(threadId: string, patch: ThreadPatch): Promise<ForumThread>;
  deleteThread(threadId: string): Promise<void>;
  /** Hands back the thread the reply lives on, so the caller can redraw it. */
  updateComment(commentId: string, patch: CommentPatch): Promise<ForumThread>;
  deleteComment(commentId: string): Promise<void>;
  /** Realtime hook: fires with a fresh snapshot whenever the board changes. */
  subscribe(listener: (threads: ForumThread[]) => void): () => void;
  /**
   * The pins: which posts a moderator has lifted to the top, and for how long.
   *
   * Read separately from the board because they change for a different reason - a moderator
   * decides, nobody writes - and because the board is public while a pin is an act of
   * moderation. Only the house account may change one; both stores check, and the database
   * checks again (`is_admin()`, section 18). `listPins` hands back the pins that still count,
   * lapsed ones included, so a screen can say when one runs out.
   */
  listPins(): Promise<ThreadPin[]>;
  /** Pins a post for that long (or forever), replacing whatever pin it had. */
  pinThread(input: PinThreadInput): Promise<ThreadPin[]>;
  /** Takes a pin back off. Nothing happens to the post itself. */
  unpinThread(threadId: string): Promise<ThreadPin[]>;
  /** Realtime hook for the pins, alongside `subscribe` for the board. */
  subscribePins(listener: (pins: ThreadPin[]) => void): () => void;
  /** Mock-only helper so local test posts can be purged. */
  clearLocalPosts?(): Promise<void>;
};

/** What a moderator asks for: that post, that long, and who is asking. */
export type PinThreadInput = {
  threadId: string;
  duration: PinDurationKey;
  /** The moderator taking the pin: the row is signed with their name. */
  moderator: ForumAuthor;
};
