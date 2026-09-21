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

export function authorLabel(author: ForumAuthor): string {
  return author.displayName.length > 0 ? author.displayName : ANONYMOUS_AUTHOR.displayName;
}

/** Compact "who wrote this" line for thread chrome, e.g. `Anonymous (guest)`. */
export function authorTag(author: ForumAuthor): string {
  return author.id === null ? `${authorLabel(author)} (guest)` : `${authorLabel(author)} (account)`;
}
