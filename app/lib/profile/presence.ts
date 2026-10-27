import { DYES } from '../ui/themes';
import { nameColourHex } from './name-colours';
import { relativeTime } from '../ui/relative-time';

/**
 * Presence: who is actually at the keyboard.
 *
 * Two sources, read together:
 *
 *   - the live room (`LivePresence`): every open tab of the site joins one Supabase Realtime Presence
 *     channel and says whether it is in use. Joining and leaving reach every other tab in a second or
 *     two, so this is what turns a lamp green, yellow or red;
 *   - the stored record (`PresenceRecord`, `profiles.last_seen_at` + `is_online`): a heartbeat once a
 *     minute while a tab is open. It dates "LAST ONLINE 12 MINUTES AGO", and it stands in for the room
 *     while the room is not connected (the clock rule in `presenceStatus`).
 */
export type PresenceRecord = {
  userId: string;
  /** Last heartbeat (or goodbye) from any tab of that account. */
  lastSeenAt: string;
  /** False once the account said goodbye; `lastSeenAt` then dates the goodbye. */
  online: boolean;
};

/** Green: a tab is open and in use. Yellow: a tab is open but nobody is using it. Red: no tab open. */
export type PresenceStatus = 'online' | 'away' | 'offline';

/** What one tab tells the live room about itself. */
export type LiveState = 'active' | 'away';

/**
 * The live room: every account with a tab open, and whether any of its tabs is in use (one in use is
 * enough for green). Null while the room is not connected, so callers fall back to the stored record.
 */
export type LivePresence = Record<string, LiveState>;

/** Without the live room: a heartbeat inside this window means the site is open. */
export const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** How often an open tab stamps `last_seen_at`. */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
/** How often the dots recheck the clock, so "12 MINUTES AGO" keeps up and the fallback ages out. */
export const PRESENCE_TICK_MS = 30 * 1000;
/** A tab in the background this long is away (a quick look at another tab is not). */
export const PRESENCE_AWAY_HIDDEN_MS = 30 * 1000;
/** A tab in front with no mouse, key or touch for this long is away. */
export const PRESENCE_AWAY_IDLE_MS = 5 * 60 * 1000;

/**
 * Folds every tab in the room into one state per account: any tab in use makes the account active.
 */
export function mergeLiveStates(entries: Array<{ userId: string; state: LiveState }>): LivePresence {
  const merged: LivePresence = {};
  for (const { userId, state } of entries) {
    if (merged[userId] !== 'active') merged[userId] = state;
  }

  return merged;
}

/**
 * The dot's state.
 *
 * With the live room connected it alone decides: in the room and in use is green, in the room but idle
 * is yellow, not in the room is red. Without it (still connecting, or Realtime unreachable) the stored
 * record decides on the clock - a tab closed without a goodbye leaves `online` true behind it, and a
 * record that old is not online any more. The fallback never says away: only a tab can know that.
 */
export function presenceStatus(
  record: PresenceRecord | undefined,
  now: number,
  live: LivePresence | null = null,
  userId: string | undefined = record?.userId,
): PresenceStatus {
  if (live !== null) {
    const state = userId === undefined ? undefined : live[userId];
    if (state === 'active') return 'online';
    if (state === 'away') return 'away';
    return 'offline';
  }

  if (record === undefined) return 'offline';

  const seen = Date.parse(record.lastSeenAt);
  if (Number.isNaN(seen)) return 'offline';

  return record.online && now - seen <= PRESENCE_ONLINE_WINDOW_MS ? 'online' : 'offline';
}

/** The lamp's colour: three of the eight dyes (Emerald / Daffodil / Rose). */
export function presenceDotColour(status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return nameColourHex('emerald') ?? DYES.emerald;
    case 'away':
      return nameColourHex('daffodil') ?? DYES.daffodil;
    default:
      return nameColourHex('rose') ?? DYES.rose;
  }
}

/** Plain words for the tooltip and the profile's status line. */
export function presenceLabel(status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return 'ONLINE NOW';
    case 'away':
      return 'AWAY';
    default:
      return 'OFFLINE';
  }
}

/**
 * The one line a lamp is read as: whether they are here, and if not, how long ago.
 *
 * `presenceLabel` is the short form - the lamp's own two or three words, for an aria-label or a
 * legend - and this is the sentence a tooltip or a status bar carries. A relative reading replaced the
 * absolute `LAST SEEN 2026-09-21 11:00` stamp because that is the question actually being asked of a
 * name ("are they about?"), and because a UTC stamp is not an answer to it for a reader in another
 * time zone. An account with no record at all is the one case relative time cannot phrase: nobody has
 * ever heard from them, so it says that instead.
 *
 * `now` defaults to the clock at call time, which is what a tooltip wants: a row that is redrawn when
 * presence changes (`PRESENCE_TICK_MS`) re-reads it, so the number keeps up without an interval of
 * its own on every row of a directory.
 */
export function presenceLine(
  status: PresenceStatus,
  record: PresenceRecord | undefined,
  now: number = Date.now(),
): string {
  if (status !== 'offline') return presenceLabel(status);
  if (record === undefined) return 'NEVER SEEN';

  return `LAST ONLINE ${relativeTime(record.lastSeenAt, now)}`;
}
