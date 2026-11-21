import type { NotificationKind } from './types';

/**
 * The NOTIFICATIONS switches (SPEC-notifications.md, answers 5B and 6A): one per kind, covering the site and the weekly
 * email alike, plus BALLOONS (the site's pop-up only) and WEEKLY EMAIL. Saved to the account (`notification_prefs`,
 * owner only). The database applies the kind switches itself before a notification is filed; `kindAllowed` is the same
 * rule for the mock store, so the two can't disagree.
 */
export type NotificationPrefs = {
  replies: boolean;
  letters: boolean;
  live: boolean;
  comic: boolean;
  invites: boolean;
  balloons: boolean;
  weeklyEmail: boolean;
};

export type KindSwitch = 'replies' | 'letters' | 'live' | 'comic' | 'invites';

/** No row yet: everything on except COMIC NEW PAGES (following the comic turns it on) and the weekly email. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  replies: true,
  letters: true,
  live: true,
  comic: false,
  invites: true,
  balloons: true,
  weeklyEmail: false,
};

/** Which switch a kind answers to. */
export function switchFor(kind: NotificationKind): KindSwitch {
  if (kind === 'tag' || kind === 'reply') return 'replies';
  if (kind === 'recommend' || kind === 'letter') return 'letters';
  if (kind === 'live') return 'live';
  if (kind === 'comic' || kind === 'comic_reply') return 'comic';

  return 'invites';
}

/** Is a notification of this kind filed for somebody with these switches. */
export function kindAllowed(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  // A moderator's report alerts have no switch: what people report is the job (SPEC-moderation.md).
  if (kind === 'report') return true;
  return prefs[switchFor(kind)];
}

/** The PREFERENCES rows, in order, with their labels. WEEKLY EMAIL and BALLOONS are drawn after them. */
export const KIND_SWITCHES: readonly { key: KindSwitch; label: string }[] = [
  { key: 'replies', label: 'REPLIES AND TAGS' },
  { key: 'letters', label: 'LETTERS' },
  { key: 'live', label: 'ROOMS GOING LIVE' },
  { key: 'comic', label: 'COMIC NEW PAGES' },
  { key: 'invites', label: 'GAME INVITES' },
];

/** A stored row read defensively: a missing or odd field takes its default. */
export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  const row = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof NotificationPrefs, column: string) =>
    typeof row[column] === 'boolean' ? (row[column] as boolean) : DEFAULT_NOTIFICATION_PREFS[key];

  return {
    replies: pick('replies', 'replies'),
    letters: pick('letters', 'letters'),
    live: pick('live', 'live'),
    comic: pick('comic', 'comic'),
    invites: pick('invites', 'invites'),
    balloons: pick('balloons', 'balloons'),
    weeklyEmail: typeof row.weeklyEmail === 'boolean' ? row.weeklyEmail : pick('weeklyEmail', 'weekly_email'),
  };
}

/** One account's notification settings and its TELL ME WHEN LIVE picks. Mock and Supabase behind one face. */
export type NotifySettingsRepository = {
  readonly source: 'mock' | 'supabase';
  readPrefs(person: string): Promise<NotificationPrefs>;
  savePrefs(person: string, prefs: NotificationPrefs): Promise<void>;
  /** The people this account picked, newest first. */
  listWatches(person: string): Promise<string[]>;
  addWatch(person: string, host: string): Promise<void>;
  removeWatch(person: string, host: string): Promise<void>;
};

/** At most this many picks a person (the database holds the same cap). */
export const LIVE_WATCHES_MAX = 200;
