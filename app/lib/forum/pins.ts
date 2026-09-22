import type { ForumThread, PinDurationKey, ThreadPin } from './types';

export type { PinDurationKey };

/**
 * Pinning a post: the moderator's mark, and how long it lasts.
 *
 * A pin does two things, and both are about being seen: the post sits at the top of the board
 * whatever else has been filed since, and it leads the wire - so the archive can say "read this
 * one" without writing a second post about it. The duration is the moderator's choice, because
 * the two useful kinds of announcement are different lengths: an evening's event and a standing
 * notice.
 *
 * Everything here is pure and time is passed in, so "has this lapsed" is one answer computed the
 * same way for the store, the database and the checks - rather than three pieces of clock
 * arithmetic that drift apart.
 */

export type PinDuration = {
  key: PinDurationKey;
  /** What the control says. */
  label: string;
  /** The compact form the cycling selector shows: `6H`, `1D`, `1W`, `∞`. */
  short: string;
  /** How long it lasts in minutes; null for a pin that never runs out. */
  minutes: number | null;
};

export const PIN_DURATIONS: PinDuration[] = [
  { key: 'hour', label: '6 HOURS', short: '6H', minutes: 6 * 60 },
  { key: 'day', label: '1 DAY', short: '1D', minutes: 60 * 24 },
  { key: 'week', label: '1 WEEK', short: '1W', minutes: 60 * 24 * 7 },
  { key: 'forever', label: 'FOREVER', short: '∞', minutes: null },
];

/** What the selector offers first: six hours is long enough to be seen, short enough to forget. */
export const DEFAULT_PIN_DURATION: PinDurationKey = 'hour';

export function pinDuration(key: string): PinDuration | undefined {
  return PIN_DURATIONS.find((duration) => duration.key === key);
}

export function isPinDurationKey(value: string): value is PinDurationKey {
  return pinDuration(value) !== undefined;
}

/** When a pin taken now with that duration lapses; null for forever. */
export function pinExpiry(key: PinDurationKey, from: Date = new Date()): string | null {
  const duration = pinDuration(key);
  if (duration === undefined || duration.minutes === null) return null;

  return new Date(from.getTime() + duration.minutes * 60_000).toISOString();
}

/** True while a pin still does something: forever, or not yet run out. */
export function isPinLive(pin: ThreadPin, at: Date = new Date()): boolean {
  if (pin.expiresAt === null) return true;

  return Date.parse(pin.expiresAt) > at.getTime();
}

/** The pins still doing something, newest first. A lapsed pin is simply not here. */
export function livePins(pins: ThreadPin[] | undefined, at: Date = new Date()): ThreadPin[] {
  // Tolerant of a store that has never heard of pins - the wire and the board both ask, and a
  // board that cannot order itself is worse than one with nothing pinned.
  return (pins ?? [])
    .filter((pin) => isPinLive(pin, at))
    .sort((left, right) => Date.parse(right.pinnedAt) - Date.parse(left.pinnedAt));
}

/** The live pin on that post, if it has one. */
export function pinForThread(
  pins: ThreadPin[] | undefined,
  threadId: string,
  at: Date = new Date(),
): ThreadPin | undefined {
  return livePins(pins, at).find((pin) => pin.threadId === threadId);
}

/** How long a pin has left, in the shortest honest terms. */
export function remainingLabel(expiresAt: string, at: Date = new Date()): string {
  const minutes = Math.ceil((Date.parse(expiresAt) - at.getTime()) / 60_000);
  if (minutes <= 0) return 'EXPIRED';
  if (minutes < 60) return `${minutes}M LEFT`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}H LEFT`;

  return `${Math.ceil(hours / 24)}D LEFT`;
}

/**
 * What a pinned post is stamped with.
 *
 * A pin that never runs out is simply `PINNED` - the badge is there to say why the post is at the
 * top, and "forever" is a duration nobody reading the board needs; the panel is where the length
 * of a pin is stated. A pin with time left says so, because that is information a reader can act
 * on ("this is still the notice of the day").
 */
export function pinLabel(pin: ThreadPin, at: Date = new Date()): string {
  if (pin.expiresAt === null) return 'PINNED';

  return `PINNED ${remainingLabel(pin.expiresAt, at)}`;
}

/**
 * The long version, for the panel: who took it, and how long is left.
 *
 * The duration is dropped for a pin that never runs out rather than spelled out - the panel is
 * read by the moderator, who chose it.
 */
export function pinSummary(pin: ThreadPin, at: Date = new Date()): string {
  const who = `BY ${pin.pinnedByName.toUpperCase()}`;
  if (pin.expiresAt === null) return who;

  return `${who} :: ${remainingLabel(pin.expiresAt, at)}`;
}

/**
 * The board's order, with the pinned posts lifted to the top.
 *
 * Newest-first is what a board is for - what arrived since you last looked - which is exactly
 * why a pin is worth having: it survives that order without turning it off. Pinned posts lead,
 * the most recently pinned first, and everything else keeps the order it came in with.
 */
export function sortThreadsPinnedFirst(
  threads: ForumThread[],
  pins: ThreadPin[],
  at: Date = new Date(),
): ForumThread[] {
  const live = livePins(pins, at);
  if (live.length === 0) return threads;

  const rank = new Map(live.map((pin, index) => [pin.threadId, index]));

  return [...threads].sort((left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);

    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;

    return leftRank - rightRank;
  });
}

/** How many posts are pinned right now, for the panel's count and the wire's summary. */
export function pinnedCount(pins: ThreadPin[], at: Date = new Date()): number {
  return livePins(pins, at).length;
}
