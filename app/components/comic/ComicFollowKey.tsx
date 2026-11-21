'use client';

import { setNotifySwitch, useNotifySettings } from '../../lib/notifications/notify-settings-store';
import { PLATE, PLATE_PRESSED } from '../../lib/ui/controls';
import { useAuth } from '../AuthProvider';

/**
 * COMIC's `[ FOLLOW ]` (SPEC-comic.md, Q12), on the contents page and at the end of each chapter. Following the comic IS
 * NOTIFY's COMIC NEW PAGES switch (SPEC-notifications.md, `notification_prefs.comic`, off by default), so one alert per
 * release reaches the bell. Nothing signed out (the guest banner carries the one LOG IN).
 */
export default function ComicFollowKey() {
  const me = useAuth().user?.id ?? null;
  const { ready, prefs } = useNotifySettings(me);
  if (me === null) return null;
  return (
    <button
      type="button"
      aria-pressed={prefs.comic}
      disabled={!ready}
      onClick={() => void setNotifySwitch('comic', !prefs.comic)}
      className={prefs.comic ? PLATE_PRESSED : PLATE}
    >
      {prefs.comic ? '[ ✓ FOLLOWING ]' : '[ FOLLOW ]'}
    </button>
  );
}
