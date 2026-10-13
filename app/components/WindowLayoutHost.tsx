'use client';

import { useEffect, useLayoutEffect } from 'react';
import { openMusic } from '../lib/audio/music-window';
import { openQueues } from '../lib/audio/queue-window';
import { openArcade } from '../lib/games/arcade-window';
import { openPreferences } from '../lib/ui/preferences-window';
import {
  adoptLayouts,
  awaitLayouts,
  flushLayoutSave,
  setLayoutSaver,
  setViewport,
  type SavedLayouts,
} from '../lib/ui/window-layout';
import { loadGuestLayouts, saveGuestLayouts } from '../lib/windows/guest-window-layouts';
import { getWindowLayoutRepository } from '../lib/windows/repository';
import { useAuth } from './AuthProvider';

/** The `sm` breakpoint: below it the docked windows are bottom sheets and no layout applies. */
const DESKTOP = '(min-width: 640px)';

/**
 * How a saved layout reopens a window. Keyed by the id each window gives `DockWindow`; a new docked
 * window that should come back open on the next visit adds its opener here.
 */
const OPENERS: Record<string, () => void> = {
  music: () => openMusic(),
  arcade: () => openArcade(),
  queue: () => openQueues(),
  preferences: () => openPreferences(),
};

/** The bottom of the guest strip, which windows may not go under; 0 when there is none. */
function measureTop(): number {
  const bar = document.querySelector('[data-top-bar]');
  return bar === null ? 0 : Math.ceil(bar.getBoundingClientRect().bottom);
}

/**
 * Keeps the window layout store in step with the screen and the session. Draws nothing.
 *
 * It reads the person's saved layouts when the session settles (the account's, or this browser's for a
 * guest), reopens the windows that layout had open, and hands the store a saver. It tells the store when
 * the screen changes size, or the guest strip comes or goes. On a phone it does none of this: a phone has
 * no layout.
 */
export default function WindowLayoutHost() {
  const { user, status } = useAuth();
  const userId = user?.id ?? null;

  // The screen, before anything opens: measured in a layout effect so a window opened by the address is
  // placed against the real viewport and not the store's placeholder.
  useLayoutEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight }, measureTop());
    measure();

    window.addEventListener('resize', measure);
    // The guest strip wraps and appears or vanishes with the session; watch its size too.
    const observer = new ResizeObserver(measure);
    const bar = document.querySelector('[data-top-bar]');
    if (bar !== null) observer.observe(bar);

    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [status]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!window.matchMedia(DESKTOP).matches) return;

    let cancelled = false;
    awaitLayouts();

    const finish = (layouts: SavedLayouts | null, saver: (layouts: SavedLayouts) => void) => {
      if (cancelled) return;
      setLayoutSaver(saver);
      for (const id of adoptLayouts(layouts)) OPENERS[id]?.();
    };

    if (userId === null) {
      finish(loadGuestLayouts(), saveGuestLayouts);
    } else {
      const repository = getWindowLayoutRepository();
      const saver = (layouts: SavedLayouts) => {
        repository.save(userId, layouts).catch((error: unknown) => console.warn('window layout not saved:', error));
      };
      repository
        .load(userId)
        .then((layouts) => finish(layouts, saver))
        .catch((error: unknown) => {
          // Unreadable is not the same as empty: the windows still work, but nothing is saved over a
          // layout that may well exist.
          console.warn('window layout not read:', error);
          if (!cancelled) adoptLayouts(null);
        });
    }

    const flush = () => flushLayoutSave();
    window.addEventListener('pagehide', flush);

    return () => {
      cancelled = true;
      flushLayoutSave();
      setLayoutSaver(null);
      window.removeEventListener('pagehide', flush);
    };
  }, [status, userId]);

  return null;
}
