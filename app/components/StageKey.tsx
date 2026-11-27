'use client';

import { useSyncExternalStore } from 'react';
import { PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import { stageBkgOn, stageBkgOnServer, subscribeToStageBkg, toggleStageBkg } from '../lib/ui/stage-bkg';
import { explain } from '../lib/ui/explain';

/**
 * `[ BKG ]`, in the top-left corner of a fullscreen video's surround, where the background's own key sits on the desk
 * (`BackdropKey`). Pressed in: the chosen background round the picture, its black bars trimmed. Out: the video as its
 * player shows it. See `../lib/ui/stage-bkg.ts`.
 *
 * Drawn by whatever box is fullscreen, inside it (only what is inside a fullscreen box shows), and that box is positioned.
 * Quiet until pointed at, so it does not sit lit over the corner of a film that fills the screen. It counts as solid for
 * the background behind it: a press on it is not a press on the sand.
 */
export default function StageKey() {
  const on = useSyncExternalStore(subscribeToStageBkg, stageBkgOn, stageBkgOnServer);
  return (
    <button
      type="button"
      onClick={toggleStageBkg}
      // A double press here is two presses on this key, never the picture's "leave fullscreen".
      onDoubleClick={(event) => event.stopPropagation()}
      aria-pressed={on}
      aria-label="Background round the picture, black bars trimmed"
      title={on ? 'BACKGROUND ROUND THE PICTURE, BARS TRIMMED. PRESS FOR THE PLAIN VIDEO' : 'THE PLAIN VIDEO. PRESS FOR THE BACKGROUND, BARS TRIMMED'}
      {...explain(on ? 'Shows the plain video, with its own black bars.' : 'Puts the site\'s background round the picture and trims the black bars.', 'Only on your screen.')}
      className={`absolute left-1 top-1 z-30 opacity-60 hover:opacity-100 focus-visible:opacity-100 ${on ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}`}
      data-stage-bkg={on ? 'on' : 'off'}
      data-backdrop-solid=""
    >
      [ BKG ]
    </button>
  );
}
