import { getSupabaseBrowserClient } from '../supabase/client';
import { DEFAULT_NOTIFICATION_PREFS, LIVE_WATCHES_MAX, parseNotificationPrefs, type NotificationPrefs, type NotifySettingsRepository } from './prefs';

/**
 * The notification switches (`notification_prefs`) and TELL ME WHEN LIVE picks (`live_watches`) in Supabase
 * (20261120014611_notifications_phase1.sql). Both tables are owner only, so nothing here is trusted for who may read or
 * change what: Row Level Security is the lock. The unsubscribe code and the last email time are never asked for.
 */

const PREF_COLUMNS = 'replies, letters, live, comic, invites, balloons, weekly_email';

/** The database is behind the code (the migration not run yet): the defaults stand and nothing is said. */
function isMissingSchema(error: { code?: string; message: string }): boolean {
  return ['PGRST205', 'PGRST204', '42P01', '42703'].includes(error.code ?? '') || /schema cache|does not exist/i.test(error.message);
}

function client() {
  const db = getSupabaseBrowserClient();
  if (db === null) throw new Error('NOTIFICATION SETTINGS NEED SUPABASE.');
  return db;
}

class SupabaseNotifySettingsRepository implements NotifySettingsRepository {
  readonly source = 'supabase' as const;

  async readPrefs(person: string): Promise<NotificationPrefs> {
    const { data, error } = await client().from('notification_prefs').select(PREF_COLUMNS).eq('person', person).maybeSingle();
    if (error !== null) {
      if (isMissingSchema(error)) return { ...DEFAULT_NOTIFICATION_PREFS };
      throw new Error('YOUR NOTIFICATION SWITCHES DID NOT LOAD.');
    }
    return data === null ? { ...DEFAULT_NOTIFICATION_PREFS } : parseNotificationPrefs(data);
  }

  async savePrefs(person: string, prefs: NotificationPrefs): Promise<void> {
    const { error } = await client()
      .from('notification_prefs')
      .upsert(
        {
          person,
          replies: prefs.replies,
          letters: prefs.letters,
          live: prefs.live,
          comic: prefs.comic,
          invites: prefs.invites,
          balloons: prefs.balloons,
          weekly_email: prefs.weeklyEmail,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'person' },
      );
    if (error !== null) throw new Error('THAT SWITCH DID NOT SAVE. TRY AGAIN.');
  }

  async listWatches(person: string): Promise<string[]> {
    const { data, error } = await client()
      .from('live_watches')
      .select('host, created_at')
      .eq('watcher', person)
      .order('created_at', { ascending: false })
      .limit(LIVE_WATCHES_MAX);
    if (error !== null) {
      if (isMissingSchema(error)) return [];
      throw new Error('YOUR PICKS DID NOT LOAD.');
    }
    return ((data ?? []) as { host: string }[]).map((row) => row.host);
  }

  async addWatch(person: string, host: string): Promise<void> {
    const { error } = await client().from('live_watches').insert({ watcher: person, host });
    // Already picked: what was asked for is true.
    if (error !== null && error.code !== '23505') throw new Error('COULD NOT PICK THEM. TRY AGAIN.');
  }

  async removeWatch(person: string, host: string): Promise<void> {
    const { error } = await client().from('live_watches').delete().eq('watcher', person).eq('host', host);
    if (error !== null) throw new Error('COULD NOT UNPICK THEM. TRY AGAIN.');
  }
}

let repository: SupabaseNotifySettingsRepository | null = null;

export function getSupabaseNotifySettingsRepository(): NotifySettingsRepository {
  if (repository === null) repository = new SupabaseNotifySettingsRepository();
  return repository;
}
