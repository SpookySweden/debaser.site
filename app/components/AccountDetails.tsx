'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authorFromAccount } from '../lib/auth/author';
import { resetMockAuth } from '../lib/auth/mock-auth';
import { isSiteAccount } from '../lib/auth/builtin-account';
import { threadDomId } from '../lib/forum/anchors';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { PLATE_LARGE } from '../lib/ui/controls';
import AccountProfilePanel from './AccountProfilePanel';
import AccountSecurityPanel from './AccountSecurityPanel';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

/**
 * The signed-in half of the account page.
 *
 * Section order: the public profile (what visitors see), the account itself
 * (EDIT ACCOUNT: name, sign-in email, password), the board activity that carries
 * this account's id, and the session controls in the danger zone.
 */
export default function AccountDetails() {
  const { user, usingMockAuth, signOut, deleteAccount } = useAuth();
  const forum = useForum();
  // The account's own swatch, so its name reads here exactly as it does on the board.
  const { profile } = usePublicProfile(user?.id ?? null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (user === null) return null;

  // Captured after the guard so the handlers below keep a non-null id.
  const accountId = user.id;

  const myThreads = forum.threads.filter((thread) => thread.author.id === accountId);
  const myReplies = forum.threads.reduce(
    (total, thread) => total + thread.comments.filter((comment) => comment.author.id === accountId).length,
    0,
  );

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage('CLICK AGAIN TO CONFIRM DELETION.');
      return;
    }

    setBusy(true);
    const result = await deleteAccount();
    setBusy(false);
    setMessage(result.ok ? 'ACCOUNT DELETED.' : result.error);
  }

  return (
    <div className="space-y-3">
      <div id="public-profile">
        <AccountProfilePanel userId={accountId} />
      </div>

      <AccountSecurityPanel />

      <section
        id="account-summary"
        className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
      >
        <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-white">
          <span>ACCOUNT DETAILS</span>
          <span>[ READ ONLY ]</span>
        </div>

        <div className="space-y-2 p-3 text-[10px] font-bold text-ink">
          <p>
            NAME:{' '}
            <ProfileName
              author={authorFromAccount(user)}
              colour={profileNameColour(profile)}
              lamp={false}
            />
          </p>
          <p>EMAIL: {user.email.length === 0 ? 'NOT PROVIDED' : user.email}</p>
          <p>
            CREATED: <TimeStamp at={user.createdAt} />
          </p>
          {isSiteAccount(accountId) ? (
            <p className="text-ena">
              HOUSE ACCOUNT: SIGNS EVERY POST AN ITEM OWNS, AND CANNOT BE DELETED.
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void signOut()} disabled={busy} className={PLATE_LARGE}>
              [ SIGN OUT ]
            </button>
            <p className="text-ink">
              NEED TO CHANGE THE NAME, EMAIL OR PASSWORD? USE THE EDIT ACCOUNT SECTION BELOW.
            </p>
          </div>

          {message === null ? null : <p className="text-[10px] font-bold text-ink">{message}</p>}
        </div>
      </section>

      <section
        id="activity"
        className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
      >
        <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-white">
          <span>BOARD ACTIVITY</span>
          <span>[ {myThreads.length + myReplies} POSTS ]</span>
        </div>

        <div className="space-y-2 p-3 text-[10px] font-bold text-ink">
          <p>
            THREADS FILED: {myThreads.length} :: REPLIES FILED: {myReplies}
          </p>

          {myThreads.length === 0 ? (
            <p>NOTHING FILED YET - POSTS MADE WHILE SIGNED IN ARE LISTED HERE.</p>
          ) : (
            <ul className="space-y-1">
              {myThreads.slice(0, 6).map((thread) => (
                <li key={thread.id}>
                  <Link href={`/forum#${threadDomId(thread.id)}`} className="underline hover:bg-ice">
                    [<TimeStamp at={thread.createdAt} />] {thread.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section
        id="danger-zone"
        className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
      >
        <div className="flex items-center justify-between bg-bubble-pale px-2 py-1 text-xs font-bold text-white">
          <span>DANGER ZONE</span>
          <span>[ CAREFUL ]</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3 text-[10px] font-bold text-ink">
          {usingMockAuth ? (
            <>
              <button type="button" onClick={() => void handleDelete()} disabled={busy} className={PLATE_LARGE}>
                {confirmDelete ? '[ CONFIRM DELETE ACCOUNT ]' : '[ DELETE THIS ACCOUNT ]'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetMockAuth();
                  setMessage('ALL LOCAL MOCK ACCOUNTS CLEARED.');
                }}
                className={PLATE_LARGE}
              >
                [ CLEAR ALL LOCAL ACCOUNTS ]
              </button>
              <p>SIGNS YOU OUT AND CLEARS THE ACCOUNTS HELD IN THIS BROWSER.</p>
            </>
          ) : (
            <p>ACCOUNT DELETION IS HANDLED BY THE ARCHIVE OWNER.</p>
          )}
        </div>
      </section>
    </div>
  );
}
