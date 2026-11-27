'use client';

import { useState } from 'react';
import { openReport } from '../lib/moderation/moderation-windows';
import { PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useModeration } from './ModerationProvider';
import { explain } from '../lib/ui/explain';

/**
 * REPORT and BLOCK on somebody else's profile (SPEC-moderation.md, 4B and 6B): one red `[ ! ]` that opens the REPORT / BLOCK
 * window (ReportWindow.tsx), where the report form and the two-press BLOCK sit together. Luke, 2026-11-21: "the report and block
 * features should be a red exclamation mark which then opens the encompassing reporting/ block pop up".
 *
 * Red is the theme's own red ink (`queue-played-ink`: deep red on the light windows, light red on the dark ones, 4.5:1 or better
 * on the window in every theme, held by Temp/check-profile-keys.cjs), set through the key's one dial, `--key-ink`, so under the
 * pointer it fills red with the window's colour on it, the same pair the other way round.
 */
const ALARM_KEY = `${PLATE} [--key-ink:var(--color-queue-played-ink)]`;

export function ProfileModerationKeys({ userId, name }: { userId: string; name: string }) {
  const { user } = useAuth();

  if (user === null || user.id === userId) return null;

  return (
    <button
      type="button"
      onClick={() => openReport({ accountId: userId, name, block: true })}
      aria-haspopup="dialog"
      aria-label={`Report or block ${name}`}
      title="REPORT OR BLOCK"
      {...explain(`Opens REPORT about ${name}, with the choice to BLOCK them as well.`, 'Report tells the moderators; block hides their posts, comments, chat and rooms from you, and they are never told.')}
      className={ALARM_KEY}
      data-moderation-key
    >
      [ ! ]
    </button>
  );
}

/** In place of a blocked person's profile: one line and the way back. */
export function BlockedProfileCard({ userId }: { userId: string }) {
  const { unblock } = useModeration();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press() {
    setBusy(true);
    setError(null);
    try {
      await unblock(userId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THEY COULD NOT BE UNBLOCKED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-wrap items-center gap-2 p-3 text-sm font-bold text-ink" data-blocked-card>
      <p>YOU BLOCKED THIS PERSON.</p>
      <button type="button" disabled={busy} onClick={() => void press()} className={PLATE} {...explain('Unblocks this person: their profile, posts, comments, chat and rooms come back for you.', 'They were never told about the block, and are not told now.')}>
        {busy ? '[ UNBLOCKING... ]' : '[ UNBLOCK ]'}
      </button>
      {error !== null ? <span className="bg-bubble-pale px-1 text-label text-ink-bar">{error}</span> : null}
    </section>
  );
}
