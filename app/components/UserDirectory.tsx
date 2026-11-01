'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { buildUserDirectory, countDirectoryStatuses } from '../lib/profile/directory';
import { PANEL, PLATE_LINK, TITLE_BAR_BUTTON, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import ChallengeControl from './ChallengeControl';
import { useComms } from './CommsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import UserDirectoryRow from './UserDirectoryRow';

type UserDirectoryProps = {
  /**
   * True inside the side panel: the first few accounts, and an `[ ALL ]` key to the
   * full directory on /users.
   */
  compact?: boolean;
};

/**
 * How many accounts the side panel shows before it hands over to /users. Six left a third of the
 * panel empty on a desktop screen; twelve fills it, and a shorter screen scrolls the panel as before.
 */
const COMPACT_LIMIT = 12;

/**
 * What the lamp means, as the hover tip of the list's title line.
 *
 * It used to be a panel of its own under the list on /users (`THE LAMP [ LEGEND ]`, with a row of links
 * to other pages); the colours explain themselves after one look, so the sentence waits under the
 * pointer instead (SPEC-efficiency.md).
 */
const LAMP_TIP = 'Green: in use. Yellow: away. Red: not on the site.';

/**
 * The account directory: every account the site knows, with its lamp.
 *
 * The list comes from the account store (`AuthRepository.listAccounts`, the same
 * call the comms picker makes) and the lamps come from the presence provider, so a
 * row is exactly what the rest of the site means by a username - picture, the name
 * in the colour that account chose, and the green / yellow / red lamp beside it.
 * One row component serves this page, the side panel and the arcade (`./UserDirectoryRow`),
 * so the lamp, the marks and the name are the same wherever an account is listed;
 * what differs between the screens is only the verb offered at the end of the row -
 * `[ MESSAGE ]` everywhere, and `[ CHALLENGE ]` on the full listing, where the row is
 * read rather than glanced at.
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
      // Comms asks for an account first; the line under the list says so.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <section className={PANEL}>
        <div className={compact ? `${TITLE_BAR_INACTIVE} title-stack` : TITLE_BAR_INACTIVE}>
          <span title={LAMP_TIP}>ACCOUNT DIRECTORY</span>
          <span>
            {/* Said once and short (SPEC-efficiency.md): the panel's key to the whole list, and the page's
                one count. `n SEEN THIS HOUR :: n ELSEWHERE` and the account total were the lamps again in
                words; the lamps are on every row. */}
            {compact ? (
              <Link href="/users" className={TITLE_BAR_BUTTON}>
                [ ALL ]
              </Link>
            ) : accountsReady ? (
              `${counts.online} ONLINE`
            ) : (
              'READING...'
            )}
          </span>
        </div>

        {!accountsReady ? (
          <p className={`${compact ? 'px-2 py-1 text-label' : 'p-3 text-label'} font-bold text-ink`}>
            READING...
          </p>
        ) : rows.length === 0 ? (
          <p className={`${compact ? 'px-2 py-1 text-label' : 'p-3 text-label'} font-bold text-ink`}>
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
                actions={
                  /* The full listing offers the arcade's verb as well as the message: a challenge is
                     a question asked of an account, and this is the screen that lists the accounts.
                     A compact row is a glance down the side panel, where two plates are one too many. */
                  compact ? undefined : (
                    <ChallengeControl
                      author={{ id: row.account.id, displayName: row.account.displayName }}
                      status={row.status}
                      viewerId={user?.id ?? null}
                    />
                  )
                }
              />
            ))}
          </ul>
        )}

        {/* A guest's locked action, as one line with the way in at its start (SPEC-efficiency.md). The
            panel's compact list leaves it out: the panel's own COMMS block already says it. */}
        {compact || user !== null ? null : (
          <p className="p-2 text-label text-ink">
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO MESSAGE
          </p>
        )}
      </section>
    </div>
  );
}

