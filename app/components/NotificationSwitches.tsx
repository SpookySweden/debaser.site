'use client';

import { setLiveWatch, setNotifySwitch, useNotifySettings } from '../lib/notifications/notify-settings-store';
import { KIND_SWITCHES } from '../lib/notifications/prefs';
import { PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import ProfileName from './ProfileName';
import { explain, type Explanation } from '../lib/ui/explain';

/**
 * PREFERENCES' NOTIFICATIONS section (SPEC-notifications.md, answers 5B and 6A): one key per kind, pressed in while on, covering
 * the bell, DESK, the balloon and (in phase 2) the weekly email alike; BALLOONS for the pop-up alone; and the people
 * picked with TELL ME WHEN LIVE, each with `[ × ]`. Saved to the account. Signed out there is nothing to switch.
 */
/** What each kind's switch covers, for the EXPLAIN box. */
const KIND_WORDS: Record<string, Explanation> = {
  replies: { what: 'Turns notices on or off for replies to your posts and for being tagged.', why: 'Covers the bell, DESK, the balloon and the weekly email alike. Pressed in means on.' },
  letters: { what: 'Turns notices on or off for letters and recommendations sent to you.', why: 'Covers the bell, DESK, the balloon and the weekly email alike. Pressed in means on.' },
  live: { what: 'Turns notices on or off for when people you picked with TELL ME WHEN LIVE make their room live.', why: 'The people you picked are listed below, each with a key to stop.' },
  comic: { what: 'Turns notices on or off for new pages of the comic.', why: 'Off until you turn it on (following the comic turns it on). Pressed in means on.' },
  invites: { what: 'Turns notices on or off for invitations to play a game.', why: 'Covers the bell, DESK, the balloon and the weekly email alike. Pressed in means on.' },
};

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
            {...explain(KIND_WORDS[key]?.what ?? `Turns notices on or off for ${label}.`, KIND_WORDS[key]?.why)}
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
          {...explain('Turns the pop-up balloon at the bottom right on or off.', 'Off, notices still reach the bell and DESK, just without popping up. Saved to your account.')}
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
          {...explain('Turns the weekly email on or off: on Sunday evenings, a list of what you have not read yet.', "Off until you turn it on. It never carries anybody's words, and every email has a link to stop it.")}
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
                  {...explain(`Stops telling you when ${nameOf(host)} goes live, and takes them off this list.`, 'TELL ME WHEN LIVE on their room picks them again.')}
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
