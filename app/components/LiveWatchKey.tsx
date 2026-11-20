'use client';

import { setLiveWatch, useNotifySettings } from '../lib/notifications/notify-settings-store';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';

/**
 * TELL ME WHEN LIVE on somebody's profile (SPEC-notifications.md, answer 2C): pressed in, their room going live (open or
 * password) files a notification for you. Private: they are never told who picked them. Not on your own profile, and
 * nothing signed out.
 */
export default function LiveWatchKey({ host }: { host: string }) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const { ready, watches } = useNotifySettings(me);

  if (me === null || me === host) return null;

  const on = watches.includes(host);

  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!ready}
      onClick={() => void setLiveWatch(host, !on)}
      className={on ? PLATE_PRESSED : PLATE}
      data-live-watch={on ? 'on' : 'off'}
    >
      {on ? '[ ✓ TELLING YOU WHEN LIVE ]' : '[ TELL ME WHEN LIVE ]'}
    </button>
  );
}
