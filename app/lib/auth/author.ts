import type { AccountUser } from './types';
import type { ForumAuthor } from '../forum/types';

/**
 * The author a post is filed under.
 *
 * Signed out, everything is filed as "Anonymous" with `id: null`. Signed in,
 * the account's id is used - which is `auth.users.id` once the Supabase backend
 * is on - so `author_id` on threads and comments lines up with RLS policies
 * without a schema change.
 *
 * The session itself comes from `AuthProvider` (app/components/AuthProvider.tsx).
 */
export const ANONYMOUS_AUTHOR: ForumAuthor = {
  id: null,
  displayName: 'Anonymous',
};

export function authorFromAccount(user: AccountUser | null): ForumAuthor {
  if (user === null) return ANONYMOUS_AUTHOR;

  return { id: user.id, displayName: user.displayName };
}

/**
 * What to call an author.
 *
 * A row read back from a store can arrive with no name at all - a hand-made row, a column
 * that was added after the fact, a select that skipped it - and `displayName` is typed as a
 * string that such a row does not have. Anything that is not a name reads as the anonymous
 * default rather than taking the page down with it.
 */
export function authorLabel(author: ForumAuthor): string {
  const name: unknown = author.displayName;

  return typeof name === 'string' && name.trim().length > 0 ? name : ANONYMOUS_AUTHOR.displayName;
}

/** Compact "who wrote this" line for thread chrome, e.g. `Anonymous (guest)`. */
export function authorTag(author: ForumAuthor): string {
  return author.id === null ? `${authorLabel(author)} (guest)` : `${authorLabel(author)} (account)`;
}
