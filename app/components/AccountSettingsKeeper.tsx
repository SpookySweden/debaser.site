'use client';

import { useEffect } from 'react';
import { setSettingsAccount } from '../lib/settings/account-settings';
import { useAuth } from './AuthProvider';

/**
 * Tells the settings that follow the account (SPEC-forum-v3.md, F1B and F2A) who is signed in. Drawn once in `layout.tsx`,
 * like `SiteHistoryKeeper`; it draws nothing.
 */
export default function AccountSettingsKeeper() {
  const { user, status } = useAuth();
  const person = status === 'signed-in' && user !== null ? user.id : null;

  useEffect(() => {
    if (status !== 'loading') void setSettingsAccount(person);
  }, [person, status]);

  return null;
}
