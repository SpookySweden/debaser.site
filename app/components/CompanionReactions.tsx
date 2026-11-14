'use client';

import { useEffect, useRef } from 'react';
import { pokeCompanion } from '../lib/companion/events';
import { threadsWithNewMessages } from '../lib/comms/threads';
import { subscribeToTheme, themeState } from '../lib/ui/theme-slot';
import { useComms } from './CommsProvider';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';

/** Somebody coming online hops the companion at most this often, so a busy evening is not a trampoline. */
const ONLINE_QUIET_MS = 10_000;
/** A theme change this soon after the page opens is the saved theme being put on, not somebody picking one. */
const THEME_SETTLE_MS = 3_000;

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
    const fresh = items.filter((item) => item.readAt === null && !known.has(item.id));
    if (fresh.length === 0) return;
    // One hop, with the mark of what arrived (Luke, 2026-11-14): `VS` for a game invite, a heart for a recommendation,
    // `!` for a reply or a tag. Several at once: the invite first, then the recommendation.
    const kinds = new Set(fresh.map((item) => item.kind));
    pokeCompanion(kinds.has('invite') ? 'invite' : kinds.has('recommend') ? 'recommend' : 'reply');
  }, [feedReady, items]);

  // The theme changed: it looks round at the new colours. On your own screen only.
  useEffect(() => {
    let theme = themeState().id;
    const since = Date.now();
    return subscribeToTheme(() => {
      const next = themeState().id;
      if (next === theme) return;
      theme = next;
      // Not the page's own theme settling in as it loads: only one picked afterwards.
      if (Date.now() - since >= THEME_SETTLE_MS) pokeCompanion('look');
    });
  }, []);

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
