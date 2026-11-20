'use client';

import { useState } from 'react';
import { openReport } from '../lib/moderation/moderation-windows';
import { PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useModeration } from './ModerationProvider';

/**
 * BLOCK and REPORT on somebody else's profile (SPEC-moderation.md, 4B and 6B). Blocking takes two presses, like anything started
 * from the board. It is one way: what they write disappears for you, they can't message you, comment on your profile or join your
 * room, and they are never told.
 */
export function ProfileModerationKeys({ userId, name }: { userId: string; name: string }) {
  const { user } = useAuth();
  const { block } = useModeration();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user === null || user.id === userId) return null;

  async function press() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await block(userId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THEY COULD NOT BE BLOCKED.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => void press()} onBlur={() => setConfirming(false)} className={PLATE} data-block-key>
        {busy ? '[ BLOCKING... ]' : confirming ? '[ CONFIRM BLOCK ]' : '[ BLOCK ]'}
      </button>
      <button type="button" onClick={() => openReport({ accountId: userId, name })} className={PLATE} data-report-key>
        [ REPORT ]
      </button>
      {error !== null ? <span className="bg-bubble-pale px-1 text-label text-ink-bar">{error}</span> : null}
    </>
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
      <button type="button" disabled={busy} onClick={() => void press()} className={PLATE}>
        {busy ? '[ UNBLOCKING... ]' : '[ UNBLOCK ]'}
      </button>
      {error !== null ? <span className="bg-bubble-pale px-1 text-label text-ink-bar">{error}</span> : null}
    </section>
  );
}
