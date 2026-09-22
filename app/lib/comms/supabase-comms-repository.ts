import { getSupabaseBrowserClient } from '../supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { groupThreadId, threadIdFor } from './threads';
import type { CommsMessage, CommsRepository, CommsThread, CreateGroupInput, SendMessageInput } from './types';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME_LENGTH } from './types';

/**
 * Conversations in Supabase - the production implementation of `CommsRepository`.
 * Dormant until the tables in `supabase/schema.sql` exist and
 * `NEXT_PUBLIC_COMMS_DATA_SOURCE=supabase` is set (see ./repository.ts).
 *
 * Tables this code expects, with the RLS rules the mock store keeps by
 * construction - a conversation is readable only by the accounts in it, and a
 * message can only be signed by its writer:
 *
 *   comms_threads   id text (`dm:<low id>|<high id>` or `grp:<uuid>`), kind, name,
 *                   created_by, participant_a, participant_b, created_at, updated_at
 *   comms_members   thread_id, user_id   (who is in a group; primary key: both)
 *   comms_messages  id uuid, thread_id, author_id, author_name, body, created_at
 *   comms_reads     thread_id, user_id, last_read_at   (primary key: both)
 *
 * The thread id of a direct conversation is derived from the pair on both sides, so
 * opening one is a lookup rather than a search and the two participants always agree
 * on it. A group has no pair to derive anything from, so `comms_members` is what
 * answers for it. `updated_at` is what the conversation list sorts by; a trigger
 * keeps it true.
 *
 * One deployment note the reads below are written around: `kind`, `name`,
 * `created_by` and `comms_members` arrive with the group script (section 13 of
 * `supabase/schema.sql`, or supabase/migrations/20260921_group_conversations.sql).
 * A project that has not had it run against it answers those requests with a schema
 * error - which would fail the *whole* read and take the direct messages down with
 * it - so this store asks the group-aware way first, falls back to asking for what
 * such a database does have, and remembers which of the two it is talking to. Groups
 * then say what is missing rather than half-working (see `GROUPS_NEED_MIGRATION`).
 */

const THREADS_TABLE = 'comms_threads';
const MESSAGES_TABLE = 'comms_messages';
const READS_TABLE = 'comms_reads';
const MEMBERS_TABLE = 'comms_members';

/** One read per conversation: the thread, its members, its messages and its markers. */
const THREAD_SELECT = `*, ${MEMBERS_TABLE}(user_id), ${MESSAGES_TABLE}(*), ${READS_TABLE}(*)`;

/**
 * The same read for a project without the group script: the pair, the messages and
 * the read markers, and no membership table to embed.
 */
const THREAD_SELECT_PAIRS_ONLY = `*, ${MESSAGES_TABLE}(*), ${READS_TABLE}(*)`;

/**
 * What the group forms are told when this database has not had the group script.
 *
 * A deployment step rather than a mistake the reader made, so it names the file to
 * run and says the direct messages are unaffected - the honest answer to "why did
 * this button not work" when the code is ahead of the database.
 */
export const GROUPS_NEED_MIGRATION =
  'GROUPS NEED A ONE-TIME DATABASE UPDATE: RUN supabase/migrations/20260921_group_conversations.sql (OR SECTION 13 OF supabase/schema.sql) IN THE SUPABASE SQL EDITOR, THEN RELOAD. DIRECT MESSAGES ARE UNAFFECTED.';

/**
 * What the ownership controls are told when this database has not had section 15.
 *
 * The four functions that may change a group are a later script than the group tables
 * themselves, so a project can have groups and no way to rename one. Groups keep working;
 * only the owner's controls need the file.
 */
export const GROUP_OWNERSHIP_NEED_MIGRATION =
  'RENAMING AND HANDING GROUPS OVER NEED A ONE-TIME DATABASE UPDATE: RUN supabase/migrations/20260922_group_ownership.sql (OR SECTION 16 OF supabase/schema.sql) IN THE SUPABASE SQL EDITOR, THEN RELOAD. TALKING IN THE GROUP IS UNAFFECTED.';

/**
 * The codes PostgREST and Postgres answer with when the database is behind the code
 * rather than the request being wrong: a missing table, a missing column, or a
 * relationship the schema cache has never heard of.
 */
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST204', 'PGRST205', 'PGRST106', '42P01', '42703']);

type QueryError = { message: string; code?: string };

/** A thread read, as the caller wants to ask for it: ordered, filtered, or one row. */
type ThreadQuery = (select: string) => PromiseLike<{ data: unknown; error: QueryError | null }>;

function isMissingSchema(error: QueryError): boolean {
  if (typeof error.code === 'string' && MISSING_SCHEMA_CODES.has(error.code)) return true;

  // An older client, or a proxy in front of the API, can answer without a code at all.
  return /schema cache|does not exist|could not find/i.test(error.message);
}

type MessageRow = {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

type ReadRow = {
  thread_id: string;
  user_id: string;
  last_read_at: string;
};

type MemberRow = {
  user_id: string;
};

type ThreadRow = {
  id: string;
  participant_a: string | null;
  participant_b: string | null;
  kind: string | null;
  name: string | null;
  /** The account that opened it. Absent on a database without the group script. */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  comms_members?: MemberRow[] | null;
  comms_messages?: MessageRow[] | null;
  comms_reads?: ReadRow[] | null;
};

function toMessage(row: MessageRow): CommsMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toThread(row: ThreadRow): CommsThread {
  // A group is whoever is in `comms_members`; a dm is its pair, and old direct
  // conversations - filed before the membership table existed - are simply that.
  const members = (row.comms_members ?? []).map((member) => member.user_id).sort();
  const pair = [row.participant_a, row.participant_b].filter((id): id is string => id !== null);

  return {
    id: row.id,
    participants: members.length > 0 ? members : pair,
    kind: row.kind === 'group' ? 'group' : 'dm',
    name: row.name ?? '',
    ownerId: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Oldest first, the way they are read.
    messages: (row.comms_messages ?? [])
      .map(toMessage)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    readAt: Object.fromEntries((row.comms_reads ?? []).map((read) => [read.user_id, read.last_read_at])),
  };
}

/** The two ids in the order the thread id stores them. */
function pairFor(userId: string, otherId: string): [string, string] {
  return userId < otherId ? [userId, otherId] : [otherId, userId];
}

class SupabaseCommsRepository implements CommsRepository {
  readonly source = 'supabase' as const;

  /**
   * Whether this project has the group conversations.
   *
   * Null until something asks, then remembered: the answer cannot change while the
   * tab is open, and every render of the console would otherwise ask again. False is
   * reached either by the probe below or by a group-aware read failing, which is the
   * same fact discovered the cheap way.
   */
  private groups: boolean | null = null;

  private client() {
    const client = getSupabaseBrowserClient();

    if (client === null) {
      throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    return client;
  }

  /** One shape of error reaches the UI, so a screen can print it as-is. */
  private fail(message: string | undefined): never {
    throw new Error((message ?? 'THE COMMS STORE DID NOT ANSWER.').toUpperCase());
  }

  /**
   * Whether this database can hold a group.
   *
   * Two one-row reads - the `kind` column a group row carries, and the membership
   * table the group is made of - rather than a failed write, so a database that is
   * behind is a message before anything is half-made. A failure that is *not* the
   * schema (a dead connection, a refused policy) is a real error and is raised.
   */
  private async groupsSupported(): Promise<boolean> {
    if (this.groups !== null) return this.groups;

    const columns = await this.client().from(THREADS_TABLE).select('kind').limit(1);
    if (columns.error !== null) return this.remember(false, columns.error);

    const members = await this.client().from(MEMBERS_TABLE).select('thread_id').limit(1);
    if (members.error !== null) return this.remember(false, members.error);

    this.groups = true;
    return true;
  }

  /** Files what a probe learned, and refuses to blame the reader for a missing table. */
  private remember(supported: boolean, error: QueryError): boolean {
    if (!isMissingSchema(error)) this.fail(error.message);

    this.groups = supported;
    return supported;
  }

  /**
   * Runs a thread read, asking the group-aware way first.
   *
   * The members embed is what a group is read from, and a database without the group
   * script rejects the whole request over it - so the read is asked again without it
   * and the store remembers that groups are not available here yet. Nothing below
   * has to know: a direct conversation comes back either way.
   */
  private async readThreads(run: ThreadQuery): Promise<{ data: unknown; error: QueryError | null }> {
    if (this.groups === false) return run(THREAD_SELECT_PAIRS_ONLY);

    const full = await run(THREAD_SELECT);
    if (full.error === null || !isMissingSchema(full.error)) return full;

    this.groups = false;
    return run(THREAD_SELECT_PAIRS_ONLY);
  }

  async listThreads(userId: string): Promise<CommsThread[]> {
    // No filter on the pair any more: a conversation comes back when you are in it,
    // by membership (a group) or by being one of its pair (a dm), and that rule is
    // the RLS policy's rather than this query's. `userId` still decides whose read
    // markers matter, which is why it is read below.
    void userId;

    const { data, error } = await this.readThreads((select) =>
      this.client().from(THREADS_TABLE).select(select).order('updated_at', { ascending: false }),
    );

    if (error !== null) this.fail(error.message);

    return ((data ?? []) as ThreadRow[]).map(toThread);
  }

  private async getThread(threadId: string): Promise<CommsThread | null> {
    const { data, error } = await this.readThreads((select) =>
      this.client().from(THREADS_TABLE).select(select).eq('id', threadId).maybeSingle(),
    );

    if (error !== null) this.fail(error.message);

    return data === null ? null : toThread(data as ThreadRow);
  }

  /**
   * Finds the conversation with that account, or opens an empty one.
   *
   * `ignoreDuplicates` makes the insert idempotent: if the other side opened the
   * same conversation a moment earlier, the row is already there and the read
   * below simply hands it back.
   */
  async openThread(userId: string, otherId: string): Promise<CommsThread> {
    if (userId === otherId) throw new Error('A CONVERSATION NEEDS TWO ACCOUNTS.');

    const id = threadIdFor(userId, otherId);
    const existing = await this.getThread(id);
    if (existing !== null) return existing;

    const [participantA, participantB] = pairFor(userId, otherId);

    // `kind` and `name` come with the group script, so a database without it is not
    // asked for them: a column it has never heard of fails the whole insert, and a
    // direct message of all things should not need a migration to be written.
    const row: Record<string, unknown> = { id, participant_a: participantA, participant_b: participantB };
    if (await this.groupsSupported()) {
      row.kind = 'dm';
      row.name = '';
    }

    const { error } = await this.client().from(THREADS_TABLE).upsert(row, { onConflict: 'id', ignoreDuplicates: true });

    if (error !== null) this.fail(error.message);

    const opened = await this.getThread(id);
    if (opened === null) this.fail('THAT CONVERSATION COULD NOT BE OPENED.');

    await this.publish();
    return opened;
  }

  /**
   * Opens a group.
   *
   * The row first (with its minted `grp:` id and its name), then the members - the
   * creator before anybody else, because the membership policy lets you add somebody
   * to a conversation you are already in. A group stores no pair at all, so
   * `participant_a` / `participant_b` stay null and membership is the whole answer.
   * A database without the group script is told so before anything is written: half a
   * group - a row with no membership table to hold it - would be worse than a message.
   */
  async createGroup(input: CreateGroupInput): Promise<CommsThread> {
    const name = input.name.trim();
    if (name.length === 0) throw new Error('A GROUP NEEDS A NAME.');
    if (name.length > MAX_GROUP_NAME_LENGTH) {
      throw new Error(`GROUP NAMES ARE ${MAX_GROUP_NAME_LENGTH} CHARACTERS OR FEWER.`);
    }

    const members = [...new Set([input.creatorId, ...input.memberIds])].sort();
    if (members.length > MAX_GROUP_MEMBERS) {
      throw new Error(`A GROUP HOLDS ${MAX_GROUP_MEMBERS} ACCOUNTS OR FEWER.`);
    }

    if (!(await this.groupsSupported())) throw new Error(GROUPS_NEED_MIGRATION);

    const client = this.client();
    const id = groupThreadId();

    const { error } = await client
      .from(THREADS_TABLE)
      .insert({ id, kind: 'group', name, created_by: input.creatorId });

    if (error !== null) this.fail(error.message);

    for (const userId of [input.creatorId, ...members.filter((member) => member !== input.creatorId)]) {
      const { error: memberError } = await client.from(MEMBERS_TABLE).insert({ thread_id: id, user_id: userId });

      if (memberError !== null) this.fail(memberError.message);
    }

    const created = await this.getThread(id);
    if (created === null) this.fail('THAT GROUP COULD NOT BE OPENED.');

    await this.publish();
    return created;
  }

  async addMember(threadId: string, userId: string): Promise<CommsThread> {
    if (!(await this.groupsSupported())) throw new Error(GROUPS_NEED_MIGRATION);

    const thread = await this.getThread(threadId);
    if (thread === null) this.fail('THAT CONVERSATION IS NOT THERE.');
    if (thread.kind !== 'group') throw new Error('ONLY A GROUP TAKES NEW MEMBERS.');
    if (thread.participants.includes(userId)) return thread;
    if (thread.participants.length >= MAX_GROUP_MEMBERS) {
      throw new Error(`A GROUP HOLDS ${MAX_GROUP_MEMBERS} ACCOUNTS OR FEWER.`);
    }

    const { error } = await this.client().from(MEMBERS_TABLE).insert({ thread_id: threadId, user_id: userId });
    if (error !== null) this.fail(error.message);

    const updated = await this.getThread(threadId);
    if (updated === null) this.fail('THAT CONVERSATION IS NOT THERE.');

    await this.publish();
    return updated;
  }
  /**
   * The owner's four, reached through the database's own functions.
   *
   * Nothing here writes `comms_threads` directly. A client may only write `updated_at` on a
   * conversation - the stamp `sendMessage` puts on it - because a member PATCHing `name` or
   * `created_by` is exactly how a group gets renamed and claimed by somebody who was only
   * invited to it. `rename_group`, `transfer_group_ownership`, `remove_group_member` and
   * `leave_group` check who is asking before they touch anything, so the rule lives in one
   * place and this store cannot be the thing that gets it wrong.
   */
  private async callOwnerFunction(name: string, args: Record<string, unknown>): Promise<void> {
    const { error } = await this.client().rpc(name, args);

    if (error !== null) {
      // A project that has not run section 16 answers "no such function": a deployment step,
      // so it is named rather than passed on as a PostgREST code.
      if (isMissingSchema(error)) throw new Error(GROUP_OWNERSHIP_NEED_MIGRATION);

      this.fail(error.message);
    }
  }

  private async afterOwnerChange(threadId: string): Promise<CommsThread> {
    const updated = await this.getThread(threadId);
    if (updated === null) this.fail('THAT GROUP IS NOT THERE ANY MORE.');

    await this.publish();
    return updated;
  }

  async renameGroup(threadId: string, name: string): Promise<CommsThread> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('A GROUP NEEDS A NAME.');
    if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
      throw new Error(`GROUP NAMES ARE ${MAX_GROUP_NAME_LENGTH} CHARACTERS OR FEWER.`);
    }

    await this.callOwnerFunction('rename_group', { thread: threadId, new_name: trimmed });
    return this.afterOwnerChange(threadId);
  }

  async transferGroupOwnership(threadId: string, toUserId: string): Promise<CommsThread> {
    await this.callOwnerFunction('transfer_group_ownership', { thread: threadId, to_user: toUserId });
    return this.afterOwnerChange(threadId);
  }

  async removeMember(threadId: string, userId: string): Promise<CommsThread> {
    await this.callOwnerFunction('remove_group_member', { thread: threadId, user_id: userId });
    return this.afterOwnerChange(threadId);
  }

  async leaveGroup(threadId: string): Promise<CommsThread | null> {
    await this.callOwnerFunction('leave_group', { thread: threadId });

    const updated = await this.getThread(threadId);
    await this.publish();

    return updated;
  }



  async sendMessage(input: SendMessageInput): Promise<CommsThread> {
    const thread =
      input.threadId === undefined
        ? await this.openThread(input.authorId, input.recipientId)
        : await this.getThread(input.threadId);

    if (thread === null) this.fail('THAT CONVERSATION IS NOT THERE.');

    const { error } = await this.client()
      .from(MESSAGES_TABLE)
      .insert({
        thread_id: thread.id,
        author_id: input.authorId,
        author_name: input.authorName.length > 0 ? input.authorName : 'Anonymous',
        body: input.body.trim(),
      });

    if (error !== null) this.fail(error.message);

    // A new message has to move the conversation up the list, and the list sorts
    // by the thread's own stamp.
    const { error: bumpError } = await this.client()
      .from(THREADS_TABLE)
      .update({ updated_at: new Date().toISOString() })
      .eq('id', thread.id);

    if (bumpError !== null) this.fail(bumpError.message);

    const updated = await this.getThread(thread.id);
    if (updated === null) this.fail('THAT CONVERSATION IS NOT THERE.');

    // The sender's own screen shows it now, rather than whenever the channel answers.
    await this.publish();
    return updated;
  }

  /** Moves that account's read marker to the newest message. */
  async markRead(userId: string, threadId: string): Promise<CommsThread> {
    const thread = await this.getThread(threadId);
    if (thread === null) this.fail('THAT CONVERSATION IS NOT THERE.');

    const newest = thread.messages.at(-1)?.createdAt ?? thread.createdAt;
    const read: CommsThread = { ...thread, readAt: { ...thread.readAt, [userId]: newest } };

    // Already read: no write, so putting a conversation on screen cannot turn into a
    // loop through the subscription. The mock store makes the same move.
    if (thread.readAt[userId] === newest) return read;

    const { error } = await this.client()
      .from(READS_TABLE)
      .upsert({ thread_id: threadId, user_id: userId, last_read_at: newest }, { onConflict: 'thread_id,user_id' });

    if (error !== null) this.fail(error.message);

    await this.publish();
    return read;
  }

  /**
   * Whose conversations these are.
   *
   * The channel is shared by every screen on the page; the list is not. The session
   * is what decides, which is why this is asked rather than passed in.
   */
  private async currentUserId(): Promise<string | null> {
    const { data } = await this.client().auth.getUser();

    return data.user?.id ?? null;
  }

  /**
   * Tells every listener what the store holds now.
   *
   * A write is followed by a read rather than by an event, because a screen needs the
   * fresh *list*: a conversation opened a moment ago has to be in the rail and on
   * screen straight away, and Realtime would only say so a round trip later. It is the
   * same read the channel handler makes, so a write and an event cannot disagree.
   */
  private async publish(): Promise<void> {
    const userId = await this.currentUserId();
    if (userId === null) return;

    const threads = await this.listThreads(userId);
    for (const listener of listeners) listener(threads);
  }

  /**
   * Opens the one channel every screen on the page shares.
   *
   * Which tables a channel may be bound to is a question about the project, not about
   * this code, and getting it wrong is silent - so it is asked (and answered once) before
   * joining:
   *
   *   - every table here must be in the `supabase_realtime` publication. One that is not
   *     does not fail alone: the channel still reports SUBSCRIBED and then delivers
   *     nothing from any of its tables. Measured on a live project: comms_messages +
   *     comms_threads heard a message, and adding comms_reads - which the schema never
   *     published - made the same channel hear nothing at all. `comms_reads` is therefore
   *     not bound (its marker is written by the reader, and the page re-reads on every
   *     event and every poll);
   *   - `comms_members` only exists once the group script has run, and a binding for a
   *     table that is not there would take the channel down with it, so the probe decides.
   *
   * A channel that still cannot join says so in the console rather than looking like an
   * account nobody has written to.
   */
  private openChannel(): void {
    if (channel !== null) return;

    const client = getSupabaseBrowserClient();
    if (client === null) return;

    const refresh = () => {
      // The same read a write publishes with, so the two can never disagree: the session
      // decides whose conversations these are, because the channel is shared and the list
      // is not.
      void this.publish().catch(() => undefined);
    };

    void this.groupsSupported()
      .catch(() => false)
      .then((groups) => {
        // Somebody may have closed the store while the probe was in flight.
        if (channel !== null || listeners.size === 0) return;

        let opened = client
          .channel('comms-inbox')
          .on('postgres_changes', { event: '*', schema: 'public', table: MESSAGES_TABLE }, refresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: THREADS_TABLE }, refresh);

        if (groups) {
          opened = opened.on('postgres_changes', { event: '*', schema: 'public', table: MEMBERS_TABLE }, refresh);
        }

        channel = opened.subscribe((status, channelError) => {
          if (status === 'SUBSCRIBED' || status === 'CLOSED') return;

          console.warn(
            `[comms] realtime channel ${status}: ${channelError?.message ?? 'no reason given'}. ` +
              'A table missing from the supabase_realtime publication makes the whole channel quiet - ' +
              'see supabase/migrations/20260921_comms_realtime.sql. Messages still arrive on the poll.',
          );
        });
      });
  }

  /** One channel for the whole page; see `openChannel` for what it may be bound to. */
  subscribe(listener: (threads: CommsThread[]) => void): () => void {
    listeners.add(listener);
    this.openChannel();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) closeChannel();
    };
  }
}

// -----------------------------------------------------------------------------
// Realtime plumbing
// -----------------------------------------------------------------------------

/**
 * The listeners, and the one channel they share.
 *
 * The console, the notification pop-up, the side panel and the nav badge all read the
 * same store, so one channel serves them all. An event only says that something moved:
 * the fresh list comes from the table, which is what keeps the ordering and the read
 * markers in one place rather than in a dozen event handlers.
 */
const listeners = new Set<(threads: CommsThread[]) => void>();
let channel: RealtimeChannel | null = null;

function closeChannel(): void {
  const client = getSupabaseBrowserClient();
  if (client === null || channel === null) return;

  void client.removeChannel(channel);
  channel = null;
}

let supabaseCommsRepository: SupabaseCommsRepository | null = null;

export function getSupabaseCommsRepository(): CommsRepository {
  if (supabaseCommsRepository === null) supabaseCommsRepository = new SupabaseCommsRepository();

  return supabaseCommsRepository;
}
