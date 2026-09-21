'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { buildUserDirectory, countDirectoryStatuses } from '../lib/profile/directory';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import UserDirectoryRow from './UserDirectoryRow';

type UserDirectoryProps = {
  /**
   * True inside the side panel: the first few accounts and no footer notes, with
   * the count turned into a link to the full directory on /users.
   */
  compact?: boolean;
};

/** How many accounts the side panel shows before it hands over to /users. */
const COMPACT_LIMIT = 6;

/**
 * The account directory: every account the site knows, with its lamp.
 *
 * The list comes from the account store (`AuthRepository.listAccounts`, the same
 * call the comms picker makes) and the lamps come from the presence provider, so a
 * row is exactly what the rest of the site means by a username - picture, the name
 * in the colour that account chose, and the green / yellow / red lamp beside it.
 * A name opens the account's public profile, and `[ MESSAGE ]` opens the
 * conversation with them on the comms page.
 *
 * The house account is pinned to the top by `buildUserDirectory`, and it does draw
 * a lamp here: the rule that leaves the lamp off `debaser.site` on the board is
 * about a post an item owns - a visitor's comment is what opened it - not about
 * the account itself, and this page is about the account itself.
 */
export default function UserDirectory({ compact = false }: UserDirectoryProps) {
  const { user } = useAuth();
  const { accounts, accountsReady, source, openThreadWith } = useComms();
  const presence = usePresenceDirectory();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      buildUserDirectory({
        accounts,
        statusFor: presence.statusFor,
        recordFor: presence.recordFor,
        viewerId: user?.id ?? null,
      }),
    [accounts, presence, user],
  );

  const counts = countDirectoryStatuses(rows);
  const shown = compact ? rows.slice(0, COMPACT_LIMIT) : rows;

  /** Pull up the conversation with that account on the comms page. */
  async function startConversation(otherId: string) {
    setBusyId(otherId);

    try {
      await openThreadWith(otherId);
      router.push('/comms');
    } catch {
      // Comms asks for an account first; the panel under the list says so.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
        <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span>ACCOUNT DIRECTORY</span>
          <span>
            {compact ? (
              <Link href="/users" className="underline hover:bg-gray-300">
                [ {rows.length} :: ALL ]
              </Link>
            ) : (
              <>
                [ {accountsReady ? `${rows.length} ACCOUNT${rows.length === 1 ? '' : 'S'}` : 'READING...'} ::{' '}
                {counts.online} ONLINE ]
              </>
            )}
          </span>
        </div>

        {compact ? null : (
          <p className="border-b border-gray-500 px-3 py-2 text-[10px] font-bold text-black">
            {counts.online} ONLINE NOW :: {counts.recent} SEEN WITHIN THE HOUR :: {counts.offline} OFFLINE ::
            THE HOUSE ACCOUNT IS LISTED FIRST
          </p>
        )}

        {!accountsReady ? (
          <p className="p-3 text-[10px] font-bold text-black">READING THE ACCOUNT LIST...</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-[10px] font-bold text-black">
            NO ACCOUNTS YET - CREATE ONE ON THE ACCOUNT PAGE AND IT APPEARS HERE.
          </p>
        ) : (
          <ul className="text-black">
            {shown.map((row) => (
              <UserDirectoryRow
                key={row.account.id}
                row={row}
                viewerId={user?.id ?? null}
                busy={busyId === row.account.id}
                onMessage={(otherId) => void startConversation(otherId)}
              />
            ))}
          </ul>
        )}
      </section>

      {compact ? null : (
        <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
          <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
            <span>HOW THIS LIST IS BUILT</span>
            <span>[ {source === 'mock' ? 'LOCAL ACCOUNTS' : 'SUPABASE AUTH'} ]</span>
          </div>

          <div className="space-y-1 p-3 text-[10px] font-bold text-black">
            <p>
              THE LAMP IS THE ONE THAT SITS BESIDE A USERNAME EVERYWHERE ELSE: GREEN WHILE A TAB OF THAT
              ACCOUNT IS OPEN, YELLOW FOR AN HOUR AFTER IT CLOSES, RED ONCE THAT HAS PASSED.
            </p>
            <p>
              {source === 'mock'
                ? 'THE MOCK ACCOUNT STORE ONLY KNOWS THE ACCOUNTS MADE IN THIS BROWSER, SO THE FULL DIRECTORY ARRIVES WITH SUPABASE AUTH.'
                : 'READ FROM THE ACCOUNTS TABLE, SO EVERY ACCOUNT ON THE SITE APPEARS HERE.'}
            </p>
            <p>
              {user === null
                ? 'READING THIS PAGE TAKES NO ACCOUNT - SIGN IN TO SEND SOMEBODY A MESSAGE.'
                : 'A MESSAGE OPENS THAT CONVERSATION ON THE COMMS PAGE.'}
            </p>
            <p className="text-gray-700">
              <Link href="/forum" className="underline hover:bg-gray-300">
                [ BOARD ]
              </Link>{' '}
              <Link href="/comms" className="underline hover:bg-gray-300">
                [ COMMS ]
              </Link>{' '}
              <Link href="/account" className="underline hover:bg-gray-300">
                [ ACCOUNT ]
              </Link>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
