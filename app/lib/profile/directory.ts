import { isSiteAccount } from '../auth/builtin-account';
import type { AccountUser } from '../auth/types';
import type { PresenceRecord, PresenceStatus } from './presence';

/**
 * The account directory: who has an account, and who is around.
 *
 * Pure, so the page's ordering can be reasoned about (and tested) without React:
 * it takes the accounts, a way to ask for one account's lamp state, and who is
 * reading, and hands back the rows in the order the page draws them. The order is
 * the point:
 *
 *   1. the house account first, because debaser.site administers the archive
 *      rather than taking a turn among its visitors (app/lib/auth/builtin-account.ts);
 *   2. then whoever is at the keyboard, then whoever was seen within the hour,
 *      then everybody else;
 *   3. inside a rank, alphabetically by name - and by id when two names match, so
 *      the list never reshuffles for no reason.
 */
export type UserDirectoryRow = {
  account: AccountUser;
  status: PresenceStatus;
  record: PresenceRecord | undefined;
  /** The house account: pinned to the top, marked `[ ADMIN ]` on the page. */
  admin: boolean;
  /** The account reading the page. */
  you: boolean;
};

/** Online first, then recently seen, then the rest. */
const STATUS_RANK: Record<PresenceStatus, number> = { online: 0, recent: 1, offline: 2 };

export type UserDirectoryInput = {
  /** Every account the store can see (`AuthRepository.listAccounts`). */
  accounts: AccountUser[];
  statusFor: (userId: string) => PresenceStatus;
  recordFor: (userId: string) => PresenceRecord | undefined;
  /** Null when nobody is signed in, in which case nobody is marked as you. */
  viewerId: string | null;
};

export function buildUserDirectory(input: UserDirectoryInput): UserDirectoryRow[] {
  return input.accounts
    .map((account) => ({
      account,
      status: input.statusFor(account.id),
      record: input.recordFor(account.id),
      admin: isSiteAccount(account.id),
      you: input.viewerId !== null && input.viewerId === account.id,
    }))
    .sort(compareDirectoryRows);
}

export function compareDirectoryRows(a: UserDirectoryRow, b: UserDirectoryRow): number {
  if (a.admin !== b.admin) return a.admin ? -1 : 1;
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];

  const byName = a.account.displayName.localeCompare(b.account.displayName, 'en', { sensitivity: 'base' });
  return byName !== 0 ? byName : a.account.id.localeCompare(b.account.id);
}

/** How many rows are in each state, for the panel's summary line. */
export function countDirectoryStatuses(rows: UserDirectoryRow[]): Record<PresenceStatus, number> {
  const counts: Record<PresenceStatus, number> = { online: 0, recent: 0, offline: 0 };
  for (const row of rows) counts[row.status] += 1;

  return counts;
}
