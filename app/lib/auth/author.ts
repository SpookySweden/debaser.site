import type { ForumAuthor } from '../forum/types';

/**
 * Auth plug-in point.
 *
 * Right now every post is filed as "Anonymous" with `id: null`. Once the
 * Supabase Auth screens land (build order step 2) this module is the only place
 * that has to change: swap `getCurrentAuthor` for
 * `supabase.auth.getUser()` and return `{ id: user.id, displayName: user.email }`.
 *
 * `author_id` is already persisted on every thread and comment, so the row
 * shape does not need a migration when real users arrive.
 */
export const ANONYMOUS_AUTHOR: ForumAuthor = {
  id: null,
  displayName: 'Anonymous',
};

/**
 * Set to true once Supabase Auth is wired up. It gates the auth listener in
 * `use-current-author.ts` so the board makes no network calls before the
 * tables and policies exist.
 */
export const AUTH_WIRED: boolean = false;

export function getCurrentAuthor(): ForumAuthor {
  if (!AUTH_WIRED) return ANONYMOUS_AUTHOR;

  // TODO(auth): replace with a Supabase session lookup:
  //   const { data } = await supabase.auth.getUser();
  //   return data.user ? { id: data.user.id, displayName: data.user.email ?? 'Anonymous' } : ANONYMOUS_AUTHOR;
  return ANONYMOUS_AUTHOR;
}

export function authorLabel(author: ForumAuthor): string {
  return author.displayName.length > 0 ? author.displayName : ANONYMOUS_AUTHOR.displayName;
}

/** Compact "who wrote this" line for thread chrome, e.g. `Anonymous (guest)`. */
export function authorTag(author: ForumAuthor): string {
  return author.id === null ? `${authorLabel(author)} (guest)` : `${authorLabel(author)} (uid)`;
}
