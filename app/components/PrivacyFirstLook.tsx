'use client';

import { useState } from 'react';
import type { ProfileVisibility } from '../lib/profile/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import PrivacySwitches, { PRIVACY_SWITCHES } from './PrivacySwitches';

/**
 * The PRIVACY window: shown once per account, the first time it is signed in (SPEC-privacy-phase-1.md).
 *
 * Remembered on the profile, so a second device does not ask again. A new account has everything off and is offered
 * `[ KEEP IT PRIVATE ]`; an account with something on keeps it (decision 10), so its main key says that instead, because
 * "keep it private" over switches that are on would not be true.
 */
export default function PrivacyFirstLook() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { profile, read, repository, refresh } = usePublicProfile(userId);
  const [closedFor, setClosedFor] = useState<string | null>(null);

  // `read`, not ready: after a failed read the profile is an empty shell, and this window would say everything is off.
  if (userId === null || !read || profile.privacySeen || closedFor === userId) return null;

  const sharing = PRIVACY_SWITCHES.filter((row) => profile.visibility[row.key]).map((row) => row.key);

  function finish(visibility?: Partial<ProfileVisibility>) {
    if (userId === null) return;
    setClosedFor(userId);
    // The same switch again next visit is the worst a failure here costs.
    void repository
      .saveProfile(userId, { privacySeen: true, ...(visibility === undefined ? {} : { visibility }) })
      .then(refresh)
      .catch(() => undefined);
  }

  return (
    <DockWindow title="PRIVACY" onClose={() => finish()} status="" dock="bottom" id="privacy-first-look" defaultSize={{ w: 520, h: 640 }} minSize={{ w: 280, h: 240 }}>
      <div className="space-y-3 p-3 text-ink">
        <p className="text-title font-bold">
          {sharing.length === 0 ? 'EVERYTHING IS OFF. NOTHING IS SHARED UNTIL YOU SWITCH IT ON.' : 'THIS IS WHAT YOU SHARE NOW. CHANGE ANY OF IT, HERE OR LATER IN ACCOUNT.'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => finish()} className={PLATE_MAIN}>
            {sharing.length === 0 ? '[ KEEP IT PRIVATE ]' : '[ KEEP THESE SETTINGS ]'}
          </button>
          {sharing.length === 0 ? null : (
            <button type="button" onClick={() => finish(Object.fromEntries(sharing.map((key) => [key, false])))} className={PLATE}>
              [ TURN EVERYTHING OFF ]
            </button>
          )}
        </div>

        <PrivacySwitches userId={userId} />
      </div>
    </DockWindow>
  );
}
