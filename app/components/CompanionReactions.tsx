'use client';

import { useEffect, useRef } from 'react';
import { pokeCompanion } from '../lib/companion/events';
import { threadsWithNewMessages } from '../lib/comms/threads';
import { useComms } from './CommsProvider';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';

/** Somebody coming online hops the companion at most this often, so a busy evening is not a trampoline. */
const ONLINE_QUIET_MS = 10_000;

/**
 * What your companion reacts to (SPEC-companion.md, decision 3): a new notification (a reply, a tag, an invite, a
 * recommendation), a new message in comms, or somebody coming online. All three are things the site already hears for
 * the bell, the comms pop-up and the lamps; this only watches them change. Draws nothing. Mounted only while your
 * companion is out, so each list is seeded fresh then and only what arrives afterwards counts.
 */
export default function CompanionReactions() {
  const { items, ready: feedReady } = useNotifications();
  const { ready: commsReady, userId, threads } = useComms();
  const { live, selfId } = usePresenceDirectory();

  const notes = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!feedReady) return;
    const known = notes.current;
    notes.current = new Set(items.map((item) => item.id));
    if (known === null) return;
    if (items.some((item) => item.readAt === null && !known.has(item.id))) pokeCompanion('reply');
  }, [feedReady, items]);

  const messages = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!commsReady || userId === null) return;
    const known = messages.current;
    messages.current = new Set(threads.flatMap((thread) => thread.messages.map((message) => message.id)));
    if (known === null) return;
    const mine = threads.filter((thread) => thread.participants.includes(userId));
    if (threadsWithNewMessages(mine, userId, known).length > 0) pokeCompanion('message');
  }, [commsReady, userId, threads]);

  const here = useRef<Set<string> | null>(null);
  const lastOnline = useRef(0);
  useEffect(() => {
    if (live === null) return;
    const known = here.current;
    const now = new Set(Object.keys(live));
    here.current = now;
    if (known === null) return;
    const arrived = [...now].some((id) => id !== selfId && !known.has(id));
    if (arrived && Date.now() - lastOnline.current >= ONLINE_QUIET_MS) {
      lastOnline.current = Date.now();
      pokeCompanion('online');
    }
  }, [live, selfId]);

  return null;
}
