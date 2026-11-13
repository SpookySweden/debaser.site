'use client';

import { useEffect, useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_NOTES, DOC_ACCESS_ORDER } from '../lib/docs/rules';
import type { DocAccess, DocRecord, DocShare, DocViewer } from '../lib/docs/types';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
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
 * SHARING, for the owner: who can see and edit the document.
 *
 * PRIVATE, SHARED WITH (named people, each CAN EDIT or CAN READ), ANYONE SIGNED IN, PUBLIC. The database
 * refuses the change from anybody but the owner; this window is only offered to them. The first move to
 * ANYONE SIGNED IN or PUBLIC makes the document's one board post.
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
    <PopoutWindow title="SHARING" onClose={onClose} maxWidth="max-w-xl">
      {error === null ? null : <p className="mb-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      <fieldset>
        <legend className="sr-only">Who can see it</legend>
        {DOC_ACCESS_ORDER.map((level) => (
          <label key={level} className="flex cursor-pointer items-baseline gap-2 py-1 text-label text-ink">
            <input type="radio" name="doc-access" value={level} checked={access === level} onChange={() => setAccess(level)} />
            <span className="font-bold">{DOC_ACCESS_LABELS[level]}</span>
            <span>{DOC_ACCESS_NOTES[level]}</span>
          </label>
        ))}
      </fieldset>

      {access === 'shared' ? (
        <section className="mt-2">
          <div className={TITLE_BAR}>
            <span>SHARED WITH</span>
          </div>
          {shares.length === 0 ? <p className="py-1 text-label text-ink">NOBODY YET.</p> : null}
          <ul>
            {shares.map((share) => (
              <li key={share.personId} className="rule-pixel flex flex-wrap items-center gap-2 py-1 text-label text-ink">
                <span className="min-w-0 flex-1 font-bold">{share.personLabel}</span>
                <button
                  type="button"
                  className={share.canEdit ? PLATE_PRESSED : PLATE}
                  aria-pressed={share.canEdit}
                  disabled={busy}
                  onClick={() => void run(() => repository.setShare(record.id, { ...share, canEdit: true }))}
                >
                  [ CAN EDIT ]
                </button>
                <button
                  type="button"
                  className={share.canEdit ? PLATE : PLATE_PRESSED}
                  aria-pressed={!share.canEdit}
                  disabled={busy}
                  onClick={() => void run(() => repository.setShare(record.id, { ...share, canEdit: false }))}
                >
                  [ CAN READ ]
                </button>
                <button type="button" className={PLATE} disabled={busy} onClick={() => void run(() => repository.removeShare(record.id, share.personId))}>
                  [ REMOVE ]
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="doc-share-person">
              Person
            </label>
            <select id="doc-share-person" value={picked} onChange={(event) => setPicked(event.target.value)} className="min-w-0 flex-1 bg-paper text-label text-ink">
              <option value="">PICK SOMEONE</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={PLATE}
              disabled={busy || picked.length === 0}
              onClick={() => {
                const person = people.find((candidate) => candidate.id === picked);
                if (person === undefined) return;
                setPicked('');
                void run(() => repository.setShare(record.id, { personId: person.id, personLabel: person.displayName, canEdit: true }));
              }}
            >
              [ ADD ]
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={PLATE_MAIN} disabled={busy} onClick={() => void apply()}>
          [ SAVE ]
        </button>
        <button type="button" className={PLATE} onClick={onClose}>
          [ CANCEL ]
        </button>
      </div>
    </PopoutWindow>
  );
}
