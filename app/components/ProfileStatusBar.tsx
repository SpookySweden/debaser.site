'use client';

import { presenceLine } from '../lib/profile/presence';
import { STATUS_BAR } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { useComms } from './CommsProvider';
import { usePresence } from './PresenceProvider';
import StatusDot from './StatusDot';
import TimeStamp from './TimeStamp';

type ProfileStatusBarProps = {
  /** The account the page is about. */
  userId: string;
};

/**
 * The rigid line at the foot of a profile: whether they are about, when they were last here, and when
 * the account was made.
 *
 * A status bar rather than another sentence in the page's text, because this is exactly what a status
 * bar is for - the one line of state that belongs to the whole window - and because it keeps the
 * reading order honest: the picture, the track, the biography, and then `ONLINE NOW` where a desktop
 * of this era put it. The clock comes from `useNow`, so the line ages on its own instead of freezing
 * at whatever the server happened to say.
 *
 * Two things are deliberately *not* here, because the window is a person's page and not a console:
 * the account id, which is nobody's business but the store's, and a count of how many versions of a
 * drawing exist. What a reader wants off a profile - who this is, what they made, and whether they are
 * about - is all this line and the panel above it carry.
 */
export default function ProfileStatusBar({ userId }: ProfileStatusBarProps) {
  const { accounts } = useComms();
  const presence = usePresence(userId);
  const now = useNow();

  // The account list is the only public source of a join date: a profile row carries no `created_at`,
  // and the auth row belongs to its owner. An account the directory has not read yet prints `--:--`
  // through `TimeStamp` rather than an invented date.
  const joinedAt = accounts.find((account) => account.id === userId)?.createdAt ?? null;

  const line = presence.status === undefined ? 'CHECKING...' : presenceLine(presence.status, presence.record, now);

  return (
    <div className={STATUS_BAR}>
      <span className="flex min-w-0 items-center gap-1">
        <StatusDot status={presence.status ?? 'offline'} record={presence.record} />
        {/* The server and the browser read the clock at render and agree to the second, and the label
            is minute-resolution, so the only way the two can differ is a request that crosses a
            minute - which is what this suppresses (see lib/ui/use-now.ts). */}
        <span className="truncate" suppressHydrationWarning>
          {line}
        </span>
      </span>

      <span className="shrink-0">
        JOINED <TimeStamp at={joinedAt} />
      </span>
    </div>
  );
}
