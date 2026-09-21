'use client';

import Link from 'next/link';
import { resolveAuthor, threadLabel } from '../lib/comms/threads';
import type { CommsThread } from '../lib/comms/types';
import CommsThreadPanel from './CommsThreadPanel';
import PopoutWindow from './PopoutWindow';

type IncomingMessageWindowProps = {
  thread: CommsThread;
  userId: string;
  /**
   * The account on the other side of a direct conversation. A group has no single other
   * side, so the pop-up for one is given none and says which group the message landed in
   * instead - and answers the group, not whichever member wrote last.
   */
  otherId?: string;
  nameById: Map<string, string>;
  onSend: (body: string) => Promise<void>;
  onClose: () => void;
};

/** How much of a long conversation the little window shows. */
const TAIL = 6;

/**
 * The notification pop-up: a contained, mini version of the comms page.
 *
 * It holds the same conversation panel the page draws - pointed at the newest
 * messages, with the box already focused - so a message that lands while the
 * board is open can be read and answered without navigating anywhere. Desktop
 * only: on a narrow screen the notifier sends the reader to /comms instead, where
 * the same conversation is the whole page.
 */
export default function IncomingMessageWindow({
  thread,
  userId,
  otherId,
  nameById,
  onSend,
  onClose,
}: IncomingMessageWindowProps) {
  const isGroup = thread.kind === 'group';
  const sender = thread.messages[thread.messages.length - 1];
  // Named after whoever wrote: the other account in a direct conversation, and in a group
  // the member whose message this is - the group's own name is the line below the title.
  const name = isGroup
    ? sender === undefined
      ? 'A MEMBER'
      : resolveAuthor(sender, nameById).displayName
    : (nameById.get(otherId ?? '') ?? otherId ?? 'AN ACCOUNT');
  const hidden = Math.max(0, thread.messages.length - TAIL);

  return (
    <PopoutWindow
      title={`COMMS :: NEW MESSAGE FROM ${name.toUpperCase()}`}
      badge="[ INCOMING ]"
      onClose={onClose}
      maxWidth="max-w-xl"
      status="ANSWER HERE, OR OPEN THE COMMS PAGE :: ESC CLOSES"
      actions={
        <Link
          href="/comms"
          className="rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] underline hover:bg-gray-300"
        >
          [ OPEN COMMS ]
        </Link>
      }
    >
      {isGroup ? (
        <p className="mb-2 text-[10px] font-bold text-black">
          IN {threadLabel(thread, userId, (id) => nameById.get(id) ?? id)} :: ANSWERING HERE WRITES TO THE WHOLE GROUP
        </p>
      ) : null}

      {hidden === 0 ? null : (
        <p className="mb-2 text-[10px] font-bold text-gray-700">
          {hidden} EARLIER MESSAGE{hidden === 1 ? '' : 'S'} STAY ON THE COMMS PAGE.
        </p>
      )}

      <CommsThreadPanel
        idPrefix="comms-popup"
        thread={thread}
        userId={userId}
        otherId={otherId}
        nameById={nameById}
        onSend={onSend}
        limit={TAIL}
        autoFocus
      />
    </PopoutWindow>
  );
}
