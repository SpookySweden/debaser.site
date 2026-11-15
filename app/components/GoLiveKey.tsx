'use client';

import { useState } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';

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
        onClick={() => setAsking(true)}
        aria-haspopup="dialog"
        aria-expanded={asking}
        aria-label="Go live: start a room people can join, with what is on and your queue"
        className={asking ? pressed : plate}
        data-go-live-key
      >
        [ GO LIVE ]
      </button>
      {asking ? <GoLiveWindow user={user} createThread={forum.createThread} screenFirst={screenFirst} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
