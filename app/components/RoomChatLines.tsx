'use client';

import { useEffect, useState } from 'react';
import { getWatchRepository } from '../lib/watch/repository';
import type { DiscussLine, DiscussQuery } from '../lib/watch/types';
import TimeStamp from './TimeStamp';
import { useModeration } from './ModerationProvider';

/**
 * Room chat on a thing's DISCUSS page (SPEC-room-chat-discuss.md, Luke 2026-11-16): the lines said in any room while it was on
 * the room's screen, read from where the chat is kept (never copied), from rooms and people whose switches are on. Each line
 * is drawn among the comments, in time order, with its name, when it was sent, and `IN ROOM · 02:14` (where in the video).
 * The words are plain text. They can't be answered one by one: the thread takes ordinary comments.
 */

/** `02:14`, or `1:02:14` past the hour. */
export function videoClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${two(minutes)}:${two(rest)}`;
}

/** The lines for one thing, read once when the window opens. Nothing is read without something to look for. */
export function useDiscussChat(query: DiscussQuery | undefined): DiscussLine[] {
  const [lines, setLines] = useState<DiscussLine[]>([]);
  const key = query === undefined ? '' : JSON.stringify(query);
  useEffect(() => {
    if (key === '') return;
    let live = true;
    void getWatchRepository()
      .discussChat(JSON.parse(key) as DiscussQuery)
      .then((found) => {
        if (live) setLines(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  // A blocked person's lines are left out (SPEC-moderation.md); the database leaves them out of the read too.
  const { isBlocked } = useModeration();
  return lines.filter((line) => !isBlocked(line.authorId));
}

export function RoomChatLine({ line }: { line: DiscussLine }) {
  const name = line.guest ? line.authorLabel.replace(/ \[GUEST\]$/, '') : line.authorLabel;
  // A private room's line (ROOMCHAT, Luke 2026-11-17): to someone who wasn't in the room the database already sent it as
  // the speaker's number there (`ANON-3`), no name; to those who were, the name, with a note that others don't see it.
  const privateTag = line.anonymous ? 'PRIVATE ROOM' : line.privateRoom ? 'PRIVATE ROOM · NAME SHOWN TO ITS MEMBERS' : null;
  return (
    <li className="rule-pixel py-1 text-ink" data-room-chat-line={line.id} data-room-chat-anonymous={line.anonymous ? '' : undefined}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-label">
        <span className={line.anonymous ? 'font-strong text-ink-quiet' : 'font-strong text-key'}>{name}</span>
        {line.guest ? <span className="text-ink-quiet">GUEST</span> : null}
        {privateTag === null ? null : <span className="text-ink-quiet" data-room-chat-private>{privateTag}</span>}
        <TimeStamp at={line.saidAt} />
        <span className="text-ink-quiet" data-room-chat-tag>{`IN ROOM · ${videoClock(line.mediaSeconds)}`}</span>
      </p>
      <p className="mt-0.5 text-prose wrap-anywhere">{line.body}</p>
    </li>
  );
}
