'use client';

import { useEffect, useState } from 'react';
import { ANONYMOUS_AUTHOR, AUTH_WIRED, getCurrentAuthor } from './author';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { ForumAuthor } from '../forum/types';

/**
 * Client side author hook.
 *
 * While `AUTH_WIRED` is false this is a pure constant - no network request, no
 * session cookie, and the board keeps everyone on the "Anonymous" identity.
 * Flipping `AUTH_WIRED` to true activates the Supabase auth listener below,
 * which is the only edit needed to attach real user ids to new posts.
 */
export function useCurrentAuthor(): ForumAuthor {
  const [author, setAuthor] = useState<ForumAuthor>(ANONYMOUS_AUTHOR);

  useEffect(() => {
    if (!AUTH_WIRED) return;

    const client = getSupabaseBrowserClient();
    if (!client) return;

    let cancelled = false;

    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      setAuthor(user ? { id: user.id, displayName: user.email ?? ANONYMOUS_AUTHOR.displayName } : getCurrentAuthor());
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setAuthor(user ? { id: user.id, displayName: user.email ?? ANONYMOUS_AUTHOR.displayName } : getCurrentAuthor());
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return author;
}
