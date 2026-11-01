import { isSupabaseConfigured } from '../supabase/client';
import { getMockGamesRepository } from './mock-games-repository';
import { getSupabaseGamesRepository } from './supabase-games-repository';
import type { GamesDataSource, GamesRepository } from './types';

/**
 * The single switch that decides where invitations live.
 *
 * An invitation is one account asking another for a game, so it follows the board and the feed
 * unless it is told otherwise: a project with `NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase` gets live
 * invitations without another deployment setting, and a project on the mock board keeps them in
 * this browser. To point the arcade somewhere else:
 *
 *   NEXT_PUBLIC_GAMES_DATA_SOURCE=supabase   (or `mock`)
 *
 * Nothing in the UI changes either way: the hub talks to the GamesRepository interface, which is
 * what makes one screen serve both stores.
 */

/** An env var that was set but left blank counts as unset. */
function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

const REQUESTED =
  readSource(process.env.NEXT_PUBLIC_GAMES_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_FORUM_DATA_SOURCE);

export const GAMES_DATA_SOURCE: GamesDataSource = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getGamesRepository(): GamesRepository {
  return GAMES_DATA_SOURCE === 'supabase' ? getSupabaseGamesRepository() : getMockGamesRepository();
}
