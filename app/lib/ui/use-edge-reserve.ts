'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes how much of the screen a fixed strip covers at one edge, as a CSS variable on `<html>`.
 *
 * Two strips are pinned over the page: the guest fault across the top (`--top-bar`, ./GuestPrompt.tsx)
 * and the docked player across the foot (`--bottom-bar`, ./MusicPlayer.tsx). The page window
 * (./SiteWindow.tsx) keeps a spacer that tall at each end, so its title and its taskbar sit beside the
 * strips instead of behind them. While a strip is not drawn its variable is unset and the window falls
 * back to the room it always kept.
 *
 * Measured rather than written down, because both strips wrap at narrow widths and follow the type dial.
 * The observer catches the strip changing size; the resize listener catches the screen changing under a
 * strip that did not (a bottom strip's top moves when the screen gets shorter).
 */
export function useEdgeReserve(
  strip: RefObject<HTMLElement | null>,
  name: '--top-bar' | '--bottom-bar',
  drawn: boolean,
): void {
  useLayoutEffect(() => {
    const element = strip.current;
    if (!drawn || element === null) return;

    const root = document.documentElement;
    const publish = () => {
      const box = element.getBoundingClientRect();
      const covered = name === '--top-bar' ? box.bottom : window.innerHeight - box.top;
      root.style.setProperty(name, `${Math.ceil(Math.max(0, covered))}px`);
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener('resize', publish);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty(name);
    };
  }, [strip, name, drawn]);
}
