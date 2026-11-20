'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getAuthRepository } from '../lib/auth/auth-repository';
import type { AccountUser } from '../lib/auth/types';
import {
  closeReports,
  reportsWindowServerState,
  reportsWindowState,
  subscribeToReportsWindow,
} from '../lib/moderation/moderation-windows';
import { getModerationStore } from '../lib/moderation/repository';
import {
  MODERATION_TEXT_MAX,
  type ModerationLogEntry,
  type ModerationReport,
  type ModeratorRow,
  type ModTargetKind,
} from '../lib/moderation/types';
import { FIELD, PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useModeration } from './ModerationProvider';

/**
 * REPORTS (SPEC-moderation.md, 7A, 9A, 10A): the moderators' window. OPEN lists what people reported and the appeals of banned
 * accounts, each with what can be done about it; DONE is what was handled; LOG is every moderator action, kept for ever; MODERATORS
 * is the list, which only the owner changes. The database decides all of it: a non-moderator who opened this would read nothing.
 */

type Tab = 'open' | 'done' | 'log' | 'moderators';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'open', label: 'OPEN' },
  { id: 'done', label: 'DONE' },
  { id: 'log', label: 'LOG' },
  { id: 'moderators', label: 'MODERATORS' },
];

const KIND_WORDS: Record<string, string> = {
  thread: 'POST',
  reply: 'REPLY',
  profile_comment: 'PROFILE COMMENT',
  room_line: 'ROOM CHAT',
  message: 'MESSAGE',
  account: 'ACCOUNT',
  report: 'REPORT',
};

const ACTION_WORDS: Record<ModerationLogEntry['action'], string> = {
  hide: 'HID',
  unhide: 'UNHID',
  remove: 'REMOVED',
  ban: 'BANNED',
  unban: 'UNBANNED',
  dismiss: 'DISMISSED A REPORT ON',
  moderator_added: 'MADE A MODERATOR:',
  moderator_removed: 'TOOK OFF THE MODERATORS:',
};

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function isHideable(kind: string): kind is ModTargetKind {
  return kind === 'thread' || kind === 'reply' || kind === 'profile_comment' || kind === 'room_line';
}

type Names = (id: string | null) => string;

function Person({ id, names }: { id: string | null; names: Names }) {
  if (id === null) return <span>SOMEBODY GONE</span>;
  return (
    <Link href={`/profile/${id}`} className="link-pixel font-bold">
      {names(id)}
    </Link>
  );
}

function ReportRow({ report, names, me, onDone }: { report: ModerationReport; names: Names; me: string; onDone: () => void }) {
  const moderation = useModeration();
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = report.state === 'open';
  const context = report.context;

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      moderation.refresh();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THAT DID NOT WORK.');
    } finally {
      setBusy(false);
    }
  }

  const store = getModerationStore();

  return (
    <li className="rule-pixel flex flex-col gap-1 py-2 text-sm text-ink">
      <p>
        {report.kind === 'appeal' ? (
          <>
            <span className="font-bold">APPEAL</span> FROM <Person id={report.accountId} names={names} />
          </>
        ) : (
          <>
            <Person id={report.accountId} names={names} /> · {report.reason?.toUpperCase()} · FROM{' '}
            <Person id={report.reporterId} names={names} />
          </>
        )}
        <span className="text-label"> · {when(report.createdAt)}</span>
        {!open ? <span className="text-label"> · {report.state === 'acted' ? 'ACTED ON' : 'DISMISSED'}</span> : null}
      </p>
      {report.note !== '' ? <p className="whitespace-pre-wrap break-words">{report.note}</p> : null}
      {context !== null ? (
        <div>
          <p className="text-label">
            {KIND_WORDS[context.kind] ?? context.kind}
            {context.private ? ' · PRIVATE: THIS LINE ONLY' : ''}
          </p>
          <blockquote className="whitespace-pre-wrap break-words border-l-line border-ink pl-2">{context.text}</blockquote>
        </div>
      ) : null}
      {open ? (
        <>
          <label className="text-label">
            REASON (SHOWN TO THEM ON A HIDE OR BAN)
            <input value={why} maxLength={MODERATION_TEXT_MAX} onChange={(event) => setWhy(event.target.value)} className={FIELD} />
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {report.kind === 'report' && context !== null && isHideable(context.kind) && !context.private ? (
              <button type="button" disabled={busy} onClick={() => void act(() => store.hide(me, context.kind as ModTargetKind, context.id, why.trim(), report.id, { authorId: report.accountId, text: context.text }))} className={PLATE}>
                [ HIDE ]
              </button>
            ) : null}
            {report.kind === 'report' ? (
              <button type="button" disabled={busy} onClick={() => void act(() => store.ban(me, report.accountId, why.trim(), report.id))} className={PLATE}>
                [ BAN ]
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void act(() => store.unban(me, report.accountId, report.id))} className={PLATE}>
                [ UNBAN ]
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void act(() => store.dismissReport(me, report.id, why.trim()))} className={PLATE}>
              [ DISMISS ]
            </button>
          </div>
        </>
      ) : null}
      {error !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function LogRow({ entry, names }: { entry: ModerationLogEntry; names: Names }) {
  const aboutAccount = entry.targetKind === 'account' || entry.targetKind === 'report';
  return (
    <li className="rule-pixel py-1.5 text-sm text-ink">
      <p>
        <span className="text-label">{when(entry.at)} · </span>
        <Person id={entry.actorId} names={names} /> {ACTION_WORDS[entry.action]}{' '}
        {aboutAccount ? null : <span>{KIND_WORDS[entry.targetKind ?? ''] ?? ''} BY </span>}
        {entry.targetAccountId !== null ? <Person id={entry.targetAccountId} names={names} /> : null}
      </p>
      {entry.reason !== '' ? <p className="text-label">REASON: {entry.reason}</p> : null}
      {entry.excerpt !== '' ? <p className="whitespace-pre-wrap break-words text-label">“{entry.excerpt}”</p> : null}
    </li>
  );
}

function Moderators({ names, accounts, me, owner }: { names: Names; accounts: AccountUser[]; me: string; owner: boolean }) {
  const [rows, setRows] = useState<ModeratorRow[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getModerationStore()
      .listModerators()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'THE MODERATORS COULD NOT BE READ.');
      });
    return () => {
      cancelled = true;
    };
  }, [asked]);

  async function run(task: () => Promise<void>) {
    setError(null);
    try {
      await task();
      setPick('');
      setAsked((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THAT DID NOT WORK.');
    }
  }

  const candidates = accounts.filter((account) => !account.hidden && !rows.some((row) => row.id === account.id));

  return (
    <div className="flex flex-col gap-2">
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="rule-pixel flex flex-wrap items-center gap-2 py-1.5 text-sm text-ink">
            <Person id={row.id} names={names} />
            {row.owner ? <span className="text-label">OWNER</span> : null}
            {owner && !row.owner ? (
              <button type="button" onClick={() => void run(() => getModerationStore().removeModerator(me, row.id))} className={PLATE}>
                [ TAKE OFF ]
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {owner ? (
        <div className="flex flex-wrap items-end gap-1">
          <label className="text-label text-ink">
            ADD
            <select value={pick} onChange={(event) => setPick(event.target.value)} className={FIELD}>
              <option value="">PICK SOMEBODY</option>
              {candidates.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pick === ''} onClick={() => void run(() => getModerationStore().addModerator(me, pick))} className={PLATE}>
            [ MAKE MODERATOR ]
          </button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReportsBody({ me, owner }: { me: string; owner: boolean }) {
  const [tab, setTab] = useState<Tab>('open');
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [log, setLog] = useState<ModerationLogEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const again = useCallback(() => setAsked((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (getAuthRepository().listAccounts?.() ?? Promise.resolve([]))
      .then((next) => {
        if (!cancelled) setAccounts(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab === 'moderators') return;
    let cancelled = false;
    const store = getModerationStore();
    const read =
      tab === 'log'
        ? store.listLog().then((next) => {
            if (cancelled) return;
            setLog(next);
            setError(null);
          })
        : store.listReports(tab).then((next) => {
            if (cancelled) return;
            setReports(next);
            setError(null);
          });
    read.catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'IT COULD NOT BE READ.');
    });
    return () => {
      cancelled = true;
    };
  }, [tab, asked]);

  const byId = new Map(accounts.map((account) => [account.id, account.displayName]));
  const names: Names = (id) => (id === null ? 'SOMEBODY GONE' : byId.get(id) ?? 'UNKNOWN');

  return (
    <div className="flex flex-col gap-2 p-2">
      <div role="tablist" aria-label="Reports" className="flex flex-wrap items-center gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={tab === entry.id ? PLATE_PRESSED : PLATE}
          >
            {tab === entry.id ? entry.label : `[ ${entry.label} ]`}
          </button>
        ))}
      </div>
      {error !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
          {error}
        </p>
      ) : null}
      {tab === 'moderators' ? (
        <Moderators names={names} accounts={accounts} me={me} owner={owner} />
      ) : tab === 'log' ? (
        log.length === 0 ? (
          <p className="text-sm text-ink">NOTHING YET.</p>
        ) : (
          <ul>
            {log.map((entry) => (
              <LogRow key={entry.id} entry={entry} names={names} />
            ))}
          </ul>
        )
      ) : reports.length === 0 ? (
        <p className="text-sm text-ink">NOTHING {tab === 'open' ? 'WAITING' : 'YET'}.</p>
      ) : (
        <ul>
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} names={names} me={me} onDone={again} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsWindow() {
  const { open } = useSyncExternalStore(subscribeToReportsWindow, reportsWindowState, reportsWindowServerState);
  const { user } = useAuth();
  const { role } = useModeration();

  if (!open || user === null || !role.moderator) return null;

  return (
    <DockWindow
      title="REPORTS"
      onClose={closeReports}
      status=""
      dock="bottom"
      id="reports"
      layoutId="reports"
      tall
      defaultSize={{ w: 520, h: 900 }}
      minSize={{ w: 300, h: 240 }}
    >
      <ReportsBody me={user.id} owner={role.owner} />
    </DockWindow>
  );
}
