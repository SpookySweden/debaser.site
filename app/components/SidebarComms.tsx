'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { participantFromThread } from '../lib/comms/threads';
import { useComms } from './CommsProvider';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

/**
 * The side panel's comms block: the conversations, small.
 *
 * It is a hand-over rather than a second console: a row opens that conversation on
 * /comms (through the same `openThreadWith` the comms picker uses) and the page
 * draws the messages. That keeps one implementation of reading and writing
 * messages, which is the same reason the notification pop-up reuses the panel.
 */
export default function SidebarComms() {
  const comms = useComms();
  const { userId, threads, nameById, ready } = comms;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      userId === null
        ? []
        : threads.map((thread) => ({ thread, row: participantFromThread(thread, userId, nameById) })),
    [threads, nameById, userId],
  );

  async function openConversation(otherId: string) {
    setBusyId(otherId);

    try {
      await comms.openThreadWith(otherId);
      router.push('/comms');
    } catch {
      // Comms asks for an account first, which the block below already says.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMS</span>
        <span>[ {comms.unreadTotal === 0 ? `${threads.length} OPEN` : `${comms.unreadTotal} NEW`} ]</span>
      </div>

      {userId === null ? (
        <p className="p-2 text-[10px] font-bold text-black">
          MESSAGES GO ACCOUNT TO ACCOUNT - SIGN IN TO READ OR SEND ONE.
        </p>
      ) : !ready ? (
        <p className="p-2 text-[10px] font-bold text-black">READING THE CONVERSATIONS...</p>
      ) : rows.length === 0 ? (
        <p className="p-2 text-[10px] font-bold text-black">
          NO CONVERSATIONS YET. OPEN ONE FROM THE DIRECTORY BELOW OR FROM THE COMMS PAGE.
        </p>
      ) : (
        <ul className="space-y-1 p-2">
          {rows.map(({ thread, row }) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => void openConversation(row.userId)}
                disabled={busyId !== null}
                className="w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-left text-[10px] font-bold text-black hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="flex flex-wrap items-center justify-between gap-1">
                  <ProfileName author={{ id: row.userId, displayName: row.displayName }} lamp={false} />
                  <TimeStamp at={row.updatedAt} />
                </span>
                <span className="mt-1 block truncate font-normal text-gray-700">{row.preview}</span>
                {row.unread === 0 ? null : <span className="mt-1 block text-[#800000]">[ {row.unread} NEW ]</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="p-2 pt-0">
        <Link
          href="/comms"
          className="inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300"
        >
          [ OPEN COMMS ]
        </Link>
      </div>
    </section>
  );
}
