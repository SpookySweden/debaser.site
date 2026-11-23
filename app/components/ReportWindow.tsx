'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  closeReport,
  reportWindowServerState,
  reportWindowState,
  subscribeToReportWindow,
  type ReportTarget,
} from '../lib/moderation/moderation-windows';
import { getModerationStore } from '../lib/moderation/repository';
import { MODERATION_TEXT_MAX, REPORT_REASONS, type ReportReason } from '../lib/moderation/types';
import { FIELD, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useModeration } from './ModerationProvider';

/**
 * REPORT (SPEC-moderation.md, 6B and 8A): a report is about a person, with a reason and a line of the reporter's own. Opened from
 * a line (a post, a reply, a comment, a chat line, a message), it carries that line: the database copies it itself, and only when
 * the reporter could read it. Moderators see it in REPORTS; nobody tells the person who reported them.
 */
function ReportForm({ target, me }: { target: ReportTarget; me: string }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState(target.note ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (reason === null) {
      setError('PICK A REASON.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await getModerationStore().fileReport(me, { accountId: target.accountId, reason, note: note.trim(), context: target.context });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE REPORT COULD NOT BE SENT.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p role="status" className="text-sm font-bold text-ink">REPORT SENT.</p>
        <button type="button" onClick={closeReport} className={PLATE}>
          [ CLOSE ]
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="text-sm font-bold text-ink">{target.name}</p>
      {target.context ? (
        <blockquote className="rule-pixel whitespace-pre-wrap break-words py-1 text-sm text-ink">{target.context.text}</blockquote>
      ) : null}
      <div role="radiogroup" aria-label="Reason" className="flex flex-wrap items-center gap-1">
        {REPORT_REASONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={reason === option.id}
            onClick={() => setReason(option.id)}
            className={reason === option.id ? PLATE_PRESSED : PLATE}
          >
            {reason === option.id ? option.label : `[ ${option.label} ]`}
          </button>
        ))}
      </div>
      <label className="text-label text-ink">
        MORE (OPTIONAL)
        <textarea
          value={note}
          maxLength={MODERATION_TEXT_MAX}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          className={FIELD}
        />
      </label>
      {error !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {error}
        </p>
      ) : null}
      <div>
        <button type="button" disabled={busy} onClick={() => void send()} className={PLATE_MAIN}>
          {busy ? 'SENDING...' : 'SEND REPORT'}
        </button>
      </div>
    </div>
  );
}

/**
 * BLOCK, under the report form when the window was opened from the red `[ ! ]` on a profile (Luke, 2026-11-21: "the encompassing
 * reporting/ block pop up"). Blocking takes two presses, like anything started from the board. It is one way: what they write
 * disappears for you, they can't message you, comment on your profile or join your room, and they are never told. Once blocked,
 * their profile behind becomes YOU BLOCKED THIS PERSON and this part offers UNBLOCK.
 */
function BlockPart({ target }: { target: ReportTarget }) {
  const { isBlocked, block, unblock } = useModeration();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = isBlocked(target.accountId);

  async function press() {
    if (!blocked && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (blocked) await unblock(target.accountId);
      else await block(target.accountId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : blocked ? 'THEY COULD NOT BE UNBLOCKED.' : 'THEY COULD NOT BE BLOCKED.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const label = blocked
    ? busy
      ? '[ UNBLOCKING... ]'
      : '[ UNBLOCK ]'
    : busy
      ? '[ BLOCKING... ]'
      : confirming
        ? '[ CONFIRM BLOCK ]'
        : '[ BLOCK ]';

  return (
    <section aria-label="Block" className="flex flex-col items-start gap-2 border-t border-ink p-2" data-block-part={blocked ? 'blocked' : 'open'}>
      <p className="text-sm font-bold text-ink">BLOCK</p>
      <p className="text-sm text-ink">
        {blocked
          ? `YOU BLOCKED ${target.name}.`
          : 'WHAT THEY WRITE DISAPPEARS FOR YOU, AND THEY CAN’T MESSAGE YOU, COMMENT ON YOUR PROFILE OR JOIN YOUR ROOM. THEY ARE NEVER TOLD.'}
      </p>
      <button type="button" disabled={busy} onClick={() => void press()} onBlur={() => setConfirming(false)} className={PLATE} data-block-key>
        {label}
      </button>
      {error !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function ReportWindow() {
  const { target } = useSyncExternalStore(subscribeToReportWindow, reportWindowState, reportWindowServerState);
  const { user } = useAuth();

  if (target === null || user === null) return null;

  const both = target.block === true;

  return (
    <DockWindow
      title={both ? 'REPORT / BLOCK' : 'REPORT'}
      onClose={closeReport}
      status=""
      dock="top"
      id="report"
      layoutId="report"
      defaultSize={{ w: 420, h: both ? 560 : 420 }}
      minSize={{ w: 280, h: 240 }}
    >
      {/* A new form for each person or line, so nothing typed for one carries over to the next. */}
      <ReportForm key={`${target.accountId}:${target.context?.id ?? ''}`} target={target} me={user.id} />
      {both ? <BlockPart key={target.accountId} target={target} /> : null}
    </DockWindow>
  );
}
