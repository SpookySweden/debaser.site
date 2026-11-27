'use client';

import { useState } from 'react';
import { openReport, type ReportTarget } from '../lib/moderation/moderation-windows';
import { getModerationStore } from '../lib/moderation/repository';
import { MODERATION_TEXT_MAX, type HiddenMark, type ModTargetKind } from '../lib/moderation/types';
import { FIELD, PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';
import { useAuth } from './AuthProvider';
import { useModeration } from './ModerationProvider';

/**
 * The small moderation keys a row wears (SPEC-moderation.md): REPORT for anybody signed in on somebody else's line, HIDE / UNHIDE
 * for a moderator, and the hidden mark its author and the moderators see. The database decides; these only draw what it allows.
 */

/** `[ REPORT ]` beside somebody else's line: opens REPORT about its author, carrying the line. */
export function ReportKey({ target, className, label }: { target: ReportTarget; className?: string; /** A glyph in place of the word, where a row is tight (room chat). */ label?: string }) {
  const { user } = useAuth();
  if (user === null || user.id === target.accountId) return null;
  return (
    <button
      type="button"
      onClick={() => openReport(target)}
      className={className ?? PLATE}
      title={label === undefined ? undefined : 'Report'}
      aria-label={label === undefined ? undefined : `Report ${target.name}`}
      data-report-key
    >
      {label ?? '[ REPORT ]'}
    </button>
  );
}

/**
 * The hidden mark: a moderator sees `[ HIDDEN ]` and the reason, the author sees HIDDEN BY A MODERATOR and the reason (10A).
 * Nobody else is ever sent the row, so nobody else sees anything.
 */
export function HiddenNote({ mark, authorId }: { mark: HiddenMark | null; authorId: string | null }) {
  const { user } = useAuth();
  const { role } = useModeration();
  if (mark === null) return null;
  const reason = mark.reason.trim();
  if (role.moderator) {
    return (
      <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" data-hidden-mark>
        [ HIDDEN ]{reason !== '' ? ` ${reason}` : ''}
      </p>
    );
  }
  if (user !== null && user.id === authorId) {
    return (
      <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" data-hidden-mark>
        HIDDEN BY A MODERATOR{reason !== '' ? `: ${reason}` : ''}
      </p>
    );
  }
  return null;
}

/** `[ HIDE ]` (with a reason) or `[ UNHIDE ]`, for a moderator. Hidden rows stay in the database: UNHIDE puts them back. */
export function HideControl({ kind, id, authorId, text, mark }: { kind: ModTargetKind; id: string; authorId: string | null; text: string; mark: HiddenMark | null }) {
  const { user } = useAuth();
  const moderation = useModeration();
  const [naming, setNaming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only while the moderator's tools are showing (the `[ MOD ]` key after their name).
  if (user === null || !moderation.toolsOn) return null;
  const me = user.id;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      setNaming(false);
      setReason('');
      moderation.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THAT DID NOT WORK.');
    } finally {
      setBusy(false);
    }
  }

  const store = getModerationStore();

  if (mark !== null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <button type="button" disabled={busy} onClick={() => void run(() => store.unhide(me, kind, id))} className={PLATE} data-unhide-key>
          {busy ? '[ WORKING... ]' : '[ UNHIDE ]'}
        </button>
        {error !== null ? <span className="bg-bubble-pale px-1 text-ink-bar">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" disabled={busy} onClick={() => setNaming(!naming)} className={PLATE} data-hide-key>
        {naming ? '[ CANCEL HIDE ]' : '[ HIDE ]'}
      </button>
      {naming ? (
        <span className="inline-flex w-full flex-wrap items-center gap-1">
          <label htmlFor={`hide-reason-${kind}-${id}`}>REASON:</label>
          <input
            id={`hide-reason-${kind}-${id}`}
            value={reason}
            maxLength={MODERATION_TEXT_MAX}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
          />
          <button type="button" disabled={busy} onClick={() => void run(() => store.hide(me, kind, id, reason.trim(), null, { authorId, text }))} className={PLATE}>
            {busy ? '[ HIDING... ]' : '[ CONFIRM HIDE ]'}
          </button>
        </span>
      ) : null}
      {error !== null ? <span className="bg-bubble-pale px-1 text-ink-bar">{error}</span> : null}
    </span>
  );
}

/**
 * The moderator badge after the reader's own name, top right (Luke, 2026-11-20: "show and hide button is at the end of username
 * with a badge icon"): it shows and hides the moderator tools on the page, which start hidden. A text mark, no drawn badge.
 * Nothing for somebody who isn't a moderator.
 */
export function ModToolsKey() {
  const { role, toolsOn, setToolsShown } = useModeration();
  if (!role.moderator) return null;
  return (
    <button
      type="button"
      aria-pressed={toolsOn}
      onClick={() => setToolsShown(!toolsOn)}
      title={toolsOn ? 'Hide moderator tools' : 'Show moderator tools'}
      aria-label={toolsOn ? 'Hide moderator tools' : 'Show moderator tools'}
      className={`${toolsOn ? PLATE_PRESSED : PLATE} ml-1 shrink-0`}
      data-mod-tools-key
      {...explain(
        toolsOn ? 'Hides the moderator tools on every page.' : 'Shows the moderator tools on every page: HIDE, REMOVE, PIN and BAN keys beside posts, comments and people.',
        'They start hidden so pages look as everyone else sees them. Only moderators have this badge.',
      )}
    >
      {toolsOn ? '⛨ MOD' : '[ ⛨ MOD ]'}
    </button>
  );
}
