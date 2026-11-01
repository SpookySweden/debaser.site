'use client';

import AccountDetails from './AccountDetails';
import AccountForms from './AccountForms';
import { useAuth } from './AuthProvider';

/**
 * The account page body.
 *
 * One line says who is signed in, then the page itself: account creation and log in for a guest, the
 * account's own sections once signed in. The contents list that used to sit between them is gone
 * (SPEC-efficiency.md, 2026-10-23): it named the four sections that were right below it.
 */
export default function AccountConsole() {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return (
      <p className="p-3 text-key font-bold text-ink">
        LOADING...
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* No "SIGNED IN AS" line: the name is shown once, in ACCOUNT DETAILS below. */}
      {user === null ? <AccountForms /> : <AccountDetails />}
    </div>
  );
}
