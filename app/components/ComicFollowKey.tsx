'use client';

import { setNotifySwitch, useNotifySettings } from '../lib/notifications/notify-settings-store';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * FOLLOW on the comic reader (SPEC-notifications.md, agreed with COMIC): following the comic IS the COMIC NEW PAGES
 * switch (`notification_prefs.comic`, off until pressed), so this key and PREFERENCES' switch are the same thing. Pressed
 * in, each RELEASE files one alert for you. Nothing signed out. COMIC places it; NOTIFY owns it.
 */
export default function ComicFollowKey() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const { ready, prefs } = useNotifySettings(me);

  if (me === null) return null;

  return (
    <button
      type="button"
      aria-pressed={prefs.comic}
      disabled={!ready}
      onClick={() => void setNotifySwitch('comic', !prefs.comic)}
      className={prefs.comic ? PLATE_PRESSED : PLATE}
      title={prefs.comic ? 'NEW PAGES TELL YOU' : 'TELL ME ABOUT NEW PAGES'}
      data-comic-follow={prefs.comic ? 'on' : 'off'}
    >
      {prefs.comic ? '[ ✓ FOLLOWING ]' : '[ FOLLOW ]'}
    </button>
  );
}
