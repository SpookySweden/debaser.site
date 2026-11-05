'use client';

import { useSyncExternalStore } from 'react';
import { KEY_FOCUS } from '../lib/ui/controls';
import { goSiteHistory, siteHistoryServerWays, siteHistoryWays, subscribeToSiteHistory } from '../lib/ui/site-history';

/**
 * `[ ◄ ] [ ► ]` in the nav, left of PROJECTS (SPEC-floating-player.md): back and forward through the site's own history.
 * Each goes quiet when it has nowhere to go. `pointer-coarse`: a phone is given the 1280 layout (`layout.tsx`), so the
 * width can't tell a finger from a mouse, and a finger gets the full tap size.
 */
const ARROW = `${KEY_FOCUS} key cursor-pointer inline-flex h-7 min-w-0 items-center px-2 text-label font-bold leading-none active:translate-y-press active:bg-bubble active:text-ink-plate disabled:cursor-not-allowed max-md:min-h-tap pointer-coarse:min-h-tap pointer-coarse:min-w-tap`;

export default function SiteArrows() {
  const ways = useSyncExternalStore(subscribeToSiteHistory, siteHistoryWays, siteHistoryServerWays);
  const back = ways === 'back' || ways === 'both';
  const forward = ways === 'forward' || ways === 'both';

  return (
    <>
      <button type="button" onClick={() => goSiteHistory(-1)} disabled={!back} aria-label="Back" title="Back" className={ARROW}>
        [ ◄ ]
      </button>
      <button type="button" onClick={() => goSiteHistory(1)} disabled={!forward} aria-label="Forward" title="Forward" className={ARROW}>
        [ ► ]
      </button>
    </>
  );
}
