'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ROOM_BAR_AWAKE_MS } from './room-frame';

/**
 * Whether the room's bar of keys shows over a fullscreen picture (Luke, 2026-11-19: "dissapear after a few seconds of no
 * mouse movement or as soon as the mouse is moved off the video"). Out of fullscreen it always shows.
 *
 * Fullscreen, it wakes on any move, press or key in the stage and sleeps `ROOM_BAR_AWAKE_MS` after the last one, at once
 * when the pointer leaves the stage (another screen, the edge of the window). It stays while the pointer rests on the
 * bar itself, while one of its lists (SUBS, QUALITY, the sound) is open, and while a key in it has the keyboard's focus.
 * Showing and hiding are instant, as every reveal on the site is (docs/design.md, "Feel").
 *
 * Another site's player (Vimeo, Twitch) keeps the pointer's moves inside its frame, so over it only the bar's own strip
 * feels them: moving to the foot of the screen wakes it. YouTube's has the room's clear cover over it, which feels them all.
 */
export function useFullscreenBar(stage: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, fullscreen: boolean): boolean {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    const element = stage.current;
    if (!fullscreen || element === null) return;
    let timer = 0;
    /** Something on the bar is in use: the pointer on it, a list open from it, or a key reached by the keyboard. */
    const inUse = () => {
      const keys = bar.current;
      return keys !== null && (keys.matches(':hover') || keys.querySelector('[aria-expanded="true"], :focus-visible') !== null);
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
    // Going fullscreen shows it, then the clock runs.
    sleep();
    const wakers = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const;
    for (const type of wakers) element.addEventListener(type, wake, { passive: true });
    element.addEventListener('pointerleave', left);
    return () => {
      window.clearTimeout(timer);
      for (const type of wakers) element.removeEventListener(type, wake);
      element.removeEventListener('pointerleave', left);
      // Out of fullscreen the bar is under the picture again, and the next fullscreen starts with it showing.
      setAwake(true);
    };
  }, [stage, bar, fullscreen]);

  return fullscreen ? awake : true;
}
