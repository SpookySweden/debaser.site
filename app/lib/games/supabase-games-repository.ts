import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { CreateInviteInput, GameId, GameInvite, GameInviteStatus, GamesRepository } from './types';

/**
 * Invitations in the project's own database (section 23 of `supabase/schema.sql`).
 *
 *   game_invites  id, game, from_user, from_name, to_user, to_name, status, created_at, updated_at
 *
 * Read by the two accounts a row names, written by either of them: the sender inserts it, the
 * recipient answers it with `status`, and both parties may delete it (the sender cancels, the
 * recipient clears one they have answered). Nobody else can list, change or remove it, which is what
 * makes a channel named after the row private to the pair.
 */

const TABLE = 'game_invites';

type InviteRow = {
  id: string;
  game: GameId;
  from_user: string;
  from_name: string;
  to_user: string;
  to_name: string;
  status: GameInviteStatus;
  created_at: string;
  updated_at: string;
};

function toInvite(row: InviteRow): GameInvite {
  return {
    id: row.id,
    game: row.game,
    fromUserId: row.from_user,
    // A row has to be drawable after the account that wrote it is gone, so the names are stored
    // with the ids and read back rather than looked up.
    fromName: row.from_name.length > 0 ? row.from_name : 'Anonymous',
    toUserId: row.to_user,
    toName: row.to_name.length > 0 ? row.to_name : 'Anonymous',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseGamesRepository implements GamesRepository {
  readonly source = 'supabase' as const;

  private client(): SupabaseClient {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('GAME_INVITES_NEED_SUPABASE_KEYS');

    return client;
  }

  /**
   * The project's own words, turned into something a player can act on.
   *
   * The two codes worth naming are the two states a project can be in before the section has run:
   * `PGRST205` is the table being absent, and `42501` is it being there with no policy for what was
   * attempted. Everything else is passed through as it came.
   */
  private refuse(error: { code?: string; message: string }): never {
    if (error.code === 'PGRST205') {
      throw new Error('GAME_INVITES_NEED_MIGRATION :: the arcade tables are not in this project yet.');
    }

    if (error.code === '42501') {
      throw new Error('GAME_INVITES_NEED_POLICIES :: the arcade tables are there but their policies are not.');
    }

    throw new Error(error.message);
  }

  async list(userId: string): Promise<GameInvite[]> {
    const { data, error } = await this.client()
      .from(TABLE)
      .select('*')
      .or(`from_user.eq.${userId},to_user.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error !== null) this.refuse(error);

    return ((data ?? []) as InviteRow[]).map(toInvite);
  }

  /**
   * Files one invitation and hands it back.
   *
   * The return is asked for here, unlike a notification's, and the difference is the read policy:
   * this row names both accounts, so the sender may read what they wrote. The id that comes back is
   * what the recipient's notification is filed against, and what the two clients name their channel
   * after, so the write and its answer are one round trip.
   */
  async create(input: CreateInviteInput): Promise<GameInvite> {
    if (input.from.id === input.to.id) throw new Error('YOU CANNOT INVITE YOURSELF.');

    const { data, error } = await this.client()
      .from(TABLE)
      .insert({
        game: input.game,
        from_user: input.from.id,
        from_name: input.from.displayName,
        to_user: input.to.id,
        to_name: input.to.displayName,
      })
      .select('*')
      .single();

    if (error !== null) this.refuse(error);

    return toInvite(data as InviteRow);
  }

  async setStatus(inviteId: string, status: GameInviteStatus): Promise<void> {
    // The id comes back so a call for a row that is not there (or not this account's) is an error
    // rather than a silent nothing.
    const { data, error } = await this.client()
      .from(TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .select('id');

    if (error !== null) this.refuse(error);
    if ((data ?? []).length === 0) throw new Error('THAT INVITATION IS NOT YOURS.');
  }

  async remove(inviteId: string): Promise<void> {
    const { error } = await this.client().from(TABLE).delete().eq('id', inviteId);
    if (error !== null) this.refuse(error);
  }

  /**
   * Both halves of the pair, re-read whenever either row moves.
   *
   * Two filtered subscriptions rather than one unfiltered: only the rows this account is part of are
   * sent, and the listener then gets the same list `list` would return, so the screen never has to
   * merge a payload into what it holds.
   */
  subscribe(userId: string, listener: (invites: GameInvite[]) => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;

    const channel = client
      .channel(`game-invites-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `to_user=eq.${userId}` }, () => {
        void this.list(userId).then(listener);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `from_user=eq.${userId}` }, () => {
        void this.list(userId).then(listener);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }
}

let repository: SupabaseGamesRepository | null = null;

export function getSupabaseGamesRepository(): GamesRepository {
  repository ??= new SupabaseGamesRepository();

  return repository;
}
