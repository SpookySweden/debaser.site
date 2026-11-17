'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ROOM_CORNER_KEYS_AWAKE_MS } from '../lib/watch/room-frame';

/**
 * The visualiser and canvas keys in the picture's top corner (Luke, 2026-11-17: "ensure that they are not intrusive on the
 * screen and dissapear after not hovering on the player for 5 minutes"). They show while the pointer is over the picture
 * (a touch counts) and go once it hasn't been for `ROOM_CORNER_KEYS_AWAKE_MS`; both at once, with no fade (docs/design.md,
 * "Feel"). Gone, they keep their place, so the pointer coming back over the picture shows them where they were, and a key
 * reached by the keyboard shows them both (`:focus-visible`, never `:focus-within`). No black bar behind them (Luke,
 * 2026-11-17: "vis and canvas buttons need the black bar behind them gone"), as before ROOMPOLISH: each key is its own plate.
 */
export default function RoomCornerKeys({ box, children }: { box: RefObject<HTMLElement | null>; children: ReactNode }) {
  const [awake, setAwake] = useState(true);
  const lastSeen = useRef(0);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    let timer = 0;
    // One timer at a time, set again for whatever is left when it fires: a moving pointer only writes down when it was seen.
    const check = () => {
      // A pointer resting over the picture is still hovering, an embedded player's too: its frame takes the pointer's moves
      // for itself, but the browser still counts the frame, and so this box, as under the pointer.
      if (element.matches(':hover')) lastSeen.current = Date.now();
      const left = lastSeen.current + ROOM_CORNER_KEYS_AWAKE_MS - Date.now();
      if (left > 0) {
        timer = window.setTimeout(check, left);
        return;
      }
      timer = 0;
      setAwake(false);
    };
    const seen = () => {
      lastSeen.current = Date.now();
      setAwake(true);
      if (timer === 0) timer = window.setTimeout(check, ROOM_CORNER_KEYS_AWAKE_MS);
    };
    // The room opening counts as the pointer having been here.
    seen();
    for (const type of ['pointerenter', 'pointermove', 'pointerdown'] as const) element.addEventListener(type, seen, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of ['pointerenter', 'pointermove', 'pointerdown'] as const) element.removeEventListener(type, seen);
    };
  }, [box]);

  return (
    <div
      // Gone, they take no press either: a touch on the corner shows them first, and the next one presses.
      className={`absolute right-1 top-1 z-30 flex gap-1 ${awake ? '' : 'pointer-events-none opacity-0 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100'}`}
      data-room-corner-keys={awake ? 'shown' : 'hidden'}
    >
      {children}
    </div>
  );
}
