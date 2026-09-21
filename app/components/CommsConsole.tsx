'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getCommsRepository } from '../lib/comms/repository';
import { lastMessage, otherParticipant, participantFromThread } from '../lib/comms/threads';
import CommsThreadPanel from './CommsThreadPanel';
import { useComms } from './CommsProvider';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

const SMALL_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/**
 * The comms console: conversations down the left, the open one on the right.
 *
 * Simple by design, the way a small Slack would be - a rail of conversations with
 * unread counts, a message list, and a box at the bottom. The notification pop-up
 * draws the very same `CommsThreadPanel`, which is what makes it a mini version of
 * this page rather than a second implementation of it.
 */
export default function CommsConsole() {
  const comms = useComms();
  const { userId, threads, accounts, nameById, ready, source, markRead } = comms;
  const [picking, setPicking] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  const others = useMemo(
    () => (userId === null ? [] : accounts.filter((account) => account.id !== userId)),
    [accounts, userId],
  );

  const rows = useMemo(
    () =>
      threads.map((thread) => ({
        thread,
        row: participantFromThread(thread, userId ?? '', nameById),
      })),
    [threads, nameById, userId],
  );

  const active = threads.find((thread) => thread.id === comms.activeThreadId) ?? threads[0];
  const activeOtherId = active === undefined || userId === null ? null : otherParticipant(active, userId);
  // Read as soon as a conversation is on screen, and again when it grows.
  const newestAt = active === undefined ? null : (lastMessage(active)?.createdAt ?? null);

  useEffect(() => {
    if (active === undefined) return;
    void markRead(active.id);
  }, [active, newestAt, markRead]);

  async function openWith(otherId: string) {
    setPicking(false);
    await comms.openThreadWith(otherId);
  }

  async function simulateIncoming() {
    const peer = (activeOtherId === null ? undefined : others.find((account) => account.id === activeOtherId)) ?? others[0];
    if (peer === undefined) {
      setTestNote('A SECOND ACCOUNT IS NEEDED FOR A TEST MESSAGE. CREATE ONE ON THE ACCOUNT PAGE.');
      return;
    }

    setTestNote(null);
    await comms.simulateIncoming(peer.id, `TEST MESSAGE FROM ${peer.displayName.toUpperCase()}`);
  }

  /** Mock-only, like the board's purge button: these rows live in this browser. */
  async function purgeLocal() {
    await getCommsRepository().clearLocalThreads?.();
    setTestNote('LOCAL TEST CONVERSATIONS CLEARED.');
  }

  if (userId === null) {
    return (
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>COMMS</span>
          <span>[ NOBODY SIGNED IN ]</span>
        </div>

        <div className="space-y-2 p-3 text-[10px] font-bold text-black">
          <p>MESSAGES TRAVEL BETWEEN ACCOUNTS, SO THERE IS NO ANONYMOUS INBOX.</p>
          <p>
            <Link href="/account" className="underline hover:bg-gray-300">
              [ GO TO THE ACCOUNT PAGE ]
            </Link>{' '}
            TO SIGN IN OR CREATE ONE.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* Conversations rail */}
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] lg:w-64 lg:shrink-0">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>CONVERSATIONS</span>
          <span>[ {threads.length} ]</span>
        </div>

        <div className="p-2">
          <button type="button" onClick={() => setPicking(!picking)} className={SMALL_BUTTON}>
            {picking ? '[ CANCEL ]' : '[ + NEW MESSAGE ]'}
          </button>

          {picking ? (
            <div className="mt-2 rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
              <p className="text-[10px] font-bold text-black">MESSAGE AN ACCOUNT:</p>
              {others.length === 0 ? (
                <p className="mt-1 text-[10px] text-gray-700">
                  NO OTHER ACCOUNTS YET. CREATE ONE ON THE ACCOUNT PAGE AND IT APPEARS HERE.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {others.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => void openWith(account.id)}
                        className={`${SMALL_BUTTON} inline-flex items-center gap-1`}
                      >
                        [ MESSAGE ]{' '}
                        <ProfileName author={{ id: account.id, displayName: account.displayName }} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <p className="mt-2 text-[10px] font-bold text-black">NO CONVERSATIONS YET. START ONE ABOVE.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {rows.map(({ thread, row }) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => comms.setActiveThreadId(thread.id)}
                    className={`w-full cursor-pointer rounded-none border p-2 text-left text-[10px] font-bold ${
                      thread.id === active?.id
                        ? 'border-black bg-gray-300'
                        : 'border-gray-500 bg-[#f0f0f0] hover:bg-gray-200'
                    }`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      <ProfileName author={{ id: row.userId, displayName: row.displayName }} />
                      <TimeStamp at={row.updatedAt} />
                    </span>
                    <span className="mt-1 block truncate font-normal text-gray-700">{row.preview}</span>
                    {row.unread === 0 ? null : <span className="mt-1 block text-[#800000]">[ {row.unread} NEW ]</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {/* The open conversation */}
      <section className="flex min-h-0 flex-1 flex-col rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>
            COMMS
            {activeOtherId === null ? '' : ` :: ${nameById.get(activeOtherId) ?? activeOtherId}`}
          </span>
          <span>[ {ready ? 'LIVE' : 'READING...'} ]</span>
        </div>

        <div className="flex min-h-[24rem] flex-1 flex-col p-3">
          {active === undefined || activeOtherId === null ? (
            <p className="text-[10px] font-bold text-black">
              PICK A CONVERSATION ON THE LEFT, OR START A NEW ONE. ONE THREAD IS OPEN AT A TIME, WHICH IS THE SAME
              SHAPE THE NOTIFICATION WINDOW OPENS IN ON A DESKTOP.
            </p>
          ) : (
            <CommsThreadPanel
              idPrefix="comms-page"
              thread={active}
              userId={userId}
              otherId={activeOtherId}
              nameById={nameById}
              onSend={(body) => comms.send(activeOtherId, body)}
            />
          )}
        </div>

        {source === 'mock' ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-500 p-2 text-[10px] font-bold text-black">
            <span className="text-gray-700">
              MOCK STORE: THIS BROWSER ONLY, SO A SECOND BROWSER CANNOT REACH YOU YET.
            </span>
            <button type="button" onClick={() => void simulateIncoming()} className={SMALL_BUTTON}>
              [ SIMULATE INCOMING ]
            </button>
            <button type="button" onClick={() => void purgeLocal()} className={SMALL_BUTTON}>
              [ PURGE LOCAL COMMS ]
            </button>
            {testNote === null ? null : <span className="text-[#800000]">{testNote}</span>}
          </div>
        ) : null}
      </section>
    </div>
  );
}


