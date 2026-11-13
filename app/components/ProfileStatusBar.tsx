'use client';

import { useShownCharacter } from '../lib/character/use-shown-character';
import { presenceLine } from '../lib/profile/presence';
import { STATUS_BAR } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { useComms } from './CommsProvider';
import { usePresence } from './PresenceProvider';
import { ProfileCharacterStrip } from './ProfileCharacter';
import SpriteSlot from './SpriteSlot';
import StatusDot from './StatusDot';
import TimeStamp from './TimeStamp';

type ProfileStatusBarProps = {
  /** The account the page is about. */
  userId: string;
  /** Whether the profile's track is playing: their character dances to it. */
  music?: boolean;
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
export default function ProfileStatusBar({ userId, music = false }: ProfileStatusBarProps) {
  const { allAccounts } = useComms();
  const presence = usePresence(userId);
  const shown = useShownCharacter(userId);
  const now = useNow();

  // The account list is the only public source of a join date: a profile row carries no `created_at`,
  // and the auth row belongs to its owner. An account the directory has not read yet prints `--:--`
  // through `TimeStamp` rather than an invented date. Every account, so a test account's page has one too.
  const joinedAt = allAccounts.find((account) => account.id === userId)?.createdAt ?? null;

  const line = presence.noLamp ? '' : presence.status === undefined ? 'CHECKING...' : presenceLine(presence.status, presence.record, now);

  return (
    <>
    {/* The account's own shown character, on a strip of its own the width of the page just over this line (Luke, 2026-11-13:
        from the sprite spot, given room to move). It starts at the left, where the sprite spot is. */}
    {shown ? <ProfileCharacterStrip shown={shown} music={music} /> : null}
    <div className={STATUS_BAR}>
      <span className="flex min-w-0 items-center gap-1">
        {/* The room for a looping sprite: a hand-drawn GIF, 24x24 (assets/sprites/README.txt), for an account with no
            shown character. */}
        {shown ? null : (
          <SpriteSlot
            src="/assets/sprites/profile.gif"
            alt="A looping sprite for this account"
            width={24}
            height={24}
            title="A pixel sprite loops here once assets/sprites/profile.gif is drawn"
          />
        )}
        {presence.lampPrivate ? <StatusDot status="private" /> : presence.noLamp ? null : <StatusDot status={presence.status ?? 'offline'} record={presence.record} />}
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
    </>
  );
}
