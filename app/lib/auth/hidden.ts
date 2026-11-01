import type { AccountUser } from './types';

/**
 * The accounts a list of people may show: everybody except the site's own test accounts (TEST ACCOUNT A-D,
 * `hidden` on the account - see SPEC-test-accounts.md).
 *
 * Every list of people is drawn from this - the directory on /users, its online counts, the comms
 * "new message" and "add to group" pickers, the tagging picker and the arcade's challenge list all read
 * `accounts` from the comms provider, which is this applied to the account store's answer. Looking a person
 * up by id is not a list and uses the whole set, so a test account's messages still carry its name.
 */
export function listedAccounts(accounts: AccountUser[]): AccountUser[] {
  return accounts.filter((account) => account.hidden !== true);
}
