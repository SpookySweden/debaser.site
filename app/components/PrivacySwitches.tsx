'use client';

import { useState } from 'react';
import type { ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';

/** Each switch and what it shares, in the plain words the PRIVACY tab and the first-look window both use. */
export const PRIVACY_SWITCHES: { key: keyof ProfileVisibility; label: string; note: string }[] = [
  { key: 'showOnline', label: 'ONLINE LAMP', note: 'OTHERS SEE YOUR LAMP, WHEN YOU WERE LAST HERE, AND WHICH STREAM YOU ARE IN.' },
  { key: 'showListening', label: 'MY LISTENING', note: "YOUR PLAYS COUNT, AND YOUR PICTURE CAN SHOW BESIDE SONGS IN OTHER PEOPLE'S PICKS." },
  { key: 'showProfileComments', label: 'PROFILE COMMENTS', note: 'PEOPLE CAN READ AND WRITE COMMENTS ON YOUR PROFILE.' },
  { key: 'showAvatarComments', label: 'PICTURE COMMENTS', note: 'PEOPLE CAN READ AND WRITE COMMENTS ON YOUR PICTURE.' },
  { key: 'showSongComments', label: 'TRACK COMMENTS', note: 'PEOPLE CAN READ AND WRITE COMMENTS ON YOUR TRACK.' },
  { key: 'showTags', label: 'TAGS', note: 'TAGS PEOPLE GAVE YOU SHOW ON YOUR PROFILE. EACH TAG ALSO HAS ITS OWN SWITCH.' },
];

/**
 * The switches, in large type, each saved the moment it is pressed (SPEC-privacy-phase-1.md).
 *
 * A row's key says what it is now, and being pressed down means ON. A whole row of words beside a small key rather
 * than a checkbox, because the people this tab is for may well be reading it from across a room.
 */
export default function PrivacySwitches({ userId }: { userId: string }) {
  const { profile, read, repository, refresh } = usePublicProfile(userId);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  async function press(key: keyof ProfileVisibility) {
    setBusy(true);
    setFault(null);
    try {
      await repository.saveProfile(userId, { visibility: { [key]: !profile.visibility[key] } });
      await refresh();
    } catch {
      setFault('THAT DID NOT SAVE. TRY AGAIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-ink">
      <ul>
        {PRIVACY_SWITCHES.map((row) => {
          const on = profile.visibility[row.key];
          return (
            <li key={row.key} className="rule-pixel flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-heading font-bold">{row.label}</p>
                <p className="text-prose">{row.note}</p>
              </div>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${row.label}: ${on ? 'ON' : 'OFF'}`}
                onClick={() => void press(row.key)}
                disabled={busy || !read}
                className={`${on ? `${PLATE_PRESSED} cursor-pointer` : PLATE} shrink-0 text-heading max-sm:min-h-tap`}
              >
                [ {on ? 'ON' : 'OFF'} ]
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-prose">YOU STAY LISTED IN THE DIRECTORY. YOUR COUNTRY FLAG SHOWS ONLY TO PEOPLE WHO ARE SIGNED IN: SET IT IN EDIT PROFILE.</p>

      {fault === null ? null : <p className="text-prose font-bold">{fault}</p>}
    </div>
  );
}
