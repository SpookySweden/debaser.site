'use client';

import { useEffect, useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { announcesOnBoard, DOC_ACCESS_LABELS, DOC_ACCESS_NOTES, DOC_ACCESS_ORDER, docPath } from '../lib/docs/rules';
import type { DocAccess, DocRecord, DocShare, DocViewer } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_MAIN, DOC_KEY_ON } from '../lib/docs/ui';
import { FIELD, TITLE_BAR } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
import DocsScale from './DocsScale';
import PopoutWindow from './PopoutWindow';

type DocSharingWindowProps = {
  record: DocRecord;
  /** Makes the document's one board post, when its level calls for one and it has words. */
  announce: (access: DocAccess) => Promise<void>;
  viewer: DocViewer;
  onChanged: (patch: Partial<DocRecord>) => void;
  onClose: () => void;
};

/**
 * SHARE, for the owner: the document's link to copy, and who can open it.
 *
 * Four plain choices, each a big row to press: ONLY ME, PEOPLE I PICK (named people, each CAN WRITE or
 * CAN ONLY READ), ANYONE SIGNED IN, EVERYONE. The database refuses the change from anybody but the owner;
 * this window is only offered to them. The first move to ANYONE SIGNED IN or EVERYONE makes the document's
 * one board post, and the window says so before it is saved.
 */
export default function DocSharingWindow({ record, announce, viewer, onChanged, onClose }: DocSharingWindowProps) {
  const repository = useMemo(() => getDocsRepository(viewer.id), [viewer.id]);
  const { accounts } = useComms();
  const [access, setAccess] = useState<DocAccess>(record.access);
  const [shares, setShares] = useState<DocShare[]>([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  useEffect(() => {
    let cancelled = false;
    repository
      .listShares(record.id)
      .then((rows) => {
        if (!cancelled) setShares(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'SHARING DID NOT LOAD.');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, record.id, repository]);

  const people = accounts
    .filter((account) => account.id !== viewer.id && !shares.some((share) => share.personId === account.id))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  // The window only exists in the browser (PopoutWindow draws after mounting), so the page's own address is there to read.
  const link = typeof window === 'undefined' ? docPath(record) : `${window.location.origin}${docPath(record)}`;

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      // No clipboard here (an old browser, or it said no): the address is in the box to copy by hand.
      setCopied('no');
    }
  }

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      setAttempt((value) => value + 1);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT CHANGED.');
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    await run(async () => {
      await repository.updateDoc(record.id, { access });
      onChanged({ access });

      await announce(access);
      onClose();
    });
  }

  return (
    <PopoutWindow title="SHARE" onClose={onClose} maxWidth="max-w-3xl">
      <DocsScale>
        {error === null ? null : <p className={`${DOC_FAULT} mb-2`}>{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="doc-share-link">
            The document&apos;s link
          </label>
          <input id="doc-share-link" value={link} readOnly onFocus={(event) => event.target.select()} className={`${FIELD} docs-meta min-w-0 flex-1`} />
          <button type="button" className={`${DOC_KEY} whitespace-nowrap`} onClick={() => void copyLink()}>
            [ COPY LINK ]
          </button>
        </div>
        <p className="docs-meta min-h-6 text-ink" role="status" aria-live="polite">
          {copied === 'yes' ? 'LINK COPIED.' : copied === 'no' ? 'NOT COPIED: PRESS AND HOLD THE LINK TO COPY IT.' : ''}
        </p>

        <div className={`${TITLE_BAR} mt-2`}>
          <span>WHO CAN OPEN IT</span>
        </div>
        <fieldset>
          <legend className="sr-only">Who can open it</legend>
          {DOC_ACCESS_ORDER.map((level) => {
            const on = access === level;
            return (
              <label
                key={level}
                className={`my-1 flex min-h-tap cursor-pointer items-start gap-3 px-2 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-bubble ${
                  on ? 'bg-ink text-paper' : 'text-ink hover:bg-pointed'
                }`}
              >
                <input type="radio" name="doc-access" value={level} checked={on} onChange={() => setAccess(level)} className="sr-only" />
                <span className="docs-key shrink-0 whitespace-nowrap" aria-hidden="true">
                  {on ? '(●)' : '( )'}
                </span>
                <span className="min-w-0">
                  <span className="docs-key block">{DOC_ACCESS_LABELS[level]}</span>
                  <span className="docs-meta block">{DOC_ACCESS_NOTES[level]}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {announcesOnBoard(access) && record.boardThreadId === null ? <p className="docs-meta mt-1 text-ink">ONCE IT HAS WORDS IN IT, THIS ALSO PUTS ONE POST ABOUT IT ON THE BOARD.</p> : null}

        {access === 'shared' ? (
          <section className="mt-2">
            <div className={TITLE_BAR}>
              <span>THE PEOPLE I PICK</span>
            </div>
            {shares.length === 0 ? <p className="docs-meta py-1 text-ink">NOBODY YET.</p> : null}
            <ul>
              {shares.map((share) => (
                <li key={share.personId} className="rule-pixel flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-ink">
                  <span className="docs-key min-w-0 flex-1 break-words">{share.personLabel}</span>
                  <button
                    type="button"
                    className={share.canEdit ? DOC_KEY_ON : DOC_KEY}
                    aria-pressed={share.canEdit}
                    disabled={busy}
                    onClick={() => void run(() => repository.setShare(record.id, { ...share, canEdit: true }))}
                  >
                    [ CAN WRITE ]
                  </button>
                  <button
                    type="button"
                    className={share.canEdit ? DOC_KEY : DOC_KEY_ON}
                    aria-pressed={!share.canEdit}
                    disabled={busy}
                    onClick={() => void run(() => repository.setShare(record.id, { ...share, canEdit: false }))}
                  >
                    [ CAN ONLY READ ]
                  </button>
                  <button type="button" className={DOC_KEY} disabled={busy} onClick={() => void run(() => repository.removeShare(record.id, share.personId))}>
                    [ REMOVE ]
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="doc-share-person">
                Person to add
              </label>
              <select
                id="doc-share-person"
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                className="docs-key min-h-tap min-w-0 flex-1 bg-paper text-ink"
              >
                <option value="">PICK SOMEONE</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={DOC_KEY}
                disabled={busy || picked.length === 0}
                onClick={() => {
                  const person = people.find((candidate) => candidate.id === picked);
                  if (person === undefined) return;
                  setPicked('');
                  void run(() => repository.setShare(record.id, { personId: person.id, personLabel: person.displayName, canEdit: true }));
                }}
              >
                [ + ADD THEM ]
              </button>
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={DOC_KEY_MAIN} disabled={busy} onClick={() => void apply()}>
            [ SAVE ]
          </button>
          <button type="button" className={DOC_KEY} onClick={onClose}>
            [ CANCEL ]
          </button>
        </div>
      </DocsScale>
    </PopoutWindow>
  );
}
