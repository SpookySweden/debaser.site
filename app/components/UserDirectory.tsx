'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { buildUserDirectory, countDirectoryStatuses } from '../lib/profile/directory';
import { arcadeHref } from '../lib/games/arcade-window';
import { PANEL, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
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
 * One row component serves this page, the side panel and the arcade (`./UserDirectoryRow`),
 * so the lamp, the marks and the name are the same wherever an account is listed;
 * what differs between the screens is only the verb offered at the end of the row.
 *
 * The house account is pinned to the top by `buildUserDirectory`, and it does draw
 * a lamp here: the rule that leaves the lamp off `debaser.site` on the board is
 * about a post an item owns - a visitor's comment is what opened it - not about
 * the account itself, and this page is about the account itself.
 */
export default function UserDirectory({ compact = false }: UserDirectoryProps) {
  const { user } = useAuth();
  const { accounts, accountsReady, openThreadWith } = useComms();
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
      <section className={PANEL}>
        <div className={TITLE_BAR_INACTIVE}>
          <span>ACCOUNT DIRECTORY</span>
          <span>
            {compact ? (
              <Link href="/users" className="underline hover:bg-ice">
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
          <p className="border-b border-ink px-2 py-1 text-[10px] font-bold text-ink">
            {counts.online} ONLINE :: {counts.recent} SEEN THIS HOUR :: {counts.offline} ELSEWHERE :: THE HOUSE
            ACCOUNT FIRST
          </p>
        )}

        {!accountsReady ? (
          <p className={`${compact ? 'px-2 py-1 text-[10px]' : 'p-3 text-[10px]'} font-bold text-ink`}>
            READING...
          </p>
        ) : rows.length === 0 ? (
          <p className={`${compact ? 'px-2 py-1 text-[10px]' : 'p-3 text-[10px]'} font-bold text-ink`}>
            NO ACCOUNTS YET.
          </p>
        ) : (
          <ul className="text-ink">
            {shown.map((row) => (
              <UserDirectoryRow
                key={row.account.id}
                row={row}
                compact={compact}
                viewerId={user?.id ?? null}
                busy={busyId === row.account.id}
                onMessage={(otherId) => void startConversation(otherId)}
              />
            ))}
          </ul>
        )}
      </section>

      {compact ? null : (
        <section className={PANEL}>
          <div className={TITLE_BAR_INACTIVE}>
            <span>THE LAMP</span>
            <span>[ LEGEND ]</span>
          </div>

          <div className="space-y-1 p-3 text-[10px] font-bold text-ink">
            <p>
              GREEN WHILE A TAB OF THAT ACCOUNT IS OPEN, YELLOW FOR AN HOUR AFTER IT CLOSES, RED ONCE THAT HAS
              PASSED.
            </p>
            <p>
              {user === null
                ? 'SIGN IN TO SEND SOMEBODY A MESSAGE.'
                : 'A MESSAGE OPENS THAT CONVERSATION ON THE COMMS PAGE. A GAME IS ASKED FOR FROM THE ARCADE - OR WITH [ CHALLENGE ] ON A POST THAT NAMES THEM.'}
            </p>
            <p className="text-ink">
              <Link href="/forum" className="underline hover:bg-ice">
                [ BOARD ]
              </Link>{' '}
              <Link href={arcadeHref({ kind: 'floor' })} className="underline hover:bg-ice">
                [ ARCADE ]
              </Link>{' '}
              <Link href="/comms" className="underline hover:bg-ice">
                [ COMMS ]
              </Link>{' '}
              <Link href="/account" className="underline hover:bg-ice">
                [ ACCOUNT ]
              </Link>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

