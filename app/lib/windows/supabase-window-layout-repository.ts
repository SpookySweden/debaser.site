import { getSupabaseBrowserClient } from '../supabase/client';
import { readSavedLayouts, type SavedLayouts } from '../ui/window-layout';
import type { WindowLayoutRepository } from './repository';

/**
 * Layouts in `window_layouts`: one row per account, the whole bundle in one `jsonb` column.
 *
 * Added by `supabase/migrations/20261013000031_window_layouts.sql`. Row Level Security lets an account
 * read and write its own row and nobody else's, so `user_id` is only ever the signed-in account.
 *
 * A project that has not run the migration yet reads as "no saved layout" rather than failing, so the
 * windows simply start in their corners - the table missing is not something a reader can act on.
 */
const TABLE = 'window_layouts';

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message ?? '');
}

const repository: WindowLayoutRepository = {
  async load(userId) {
    const client = getSupabaseBrowserClient();
    if (client === null) return null;

    const { data, error } = await client.from(TABLE).select('layouts').eq('user_id', userId).maybeSingle();
    if (error !== null) {
      if (isMissingTable(error)) return null;
      throw new Error(error.message);
    }

    return data === null ? null : readSavedLayouts(data.layouts);
  },

  async save(userId, layouts: SavedLayouts) {
    const client = getSupabaseBrowserClient();
    if (client === null) return;

    const { error } = await client
      .from(TABLE)
      .upsert({ user_id: userId, layouts, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error !== null && !isMissingTable(error)) throw new Error(error.message);
  },
};

export function getSupabaseWindowLayoutRepository(): WindowLayoutRepository {
  return repository;
}
