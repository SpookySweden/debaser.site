'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import AccountDetails from './AccountDetails';
import AccountForms from './AccountForms';
import { useAuth } from './AuthProvider';
import PrivacySwitches from './PrivacySwitches';
import HistoryPanel from './HistoryPanel';

type AccountTab = 'account' | 'privacy';

/** `/account?tab=privacy` opens the PRIVACY tab. Read once, as the page arrives; nothing draws from it before sign-in has been read. */
function tabAsked(): AccountTab {
  if (typeof window === 'undefined') return 'account';
  return new URLSearchParams(window.location.search).get('tab') === 'privacy' ? 'privacy' : 'account';
}

/**
 * The account page body.
 *
 * One line says who is signed in, then the page itself: account creation and log in for a guest, the
 * account's own tabs once signed in. The contents list that used to sit between them is gone
 * (SPEC-efficiency.md, 2026-10-23): it named the four sections that were right below it.
 */
export default function AccountConsole() {
  const { user, status } = useAuth();
  const [tab, setTab] = useState<AccountTab>(tabAsked);

  if (status === 'loading') {
    return (
      <p className="p-3 text-key font-bold text-ink">
        LOADING...
      </p>
    );
  }

  if (user === null) {
    return (
      <div className="space-y-3">
        <AccountForms />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-3" role="tablist" aria-label="Account">
        {(['account', 'privacy'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={tab === entry ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
          >
            [ {entry.toUpperCase()} ]
          </button>
        ))}
      </div>

      {/* No "SIGNED IN AS" line: the name is shown once, in ACCOUNT DETAILS below. */}
      {tab === 'account' ? (
        <AccountDetails />
      ) : (
        <section id="privacy">
          <div className="title-line text-accent-ink">
            <span>PRIVACY</span>
          </div>
          <div className="p-3">
            <PrivacySwitches userId={user.id} />
            {/* FOR YOU's private history (SPEC-recommender.md): pause, erase, and the list of what is kept. */}
            <div className="mt-4">
              <HistoryPanel />
            </div>
            <p className="mt-4 text-label font-bold text-ink">
              <Link href="/privacy" className="underline">
                READ THE PRIVACY POLICY
              </Link>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
