'use client';

import Link from 'next/link';
import type { CommsThread } from '../lib/comms/types';
import CommsThreadPanel from './CommsThreadPanel';
import PopoutWindow from './PopoutWindow';

type IncomingMessageWindowProps = {
  thread: CommsThread;
  userId: string;
  /** The account on the other side. */
  otherId: string;
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
  const name = nameById.get(otherId) ?? otherId;
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
