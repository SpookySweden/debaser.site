'use client';

import { useEffect, useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import type { ForumThread } from '../lib/forum/types';
import { getWatchRepository } from '../lib/watch/repository';
import type { PrivateLine } from '../lib/watch/types';
import { PrivateLines } from './PrivateOutline';

/**
 * A private stream's record on the board, for somebody outside it (SPEC-privacy-phase-3.md): `STREAM :: PRIVATE :: <day>`, the record in bars, no
 * replies and no reply box. The thread itself stays unreadable, so its title and author never reach this browser.
 */
export default function PrivateRecordRow({ thread, isOpen, onToggle }: { thread: ForumThread; isOpen: boolean; onToggle: (threadId: string, open: boolean) => void }) {
  const [lines, setLines] = useState<PrivateLine[] | null>(null);

  useEffect(() => {
    if (!isOpen || lines !== null) return;
    let alive = true;
    void getWatchRepository()
      .readRecordOutline(thread.id)
      .then((next) => {
        if (alive) setLines(next);
      })
      .catch(() => {
        if (alive) setLines([]);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, lines, thread.id]);

  return (
    <article id={threadDomId(thread.id)} className="rule-pixel px-2 py-2" data-private-record>
      <details className="group" open={isOpen} onToggle={(event) => onToggle(thread.id, event.currentTarget.open)}>
        <summary className="cursor-pointer text-label font-bold text-ink">
          <span aria-hidden="true">{isOpen ? '[-] ' : '[+] '}</span>
          {thread.title} :: {thread.privateRecord?.messages ?? 0} MESSAGES
        </summary>
        {isOpen ? <div className="mt-1 text-label font-bold text-ink">{lines === null ? <p>READING...</p> : <PrivateLines lines={lines} />}</div> : null}
      </details>
    </article>
  );
}
