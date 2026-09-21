'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveAuthor, validateMessage } from '../lib/comms/threads';
import { MAX_MESSAGE_LENGTH } from '../lib/comms/types';
import type { CommsThread } from '../lib/comms/types';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

type CommsThreadPanelProps = {
  thread: CommsThread;
  /** The signed-in account: its messages are marked as yours. */
  userId: string;
  /** The account on the other side. */
  otherId: string;
  nameById: Map<string, string>;
  onSend: (body: string) => Promise<void>;
  /** Show only the tail of a long conversation (the pop-up window does). */
  limit?: number;
  /** Put the caret in the box as the panel opens. */
  autoFocus?: boolean;
  /** Unique prefix for the field ids. */
  idPrefix: string;
};

/**
 * One conversation: who it is with, the messages, and the box to answer in.
 *
 * Shared by the comms page and the notification pop-up, which is what makes the
 * pop-up a mini version of the page rather than a second implementation of it:
 * both draw the same list and send through the same call.
 */
export default function CommsThreadPanel({
  thread,
  userId,
  otherId,
  nameById,
  onSend,
  limit,
  autoFocus = false,
  idPrefix,
}: CommsThreadPanelProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const shown = limit === undefined ? thread.messages : thread.messages.slice(-limit);
  const peer = { id: otherId, displayName: nameById.get(otherId) ?? otherId };

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = list.scrollHeight;
  }, [shown.length]);

  useEffect(() => {
    if (autoFocus) boxRef.current?.focus();
  }, [autoFocus]);

  async function handleSend() {
    const problem = validateMessage(body);
    if (problem !== undefined) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onSend(body.trim());
      setBody('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
        <span className="inline-flex items-center gap-1">
          TO: <ProfileName author={peer} />
        </span>
        <span className="text-gray-700">
          {thread.messages.length} MESSAGE{thread.messages.length === 1 ? '' : 'S'}
        </span>
      </div>

      <ul
        ref={listRef}
        className="min-h-32 flex-1 space-y-2 overflow-y-auto rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2"
      >
        {shown.length === 0 ? (
          <li className="text-[10px] font-bold text-black">NO MESSAGES YET - SAY SOMETHING.</li>
        ) : (
          shown.map((message) => (
            <li key={message.id} className="rounded-none border border-gray-400 bg-[#f0f0f0] p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                <span className="inline-flex items-center gap-1">
                  <ProfileName author={resolveAuthor(message, nameById)} />
                  {message.authorId === userId ? <span className="text-gray-700">[ YOU ]</span> : null}
                </span>
                <TimeStamp at={message.createdAt} />
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-black">{message.body}</p>
            </li>
          ))
        )}
      </ul>

      <div className="mt-2 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
          <label htmlFor={`${idPrefix}-body`}>
            MESSAGE TO <ProfileName author={peer} lamp={false} />:
          </label>
          <span>
            {body.trim().length} / {MAX_MESSAGE_LENGTH}
          </span>
        </div>

        <textarea
          id={`${idPrefix}-body`}
          ref={boxRef}
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Slack habit: Enter sends, Shift+Enter starts a new line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type the message..."
          className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy}
            className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? '[ SENDING... ]' : '[ SEND ]'}
          </button>
          <p className="text-[10px] text-gray-700">ENTER SENDS :: SHIFT+ENTER STARTS A NEW LINE</p>
          {error === null ? null : <p className="text-[10px] font-bold text-[#800000]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
