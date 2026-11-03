import { getSupabaseBrowserClient } from '../supabase/client';
import { readLook } from './looks';
import type { LookRepository } from './look-repository';

/**
 * Looks in `cytube_looks`: one row per person, `look` (a preset name or null) and `show_host_look`.
 *
 * Row Level Security is the lock: signed-in people read every row, and only the owner inserts or changes
 * theirs. A project that has not run the migration reads as "no look" (the site's own theme), never a fault.
 */
const TABLE = 'cytube_looks';

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message ?? '');
}

const repository: LookRepository = {
  async load(userId) {
    const client = getSupabaseBrowserClient();
    if (client === null) return null;
    const { data, error } = await client.from(TABLE).select('look, show_host_look').eq('user_id', userId).maybeSingle();
    if (error !== null) {
      if (isMissingTable(error)) return null;
      throw new Error('THE LOOK COULD NOT BE READ.');
    }
    if (data === null) return null;
    const row = data as { look: unknown; show_host_look: unknown };
    return { look: readLook(row.look), showHostLook: row.show_host_look !== false };
  },

  async save(by, choice) {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('YOUR LOOK COULD NOT BE SAVED.');
    const { error } = await client
      .from(TABLE)
      .upsert({ user_id: by, look: readLook(choice.look), show_host_look: choice.showHostLook, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error !== null) throw new Error('YOUR LOOK COULD NOT BE SAVED.');
  },
};

export function getSupabaseLookRepository(): LookRepository {
  return repository;
}
