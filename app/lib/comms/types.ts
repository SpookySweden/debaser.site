/**
 * Direct messages between accounts.
 *
 * A thread is a conversation between exactly two accounts, named by the pair so
 * opening one is a lookup rather than a search: `dm:<low id>|<high id>`. That is
 * what makes "message this account" idempotent, and what keeps Supabase's unique
 * index honest (`unique (participant_a, participant_b)`).
 *
 * Like the forum and the profiles, everything below is storage agnostic: the mock
 * repository in this folder works today, and the Supabase one drops in behind the
 * same interface (see the swap-in plan on `CommsRepository`).
 */

export type CommsDataSource = 'mock' | 'supabase';

/** Longest message the composer accepts. */
export const MAX_MESSAGE_LENGTH = 800;

export type CommsMessage = {
  id: string;
  threadId: string;
  /** The account that wrote it. Every message is signed: there are no guests. */
  authorId: string;
  /**
   * The author's name as it was when they wrote it. Names are resolved live from
   * the account list when it is available (`resolveAuthor`), so this is only the
   * fallback for an account this browser has never seen.
   */
  authorName: string;
  body: string;
  createdAt: string;
};

export type CommsThread = {
  /** `dm:<low id>|<high id>`, so both sides agree on it without a lookup. */
  id: string;
  /** The two accounts, lowest id first. */
  participants: string[];
  createdAt: string;
  /** Newest activity: what the conversation list sorts by. */
  updatedAt: string;
  /** Oldest first, the way they are read. */
  messages: CommsMessage[];
  /** userId -> ISO stamp of the last message that account has seen. */
  readAt: Record<string, string>;
};

export type SendMessageInput = {
  /** The two sides of the conversation: the thread id is derived from them, so
   * a message can never end up in a thread its sender is not part of. */
  authorId: string;
  recipientId: string;
  /** The sender's name at the time of writing, for names this store cannot resolve. */
  authorName: string;
  body: string;
};

/**
 * Storage contract for comms.
 *
 * Supabase swap-in plan (build order step 4, next to the profiles table):
 *   `listThreads`  -> `select *, comms_messages(*) from comms_threads
 *                      where auth.uid() in (participant_a, participant_b)`
 *   `openThread`   -> find-or-insert on (participant_a, participant_b)
 *   `sendMessage`  -> insert into comms_messages + bump comms_threads.updated_at
 *   `markRead`     -> upsert comms_reads (thread_id, user_id, last_read_at)
 *   `subscribe`    -> `supabase.channel('comms')`: postgres_changes on
 *                     comms_messages filtered to the signed-in account, which is
 *                     what turns the notification pop-up into a real thing
 *
 * DDL:
 *   create table public.comms_threads (
 *     id text primary key,
 *     participant_a uuid not null references auth.users (id) on delete cascade,
 *     participant_b uuid not null references auth.users (id) on delete cascade,
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now(),
 *     unique (participant_a, participant_b)
 *   );
 *   create table public.comms_messages (
 *     id uuid primary key default gen_random_uuid(),
 *     thread_id text not null references public.comms_threads (id) on delete cascade,
 *     author_id uuid not null references auth.users (id) on delete cascade,
 *     body text not null,
 *     created_at timestamptz not null default now()
 *   );
 *   create table public.comms_reads (
 *     thread_id text not null references public.comms_threads (id) on delete cascade,
 *     user_id uuid not null references auth.users (id) on delete cascade,
 *     last_read_at timestamptz not null default now(),
 *     primary key (thread_id, user_id)
 *   );
 *
 * RLS: a thread is readable only by its two participants
 * (`auth.uid() in (participant_a, participant_b)`), messages are insertable only
 * by a participant and only signed by themselves (`author_id = auth.uid()`), and
 * a read marker is writable only by the account it belongs to. That is the rule
 * the mock store keeps by construction: it only ever hands back the threads the
 * signed-in account is in.
 */
export type CommsRepository = {
  readonly source: CommsDataSource;
  listThreads(userId: string): Promise<CommsThread[]>;
  /** Idempotent: finds the conversation with that account, or opens an empty one. */
  openThread(userId: string, otherId: string): Promise<CommsThread>;
  sendMessage(input: SendMessageInput): Promise<CommsThread>;
  /** Moves that account's read marker to the newest message. */
  markRead(userId: string, threadId: string): Promise<CommsThread>;
  /** Realtime hook: fires with every thread whenever comms moves. */
  subscribe(listener: (threads: CommsThread[]) => void): () => void;
  /** Mock-only helper so local test conversations can be purged. */
  clearLocalThreads?(): Promise<void>;
};
