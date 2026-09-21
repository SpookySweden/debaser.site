import { formatStamp } from '../forum/format';
import { nameColourHex } from './name-colours';

/**
 * Presence: who is actually at the keyboard.
 *
 * One record per account, written by that account's own browser: a heartbeat
 * while the site is open, and a goodbye when the tab closes or the visitor signs
 * out. The dot beside a username is derived from the record alone, so the same
 * three colours come out of the mock store and, later, out of Supabase.
 *
 * The mock store is per browser, so today the only green dot anybody sees is
 * their own (and any other local test account's, once it has been signed in and
 * left). The shape is the one Supabase needs - `profiles.last_seen_at` plus an
 * `is_online` flag, or Supabase Realtime Presence for exact connect/disconnect
 * events - and no component changes when that lands.
 */
export type PresenceRecord = {
  userId: string;
  /** Last heartbeat (or goodbye) from any tab of that account. */
  lastSeenAt: string;
  /** False once the account said goodbye; `lastSeenAt` then dates the goodbye. */
  online: boolean;
};

export type PresenceStatus = 'online' | 'recent' | 'offline';

/** A heartbeat inside this window means "at the keyboard right now". */
export const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** Seen inside this window still counts as "was here within the last hour". */
export const PRESENCE_RECENT_WINDOW_MS = 60 * 60 * 1000;
/** How often an open tab says it is still there. */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
/** How often the dots recheck the clock, so a stale one fades on its own. */
export const PRESENCE_TICK_MS = 30 * 1000;

/**
 * The dot's state, judged on the clock rather than on the flag alone: a tab that
 * was closed without a goodbye leaves `online` true behind it, and a record that
 * old is not online any more.
 */
export function presenceStatus(record: PresenceRecord | undefined, now: number): PresenceStatus {
  if (record === undefined) return 'offline';

  const seen = Date.parse(record.lastSeenAt);
  if (Number.isNaN(seen)) return 'offline';

  const age = now - seen;
  if (record.online && age <= PRESENCE_ONLINE_WINDOW_MS) return 'online';
  if (age <= PRESENCE_RECENT_WINDOW_MS) return 'recent';

  return 'offline';
}

/** The lamp's colour: three of the sixteen swatches (green / yellow / red). */
export function presenceDotColour(status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return nameColourHex('green') ?? '#008000';
    case 'recent':
      return nameColourHex('yellow') ?? '#ffff00';
    default:
      return nameColourHex('red') ?? '#ff0000';
  }
}

/** Plain words for the tooltip and the profile's status line. */
export function presenceLabel(status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return 'ONLINE NOW';
    case 'recent':
      return 'ONLINE WITHIN THE LAST HOUR';
    default:
      return 'OFFLINE';
  }
}

/** The lamp's tooltip: the state, and when they were last around. */
export function presenceTooltip(status: PresenceStatus, record: PresenceRecord | undefined): string {
  const label = presenceLabel(status);
  if (record === undefined) return label;

  return `${label} :: LAST SEEN ${formatStamp(record.lastSeenAt)}`;
}
