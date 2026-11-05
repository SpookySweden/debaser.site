'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  arrivedWithPlace,
  currentEntryKey,
  paneName,
  paneNamed,
  placeFor,
  savePlace,
  WINDOW_PANE,
  writePlaces,
  type PanePlaces,
} from '../lib/ui/site-history';

/**
 * Your place on each page (SPEC-floating-player.md): how far each pane was scrolled, saved per history entry and put back
 * when the arrows or the browser's own keys return to that entry. Draws nothing.
 *
 * The site's pages scroll inside their own panes, not the window, so the browser's own restoring never helps here.
 * MEDIA's rows arrive late, so the place is put back over and over as the page grows, until it holds still or the reader
 * does anything themselves.
 */

/** Gives up on a page that never grows tall enough. */
const RESTORE_MS = 10000;
/** How many frames the place must hold before it counts as done: a late row can still push things along. */
const HOLD_FRAMES = 30;
const WRITE_MS = 300;
const THE_READER_ACTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

function scrollerOf(name: string): Element | null {
  return name === WINDOW_PANE ? document.scrollingElement : paneNamed(name);
}

export default function SiteHistoryKeeper() {
  const pathname = usePathname();
  /** The page React has drawn. On a traversal the address changes first, and the old page is still up until this does. */
  const drawn = useRef(pathname);
  useEffect(() => {
    drawn.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let restoring: (() => void) | null = null;
    let writing = 0;

    const onScroll = (event: Event) => {
      if (restoring !== null) return;
      const target = event.target;
      const pane = target === document ? WINDOW_PANE : target instanceof Element && target.isConnected && target.closest('main') !== null ? paneName(target) : null;
      if (pane === null) return;
      const top = pane === WINDOW_PANE ? window.scrollY : (target as Element).scrollTop;
      savePlace(currentEntryKey(), pane, top);
      window.clearTimeout(writing);
      writing = window.setTimeout(writePlaces, WRITE_MS);
    };

    const restore = (place: PanePlaces) => {
      restoring?.();
      const started = performance.now();
      let held = 0;
      let raf = 0;
      const stop = () => {
        window.cancelAnimationFrame(raf);
        for (const name of THE_READER_ACTS) document.removeEventListener(name, stop, { capture: true });
        restoring = null;
      };
      restoring = stop;
      for (const name of THE_READER_ACTS) document.addEventListener(name, stop, { capture: true, passive: true });
      const tick = () => {
        if (performance.now() - started > RESTORE_MS) {
          stop();
          return;
        }
        if (drawn.current !== window.location.pathname) {
          raf = window.requestAnimationFrame(tick);
          return;
        }
        let there = true;
        for (const [name, top] of Object.entries(place)) {
          const pane = scrollerOf(name);
          if (pane === null) {
            there = false;
            continue;
          }
          if (Math.abs(pane.scrollTop - top) > 1) {
            pane.scrollTop = top;
            if (Math.abs(pane.scrollTop - top) > 1) there = false;
          }
        }
        held = there ? held + 1 : 0;
        if (held >= HOLD_FRAMES) {
          stop();
          return;
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    };

    const onTraverse = () => {
      restoring?.();
      const place = placeFor(currentEntryKey());
      if (place !== null) restore(place);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('popstate', onTraverse);
    window.addEventListener('pagehide', writePlaces);
    if (arrivedWithPlace()) onTraverse();

    return () => {
      restoring?.();
      window.clearTimeout(writing);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('popstate', onTraverse);
      window.removeEventListener('pagehide', writePlaces);
    };
  }, []);

  return null;
}
