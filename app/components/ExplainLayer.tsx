'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EXPLAIN_BOX_ID, placeExplainBox } from '../lib/ui/explain';
import { useExplainMode } from '../lib/ui/explain-mode';

/**
 * The explanation box (EXPLAIN, Luke 2026-11-27): drawn once in `layout.tsx`, and only while the reader's `[ EXPLAIN ]` switch is on
 * (`../lib/ui/explain-mode.ts`). Off, it is nothing at all: no box, no listeners.
 *
 * On, it listens to the whole page rather than to each key. Rest the pointer on a key that carries words (`data-explain`, written by
 * `explain()` in `../lib/ui/explain.ts`) for a moment and the box opens beside it; move to another key and it follows at once; Tab
 * onto a key and it opens straight away. Esc, a press, a scroll or leaving the key puts it away, and a key you pressed or Esc'd stays
 * quiet until the pointer leaves it.
 *
 * - It never covers the key: below it, else above, else beside it, kept inside the screen. It is `fixed`, so nothing on the page moves
 *   (frontend.md, "reveals take their space"), and the pointer passes straight through it.
 * - It appears and goes with no animation, so it is the same under reduced motion.
 * - The key a box is about names it in `aria-describedby`, so a screen reader reads the same words.
 * - While it is about a key, the browser's own grey tip (`title`) on that key, inside it and above it is held back, so two tips
 *   never show at once, and put back the moment the pointer moves on.
 * - A finger is left alone: phones come later (desktop first).
 */
export default function ExplainLayer() {
  const on = useExplainMode();
  return on ? <ExplainBox /> : null;
}

/** How long the pointer rests on a key before the box opens: long enough that passing over keys opens nothing. */
const PAUSE_MS = 450;
type Shown = { target: HTMLElement; what: string; why: string | null; note: string | null };

function wordsOf(target: HTMLElement): Shown {
  return {
    target,
    what: target.getAttribute('data-explain') ?? '',
    why: target.getAttribute('data-explain-why'),
    note: target.getAttribute('data-explain-note'),
  };
}

/** The key under a pointer or focus: the nearest element, from there up, that carries words. */
function keyAt(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-explain]') : null;
}

/** Adds or takes the box's name from a key's `aria-describedby`, leaving any other names it has alone. */
function describe(key: HTMLElement, add: boolean): void {
  const names = (key.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((name) => name !== '' && name !== EXPLAIN_BOX_ID);
  if (add) names.push(EXPLAIN_BOX_ID);
  if (names.length === 0) key.removeAttribute('aria-describedby');
  else key.setAttribute('aria-describedby', names.join(' '));
}

function ExplainBox() {
  const [shown, setShown] = useState<Shown | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    /** The key the pointer is resting on. */
    let pending: HTMLElement | null = null;
    /** The key the box is about. */
    let current: HTMLElement | null = null;
    /** A key pressed or Esc'd: it stays quiet until the pointer leaves it. */
    let quiet: HTMLElement | null = null;
    /** Grey browser tips held back while the box is about their key, to be put back. */
    const lifted = new Map<HTMLElement, string>();

    const restoreTitles = () => {
      for (const [element, title] of lifted) element.setAttribute('title', title);
      lifted.clear();
    };
    const lift = (element: Element) => {
      const title = element.getAttribute('title');
      if (title !== null && element instanceof HTMLElement && !lifted.has(element)) {
        lifted.set(element, title);
        element.removeAttribute('title');
      }
    };
    /** The key's own tip, every tip inside it, and every tip above it (a row's), which the browser would show instead. */
    const liftTitles = (key: HTMLElement) => {
      for (const inside of key.querySelectorAll('[title]')) lift(inside);
      for (let element: Element | null = key; element !== null && element !== document.body; element = element.parentElement) lift(element);
    };

    const show = (key: HTMLElement) => {
      window.clearTimeout(timer);
      if (current !== null && current !== key) describe(current, false);
      current = key;
      describe(key, true);
      setShown(wordsOf(key));
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (current !== null) describe(current, false);
      current = null;
      setShown(null);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const key = keyAt(event.target);
      if (key === pending) return;
      restoreTitles();
      pending = key;
      if (quiet !== null && key !== quiet) quiet = null;
      if (key === null || key === quiet) {
        hide();
        return;
      }
      liftTitles(key);
      // Already open on another key: move straight over, as a menu does.
      if (current !== null) {
        show(key);
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (pending === key && key.isConnected) show(key);
      }, PAUSE_MS);
    };
    // The pointer left the page altogether.
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      pending = null;
      restoreTitles();
      hide();
    };
    const onDown = () => {
      quiet = pending ?? current;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const key = keyAt(event.target);
      if (key === null || !(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
      quiet = null;
      show(key);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (current !== null && event.target instanceof Node && current.contains(event.target)) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || current === null) return;
      quiet = current;
      hide();
    };
    const onMove = () => {
      if (current !== null) hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      // Switched off with the box open: every tip and every key's description back as it was.
      restoreTitles();
      if (current !== null) describe(current, false);
    };
  }, []);

  // Placed before the screen is painted, so the box never shows anywhere but beside its key.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (shown === null || box === null) return;
    const size = box.getBoundingClientRect();
    const place = placeExplainBox(shown.target.getBoundingClientRect(), size, document.documentElement.clientWidth, window.innerHeight);
    box.style.left = `${place.left}px`;
    box.style.top = `${place.top}px`;
    box.style.visibility = 'visible';
  }, [shown]);

  if (shown === null) return null;
  return (
    <div
      ref={boxRef}
      id={EXPLAIN_BOX_ID}
      role="tooltip"
      data-explain-box=""
      className="frame pointer-events-none fixed left-0 top-0 z-overlay w-max max-w-sm bg-sun-pale px-2 py-1.5 text-prose text-ink"
      style={{ visibility: 'hidden' }}
    >
      <p className="font-strong">{shown.what}</p>
      {shown.why === null ? null : <p className="mt-1">{shown.why}</p>}
      {shown.note === null ? null : <p className="mt-1 w-fit bg-bubble-pale px-1 font-strong text-ink-bar">{shown.note}</p>}
    </div>
  );
}
