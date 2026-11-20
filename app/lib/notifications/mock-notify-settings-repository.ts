import { DEFAULT_NOTIFICATION_PREFS, LIVE_WATCHES_MAX, parseNotificationPrefs, type NotificationPrefs, type NotifySettingsRepository } from './prefs';

/**
 * The notification switches and TELL ME WHEN LIVE picks while Supabase isn't wired up: this browser's storage, like
 * every other mock store, keyed by account, so a local drive can seed and read it. The mock feed reads the same rows
 * to drop a switched-off kind, as the database's gate does.
 */
export const MOCK_NOTIFY_SETTINGS_KEY = 'debaser.notify-settings.mock.v1';

type MockRow = { prefs?: unknown; watches?: unknown };
type MockRows = Record<string, MockRow>;

function readRows(): MockRows {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MOCK_NOTIFY_SETTINGS_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as MockRows) : {};
  } catch {
    return {};
  }
}

function writeRow(person: string, patch: MockRow): void {
  if (typeof window === 'undefined') return;
  const rows = readRows();
  rows[person] = { ...(rows[person] ?? {}), ...patch };
  try {
    window.localStorage.setItem(MOCK_NOTIFY_SETTINGS_KEY, JSON.stringify(rows));
  } catch {
    // Storage off or full: the switches keep working for this page.
  }
}

/** A person's switches as the mock has them (the defaults when they have none). Read by the mock feed's gate too. */
export function mockPrefsFor(person: string): NotificationPrefs {
  const row = readRows()[person];
  return row?.prefs === undefined ? { ...DEFAULT_NOTIFICATION_PREFS } : parseNotificationPrefs(row.prefs);
}

function watchesOf(person: string): string[] {
  const value = readRows()[person]?.watches;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

class MockNotifySettingsRepository implements NotifySettingsRepository {
  readonly source = 'mock' as const;

  async readPrefs(person: string): Promise<NotificationPrefs> {
    return mockPrefsFor(person);
  }

  async savePrefs(person: string, prefs: NotificationPrefs): Promise<void> {
    writeRow(person, { prefs });
  }

  async listWatches(person: string): Promise<string[]> {
    return watchesOf(person);
  }

  async addWatch(person: string, host: string): Promise<void> {
    if (host === person) return;
    const current = watchesOf(person).filter((id) => id !== host);
    if (current.length >= LIVE_WATCHES_MAX) return;
    writeRow(person, { watches: [host, ...current] });
  }

  async removeWatch(person: string, host: string): Promise<void> {
    writeRow(person, { watches: watchesOf(person).filter((id) => id !== host) });
  }
}

let repository: MockNotifySettingsRepository | null = null;

export function getMockNotifySettingsRepository(): NotifySettingsRepository {
  if (repository === null) repository = new MockNotifySettingsRepository();
  return repository;
}
