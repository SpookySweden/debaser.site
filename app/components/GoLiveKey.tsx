'use client';

import { useState } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';
import { goLiveInMainRoom } from '../lib/watch/main-room-play';
import { explain } from '../lib/ui/explain';

/**
 * `[ GO LIVE ]` wherever your room shows itself: on the bar, and on the floating player in place of its old
 * `[ WATCH IN ROOM ]` (SPEC-rooms-queues.md, phase 3: "one key, one meaning").
 *
 * One press opens the menu every GO LIVE opens (WHO CAN JOIN, with PRIVATE picked); START there makes tonight's room and
 * carries what is on and your queue into it (go-live-carry.ts), so a stray press starts nothing. Accounts only: a
 * signed-out visitor is not shown the key here (the room window's own panel tells them to log in). `screenFirst` is
 * the floating player's: the video it is drawn under is what goes in.
 */
export default function GoLiveKey({ plate = PLATE, pressed = PLATE_PRESSED, screenFirst = false }: { plate?: string; pressed?: string; screenFirst?: boolean }) {
  const { user } = useAuth();
  const forum = useForum();
  const [asking, setAsking] = useState(false);

  if (user === null) return null;
  return (
    <>
      <button
        type="button"
        // Your own room goes live where it is (SPEC-rooms-perpetual.md): its window opens on WHO CAN JOIN.
        onClick={() => {
          if (!goLiveInMainRoom()) setAsking(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={asking}
        aria-label="Go live: start a room people can join, with what is on and your queue"
        className={asking ? pressed : plate}
        data-go-live-key
        {...explain('Opens GO LIVE: start a room other people can join, with what is on and your queue.', 'First you choose who can join (PRIVATE is picked to start with); nothing starts until you press START.', 'ONCE STARTED, PEOPLE YOU LET IN SEE AND HEAR WHAT YOU PLAY.')}
      >
        [ GO LIVE ]
      </button>
      {asking ? <GoLiveWindow user={user} createThread={forum.createThread} screenFirst={screenFirst} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
