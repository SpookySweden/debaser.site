import type { ProfileRepository, PublicProfile } from './types';

/**
 * The profiles this tab has already read.
 *
 * `usePublicProfile` runs wherever a name or a picture appears: once for the corner of the
 * window, once per avatar on the board, once in the side panel, once on a profile. Every one
 * of those used to begin from an empty shell and ask the store again, which is why a picture
 * that had just been on screen said `NO PICTURE` for a moment after a navigation - each page
 * mounts its components afresh, and each of them started from nothing.
 *
 * So what has been read is kept here, by account, for the life of the tab:
 *
 *   - a component that mounts later draws the remembered row on its **first** render, so
 *     nothing flickers;
 *   - one account is fetched once, however many components ask for it at the same moment (a
 *     board page has dozens of avatars and a handful of accounts);
 *   - `status` tells the two states a blank picture can mean apart - `read`, with no row, is
 *     an answer the empty shell can be drawn from; `failed` is a read that has to be made
 *     again, so a blip does not blank the picture for the rest of the session.
 */

/** How far this tab has got with one account. */
export type ProfileReadStatus = 'unread' | 'read' | 'failed';

/** One account as this tab knows it. */
export type CachedProfile = {
  profile: PublicProfile | null;
  status: ProfileReadStatus;
};

/** Nobody has asked for that account yet. A shared value, so React can compare it by identity. */
const NOT_READ: CachedProfile = { profile: null, status: 'unread' };

const records = new Map<string, CachedProfile>();
/** One request per account, however many components want it at once. */
const inFlight = new Map<string, Promise<PublicProfile | null>>();
/** Everyone drawing one account, so a write reaches every copy of it on screen. */
const watchers = new Map<string, Set<() => void>>();

function wake(userId: string): void {
  for (const listener of watchers.get(userId) ?? []) listener();
}

function setRecord(userId: string, record: CachedProfile): void {
  records.set(userId, record);
  wake(userId);
}

/**
 * One account as this tab knows it, for `useSyncExternalStore`.
 *
 * The value only changes when something is remembered, so React sees the same object from one
 * render to the next and does not re-draw for nothing.
 */
export function profileRecord(userId: string): CachedProfile {
  return records.get(userId) ?? NOT_READ;
}

/** Draws from one account: the listener fires when that account's record changes. */
export function subscribeToProfile(userId: string, listener: () => void): () => void {
  const listeners = watchers.get(userId) ?? new Set<() => void>();
  listeners.add(listener);
  watchers.set(userId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) watchers.delete(userId);
  };
}

/** Remembers a row: a read that landed, a write from the store's own channel, or the owner's save. */
export function rememberProfile(profile: PublicProfile): void {
  setRecord(profile.userId, { profile, status: 'read' });
}

/** Forgets everything. For the scratch checks, and for anything that purges a local store. */
export function forgetProfiles(): void {
  records.clear();
  inFlight.clear();
}

/**
 * Reads an account, once.
 *
 * A row already read is handed straight back, and a request already running is shared rather
 * than repeated. `force` is for the owner's own customiser, which writes a row and then wants
 * to see the one it wrote.
 */
export function readProfile(
  repository: ProfileRepository,
  userId: string,
  options: { force?: boolean } = {},
): Promise<PublicProfile | null> {
  const force = options.force === true;
  const known = records.get(userId);

  if (!force && known?.status === 'read') return Promise.resolve(known.profile);

  const running = inFlight.get(userId);
  if (!force && running !== undefined) return running;

  const request: Promise<PublicProfile | null> = Promise.resolve()
    // Wrapped so a store that throws on the way out is a refusal like any other, rather than
    // an exception thrown through this call.
    .then(() => repository.getProfile(userId))
    .then((profile) => {
      // `null` is an answer worth keeping: it stops every later mount asking again, and it is
      // what the empty shell is drawn from.
      setRecord(userId, { profile, status: 'read' });
      return profile;
    })
    .catch(() => {
      // A failure is not an answer: the account is marked as asked (so nothing waits on a
      // request that is not coming back) but the next mount asks again. A row that is already
      // known is kept - a failed refresh does not take a picture off the screen.
      const held = records.get(userId);

      if (held?.status !== 'read') {
        setRecord(userId, { profile: held?.profile ?? null, status: 'failed' });
      }

      return records.get(userId)?.profile ?? null;
    })
    .finally(() => {
      // Only if a later read has not already taken the slot.
      if (inFlight.get(userId) === request) inFlight.delete(userId);
      wake(userId);
    });

  inFlight.set(userId, request);

  return request;
}
