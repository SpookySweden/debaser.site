'use client';

import AccountDetails from './AccountDetails';
import AccountForms from './AccountForms';
import { useAuth } from './AuthProvider';
import ProfileName from './ProfileName';
import { authorFromAccount } from '../lib/auth/author';

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
        READING THE LOCAL SESSION...
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Drawn only for somebody who is signed in: a guest is not "signed in as" anybody, and the forms
          below already say what an account is for. */}
      {user === null ? null : (
        <p className="px-3 text-label text-ink">
          SIGNED IN AS <ProfileName author={authorFromAccount(user)} lamp={false} />
        </p>
      )}

      {user === null ? <AccountForms /> : <AccountDetails />}
    </div>
  );
}
