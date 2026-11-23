'use client';

import { useSyncExternalStore } from 'react';
import { KEY_FOCUS } from '../lib/ui/controls';
import { siteCanFullscreen, siteIsFullscreen, subscribeToSiteFullscreen, toggleSiteFullscreen } from '../lib/ui/whole-site-fullscreen';

const never = () => () => undefined;

/**
 * FULLSCREEN, the last key on the top bar (Luke, 2026-11-23: "The site itself should have a full screen button in the top right, which
 * you can exit with f11 or escape or by pressing the button again"). A bracket key saying what a press will do, as FILL WINDOW beside
 * it. Not drawn where the browser has no fullscreen.
 */
export default function SiteFullscreenKey() {
  const on = useSyncExternalStore(subscribeToSiteFullscreen, siteIsFullscreen, () => false);
  const can = useSyncExternalStore(never, siteCanFullscreen, () => true);
  if (!can) return null;
  return (
    <button
      type="button"
      data-site-fullscreen-key={on ? 'leave' : 'enter'}
      aria-label={on ? 'Leave fullscreen' : 'Fullscreen'}
      aria-pressed={on}
      title={on ? 'Back to the browser window (Esc or F11)' : 'The whole site, fullscreen'}
      onClick={toggleSiteFullscreen}
      className={`key ${KEY_FOCUS} -my-2 hidden min-h-tap shrink-0 cursor-pointer items-center px-2 text-label font-bold leading-none whitespace-nowrap active:translate-y-press active:bg-bubble active:text-ink-plate md:inline-flex`}
    >
      <span aria-hidden="true">{on ? '[ LEAVE FULLSCREEN ]' : '[ FULLSCREEN ]'}</span>
    </button>
  );
}
