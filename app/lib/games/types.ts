/**
 * The arcade: two games, and the invitations that put two accounts into one of them.
 *
 * Storage agnostic like the board, the profiles and the feed: the mock repository in this folder
 * works on one browser today and the Supabase one drops in behind the same interface. What is
 * played is decided here and nowhere else - a game is an id, and every screen reads the same
 * catalogue (./catalogue.ts) rather than inventing its own list.
 *
 * The line between a game and artwork, since this site draws nothing in code: a board of nine
 * plates, a court, a paddle and a ball are chrome - the same raised grey rectangles, borders and
 * navy fills every other control on the site is made of, moved by rules. Nothing here depicts a
 * character or an illustration, and nothing ever should: a picture of a person is a hand-drawn
 * file, shown through `<Image />` (see ProfileAvatar's own placeholder path).
 */

export type GamesDataSource = 'mock' | 'supabase';

/** The games the arcade carries. The id is what an invitation names and what a match launches. */
export type GameId = 'tic-tac-toe' | 'paddle-duel';

export const GAME_IDS: GameId[] = ['tic-tac-toe', 'paddle-duel'];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as string[]).includes(value);
}

/** Pending until the person asked answers; either side may cancel, which removes the row. */
export type GameInviteStatus = 'pending' | 'accepted' | 'declined';

/**
 * One invitation, as both sides read it.
 *
 * The names are stored with the ids for the same reason a notification stores its actor's name:
 * a row has to be readable and drawable after the account that wrote it has gone. `game` is what
 * gets launched, and the pair of ids is the whole of the addressing - a match is a channel named
 * after the invite, so no third account can join by guessing.
 */
export type GameInvite = {
  id: string;
  game: GameId;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  status: GameInviteStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateInviteInput = {
  game: GameId;
  from: { id: string; displayName: string };
  to: { id: string; displayName: string };
};

/** How long an unanswered invitation is good for, on the screen and in the rules. */
export const INVITE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Storage contract for the arcade.
 *
 * Supabase swap-in plan (the tables are section 23 of `supabase/schema.sql`):
 *   `list`         -> `select * from game_invites where from_user = $1 or to_user = $1 order by created_at desc`
 *   `create`       -> `insert into game_invites (from_user, from_name, to_user, to_name, game)`,
 *                     which the policy only allows signed by the sender and never addressed to them
 *   `setStatus`    -> `update game_invites set status = $2, updated_at = now() where id = $1`,
 *                     which the policy allows for either party - the recipient answers with it and
 *                     the sender cancels with it
 *   `remove`       -> `delete from game_invites where id = $1`, either party
 *   `subscribe`    -> `supabase.channel('game_invites').on('postgres_changes', ...)`
 *
 * RLS: a row is readable, updatable and deletable by the two accounts it names and by nobody else,
 * while an insert is allowed for any signed-in, unbanned account as long as it is signed by the
 * sender (`from_user = auth.uid()`) and addressed to somebody other than themselves.
 *
 * Unlike a notification, the sender *may* read back the row it just wrote - the read policy names
 * both parties - so `create` returns the invitation it filed. That is also what lets the hub file
 * the recipient's notification afterwards, naming the invite it belongs to.
 */
export type GamesRepository = {
  readonly source: GamesDataSource;
  /** Every invitation this account is part of, newest first: sent and received alike. */
  list(userId: string): Promise<GameInvite[]>;
  /** Files one invitation, and hands it back so the caller can tell the recipient. */
  create(input: CreateInviteInput): Promise<GameInvite>;
  /** Answers one, or cancels it: the recipient accepts or declines, the sender cancels. */
  setStatus(inviteId: string, status: GameInviteStatus): Promise<void>;
  /** Takes it off the board for both sides. */
  remove(inviteId: string): Promise<void>;
  /** Realtime hook: fires with the account's fresh list whenever either side's row moves. */
  subscribe(userId: string, listener: (invites: GameInvite[]) => void): () => void;
  /** Mock-only helper so local invitations can be purged. */
  clearLocalInvites?(): Promise<void>;
};
