'use client';

import { setLiveWatch, setNotifySwitch, useNotifySettings } from '../lib/notifications/notify-settings-store';
import { KIND_SWITCHES } from '../lib/notifications/prefs';
import { PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import ProfileName from './ProfileName';

/**
 * PREFERENCES' NOTIFICATIONS section (SPEC-notifications.md, answers 5B and 6A): one key per kind, pressed in while on, covering
 * the bell, DESK, the balloon and (in phase 2) the weekly email alike; BALLOONS for the pop-up alone; and the people
 * picked with TELL ME WHEN LIVE, each with `[ × ]`. Saved to the account. Signed out there is nothing to switch.
 */
export default function NotificationSwitches() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const { ready, prefs, watches, error } = useNotifySettings(me);
  const { accounts } = useComms();

  if (me === null) return null;

  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.displayName ?? 'SOMEONE';

  return (
    <section className="mt-2" data-notification-switches>
      <div className={TITLE_BAR_INACTIVE} title="What tells you, on the site">
        <span>NOTIFICATIONS</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-2" role="group" aria-label="Notifications">
        {KIND_SWITCHES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={prefs[key]}
            disabled={!ready}
            onClick={() => void setNotifySwitch(key, !prefs[key])}
            className={prefs[key] ? PLATE_PRESSED : PLATE}
            data-notify-switch={key}
          >
            [ {label} ]
          </button>
        ))}
        <button
          type="button"
          aria-pressed={prefs.balloons}
          disabled={!ready}
          onClick={() => void setNotifySwitch('balloons', !prefs.balloons)}
          className={prefs.balloons ? PLATE_PRESSED : PLATE}
          title="THE POP-UP AT THE BOTTOM RIGHT"
          data-notify-switch="balloons"
        >
          [ BALLOONS ]
        </button>
        {/* 6A: off until each person turns it on. Sunday 18:00 UK time, only what is still unread, never anybody's words. */}
        <button
          type="button"
          aria-pressed={prefs.weeklyEmail}
          disabled={!ready}
          onClick={() => void setNotifySwitch('weeklyEmail', !prefs.weeklyEmail)}
          className={prefs.weeklyEmail ? PLATE_PRESSED : PLATE}
          title="SUNDAY EVENINGS: WHAT YOU HAVEN'T READ YET"
          data-notify-switch="weeklyEmail"
        >
          [ WEEKLY EMAIL ]
        </button>
      </div>

      {error === null ? null : <p className="mx-2 mb-1 w-fit bg-bubble-pale px-1 text-label text-ink-bar">{error}</p>}

      {watches.length === 0 ? null : (
        <div className="px-2 pb-2" data-live-watches>
          <p className="text-label text-ink">TELL ME WHEN LIVE:</p>
          <ul>
            {watches.map((host) => (
              <li key={host} className="flex items-center gap-2 py-0.5 text-key">
                <ProfileName author={{ id: host, displayName: nameOf(host) }} />
                <button
                  type="button"
                  onClick={() => void setLiveWatch(host, false)}
                  className={`${PLATE} ml-auto`}
                  aria-label={`Stop telling me when ${nameOf(host)} goes live`}
                  title="STOP"
                >
                  [ × ]
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
