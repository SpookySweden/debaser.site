'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getCommsRepository } from '../lib/comms/repository';
import { lastMessage, otherParticipant, participantFromThread, threadLabel } from '../lib/comms/threads';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME_LENGTH } from '../lib/comms/types';
import { PLATE } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import CommsGroupBar from './CommsGroupBar';
import CommsThreadPanel from './CommsThreadPanel';
import { useComms } from './CommsProvider';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

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
  const { userId, threads, accounts, accountsReady, nameById, ready, source, error, retry, markRead } = comms;
  const [picking, setPicking] = useState(false);
  const compact = useCompactViewport();
  /** On a phone the console is one pane at a time: the list, or the open thread. */
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [testNote, setTestNote] = useState<string | null>(null);
  // Opening a group: one form and one account list. What is done to a group once it
  // exists - renaming, handing it on, removing a member, leaving - is the strip under the
  // open conversation's own business (see ./CommsGroupBar).
  const [grouping, setGrouping] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

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

  const nameFor = (id: string) => nameById.get(id) ?? id;

  async function openGroup() {
    setGroupError(null);

    // The store refuses an empty name as well; asking here means the reader is told
    // before anything is sent, and the name is trimmed once, in one place.
    if (groupName.trim().length === 0) {
      setGroupError('A GROUP NEEDS A NAME.');
      return;
    }

    try {
      await comms.createGroup(groupName, groupMembers);
      setGrouping(false);
      setGroupName('');
      setGroupMembers([]);
    } catch (caught) {
      setGroupError(caught instanceof Error ? caught.message : 'THAT GROUP COULD NOT BE OPENED.');
    }
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
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
      {/* A store that cannot be read is said out loud rather than left looking like an
          account with nothing in it. On a wide screen it takes the first row to itself. */}
      {error === null ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2 text-[10px] font-bold text-black lg:basis-full">
          <span className="border border-black bg-[#800000] px-1 text-white">[ COMMS OFFLINE ]</span>
          <span className="min-w-0 flex-1 break-words text-[#800000]">{error}</span>
          <button type="button" onClick={retry} className={PLATE}>
            [ RETRY ]
          </button>
        </div>
      )}

      {/* Conversations rail */}
      <section className={`rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] lg:w-64 lg:shrink-0 ${compact && mobileView === 'thread' ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>CONVERSATIONS</span>
          <span>[ {threads.length} ]</span>
        </div>

        <div className="p-2">
          <button type="button" onClick={() => setPicking(!picking)} className={PLATE}>
            {picking ? '[ CANCEL ]' : '[ + NEW MESSAGE ]'}
          </button>

          {picking ? (
            <div className="mt-2 rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
              <p className="text-[10px] font-bold text-black">MESSAGE AN ACCOUNT:</p>
              {!accountsReady ? (
                <p className="mt-1 text-[10px] text-gray-700">READING THE ACCOUNT LIST...</p>
              ) : others.length === 0 ? (
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
                        className={`${PLATE} inline-flex items-center gap-1`}
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

          <button
            type="button"
            onClick={() => {
              setGrouping(!grouping);
              // A refusal from the last attempt belongs to that attempt, not to this one.
              setGroupError(null);
            }}
            className={`ml-1 mt-1 ${PLATE}`}
          >
            {grouping ? '[ CANCEL ]' : '[ + NEW GROUP ]'}
          </button>

          {grouping ? (
            <div className="mt-2 space-y-1 rounded-none border border-gray-500 bg-[#f0f0f0] p-2 text-[10px] font-bold text-black">
              <label htmlFor="group-name" className="block">
                GROUP NAME:
              </label>
              <input
                id="group-name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="e.g. THE WARD"
                maxLength={MAX_GROUP_NAME_LENGTH}
                className="w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none"
              />

              <p className="pt-1">
                WHO IS IN IT ({groupMembers.length} PICKED) :: YOU ARE ALWAYS IN, AND A GROUP HOLDS {MAX_GROUP_MEMBERS}:
              </p>

              {!accountsReady ? (
                <p className="text-gray-700">READING THE ACCOUNT LIST...</p>
              ) : others.length === 0 ? (
                <p className="text-gray-700">NO OTHER ACCOUNTS YET. CREATE ONE ON THE ACCOUNT PAGE.</p>
              ) : (
                <ul className="space-y-1">
                  {others.map((account) => (
                    <li key={account.id}>
                      <label className="inline-flex cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={groupMembers.includes(account.id)}
                          onChange={(event) =>
                            setGroupMembers((current) =>
                              event.target.checked
                                ? [...current, account.id]
                                : current.filter((id) => id !== account.id),
                            )
                          }
                        />
                        <ProfileName author={{ id: account.id, displayName: account.displayName }} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <button type="button" onClick={() => void openGroup()} className={`mt-1 ${PLATE}`}>
                [ OPEN GROUP ]
              </button>

              {groupError === null ? null : <p className="text-[#800000]">{groupError}</p>}
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
                    onClick={() => {
                      comms.setActiveThreadId(thread.id);
                      setMobileView('thread');
                    }}
                    className={`w-full cursor-pointer rounded-none border p-2 text-left text-[10px] font-bold max-sm:p-3 max-sm:text-xs ${
                      thread.id === active?.id
                        ? 'border-black bg-gray-300'
                        : 'border-gray-500 bg-[#f0f0f0] hover:bg-gray-200'
                    }`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      {thread.kind === 'group' ? (
                        <span>[ GROUP ] {threadLabel(thread, userId ?? '', nameFor)}</span>
                      ) : (
                        <ProfileName author={{ id: row.userId, displayName: row.displayName }} />
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
        </div>
      </section>
      {/* The open conversation */}
      <section className={`flex min-h-0 flex-1 flex-col rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] ${compact && mobileView === 'list' ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between gap-2 bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileView('list')}
              className="shrink-0 cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold leading-none text-black hover:bg-gray-300 lg:hidden"
            >
              ← LIST
            </button>
            <span className="truncate">
              COMMS
              {active === undefined ? '' : ` :: ${threadLabel(active, userId ?? '', nameFor)}`}
            </span>
          </span>
          <span className="shrink-0">[ {ready ? 'LIVE' : 'READING...'} ]</span>
        </div>

        <div className="flex min-h-[24rem] flex-1 flex-col p-3">
          {/* A group's members are part of the conversation: who is in the room, who owns it,
              a way to pull somebody else in, and - for the owner alone - the controls that
              belong to whoever opened it. A dm has no such strip: it is a pair, and a third
              account would make it a group. */}
          {active === undefined || active.kind !== 'group' || userId === null ? null : (
            <CommsGroupBar
              thread={active}
              userId={userId}
              nameFor={nameFor}
              accounts={accounts}
              onAdd={(memberId) => comms.addMember(active.id, memberId).then(() => undefined)}
              onRename={(name) => comms.renameGroup(active.id, name).then(() => undefined)}
              onHandOver={(toUserId) => comms.transferGroupOwnership(active.id, toUserId).then(() => undefined)}
              onRemove={(memberId) => comms.removeMember(active.id, memberId).then(() => undefined)}
              onLeave={() => comms.leaveGroup(active.id).then(() => undefined)}
            />
          )}

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
              otherId={active.kind === 'group' ? undefined : activeOtherId}
              nameById={nameById}
              onSend={(body) =>
                active.kind === 'group' ? comms.sendToThread(active.id, body) : comms.send(activeOtherId, body)
              }
            />
          )}
        </div>

        {source === 'mock' ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-500 p-2 text-[10px] font-bold text-black">
            <span className="text-gray-700">
              LOCAL MODE: MESSAGES STAY IN THIS BROWSER.
            </span>
            <button type="button" onClick={() => void simulateIncoming()} className={PLATE}>
              [ SIMULATE INCOMING ]
            </button>
            <button type="button" onClick={() => void purgeLocal()} className={PLATE}>
              [ PURGE LOCAL COMMS ]
            </button>
            {testNote === null ? null : <span className="text-[#800000]">{testNote}</span>}
          </div>
        ) : null}
      </section>
    </div>
  );
}


