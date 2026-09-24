'use client';

import { useEffect, useRef, useState } from 'react';
import { insertAtCaret } from '../lib/comms/ascii-emoticons';
import { otherParticipant, resolveAuthor, threadLabel, validateMessage } from '../lib/comms/threads';
import { MAX_MESSAGE_LENGTH } from '../lib/comms/types';
import type { CommsThread } from '../lib/comms/types';
import { openArcade } from '../lib/games/arcade-window';
import { EVENT_LABELS, gameTitle } from '../lib/games/events';
import AsciiEmoticonPicker from './AsciiEmoticonPicker';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';
import { PLATE, PLATE_LARGE } from '../lib/ui/controls';

type CommsThreadPanelProps = {
  thread: CommsThread;
  /** The signed-in account: its messages are marked as yours. */
  userId: string;
  /**
   * The account on the other side of a direct conversation. A group has no single
   * other side, so a group panel is given none and names its members instead.
   */
  otherId?: string;
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
  const isGroup = thread.kind === 'group';
  // A direct conversation has one other side; a group has a name and a member list.
  const peerId = otherId ?? (isGroup ? '' : otherParticipant(thread, userId));
  const peer = { id: peerId, displayName: nameById.get(peerId) ?? peerId };
  const heading = threadLabel(thread, userId, (id) => nameById.get(id) ?? id);
  const others = thread.participants.filter((id) => id !== userId).map((id) => nameById.get(id) ?? id);

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

  /**
   * Drop an emoticon in at the caret.
   *
   * The textarea is the only place that knows where the caret is, so this reads it
   * there, writes the whole value back through state, and then puts the caret after
   * what arrived - which is what makes picking two faces in a row feel like typing.
   */
  function insertEmoticon(text: string) {
    const box = boxRef.current;

    if (box === null) {
      setBody((current) => `${current}${text}`);
      return;
    }

    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    const next = insertAtCaret(box.value, start, end, text);

    setBody(next.value);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-ink">
        <span className="inline-flex flex-wrap items-center gap-1">
          {isGroup ? (
            <>
              IN: {heading}
              {others.length === 0 ? null : <span className="text-ink"> :: {others.join(', ')}</span>}
            </>
          ) : (
            <>
              TO: <ProfileName author={peer} />
            </>
          )}
        </span>
        <span className="text-ink">
          {thread.messages.length} MESSAGE{thread.messages.length === 1 ? '' : 'S'}
        </span>
      </div>

      <ul
        ref={listRef}
        className="min-h-32 flex-1 space-y-2 overflow-y-auto rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-2"
      >
        {shown.length === 0 ? (
          <li className="text-[10px] font-bold text-ink">NO MESSAGES YET - SAY SOMETHING.</li>
        ) : (
          shown.map((message) => (
            <li
              key={message.id}
              className={`rounded-none border p-2 ${
                message.event === undefined ? 'border-ink bg-ice-pale' : 'border-ink bg-sun-pale'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                <span className="inline-flex items-center gap-1">
                  <ProfileName author={resolveAuthor(message, nameById)} />
                  {message.authorId === userId ? <span className="text-ink">[ YOU ]</span> : null}
                </span>
                <TimeStamp at={message.createdAt} />
              </div>

              {/*
                A game challenge is drawn as a plate rather than as prose, and it is the one line in a
                conversation that gets a link: the invite is still the arcade's, so pressing it opens
                the arcade on that invitation rather than trying to re-send anything. Drawing it as a
                sentence would read as something one of them typed - which it is not, and which matters
                when the reader is scrolling back to work out who asked whom.
              */}
              {message.event === undefined ? (
                <p className="mt-1 whitespace-pre-line text-xs text-ink">{message.body}</p>
              ) : (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-ink">
                  <span
                    className={`rounded-none border border-ink px-1 ${
                      message.event.kind === 'invite' ? 'bg-ena text-paper' : 'bg-paper text-ink'
                    }`}
                  >
                    {EVENT_LABELS[message.event.kind]} {gameTitle(message.event.gameId)}
                  </span>

                  {message.event.kind === 'invite' ? (
                    <button
                      type="button"
                      onClick={() => openArcade({ kind: 'invite', inviteId: message.event!.inviteId })}
                      title="Open this invitation in the arcade"
                      className={PLATE}
                    >
                      [ OPEN ]
                    </button>
                  ) : null}
                </p>
              )}
            </li>
          ))
        )}
      </ul>

      <div className="mt-2 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-ink">
          <label htmlFor={`${idPrefix}-body`}>
            {isGroup ? (
              <>
                MESSAGE TO THE GROUP ({others.length} OTHER{others.length === 1 ? '' : 'S'}):
              </>
            ) : (
              <>
                MESSAGE TO <ProfileName author={peer} lamp={false} />:
              </>
            )}
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
          className="mt-1 w-full rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-2 font-mono text-xs text-ink outline-none max-sm:p-3"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy}
            className={PLATE_LARGE}
          >
            {busy ? '[ SENDING... ]' : '[ SEND ]'}
          </button>

          <AsciiEmoticonPicker onPick={insertEmoticon} disabled={busy} />

          <p className="text-[10px] text-ink">ENTER SENDS :: SHIFT+ENTER STARTS A NEW LINE</p>
          {error === null ? null : <p className="text-[10px] font-bold text-bubble-pale">{error}</p>}
        </div>
      </div>
    </div>
  );
}
