'use client';

import { useEffect } from 'react';
import { askScreenHost, useScreenHost } from '../lib/screens/host-client';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { chooseScreen, useScreenView } from '../lib/watch/canvas-view';
import { setVisualiserOn } from '../lib/watch/visualiser';

/**
 * The `[ SCREEN ]` key (SPEC-screens.md, phase 3), beside the visualiser and canvas keys in a room's screen corner:
 * this viewer's own screen switched to their PC's screen and back. Words only: no mark, no art slot.
 *
 * Only the owner of the PC ever sees it, in any room they are in, and only while the PC's screen engine answers: the
 * site says so (`/api/screens/host`, asked when a room opens) and says no to everybody else. Like VIS and CANVAS it is
 * each viewer's own choice: nothing is synced, and the room's queue and players carry on untouched underneath.
 */
export default function ScreenToggle({
  roomId,
  audio,
  className,
}: {
  roomId: string;
  /** As the canvas key's: what kind of thing plays, which the room's own screen choice is kept by. */
  audio: boolean;
  className?: string;
}) {
  const host = useScreenHost();
  const onScreen = useScreenView(roomId, audio) === 'screen';
  useEffect(() => askScreenHost(), []);

  if (!host.available) return null;
  return (
    <button
      type="button"
      className={`${onScreen ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} ${className ?? ''}`}
      aria-pressed={onScreen}
      aria-label={onScreen ? "Back to the room's picture" : "Show your PC's screen"}
      title={onScreen ? 'Picture' : "Your PC's screen"}
      onClick={() => {
        // The visualiser would lie over the PC's screen, so choosing the screen puts it away (as the canvas key does).
        if (!onScreen) setVisualiserOn(roomId, false);
        chooseScreen(roomId, onScreen ? 'picture' : 'screen', audio);
      }}
      data-screen-toggle={onScreen ? 'on' : 'off'}
    >
      [ SCREEN ]
    </button>
  );
}
