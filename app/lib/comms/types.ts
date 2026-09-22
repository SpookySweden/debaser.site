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

/** A conversation of two (`dm:`) or of any number of accounts (`grp:`). */
export type CommsThreadKind = 'dm' | 'group';

/** Longest group name the composer accepts. */
export const MAX_GROUP_NAME_LENGTH = 40;

/** Most accounts one group may hold, the creator included. */
export const MAX_GROUP_MEMBERS = 12;

export type CommsThread = {
  /** `dm:<low id>|<high id>` or `grp:<id>`, so both sides agree without a lookup. */
  id: string;
  /**
   * Who is in it: the two accounts of a dm (lowest id first), or every member of a
   * group. Sorted, so a name joined from it reads the same everywhere.
   */
  participants: string[];
  kind: CommsThreadKind;
  /** A group's name. Empty for a dm, which is named after the other account. */
  name: string;
  /**
   * Who opened the conversation: a group's owner. Null for a dm filed before the column
   * existed, and for a database that has not had the ownership script run.
   *
   * The owner is the only account that may rename the group, hand it to somebody else, or
   * take a member out - and ownership only moves two ways: the owner hands it over, or the
   * owner leaves and it passes to whoever has been in the group longest. The database
   * enforces that (see `supabase/migrations/20260922_group_ownership.sql`); this field is
   * how the screen knows whether to draw the controls at all.
   */
  ownerId: string | null;
  createdAt: string;
  /** Newest activity: what the conversation list sorts by. */
  updatedAt: string;
  /** Oldest first, the way they are read. */
  messages: CommsMessage[];
  /** userId -> ISO stamp of the last message that account has seen. */
  readAt: Record<string, string>;
};

/**
 * What to send, and where to.
 *
 * A message is addressed either to an account (`recipientId`, which derives the
 * `dm:` id, so a message can never land in a thread its sender is not part of) or to
 * a conversation that already exists (`threadId`, which is how a group is written
 * to). Exactly one of the two, which is what the union says.
 */
export type SendMessageInput = {
  authorId: string;
  /** The sender's name at the time of writing, for names this store cannot resolve. */
  authorName: string;
  body: string;
} & ({ recipientId: string; threadId?: undefined } | { threadId: string; recipientId?: undefined });

export type CreateGroupInput = {
  creatorId: string;
  /** Kept as the byline on the group's first message if one is sent. */
  creatorName: string;
  name: string;
  /** Everybody else who should be in it. The creator is added either way. */
  memberIds: string[];
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
  /**
   * Opens a group: any number of accounts, a name, and a membership row each.
   *
   * A group has no derived id (there is no pair to derive it from), so the store
   * mints one, `grp:<id>`. The creator is a member from the start; everybody else
   * named is added in the same call, so the group is complete before the screen
   * switches to it.
   */
  createGroup(input: CreateGroupInput): Promise<CommsThread>;
  /**
   * Adds an account to a group.
   *
   * Anybody in it may add somebody else; adding *yourself* only works in a conversation you
   * opened, which is what gets a new group's creator into their own group. `actorId` is who is
   * asking: the Supabase store ignores it - the session says who is asking, and the database
   * checks that - while the mock, which has no session, applies the same rules with it.
   */
  addMember(threadId: string, userId: string, actorId?: string): Promise<CommsThread>;
  /**
   * The owner's four, and each store checks it for itself.
   *
   * A group's metadata belongs to whoever opened it. Renaming, handing the group over and
   * taking a member out are the owner's alone; leaving any member may do, and an owner who
   * leaves hands the group on - to whoever has been in it longest, or to nobody at all, in
   * which case the empty group goes with them.
   */
  renameGroup(threadId: string, name: string, actorId?: string): Promise<CommsThread>;
  /** Hands the group to somebody who is in it. Owner only. */
  transferGroupOwnership(threadId: string, toUserId: string, actorId?: string): Promise<CommsThread>;
  /** Takes somebody else out of the group. Owner only. */
  removeMember(threadId: string, userId: string, actorId?: string): Promise<CommsThread>;
  /** Leaves the group. Null when that was the last member and the group is gone. */
  leaveGroup(threadId: string, actorId?: string): Promise<CommsThread | null>;
  sendMessage(input: SendMessageInput): Promise<CommsThread>;
  /** Moves that account's read marker to the newest message. */
  markRead(userId: string, threadId: string): Promise<CommsThread>;
  /** Realtime hook: fires with every thread whenever comms moves. */
  subscribe(listener: (threads: CommsThread[]) => void): () => void;
  /** Mock-only helper so local test conversations can be purged. */
  clearLocalThreads?(): Promise<void>;
};
