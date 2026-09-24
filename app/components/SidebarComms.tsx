'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { participantFromThread, threadLabel } from '../lib/comms/threads';
import { useComms } from './CommsProvider';
import NotificationBell from './NotificationBell';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';
import { TITLE_BAR } from '../lib/ui/controls';

/**
 * The side panel's comms block: one button, and the conversations behind it.
 *
 * It is folded by default, and that is the change: a panel that opened with six conversations in it
 * spent the whole column on the one thing a reader is least often there for. `[ COMMS ]` says how many
 * are waiting, and pressing it shows them; pressing it again puts them away. Nothing is hidden that
 * cannot be reached - the button carries the count, so the panel still tells a reader whether opening
 * it is worth the press.
 *
 * The notices key sits on the same line, and only when there is something unread (see
 * ./NotificationBell.tsx): a bell on a quiet day is a row of furniture that teaches nobody anything,
 * while a bell with a count on it is a reason to look.
 *
 * Opening a conversation is still a hand-over rather than a second console: a row makes that
 * conversation the open one (`setActiveThreadId`, the same call the console's own list makes) and sends
 * the reader to /comms, where the page draws the messages. That keeps one implementation of reading and
 * writing messages, which is the same reason the notification pop-up reuses the panel.
 */
export default function SidebarComms() {
  const comms = useComms();
  const { userId, threads, nameById, ready, error } = comms;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Whether the conversations are showing.
   *
   * Local rather than stored: this is a glance, not a setting. A reader who folds the list away and then
   * opens a new page has not asked for it to stay folded, and a panel that remembered would be a panel
   * that hides its own contents from somebody who has forgotten they are there.
   */
  const [expanded, setExpanded] = useState(false);

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
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      {/* The title bar is the control. `[ COMMS ]` is the button a reader presses to see the
          conversations, and the count beside it is what says whether that is worth a press - which is
          why the count is on the *button* rather than in a heading that would vanish with the list. */}
      <div className={TITLE_BAR}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="sidebar-comms-list"
          title={expanded ? 'Hide the conversations' : 'Show the conversations'}
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun px-2 py-[1px] text-[10px] font-bold leading-none text-ink hover:bg-ena hover:text-sun"
        >
          [ COMMS ] {expanded ? '▴' : '▾'}
        </button>

        <span className="flex items-center gap-1">
          {/* The count, and the notices key when there is anything to notice: a tag or a reply is the
              same kind of thing as a message, both addressed to this account (./NotificationBell.tsx). */}
          <span>
            [ {comms.unreadTotal === 0 ? `${threads.length} OPEN` : `${comms.unreadTotal} NEW`} ]
          </span>
          <NotificationBell />
        </span>
      </div>

      {!expanded ? null : (
        <div id="sidebar-comms-list">
          {userId === null ? (
            <p className="p-2 text-[10px] font-bold text-ink">
              MESSAGES GO ACCOUNT TO ACCOUNT - SIGN IN TO READ OR SEND ONE.
            </p>
          ) : !ready ? (
            <p className="p-2 text-[10px] font-bold text-ink">READING THE CONVERSATIONS...</p>
          ) : error !== null ? (
            // A store that cannot be read is not the same as an account with nothing in it.
            <p className="p-2 text-[10px] font-bold text-bubble-pale">COMMS OFFLINE :: {error}</p>
          ) : rows.length === 0 ? (
            <p className="p-2 text-[10px] font-bold text-ink">
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
                    className="w-full cursor-pointer rounded-none border border-ink bg-paper p-1 text-left text-[10px] font-bold text-ink hover:bg-ice-pale disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      {thread.kind === 'group' ? (
                        <span>[ GROUP ] {threadLabel(thread, userId ?? '', (id) => nameById.get(id) ?? id)}</span>
                      ) : (
                        <ProfileName author={{ id: row.userId, displayName: row.displayName }} lamp={false} />
                      )}
                      <TimeStamp at={row.updatedAt} />
                    </span>
                    <span className="mt-1 block truncate font-normal text-ink">{row.preview}</span>
                    {row.unread === 0 ? null : <span className="mt-1 block text-bubble-pale">[ {row.unread} NEW ]</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
            <Link
              href="/comms"
              className="inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice"
            >
              [ OPEN THE CONSOLE ]
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
