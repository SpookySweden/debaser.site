import { nameColourHex } from '../profile/name-colours';

/**
 * The house account.
 *
 * debaser.site is a real account, not just a label: it can be signed into with the
 * credentials below, it owns the byline on every thread an item's comment box
 * opened (see app/lib/forum/site-author.ts), and it has a profile like anybody
 * else - which is where its dark blue name comes from.
 *
 * The mock backend plants it in a browser the first time the account store is read
 * (app/lib/auth/mock-auth.ts), and the mock profile store gives it its profile
 * (app/lib/profile/mock-profile-repository.ts). Supabase seeds the same two rows
 * with an insert, so signing in from anywhere lands on the same account.
 *
 * The credential is deliberately not an email address: the sign-in field takes an
 * address *or* an account name, and ADMIN1212 is this account's name. It exists so
 * the archive owner can always get in while the backend is the mock one - change
 * it (or the account) before Supabase Auth is switched on for real. Changing the
 * account's address from the account page stops the identifier resolving, because
 * it is the address, not the identifier, that is stored.
 */
export const SITE_ACCOUNT_ID = 'debaser-site';

/** What the owner types in the sign-in box, in place of an address. */
export const SITE_ACCOUNT_IDENTIFIER = 'ADMIN1212';
export const SITE_ACCOUNT_PASSWORD = 'ADMIN1212';

/**
 * The address the account is stored under.
 *
 * Supabase Auth signs in with an address, so the house account has one from the
 * start - and the bare identifier keeps working after the backend is switched on,
 * because both backends pass whatever was typed through `resolveSignInAddress`
 * first.
 */
export const SITE_ACCOUNT_ADDRESS = 'admin1212@debaser.site';
export const SITE_ACCOUNT_DISPLAY_NAME = 'debaser.site';

/** Dark blue: the navy swatch out of the sixteen a username can be drawn in. */
export const SITE_ACCOUNT_NAME_COLOUR = nameColourHex('navy') ?? '#000080';

/** The address a typed sign-in identifier stands for, whatever the backend needs. */
export function resolveSignInAddress(identifier: string): string {
  const value = identifier.trim();

  return value.toLowerCase() === SITE_ACCOUNT_IDENTIFIER.toLowerCase() ? SITE_ACCOUNT_ADDRESS : value;
}

export function isSiteAccount(userId: string | null): boolean {
  return userId === SITE_ACCOUNT_ID;
}

/**
 * Whether a username carries a presence lamp.
 *
 * The house account does not: an item-owned post is signed by the archive even
 * though a visitor's comment is what opened it, so a lamp beside that name would
 * report somebody else's presence. Guests have no account to be online with
 * either, which leaves every other account with its green / yellow / red lamp.
 */
export function showsPresenceLamp(userId: string | null): boolean {
  return userId !== null && !isSiteAccount(userId);
}
