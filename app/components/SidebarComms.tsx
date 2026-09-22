'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { participantFromThread, threadLabel } from '../lib/comms/threads';
import { useComms } from './CommsProvider';
import NotificationBell from './NotificationBell';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

/**
 * The side panel's comms block: the conversations, small.
 *
 * It is a hand-over rather than a second console: a row makes that conversation the
 * open one (`setActiveThreadId`, the same call the console's own list makes) and
 * sends the reader to /comms, where the page draws the messages. That keeps one
 * implementation of reading and writing messages, which is the same reason the
 * notification pop-up reuses the panel.
 */
export default function SidebarComms() {
  const comms = useComms();
  const { userId, threads, nameById, ready, error } = comms;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      userId === null
        ? []
        : threads.map((thread) => ({ thread, row: participantFromThread(thread, userId, nameById) })),
    [threads, nameById, userId],
  );

  /**
   * Opens a conversation on /comms.
   *
   * The row hands over the conversation itself rather than the account it is named
   * after: a direct message would be re-derived from the pair and come out the same,
   * but a group is not "with" any single member, so going through the pair would open
   * the wrong conversation. The page reads the id and draws the messages.
   */
  function openConversation(threadId: string) {
    setBusyId(threadId);
    comms.setActiveThreadId(threadId);
    router.push('/comms');
    setBusyId(null);
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between gap-1 bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMS</span>
        <span className="flex items-center gap-1">
          {/* The bell sits at the top of the comms block: tags and replies are board news, but
              this is where a reader looks when they want to know who is waiting on them. */}
          <NotificationBell />
          <span>[ {comms.unreadTotal === 0 ? `${threads.length} OPEN` : `${comms.unreadTotal} NEW`} ]</span>
        </span>
      </div>

      {userId === null ? (
        <p className="p-2 text-[10px] font-bold text-black">
          MESSAGES GO ACCOUNT TO ACCOUNT - SIGN IN TO READ OR SEND ONE.
        </p>
      ) : !ready ? (
        <p className="p-2 text-[10px] font-bold text-black">READING THE CONVERSATIONS...</p>
      ) : error !== null ? (
        // A store that cannot be read is not the same as an account with nothing in it.
        <p className="p-2 text-[10px] font-bold text-[#800000]">COMMS OFFLINE :: {error}</p>
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
                onClick={() => openConversation(thread.id)}
                disabled={busyId !== null}
                className="w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-left text-[10px] font-bold text-black hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="flex flex-wrap items-center justify-between gap-1">
                  {thread.kind === 'group' ? (
                    <span>[ GROUP ] {threadLabel(thread, userId ?? '', (id) => nameById.get(id) ?? id)}</span>
                  ) : (
                    <ProfileName author={{ id: row.userId, displayName: row.displayName }} lamp={false} />
                  )}
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
