'use client';

import { setLiveWatch, useNotifySettings } from '../lib/notifications/notify-settings-store';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { ICON_BELL } from '../lib/ui/icons';
import { useAuth } from './AuthProvider';
import { explain } from '../lib/ui/explain';

/**
 * The notification key on somebody's profile (SPEC-notifications.md, answer 2C): pressed in, their room going live (open or
 * password) files a notification for you. Private: they are never told who picked them. Not on your own profile, and
 * nothing signed out.
 *
 * Luke, 2026-11-21: "the tell me when live should be a notification button, which will later include other options, but when
 * clicked it lights up for now which has the same function". So it is the site's own notices glyph (`ICON_BELL`, the one the
 * top bar's notices key wears) in brackets, and pressed it lights up as the filled pill every key that is on wears. One press
 * is TELL ME WHEN LIVE, as before. When more options come, this key opens a small menu of them instead (aria-haspopup), and
 * lights up while any of them is on.
 */
const NAME = 'Tell me when they go live';

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
      aria-label={NAME}
      title={on ? 'TELLING YOU WHEN THEY GO LIVE (PRESS TO STOP)' : NAME}
      disabled={!ready}
      onClick={() => void setLiveWatch(host, !on)}
      className={on ? PLATE_PRESSED : PLATE}
      data-live-watch={on ? 'on' : 'off'}
      {...explain(on ? 'Stops telling you when this person goes live.' : 'Tells you when this person goes live: their room going live sends you a notification.', 'Private: they are never told who picked them. Your list is in PREFERENCES under NOTIFICATIONS.')}
    >
      {on ? ICON_BELL : `[ ${ICON_BELL} ]`}
    </button>
  );
}
