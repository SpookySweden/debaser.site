'use client';

import AccountDetails from './AccountDetails';
import AccountForms from './AccountForms';
import { useAuth } from './AuthProvider';
import ProfileName from './ProfileName';
import { authorFromAccount } from '../lib/auth/author';

/** The sections that appear on this page once somebody is signed in. */
const SECTIONS = [
  { id: 'public-profile', index: 1, label: 'PUBLIC PROFILE', note: 'PICTURE, BIO, WHAT VISITORS SEE' },
  { id: 'edit-account', index: 2, label: 'EDIT ACCOUNT', note: 'DISPLAY NAME, SIGN-IN EMAIL, PASSWORD' },
  { id: 'activity', index: 3, label: 'BOARD ACTIVITY', note: 'THREADS AND REPLIES ON THIS ACCOUNT ID' },
  { id: 'danger-zone', index: 4, label: 'DANGER ZONE', note: 'SIGN OUT AND ACCOUNT DELETION' },
];

/**
 * The account page body.
 *
 * Signed out it offers account creation and log in; signed in it leads with an
 * index of the sections that live under this tab - the public profile, the
 * account editing panel, this account's board activity and the session
 * controls - so the page is navigable instead of one long scroll.
 */
export default function AccountConsole() {
  const { user, status } = useAuth();
  const signedIn = status === 'signed-in';

  return (
    <div className="space-y-3">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>ACCOUNT TERMINAL</span>
          <span>
            {status === 'loading' ? '[ READING... ]' : signedIn ? '[ SIGNED IN ]' : '[ GUEST ]'}
          </span>
        </div>

        <div className="space-y-1 p-3 text-[10px] font-bold text-black">
          <p>
            SIGNED IN AS:{' '}
            {user === null ? (
              'Anonymous (guest)'
            ) : (
              <>
                <ProfileName author={authorFromAccount(user)} lamp={false} /> (account)
              </>
            )}
          </p>
        </div>
      </section>

      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>WHAT LIVES UNDER THIS TAB</span>
          <span>{signedIn ? '[ OPEN ]' : '[ OPENS AFTER SIGN IN ]'}</span>
        </div>

        <ul className="grid gap-1 p-3 text-[10px] font-bold text-black sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              {signedIn ? (
                <a href={`#${section.id}`} className="underline hover:bg-gray-300">
                  [{section.index}] {section.label} :: {section.note}
                </a>
              ) : (
                <span className="text-gray-700">
                  [{section.index}] {section.label} :: {section.note} (AFTER SIGN IN)
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="px-3 pb-2 text-[10px] text-gray-700">
          {signedIn
            ? 'EACH ENTRY JUMPS TO THAT SECTION ON THIS PAGE. THE PICTURE CONSOLE OPENS AS A POP-UP FROM THE PUBLIC PROFILE PANEL.'
            : 'CREATE AN ACCOUNT OR LOG IN BELOW AND THESE SECTIONS APPEAR STRAIGHT AWAY.'}
        </p>
      </section>

      {status === 'loading' ? (
        <p className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-3 text-xs font-bold text-black">
          READING THE LOCAL SESSION...
        </p>
      ) : user === null ? (
        <AccountForms />
      ) : (
        <AccountDetails />
      )}
    </div>
  );
}
