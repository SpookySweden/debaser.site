import { isGameId } from '../games/types';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { dedupeTargets, snippet, sortNotificationsNewestFirst } from './feed';
import type { AppNotification, NotificationKind, NotificationsRepository, NotifyInput } from './types';

/**
 * The notification feed in Supabase - the production implementation of
 * `NotificationsRepository`. Dormant until the table in `supabase/schema.sql` exists and
 * `NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE=supabase` is set (see ./repository.ts).
 *
 * The table this code expects, with the RLS rules the mock store keeps by construction - a row
 * belongs to the account it names, and it is signed by whoever wrote the tag or the reply:
 *
 *   forum_notifications  id uuid, user_id uuid, kind text ('tag' | 'reply'), actor_id uuid,
 *                        actor_name text, thread_id uuid, thread_title text, body text,
 *                        created_at timestamptz, read_at timestamptz (null while unread)
 *
 * The reason this is its own table rather than a column on the board: a post is read by
 * everybody, a notification is read by one account. Tags and replies therefore have to be rows
 * an account can own, list and mark seen on its own - which is exactly what RLS is for.
 */

const TABLE = 'forum_notifications';

/**
 * What the bell is told when this database has not had the notification script.
 *
 * A deployment step rather than a mistake the reader made, so it names the file to run. The
 * board keeps working; only the feed is empty.
 */
export const NOTIFICATIONS_NEED_MIGRATION =
  'THE NOTIFICATION FEED NEEDS A ONE-TIME DATABASE UPDATE: RUN supabase/migrations/20260923_notifications.sql (OR SECTION 17 OF supabase/schema.sql) IN THE SUPABASE SQL EDITOR, THEN RELOAD. POSTING AND REPLYING ARE UNAFFECTED.';

/**
 * What the bell is told when the table is there but its rules are not.
 *
 * A table can exist with the four policies missing - a script that stopped halfway, a `create table`
 * pasted on its own, a policy block run while it was not what was selected in the editor - and the
 * only thing the client ever sees of that is Postgres refusing every write with `42501`, in words
 * about row-level security that name no fix. So the database's own sentence is kept (it is the
 * truth) and the sentence that says which file to run is put beside it.
 */
export const NOTIFICATIONS_NEED_POLICIES =
  'THE FEED`S OWN RULES ARE NOT IN PLACE, SO NOTHING CAN BE FILED: RUN supabase/migrations/20260923_notifications.sql (OR SECTION 17 OF supabase/schema.sql) IN THE SUPABASE SQL EDITOR, THEN RELOAD - IT RECREATES EACH POLICY BY NAME, SO IT IS SAFE TO RUN AGAIN. THE POST, THE REPLY AND THE TAG IN ITS WORDS ARE ALL UNAFFECTED.';

/** The codes PostgREST and Postgres answer with when the database is behind the code. */
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST204', 'PGRST205', 'PGRST106', '42P01', '42703']);

type QueryError = { message: string; code?: string };

function isMissingSchema(error: QueryError): boolean {
  if (typeof error.code === 'string' && MISSING_SCHEMA_CODES.has(error.code)) return true;

  return /schema cache|does not exist|could not find/i.test(error.message);
}

/** `42501` is what a row-level security refusal carries, whatever the policy that refused. */
function isPolicyRefusal(error: QueryError): boolean {
  return error.code === '42501' || /row-level security policy/i.test(error.message);
}

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  actor_id: string | null;
  actor_name: string;
  thread_id: string | null;
  thread_title: string;
  body: string;
  /** Section 23: the game an invitation is for, and the row it belongs to. Null on a tag or reply. */
  game_id?: string | null;
  invite_id?: string | null;
  created_at: string;
  read_at: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind === 'reply' ? 'reply' : row.kind === 'invite' ? 'invite' : 'tag',
    actorId: row.actor_id,
    actorName: row.actor_name,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    body: row.body,
    gameId: isGameId(row.game_id) ? row.game_id : null,
    inviteId: row.invite_id ?? null,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

type Listener = (items: AppNotification[]) => void;

class SupabaseNotificationsRepository implements NotificationsRepository {
  readonly source = 'supabase' as const;

  private fail(message: string): never {
    throw new Error(message);
  }

  /**
   * The store's own words for a write it would not take, with the script to run beside them when the
   * cause is the database being behind the code rather than the row being wrong.
   */
  private refuse(error: QueryError): never {
    if (isMissingSchema(error)) this.fail(NOTIFICATIONS_NEED_MIGRATION);
    if (isPolicyRefusal(error)) this.fail(`${error.message} :: ${NOTIFICATIONS_NEED_POLICIES}`);

    this.fail(error.message);
  }

  private client() {
    const client = getSupabaseBrowserClient();
    if (client === null) this.fail('THE NOTIFICATION FEED NEEDS SUPABASE TO BE CONFIGURED.');

    return client;
  }

  /** The account's own feed, as the table has it. One read, one order. */
  private async read(userId: string): Promise<AppNotification[]> {
    const { data, error } = await this.client()
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error !== null) {
      this.refuse(error);
    }

    return sortNotificationsNewestFirst(((data ?? []) as NotificationRow[]).map(toNotification));
  }

  async list(userId: string): Promise<AppNotification[]> {
    return this.read(userId);
  }

  /**
   * Files one row per account to tell.
   *
   * The rows are written together, so a post that tags three people either tells all three or
   * none of them: a half-delivered tag is worse than a retry. The policy refuses anything not
   * signed by its actor, which is what keeps the feed honest about who did it.
   *
   * No return is asked for, and nothing comes back. A row is addressed to somebody else, so the
   * account that files it cannot read it - `insert(...).select()` would make PostgREST read back a
   * row the read policy refuses and fail the whole write with `new row violates row-level security
   * policy` (see the contract in ./types.ts). What was filed is the recipient's to see.
   */
  async notify(input: NotifyInput): Promise<void> {
    const targets = dedupeTargets(input.targets, input.actorId);
    if (targets.length === 0) return;

    const rows = targets.map((target) => ({
      user_id: target.userId,
      kind: target.kind satisfies NotificationKind,
      actor_id: input.actorId,
      actor_name: input.actorName,
      // The board's ids are uuids; anything else is not a post this table can point at.
      thread_id: UUID.test(input.threadId) ? input.threadId : null,
      thread_title: input.threadTitle,
      body: snippet(input.body),
      // Section 23's two columns, written only when the row is about a game.
      game_id: input.gameId ?? null,
      invite_id: input.inviteId ?? null,
    }));

    const { error } = await this.client().from(TABLE).insert(rows);
    if (error !== null) {
      this.refuse(error);
    }
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { error } = await this.client()
      .from(TABLE)
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('read_at', null);

    if (error !== null) {
      this.refuse(error);
    }

    await this.publish(userId);
  }

  async markAllRead(userId: string): Promise<void> {
    const { error } = await this.client()
      .from(TABLE)
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error !== null) {
      this.refuse(error);
    }

    await this.publish(userId);
  }

  /** Hands the account's fresh feed to its listeners; the reader's own screen shows it now. */
  private async publish(userId: string): Promise<void> {
    const items = await this.read(userId);
    for (const entry of listeners) if (entry.userId === userId) entry.listener(items);
  }

  subscribe(userId: string, listener: Listener): () => void {
    const entry = { userId, listener };
    listeners.add(entry);
    openChannel(userId);

    return () => {
      listeners.delete(entry);
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
 * The bell in the side panel and the menu on a phone read the same store, so one channel serves
 * both. An event only says that something moved: the fresh feed comes from the table, which is
 * what keeps the ordering and the read markers in one place rather than in a dozen handlers.
 * The channel is filtered to this account's rows, so a tab is not woken by somebody else's tags.
 */
const listeners = new Set<{ userId: string; listener: Listener }>();
let channel: RealtimeChannel | null = null;
let channelUserId: string | null = null;

function closeChannel(): void {
  const client = getSupabaseBrowserClient();
  if (client === null || channel === null) return;

  void client.removeChannel(channel);
  channel = null;
  channelUserId = null;
}

function openChannel(userId: string): void {
  const client = getSupabaseBrowserClient();
  if (client === null) return;

  if (channel !== null && channelUserId === userId) return;
  closeChannel();

  channelUserId = userId;
  channel = client
    .channel(`forum_notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${userId}` },
      () => {
        for (const entry of listeners) {
          if (entry.userId !== userId) continue;

          void repository
            ?.list(userId)
            .then((items) => entry.listener(items))
            .catch((caught: unknown) => {
              // The read is the part that matters; a failed one leaves the last feed up.
              console.warn('notification feed: could not reload after a change', caught);
            });
        }
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(
          'notification feed: realtime is not delivering - run the script in ' +
            'supabase/migrations/20260923_notifications.sql and reload. The bell still refreshes on its poll.',
        );
      }
    });
}

let repository: SupabaseNotificationsRepository | null = null;

export function getSupabaseNotificationsRepository(): NotificationsRepository {
  if (repository === null) repository = new SupabaseNotificationsRepository();

  return repository;
}
