'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAuthRepository } from '../lib/auth/auth-repository';
import { getModerationStore } from '../lib/moderation/repository';
import { MODERATION_TEXT_MAX } from '../lib/moderation/types';
import { FIELD, PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useModeration } from './ModerationProvider';
import { explain } from '../lib/ui/explain';

/**
 * A banned person's notice (SPEC-moderation.md, 10A): `[ BANNED ]` with the moderator's reason, and one APPEAL, which arrives in
 * the moderators' REPORTS. One appeal waits at a time. Drawn where they would write (the board's composer) and on PRIVACY.
 */
export function BannedNotice() {
  const { user } = useAuth();
  const { standing, refresh } = useModeration();
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user === null || !standing.banned) return null;
  const me = user.id;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await getModerationStore().fileAppeal(me, words.trim());
      setWriting(false);
      setWords('');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE APPEAL COULD NOT BE SENT.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col items-start gap-1 py-2 text-sm text-ink" data-banned-notice>
      <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar">
        [ BANNED ]{standing.reason.trim() !== '' ? ` ${standing.reason}` : ''}
      </p>
      {standing.appealOpen ? (
        <p className="font-bold">YOUR APPEAL IS WAITING.</p>
      ) : writing ? (
        <div className="flex w-full flex-col items-start gap-1">
          <label className="w-full text-label">
            APPEAL
            <textarea value={words} maxLength={MODERATION_TEXT_MAX} rows={3} onChange={(event) => setWords(event.target.value)} className={FIELD} />
          </label>
          <button type="button" disabled={busy || words.trim() === ''} onClick={() => void send()} className={PLATE} {...explain('Sends the appeal you typed to the moderators, in their REPORTS.', 'To ask for the ban to be lifted. One appeal waits at a time.')}>
            {busy ? '[ SENDING... ]' : '[ SEND APPEAL ]'}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setWriting(true)} className={PLATE} {...explain('Opens a box to write an appeal against your ban.', 'The moderators read it in their REPORTS; nothing is sent until SEND APPEAL.')}>
          [ APPEAL ]
        </button>
      )}
      {error !== null ? <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{error}</p> : null}
    </section>
  );
}

/** PRIVACY's BLOCKED list (SPEC-moderation.md, 4B): everybody the reader blocked, each with UNBLOCK. Nobody else sees it. */
export function BlockedList() {
  const { blocked, unblock } = useModeration();
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const anybody = blocked.size > 0;

  // Names for the list, read once there is somebody on it.
  useEffect(() => {
    if (!anybody) return;
    let cancelled = false;
    void (getAuthRepository().listAccounts?.() ?? Promise.resolve([]))
      .then((accounts) => {
        if (!cancelled) setNames(Object.fromEntries(accounts.map((account) => [account.id, account.displayName])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [anybody]);

  async function lift(person: string) {
    setError(null);
    try {
      await unblock(person);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THEY COULD NOT BE UNBLOCKED.');
    }
  }

  return (
    <section data-blocked-list>
      <p className="text-heading font-bold">BLOCKED</p>
      {blocked.size === 0 ? (
        <p className="text-prose">NOBODY.</p>
      ) : (
        <ul>
          {[...blocked].map((person) => (
            <li key={person} className="rule-pixel flex items-center justify-between gap-3 py-2">
              <Link href={`/profile/${person}`} className="link-pixel text-prose font-bold">
                {names[person] ?? 'SOMEBODY'}
              </Link>
              <button type="button" onClick={() => void lift(person)} className={PLATE} {...explain('Unblocks this person: their posts, comments, chat and rooms come back for you as they were.', 'They were never told about the block, and are not told now.')}>
                [ UNBLOCK ]
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null ? <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{error}</p> : null}
    </section>
  );
}
