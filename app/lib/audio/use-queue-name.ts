'use client';

import { usePublicProfile } from '../profile/use-public-profile';

/**
 * What a queue is called: its owner's display name, upper-cased the way the window writes.
 *
 * The list used to print the first eight characters of the account's id (`640d9861...`), which is the
 * one thing CLAUDE.md says a person is never shown as. Read through the profile cache, so a list of
 * five queues costs at most five reads and every other screen showing those people shares them.
 */
export function useQueueName(userId: string): string {
  const { profile, ready } = usePublicProfile(userId);

  if (!ready) return '...';

  const name = profile.displayName.trim();

  return name.length === 0 ? 'SOMEBODY' : name.toUpperCase();
}
