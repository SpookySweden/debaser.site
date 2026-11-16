'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { PLATE } from '../lib/ui/controls';
import { setCornerSlot } from '../lib/ui/corner-shelf';
import { setSiteHidden, siteHidden, siteHiddenOnServer, subscribeToSiteHidden } from '../lib/ui/site-hidden';
import { useEdgeReserve } from '../lib/ui/use-edge-reserve';
import { usePlayerFolded } from './MusicPlayer';

/**
 * The keys above the player, in one place (Luke, 2026-11-16): `[ ▲ ROOM ]` (your own room, ./WatchWindow.tsx), the folded
 * stream's `ROOM :: LIVE`, and `[ ▲ WINDOW ]`, which brings back the site window `[ HIDE WINDOW ]` put away (../lib/ui/site-hidden.ts).
 *
 * Over the bar they stand in a row just above its left key; with the player folded to its tile they stand in a column over that
 * tile, in the bottom left: the room keys nearest the player, the window's key on top. Each is its own framed tile, as a key on the
 * desktop is. The page window's foot keeps clear of the whole shelf (`--stream-box`, ./SiteWindow.tsx), and the companion steps
 * round it. Empty, it is no size and covers nothing.
 */
export default function CornerShelf() {
  const folded = usePlayerFolded();
  const hidden = useSyncExternalStore(subscribeToSiteHidden, siteHidden, siteHiddenOnServer);
  const shelf = useRef<HTMLDivElement>(null);
  useEdgeReserve(shelf, '--stream-box', true);
  const slot = useCallback((element: HTMLSpanElement | null) => setCornerSlot(element), []);

  return (
    <div
      ref={shelf}
      className={`fixed z-50 flex gap-1 ${folded ? 'flex-col-reverse items-start' : 'items-end'}`}
      style={{ bottom: 'calc(var(--music-top, 0px) + 0.5rem)', left: 'var(--music-key-left, 0.5rem)' }}
      data-corner-shelf={folded ? 'column' : 'row'}
      data-companion-avoid
    >
      <span ref={slot} className="contents" />
      {hidden ? (
        <span className="frame bg-sun-pale p-0.5" data-restore-window>
          <button type="button" onClick={() => setSiteHidden(false)} className={PLATE} aria-label="Bring back the site window" title="BRING BACK THE WINDOW">
            [ ▲ WINDOW ]
          </button>
        </span>
      ) : null}
    </div>
  );
}
