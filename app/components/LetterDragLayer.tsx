'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { companionCatches } from '../lib/companion/events';
import { CATCH_ROOM_PX, characterCatchers, setLetterDropHandler, useLetterDrag, type LetterDrop } from '../lib/letters/letter-drag';
import { getLettersRepository } from '../lib/letters/repository';
import type { LetterItem } from '../lib/letters/types';
import { EMPTY_LETTER, sendLetterTo, sentLine } from '../lib/recommendations/send-letter';
import { useComms } from './CommsProvider';
import LetterStamp from './LetterStamp';

/** How long the words stay where the letter landed. */
const SAID_FOR_MS = 4000;
/** The carried envelope hangs a little down and right of the pointer, so the pointer's tip stays the thing that aims. */
const HANG_PX = 14;

/**
 * What a letter in the air draws, and what a drop does (SPEC-letter-drag.md). While one is carried: a small copy of its
 * envelope and name under the pointer, saying `→ NAME` once it is over someone who can catch it, and a dotted outline
 * round every character that could (the side panel's rows light themselves, `UserDirectoryRow`).
 *
 * A drop on a lit person sends at once (Luke, Q2: "Sends at once"): the letter goes as a recommendation, that person's
 * character plays its catch the moment it lands (Q3; `companionCatches`, a picture on this screen only), and
 * `SENT "LETTER" TO NAME` shows where it landed for a few seconds and is handed to `onSaid` for the LETTERS section's own
 * line. An empty letter, or a refusal from the database (the 50-a-day limit), says so in the same two places.
 *
 * Mounted by the profile's LETTERS for someone signed in. It draws on `document.body`, over everything, and takes no
 * presses.
 */
export default function LetterDragLayer({ me, onSaid }: { me: string; onSaid: (line: string) => void }) {
  const drag = useLetterDrag();
  const { allAccounts } = useComms();
  const [said, setSaid] = useState<{ line: string; x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  /** The carried letter's things, asked for as it is picked up so a drop doesn't wait for them. */
  const things = useRef<{ id: string; read: Promise<LetterItem[]> } | null>(null);
  const nameMap = useMemo(() => new Map(allAccounts.map((account) => [account.id, account.displayName])), [allAccounts]);
  const names = useRef(nameMap);
  const saidTo = useRef(onSaid);

  useEffect(() => {
    names.current = nameMap;
  }, [nameMap]);
  useEffect(() => {
    saidTo.current = onSaid;
  }, [onSaid]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHost(document.body));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const carriedId = drag?.letter.id ?? null;
  useEffect(() => {
    if (carriedId === null) return undefined;
    const read = getLettersRepository().items(carriedId);
    read.catch(() => undefined);
    things.current = { id: carriedId, read };
    // Put back, dropped or cancelled: what was read is forgotten, so a letter changed since is read afresh the next time
    // it is picked up (code review, 2026-11-14: Escape used to leave the old list to be sent later).
    return () => {
      things.current = null;
    };
  }, [carriedId]);

  // Characters walk: while a letter is up, their outlines are drawn again every frame.
  const carrying = drag !== null;
  useEffect(() => {
    if (!carrying) return undefined;
    let frame = window.requestAnimationFrame(function again() {
      setTick((tick) => tick + 1);
      frame = window.requestAnimationFrame(again);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [carrying]);

  useEffect(() => {
    const say = (line: string, drop: LetterDrop) => {
      setSaid({ line, x: drop.x, y: drop.y });
      saidTo.current(line);
    };
    setLetterDropHandler((drop) => {
      const nameOf = (id: string) => names.current.get(id) ?? 'SOMEONE';
      const held = things.current?.id === drop.letter.id ? things.current.read : getLettersRepository().items(drop.letter.id);
      void (async () => {
        try {
          const items = await held;
          if (items.length === 0) {
            say(EMPTY_LETTER, drop);
            return;
          }
          // The catch and the send are one moment: the picture plays here while the letter goes.
          companionCatches(drop.userId);
          const sent = await sendLetterTo({
            letter: drop.letter,
            items,
            to: [drop.userId],
            ownerName: drop.letter.owner === me ? null : nameOf(drop.letter.owner),
            sender: { id: me, name: names.current.get(me) ?? '' },
          });
          say(sentLine(drop.letter.name, [nameOf(drop.userId)], sent.left), drop);
        } catch (error) {
          say(error instanceof Error ? error.message : 'The letter could not be sent.', drop);
        }
      })();
    });
    return () => setLetterDropHandler(null);
  }, [me]);

  useEffect(() => {
    if (said === null) return undefined;
    const timer = window.setTimeout(() => setSaid(null), SAID_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [said]);

  if (host === null || (drag === null && said === null)) return null;

  const overName = drag?.over ? (nameMap.get(drag.over.userId) ?? 'SOMEONE') : null;
  // Beside the pointer, on whichever side has the room: the side panel is at the right edge and the companions at the foot.
  const at = (x: number, y: number): CSSProperties => ({
    ...(x > window.innerWidth / 2 ? { right: window.innerWidth - x + HANG_PX } : { left: x + HANG_PX }),
    ...(y > window.innerHeight / 2 ? { bottom: window.innerHeight - y + HANG_PX } : { top: y + HANG_PX }),
  });

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-overlay overflow-hidden" aria-hidden="true" data-letter-drag-layer>
      {drag !== null
        ? characterCatchers().map(({ userId, box }) => (
            <span
              key={userId}
              data-letter-catcher-outline={userId}
              className={`absolute block outline-accent-ink ${drag.over?.userId === userId ? 'outline outline-2' : 'outline outline-2 outline-dotted'}`}
              style={{ left: box.left - CATCH_ROOM_PX, top: box.top - CATCH_ROOM_PX, width: box.width + CATCH_ROOM_PX * 2, height: box.height + CATCH_ROOM_PX * 2 }}
            />
          ))
        : null}
      {drag !== null ? (
        <span className="absolute flex items-center gap-1.5 border border-ink bg-paper px-1 text-label text-ink" style={at(drag.x, drag.y)} data-letter-carried>
          <LetterStamp letter={drag.letter} />
          <span className="whitespace-nowrap">{drag.letter.name}</span>
          {overName !== null ? <span className="whitespace-nowrap font-bold text-accent-ink">→ {overName}</span> : null}
        </span>
      ) : null}
      {said !== null ? (
        <span className="absolute border border-ink bg-paper px-1 py-0.5 text-label text-ink" style={at(said.x, said.y)} data-letter-said>
          {said.line}
        </span>
      ) : null}
    </div>,
    host,
  );
}
