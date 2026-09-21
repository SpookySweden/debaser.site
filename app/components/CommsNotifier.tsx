'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getCommsRepository } from '../lib/comms/repository';
import { otherParticipant, threadsWithNewMessages } from '../lib/comms/threads';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useComms } from './CommsProvider';
import IncomingMessageWindow from './IncomingMessageWindow';

/**
 * Watches for messages arriving while the site is open.
 *
 * Desktop gets the contained pop-up, which answers the message in place. A narrow
 * screen has no room for a window, so it is taken straight to the comms page
 * instead - the same breakpoint the layout already treats as mobile.
 *
 * The watch is a subscription to the store rather than a pass over each render,
 * because that is what a message arriving actually is: an event. Messages that
 * were already stored when the page loaded are seeded as "seen", so opening the
 * site never yanks anybody anywhere, and nothing fires on /comms, where the
 * conversation is already on screen.
 */
export default function CommsNotifier() {
  const { ready, userId, threads, nameById, markRead, send, sendToThread } = useComms();
  const compact = useCompactViewport();
  const pathname = usePathname();
  const router = useRouter();
  /** Every message id already accounted for; null until the seed lands. */
  const seen = useRef<Set<string> | null>(null);
  const [incomingId, setIncomingId] = useState<string | null>(null);

  const onCommsPage = pathname !== null && pathname.startsWith('/comms');

  // Seed: whatever is in the store when the page opens is history, not news.
  useEffect(() => {
    if (!ready || seen.current !== null) return;
    seen.current = new Set(threads.flatMap((thread) => thread.messages.map((message) => message.id)));
  }, [ready, threads]);

  useEffect(() => {
    if (!ready || userId === null) return;

    return getCommsRepository().subscribe((snapshot) => {
      const known = seen.current;
      const mine = snapshot.filter((thread) => thread.participants.includes(userId));
      const arrivals = threadsWithNewMessages(mine, userId, known ?? new Set());

      seen.current = new Set([
        ...(known ?? []),
        ...mine.flatMap((thread) => thread.messages.map((message) => message.id)),
      ]);

      const newest = arrivals[0];
      if (newest === undefined || onCommsPage) return;

      if (compact) {
        router.push('/comms');
        return;
      }

      setIncomingId(newest.id);
    });
  }, [compact, onCommsPage, ready, router, userId]);

  // Once the comms page is up, the window has done its job. Deferred by a frame
  // so the pop-up is not torn down in the same pass that renders the page.
  useEffect(() => {
    if (!onCommsPage) return;

    const frame = window.requestAnimationFrame(() => setIncomingId(null));
    return () => window.cancelAnimationFrame(frame);
  }, [onCommsPage]);

  // A message on screen counts as read.
  useEffect(() => {
    if (incomingId === null) return;
    void markRead(incomingId);
  }, [incomingId, markRead]);

  if (incomingId === null || userId === null || compact || onCommsPage) return null;

  const incoming = threads.find((item) => item.id === incomingId);
  if (incoming === undefined) return null;

  // Narrowed into its own bindings, so the reply below can reach them after the guards.
  const thread = incoming;
  const viewerId = userId;

  // A group has no single other side, so the pop-up answers the group itself: pointing
  // it at the member who happened to write last would open a direct conversation with
  // them instead - a different conversation, and the wrong one to reply in.
  const isGroup = thread.kind === 'group';
  const otherId = isGroup ? undefined : otherParticipant(thread, viewerId);

  /** Answering the pop-up writes where the message came from. */
  async function reply(body: string) {
    if (isGroup) {
      await sendToThread(thread.id, body);
      return;
    }

    await send(otherParticipant(thread, viewerId), body);
  }

  return (
    <IncomingMessageWindow
      thread={thread}
      userId={viewerId}
      otherId={otherId}
      nameById={nameById}
      onSend={reply}
      onClose={() => setIncomingId(null)}
    />
  );
}

