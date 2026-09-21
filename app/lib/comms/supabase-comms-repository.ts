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
 * construction - a conversation is readable only by the two accounts in it, and a
 * message can only be signed by its writer:
 *
 *   comms_threads   id text (`dm:<low id>|<high id>`), participant_a, participant_b,
 *                   created_at, updated_at
 *   comms_messages  id uuid, thread_id, author_id, author_name, body, created_at
 *   comms_reads     thread_id, user_id, last_read_at   (primary key: both)
 *
 * The thread id is derived from the pair on both sides, so opening a conversation
 * is a lookup rather than a search and the two participants always agree on it.
 * `updated_at` is what the conversation list sorts by; a trigger keeps it true.
 */

const THREADS_TABLE = 'comms_threads';
const MESSAGES_TABLE = 'comms_messages';
const READS_TABLE = 'comms_reads';
const MEMBERS_TABLE = 'comms_members';

/** One read per conversation: the thread, its members, its messages and its markers. */
const THREAD_SELECT = `*, ${MEMBERS_TABLE}(user_id), ${MESSAGES_TABLE}(*), ${READS_TABLE}(*)`;

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

  async listThreads(userId: string): Promise<CommsThread[]> {
    // No filter on the pair any more: a conversation comes back when you are in it,
    // by membership (a group) or by being one of its pair (a dm), and that rule is
    // the RLS policy's rather than this query's. `userId` still decides whose read
    // markers matter, which is why it is read below.
    void userId;

    const { data, error } = await this.client()
      .from(THREADS_TABLE)
      .select(THREAD_SELECT)
      .order('updated_at', { ascending: false });

    if (error !== null) this.fail(error.message);

    return ((data ?? []) as ThreadRow[]).map(toThread);
  }

  private async getThread(threadId: string): Promise<CommsThread | null> {
    const { data, error } = await this.client()
      .from(THREADS_TABLE)
      .select(THREAD_SELECT)
      .eq('id', threadId)
      .maybeSingle();

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

    const { error } = await this.client()
      .from(THREADS_TABLE)
      .upsert(
        { id, kind: 'dm', name: '', participant_a: participantA, participant_b: participantB },
        { onConflict: 'id', ignoreDuplicates: true },
      );

    if (error !== null) this.fail(error.message);

    const opened = await this.getThread(id);
    if (opened === null) this.fail('THAT CONVERSATION COULD NOT BE OPENED.');

    return opened;
  }

  /**
   * Opens a group.
   *
   * The row first (with its minted `grp:` id and its name), then the members - the
   * creator before anybody else, because the membership policy lets you add somebody
   * to a conversation you are already in. A group stores no pair at all, so
   * `participant_a` / `participant_b` stay null and membership is the whole answer.
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

    return created;
  }

  async addMember(threadId: string, userId: string): Promise<CommsThread> {
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

    return updated;
  }

  /** Moves that account's read marker to the newest message. */
  async markRead(userId: string, threadId: string): Promise<CommsThread> {
    const thread = await this.getThread(threadId);
    if (thread === null) this.fail('THAT CONVERSATION IS NOT THERE.');

    const newest = thread.messages.at(-1)?.createdAt ?? thread.createdAt;

    const { error } = await this.client()
      .from(READS_TABLE)
      .upsert({ thread_id: threadId, user_id: userId, last_read_at: newest }, { onConflict: 'thread_id,user_id' });

    if (error !== null) this.fail(error.message);

    return { ...thread, readAt: { ...thread.readAt, [userId]: newest } };
  }

  /** One channel for the whole page; see the note below. */
  subscribe(listener: (threads: CommsThread[]) => void): () => void {
    listeners.add(listener);
    openChannel(this);

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
 * The console, the notification pop-up, the side panel and the nav badge all read
 * the same store, so one channel serves them all. An event only says that
 * something moved: the fresh list comes from the table, which is what keeps the
 * ordering and the read markers in one place rather than in a dozen event handlers.
 */
const listeners = new Set<(threads: CommsThread[]) => void>();
let channel: RealtimeChannel | null = null;

function openChannel(repository: SupabaseCommsRepository): void {
  if (channel !== null) return;

  const client = getSupabaseBrowserClient();
  if (client === null) return;

  const refresh = () => {
    // The session decides whose conversations these are: the channel is shared,
    // the list is not.
    void client.auth
      .getUser()
      .then(async ({ data }) => {
        const userId = data.user?.id;
        if (userId === undefined) return;

        const threads = await repository.listThreads(userId);
        for (const listener of listeners) listener(threads);
      })
      .catch(() => undefined);
  };

  channel = client
    .channel('comms-inbox')
    .on('postgres_changes', { event: '*', schema: 'public', table: MESSAGES_TABLE }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: THREADS_TABLE }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: READS_TABLE }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: MEMBERS_TABLE }, refresh)
    .subscribe();
}

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
