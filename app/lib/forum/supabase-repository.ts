import { getSupabaseBrowserClient } from '../supabase/client';
import { ANONYMOUS_AUTHOR } from '../auth/author';
import { AUTO_FILED_BODY, autoThreadTitle } from './anchors';
import { deriveTags, mergeTags } from './tags';
import { pinExpiry } from './pins';
import type {
  AddCommentResult,
  CommentPatch,
  CreateCommentInput,
  CreateThreadInput,
  ForumAnchorKind,
  ForumAuthor,
  ForumComment,
  ForumRepository,
  ForumTag,
  ForumThread,
  ForumTrack,
  PinThreadInput,
  ThreadPatch,
  ThreadPin,
} from './types';

/**
 * Supabase backed repository - the production implementation of
 * `ForumRepository`. It stays dormant until the tables below exist and
 * `NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase` is set (see ./repository.ts).
 *
 * Schema this code expects:
 *
 *   create table public.forum_threads (
 *     id uuid primary key default gen_random_uuid(),
 *     title text not null,
 *     body text not null,
 *     author_id uuid references auth.users (id) on delete set null,
 *     author_label text not null default 'Anonymous',
 *     anchor_kind text not null,
 *     anchor_id text not null,
 *     anchor_label text not null,
 *     tags jsonb not null default '[]'::jsonb,
 *     media_src text,
 *     media_alt text,
 *     media_width integer,
 *     media_height integer,
 *     -- The MP3 filed with the post: { src, title, credit, tags, length }.
 *     track jsonb,
 *     created_at timestamptz not null default now()
 *   );
 *
 *   create table public.forum_comments (
 *     id uuid primary key default gen_random_uuid(),
 *     thread_id uuid not null references public.forum_threads (id) on delete cascade,
 *     body text not null,
 *     author_id uuid references auth.users (id) on delete set null,
 *     author_label text not null default 'Anonymous',
 *     tags jsonb not null default '[]'::jsonb,
 *     media_src text,
 *     media_alt text,
 *     media_width integer,
 *     media_height integer,
 *     -- The MP3 filed with the reply, the same shape the post's column holds.
 *     track jsonb,
 *     created_at timestamptz not null default now()
 *   );
 *
 *   -- one auto-generated thread per asset / text box
 *   create unique index forum_threads_anchor_key
 *     on public.forum_threads (anchor_kind, anchor_id)
 *     where anchor_kind <> 'board';
 *
 *   alter table public.forum_threads enable row level security;
 *   alter table public.forum_comments enable row level security;
 *
 *   -- public read, but authors may only edit or delete their own rows
 *   create policy "forum_threads readable" on public.forum_threads for select using (true);
 *   create policy "forum_threads insert own" on public.forum_threads for insert with check (author_id is null or author_id = auth.uid());
 *   create policy "forum_threads update own" on public.forum_threads for update using (author_id = auth.uid());
 *   create policy "forum_threads delete own" on public.forum_threads for delete using (author_id = auth.uid());
 *   create policy "forum_comments readable" on public.forum_comments for select using (true);
 *   create policy "forum_comments insert own" on public.forum_comments for insert with check (author_id is null or author_id = auth.uid());
 *   create policy "forum_comments update own" on public.forum_comments for update using (author_id = auth.uid());
 *   create policy "forum_comments delete own" on public.forum_comments for delete using (author_id = auth.uid());
 *
 *   -- reply threads (additive, so rows written before this still load)
 *   alter table public.forum_comments
 *     add column parent_id uuid references public.forum_comments (id) on delete cascade;
 *
 *   -- the MP3 filed with a post or a reply (additive: an older row is simply null)
 *   alter table public.forum_threads add column if not exists track jsonb;
 *   alter table public.forum_comments add column if not exists track jsonb;
 *
 *   -- realtime
 *   alter publication supabase_realtime add table public.forum_threads, public.forum_comments;
 */

const THREADS_TABLE = 'forum_threads';
const COMMENTS_TABLE = 'forum_comments';
const PINS_TABLE = 'forum_pins';
const THREAD_SELECT = `*, ${COMMENTS_TABLE}(*)`;

type CommentRow = {
  id: string;
  thread_id: string;
  body: string;
  author_id: string | null;
  author_label: string;
  tags: ForumTag[] | null;
  media_src?: string | null;
  media_alt?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  /** The MP3 filed with the reply, as jsonb (`null` when there is none). */
  track?: ForumTrack | null;
  /** The comment this replies to, null for a reply to the post itself. */
  parent_id?: string | null;
  created_at: string;
};

type ThreadRow = {
  id: string;
  title: string;
  body: string;
  author_id: string | null;
  author_label: string;
  anchor_kind: ForumAnchorKind;
  anchor_id: string;
  anchor_label: string;
  tags: ForumTag[] | null;
  media_src?: string | null;
  media_alt?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  /** The MP3 filed with the post, as jsonb (`null` when there is none). */
  track?: ForumTrack | null;
  created_at: string;
  forum_comments?: CommentRow[] | null;
};

/** A pin row, as `forum_pins` has it. `expires_at` null is a pin that never runs out. */
type PinRow = {
  thread_id: string;
  pinned_by: string | null;
  pinned_by_label: string;
  pinned_at: string;
  expires_at: string | null;
};

function toAuthor(id: string | null, label: string, banned = false): ForumAuthor {
  return {
    id,
    displayName: label.length > 0 ? label : ANONYMOUS_AUTHOR.displayName,
    ...(banned ? { banned: true } : {}),
  };
}

/**
 * The `track` column as the board reads it.
 *
 * The jsonb is written by whichever browser filed the post, so nothing in it is
 * trusted: a row that has lost its `src` is dropped rather than drawn as a player
 * that cannot play anything. Anything else that is missing is filled with what
 * the board can say honestly - an untitled track, an unattributed one.
 */
function trackFromRow(value: ForumTrack | null | undefined): ForumTrack | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  if (typeof value.src !== 'string' || value.src.length === 0) return undefined;

  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const credit = typeof value.credit === 'string' ? value.credit.trim() : '';
  const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const length = typeof value.length === 'string' && value.length.length > 0 ? value.length : undefined;

  return {
    src: value.src,
    title: title.length === 0 ? 'UNTITLED' : title,
    credit,
    tags,
    ...(length === undefined ? {} : { length }),
  };
}

/** A track for an object literal's spread, or nothing to spread at all. */
function withTrack(value: ForumTrack | null | undefined): { track?: ForumTrack } {
  const track = trackFromRow(value);
  return track === undefined ? {} : { track };
}

/** `banned` holds the ids the admin has banned, so a row can be marked on sight. */
/** A pin row as the screen reads it. */
function toPin(row: PinRow): ThreadPin {
  return {
    threadId: row.thread_id,
    pinnedById: row.pinned_by,
    pinnedByName: row.pinned_by_label,
    pinnedAt: row.pinned_at,
    expiresAt: row.expires_at,
  };
}

function toComment(row: CommentRow, threadId: string, banned: ReadonlySet<string> = new Set()): ForumComment {
  return {
    id: row.id,
    threadId,
    body: row.body,
    author: toAuthor(row.author_id, row.author_label, row.author_id !== null && banned.has(row.author_id)),
    createdAt: row.created_at,
    tags: row.tags ?? deriveTags({ text: row.body, maxTags: 3 }),
    ...(row.parent_id === null || row.parent_id === undefined ? {} : { parentId: row.parent_id }),
    ...withTrack(row.track),
    ...(row.media_src === null || row.media_src === undefined
      ? {}
      : {
          media: {
            src: row.media_src,
            alt: row.media_alt ?? 'Image attached to a reply',
            width: row.media_width ?? 0,
            height: row.media_height ?? 0,
          },
        }),
  };
}

function toThread(row: ThreadRow, banned: ReadonlySet<string> = new Set()): ForumThread {
  const comments = (row.forum_comments ?? [])
    .map((comment) => toComment(comment, row.id, banned))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    author: toAuthor(row.author_id, row.author_label, row.author_id !== null && banned.has(row.author_id)),
    createdAt: row.created_at,
    anchor: { kind: row.anchor_kind, id: row.anchor_id, label: row.anchor_label },
    tags: row.tags ?? deriveTags({ text: `${row.title}\n${row.body}`, maxTags: 6 }),
    comments,
    ...withTrack(row.track),
    ...(row.media_src === null || row.media_src === undefined
      ? {}
      : {
          media: {
            src: row.media_src,
            alt: row.media_alt ?? row.title,
            width: row.media_width ?? 0,
            height: row.media_height ?? 0,
          },
        }),
    origin: 'user',
  };
}

/** Row shape for an insert: the database supplies `id` and `created_at`. */
type ThreadInsert = Omit<ThreadRow, 'id' | 'created_at' | 'forum_comments'>;
type CommentInsert = Omit<CommentRow, 'id' | 'created_at'>;

function threadPayload(input: CreateThreadInput): ThreadInsert {
  return {
    title: input.title,
    body: input.body,
    author_id: input.author.id,
    author_label: input.author.displayName,
    anchor_kind: input.anchor.kind,
    anchor_id: input.anchor.id,
    anchor_label: input.anchor.label,
    tags: mergeTags(input.userTags ?? [], deriveTags({ text: `${input.title}\n${input.body}`, anchor: input.anchor })),
    media_src: input.media?.src ?? null,
    media_alt: input.media?.alt ?? null,
    media_width: input.media?.width ?? null,
    media_height: input.media?.height ?? null,
    track: input.track ?? null,
  };
}

function commentPayload(input: CreateCommentInput, threadId: string): CommentInsert {
  return {
    thread_id: threadId,
    body: input.body.trim(),
    author_id: input.author.id,
    author_label: input.author.displayName,
    tags: mergeTags(input.userTags ?? [], deriveTags({ text: input.body, anchor: input.anchor, maxTags: 3 })),
    parent_id: input.parentId ?? null,
    media_src: input.media?.src ?? null,
    media_alt: input.media?.alt ?? null,
    media_width: input.media?.width ?? null,
    media_height: input.media?.height ?? null,
    track: input.track ?? null,
  };
}

class SupabaseForumRepository implements ForumRepository {
  readonly source = 'supabase' as const;

  private client() {
    const client = getSupabaseBrowserClient();

    if (client === null) {
      throw new Error(
        'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );
    }

    return client;
  }

  /**
   * Which accounts the admin has banned.
   *
   * The database does the hiding (the readable policies in supabase/schema.sql,
   * section 12, skip a banned author's rows for everybody), so this is only about
   * telling the truth on screen: the admin still sees those rows, and they should
   * say why that name has gone quiet rather than looking ordinary. A read failure
   * is not worth failing the board over, so it comes back empty.
   */
  private async bannedAuthorIds(): Promise<ReadonlySet<string>> {
    const { data, error } = await this.client().from('profiles').select('id').not('banned_at', 'is', null);

    if (error !== null) return new Set();

    return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
  }

  async listThreads(): Promise<ForumThread[]> {
    const banned = await this.bannedAuthorIds();

    const { data, error } = await this.client()
      .from(THREADS_TABLE)
      .select(THREAD_SELECT)
      .order('created_at', { ascending: false });

    if (error !== null) throw new Error(`forum thread select failed: ${error.message}`);

    return ((data ?? []) as ThreadRow[]).map((row) => toThread(row, banned));
  }

  async createThread(input: CreateThreadInput): Promise<ForumThread> {
    const { data, error } = await this.client()
      .from(THREADS_TABLE)
      .insert(threadPayload(input))
      .select(THREAD_SELECT)
      .single();

    if (error !== null) throw new Error(`forum thread insert failed: ${error.message}`);

    return toThread(data as ThreadRow);
  }

  async addComment(input: CreateCommentInput): Promise<AddCommentResult> {
    const client = this.client();
    const { threadId, createdThread } = await this.resolveThreadId(input);

    const { data: commentRow, error: commentError } = await client
      .from(COMMENTS_TABLE)
      .insert(commentPayload(input, threadId))
      .select('*')
      .single();

    if (commentError !== null) throw new Error(`forum comment insert failed: ${commentError.message}`);

    const { data: threadRow, error: threadError } = await client
      .from(THREADS_TABLE)
      .select(THREAD_SELECT)
      .eq('id', threadId)
      .single();

    if (threadError !== null) throw new Error(`forum thread refresh failed: ${threadError.message}`);

    const thread = toThread(threadRow as ThreadRow);

    return { thread, comment: toComment(commentRow as CommentRow, thread.id), createdThread };
  }

  /**
   * Editing what is already on the board.
   *
   * The site offers these controls to the house account only (see
   * app/components/ForumModerationControls.tsx); the permission itself lives in
   * Supabase, where the `is_admin()` policies let it past the author check.
   */
  async updateThread(threadId: string, patch: ThreadPatch): Promise<ForumThread> {
    const changes: Record<string, unknown> = {};

    if (patch.title !== undefined) changes.title = patch.title.trim();
    if (patch.body !== undefined) changes.body = patch.body.trim();

    if (Object.keys(changes).length === 0) return this.fetchThread(threadId);

    const { error } = await this.client().from(THREADS_TABLE).update(changes).eq('id', threadId);
    if (error !== null) throw new Error(`forum thread update failed: ${error.message}`);

    return this.fetchThread(threadId);
  }

  async deleteThread(threadId: string): Promise<void> {
    const { error } = await this.client().from(THREADS_TABLE).delete().eq('id', threadId);
    if (error !== null) throw new Error(`forum thread delete failed: ${error.message}`);
  }

  /** Hands back the whole thread, so the board can redraw the reply in place. */
  async updateComment(commentId: string, patch: CommentPatch): Promise<ForumThread> {
    const body = (patch.body ?? '').trim();
    const threadId = await this.threadIdForComment(commentId);

    if (body.length > 0) {
      const { error } = await this.client().from(COMMENTS_TABLE).update({ body }).eq('id', commentId);
      if (error !== null) throw new Error(`forum comment update failed: ${error.message}`);
    }

    return this.fetchThread(threadId);
  }

  async deleteComment(commentId: string): Promise<void> {
    // The replies that answered this one go with it: the foreign key cascades.
    const { error } = await this.client().from(COMMENTS_TABLE).delete().eq('id', commentId);
    if (error !== null) throw new Error(`forum comment delete failed: ${error.message}`);
  }

  /** One thread, by id: what a moderation write hands back to the board. */
  private async fetchThread(threadId: string): Promise<ForumThread> {
    const { data, error } = await this.client()
      .from(THREADS_TABLE)
      .select(THREAD_SELECT)
      .eq('id', threadId)
      .single();

    if (error !== null) throw new Error(`forum thread refresh failed: ${error.message}`);

    return toThread(data as ThreadRow, await this.bannedAuthorIds());
  }

  /** Which thread a reply is filed under, for the refresh above. */
  private async threadIdForComment(commentId: string): Promise<string> {
    const { data, error } = await this.client()
      .from(COMMENTS_TABLE)
      .select('thread_id')
      .eq('id', commentId)
      .single();

    if (error !== null) throw new Error(`forum comment lookup failed: ${error.message}`);

    return (data as { thread_id: string }).thread_id;
  }

  /** Resolves (or auto-creates) the thread a comment belongs to. */
  private async resolveThreadId(input: CreateCommentInput): Promise<{ threadId: string; createdThread: boolean }> {
    if (input.threadId !== undefined) {
      return { threadId: input.threadId, createdThread: false };
    }

    if (input.anchor === undefined) {
      throw new Error('addComment needs either a threadId or an anchor.');
    }

    const client = this.client();
    const anchor = input.anchor;

    const { data: existing, error: lookupError } = await client
      .from(THREADS_TABLE)
      .select('id')
      .eq('anchor_kind', anchor.kind)
      .eq('anchor_id', anchor.id)
      .maybeSingle();

    if (lookupError !== null) throw new Error(`forum thread lookup failed: ${lookupError.message}`);

    const existingId = (existing as { id: string } | null)?.id;
    if (existingId !== undefined) {
      return { threadId: existingId, createdThread: false };
    }

    const title = autoThreadTitle(anchor);
    const payload = threadPayload({ title, body: AUTO_FILED_BODY, anchor, author: input.author });
    payload.tags = mergeTags(input.userTags ?? [], deriveTags({ text: `${title}\n${AUTO_FILED_BODY}\n${input.body}`, anchor }));

    const { data: created, error: createError } = await client
      .from(THREADS_TABLE)
      .insert(payload)
      .select('id')
      .single();

    if (createError !== null) throw new Error(`auto thread insert failed: ${createError.message}`);

    return { threadId: (created as { id: string }).id, createdThread: true };
  }

  subscribe(listener: (threads: ForumThread[]) => void): () => void {
    const client = this.client();

    const refresh = () => {
      void this.listThreads()
        .then((threads) => listener(threads))
        .catch(() => undefined);
    };

    const channel = client
      .channel('forum-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: THREADS_TABLE }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: COMMENTS_TABLE }, refresh)
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }

  async clearLocalPosts(): Promise<void> {
    // Supabase owns the rows; nothing to purge client side.
  }

  /** The pins as the table has them: newest first, lapsed ones included. */
  async listPins(): Promise<ThreadPin[]> {
    const { data, error } = await this.client()
      .from(PINS_TABLE)
      .select('*')
      .order('pinned_at', { ascending: false });

    if (error !== null) throw new Error(`forum pin select failed: ${error.message}`);

    return ((data ?? []) as PinRow[]).map(toPin);
  }

  /**
   * Pins a post for that long, replacing whatever pin it had.
   *
   * The row is signed with the moderator who took it (`pinned_by = auth.uid()`, which the insert
   * policy checks along with `is_admin()`), so a pin always names the account that decided. One
   * pin per post - `thread_id` is the primary key - so extending a deadline is the same write as
   * taking the pin in the first place.
   */
  async pinThread(input: PinThreadInput): Promise<ThreadPin[]> {
    const { error } = await this.client()
      .from(PINS_TABLE)
      .upsert(
        {
          thread_id: input.threadId,
          pinned_by: input.moderator.id,
          pinned_by_label: input.moderator.displayName,
          pinned_at: new Date().toISOString(),
          expires_at: pinExpiry(input.duration),
        },
        { onConflict: 'thread_id' },
      );

    if (error !== null) throw new Error(`forum pin write failed: ${error.message}`);

    return this.listPins();
  }

  async unpinThread(threadId: string): Promise<ThreadPin[]> {
    const { error } = await this.client().from(PINS_TABLE).delete().eq('thread_id', threadId);

    if (error !== null) throw new Error(`forum pin delete failed: ${error.message}`);

    return this.listPins();
  }

  subscribePins(listener: (pins: ThreadPin[]) => void): () => void {
    const client = this.client();

    const refresh = () => {
      void this.listPins()
        .then((pins) => listener(pins))
        .catch(() => undefined);
    };

    const channel = client
      .channel('forum-pins')
      .on('postgres_changes', { event: '*', schema: 'public', table: PINS_TABLE }, refresh)
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }
}

let supabaseRepository: SupabaseForumRepository | null = null;

export function getSupabaseForumRepository(): ForumRepository {
  if (supabaseRepository === null) supabaseRepository = new SupabaseForumRepository();
  return supabaseRepository;
}
