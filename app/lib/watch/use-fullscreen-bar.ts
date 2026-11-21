'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ROOM_BAR_AWAKE_MS } from './room-frame';

/**
 * Whether a bar of keys over a picture shows (Luke, 2026-11-19: "dissapear after a few seconds of no mouse movement or as soon
 * as the mouse is moved off the video"; 2026-11-21: "When full screening video make it so that the bottom bar goes away after a
 * few seconds of no mouse movement"). While `active` is false it always shows.
 *
 * Active, it wakes on any move or press in `area` and any key pressed anywhere on the page, and sleeps `ROOM_BAR_AWAKE_MS`
 * after the last one, at once when the pointer leaves the area (another screen, the edge of the window). A pointer resting
 * still on the bar does not keep it: pressing FULL leaves the pointer there, and the bar still goes once it stops moving
 * (ROOMBARS). It stays while one of its lists (SUBS, QUALITY, the sound) is open and while a key in it has the keyboard's
 * focus. Showing and hiding are instant, as every reveal on the site is (docs/design.md, "Feel").
 *
 * Another site's player (Vimeo, Twitch) keeps the pointer's moves inside its frame, so over it only the bar's own strip
 * feels them: moving to the foot of the picture wakes it. YouTube's has the room's clear cover over it, which feels them all.
 */
export function useIdleBar(area: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    const element = area.current;
    if (!active || element === null) return;
    let timer = 0;
    /** Something on the bar is in use: a list open from it, or a key reached by the keyboard. */
    const inUse = () => {
      const keys = bar.current;
      return keys !== null && keys.querySelector('[aria-expanded="true"], :focus-visible') !== null;
    };
    const sleep = () => {
      timer = window.setTimeout(() => {
        if (inUse()) sleep();
        else setAwake(false);
      }, ROOM_BAR_AWAKE_MS);
    };
    const wake = () => {
      window.clearTimeout(timer);
      setAwake(true);
      sleep();
    };
    const left = (event: PointerEvent) => {
      // A finger lifting is not the pointer going anywhere; and a frame in the picture still counts as over it.
      if (event.pointerType === 'touch' || element.matches(':hover') || inUse()) return;
      window.clearTimeout(timer);
      setAwake(false);
    };
    // Becoming active shows it, then the clock runs.
    sleep();
    const wakers = ['pointermove', 'pointerdown', 'focusin'] as const;
    for (const type of wakers) element.addEventListener(type, wake, { passive: true });
    // A key anywhere: the focus may be outside the area (fullscreen started from the keyboard, a press on the page).
    document.addEventListener('keydown', wake);
    element.addEventListener('pointerleave', left);
    return () => {
      window.clearTimeout(timer);
      for (const type of wakers) element.removeEventListener(type, wake);
      document.removeEventListener('keydown', wake);
      element.removeEventListener('pointerleave', left);
      // Inactive, the bar shows, and the next time starts with it showing.
      setAwake(true);
    };
  }, [area, bar, active]);

  return active ? awake : true;
}

/** The room's bar of keys over a fullscreen picture: out of fullscreen it sits under the picture and always shows. */
export function useFullscreenBar(stage: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, fullscreen: boolean): boolean {
  return useIdleBar(stage, bar, fullscreen);
}
