'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { forgetOne, notForMe, pressHistory } from '../lib/recommender/history';
import { makerRef, type HistoryKind } from '../lib/recommender/types';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * The one feedback key on a result (Luke, 2026-11-14: "make sure the 'not for me etc' options are a single expandable
 * clear button, fitting with our intention to sleeken the ui"). `[ ⋯ ]` opens a short list: NOT FOR ME, SHOW LESS FROM
 * THIS CHANNEL, MORE LIKE THIS, and WHY THIS when the result has a reason to give.
 *
 * - One shared component: FOR YOU's lanes and MEDIA's rows draw the same key, and it writes the person's own private
 *   history itself (`recommender/history.ts`), so a row needs no wiring. Each press reshapes the picks at once: the
 *   history tells every list that reads it.
 * - The list is drawn on the page's own layer, fixed to where the key stands, so nothing under the pointer moves and a
 *   card that clips its contents cannot clip it. It closes on Escape, a press outside, or the page scrolling.
 * - It carries `aria-expanded`, so the site's one "this is open" look applies (globals.css).
 * - A press shows as pressed and pressing it again takes it back. Signed out there is nothing to keep, so no key.
 */

export type FeedbackItem = { kind: HistoryKind; ref: string; title: string; maker: string; words: readonly string[] };

type Press = 'not_for_me' | 'less' | 'more';

const ITEM = `${PLATE} block w-full text-left whitespace-nowrap`;
const ITEM_ON = `${PLATE_PRESSED} block w-full text-left whitespace-nowrap`;

export default function FeedbackKey({
  item,
  why = null,
  className = '',
  onNotForMe,
}: {
  item: FeedbackItem;
  /** The reason this result is here, in words; WHY THIS shows it. Left out, there is no WHY THIS. */
  why?: string | null;
  className?: string;
  /** A list that hides the result its own way (a visit-only hide, say): called instead of writing NOT FOR ME here. */
  onNotForMe?: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  /** What has been pressed here: one thing about the result itself (the newest of the two wins), and the maker's own. */
  const [thing, setThing] = useState<'not_for_me' | 'more' | null>(null);
  const [less, setLess] = useState(false);
  const [whyShown, setWhyShown] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const key = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setWhyShown(false);
    setNote(null);
    if (refocus) key.current?.focus();
  }, []);

  // Where the list goes: under the key, kept inside the window. Measured when it opens, and it closes rather than follow a scroll.
  useLayoutEffect(() => {
    if (!open || key.current === null || menu.current === null) return;
    const at = key.current.getBoundingClientRect();
    const size = menu.current.getBoundingClientRect();
    const left = Math.max(4, Math.min(at.left, window.innerWidth - size.width - 4));
    const below = at.bottom + 2;
    const top = below + size.height > window.innerHeight - 4 ? Math.max(4, at.top - size.height - 2) : below;
    // Measuring is what a layout effect is for: the list is drawn once out of sight, then placed before it is seen.
    setPlace({ top, left });
    menu.current.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !key.current?.contains(target)) close(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    };
    const away = () => close(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
    window.addEventListener('scroll', away, { capture: true, passive: true });
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('scroll', away, { capture: true });
      window.removeEventListener('resize', away);
    };
  }, [open, close]);

  if (user === null) return null;

  const press = async (action: Press) => {
    const about = { kind: item.kind, ref: item.ref, title: item.title, maker: item.maker, words: [...item.words] };
    // Pressed again: taken back. SHOW LESS is the maker's own row; the other two are one row about this thing.
    if (action === 'less' ? less : thing === action) {
      await (action === 'less' ? forgetOne('maker', makerRef(item.maker)) : forgetOne(item.kind, item.ref));
      if (action === 'less') setLess(false);
      else setThing(null);
      setNote('TAKEN BACK.');
      return;
    }
    if (action === 'not_for_me' && onNotForMe !== undefined) {
      onNotForMe();
      close(false);
      return;
    }
    const kept = action === 'not_for_me' ? await notForMe(about) : await pressHistory(about, action);
    if (!kept) {
      setNote('NOT KEPT: YOUR HISTORY IS PAUSED.');
      return;
    }
    if (action === 'less') setLess(true);
    else setThing(action);
    setNote(action === 'more' ? 'NOTED: MORE LIKE THIS.' : action === 'less' ? 'NOTED: LESS FROM THEM.' : 'NOTED: NOT FOR ME.');
  };

  const makerWord = item.kind === 'media' ? 'CHANNEL' : 'MAKER';
  return (
    <span className={`relative inline-block ${className}`} data-feedback-key>
      <button
        ref={key}
        type="button"
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`Picks: more or less like ${item.title}`}
        title="More or less like this"
        className={PLATE}
      >
        [ ⋯ ]
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Picks for ${item.title}`}
          className={`frame fixed z-menu flex w-max max-w-xs flex-col items-stretch bg-paper p-1 ${place === null ? 'invisible' : ''}`}
          style={place ?? { top: 0, left: 0 }}
          data-feedback-menu
        >
          <button type="button" role="menuitemcheckbox" aria-checked={thing === 'not_for_me'} onClick={() => void press('not_for_me')} className={thing === 'not_for_me' ? ITEM_ON : ITEM}>
            NOT FOR ME
          </button>
          {item.maker.trim() !== '' ? (
            <button type="button" role="menuitemcheckbox" aria-checked={less} onClick={() => void press('less')} className={less ? ITEM_ON : ITEM}>
              {`SHOW LESS FROM THIS ${makerWord}`}
            </button>
          ) : null}
          <button type="button" role="menuitemcheckbox" aria-checked={thing === 'more'} onClick={() => void press('more')} className={thing === 'more' ? ITEM_ON : ITEM}>
            MORE LIKE THIS
          </button>
          {why !== null && why !== '' ? (
            <button type="button" role="menuitem" aria-expanded={whyShown} onClick={() => setWhyShown((shown) => !shown)} className={ITEM}>
              WHY THIS
            </button>
          ) : null}
          {whyShown && why ? (
            <p className="break-words px-1 py-1 text-label text-ink" data-why>
              {why}
            </p>
          ) : null}
          {note !== null ? (
            <p role="status" className="px-1 py-1 text-label text-ink-quiet">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
