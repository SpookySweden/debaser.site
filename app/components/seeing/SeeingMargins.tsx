'use client';

import { useState } from 'react';
import { hideSeen, ON_THE_ACCOUNT, type SharedNote } from '../../lib/seeing/account';
import { MARGIN_LENGTH } from '../../lib/seeing/margins';
import { addNote, deleteNote } from '../../lib/seeing/notes-store';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { ReportKey } from '../ModerationKeys';
import { useModeration } from '../ModerationProvider';

type Props = { page: string; owner: { id: string; label: string }; notes: readonly SharedNote[]; selected: string; onFind: (index: number) => void; onClose: () => void };

/** MARGINALIA, beside the page: a note on a passage, and the passage marked where it stands. */
export default function SeeingMargins({ page, owner, notes, selected, onFind, onClose }: Props) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const { toolsOn } = useModeration();
  const tried = (done: boolean) => setSaid(done ? null : 'IT COULD NOT BE DONE: TRY AGAIN');
  return (
    <section aria-label="Notes" className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l-line border-ink bg-paper p-2 text-label text-ink" data-seeing-margins>
      <div className="flex items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} flex-1`}>NOTES</h2>
        <button type="button" aria-label="Close notes" onClick={onClose} className={PLATE}>
          [ × ]
        </button>
      </div>
      <p className="text-ink-quiet">{ON_THE_ACCOUNT ? 'EVERYONE WHO OPENS THIS PAGE HERE SEES THESE' : 'ONLY YOU, IN THIS BROWSER'}</p>
      <p className="break-words">{selected === '' ? 'SELECT WORDS ON THE PAGE' : `“${selected}”`}</p>
      <label className="flex flex-col">
        NOTE
        <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={MARGIN_LENGTH} rows={3} className={FIELD_TIGHT} />
      </label>
      <button
        type="button"
        disabled={selected === '' || text.trim() === ''}
        onClick={() =>
          void addNote({ id: window.crypto.randomUUID(), page, quote: selected, note: text.trim(), at: Date.now() }, owner).then((done) => {
            tried(done);
            if (done) setText('');
          })
        }
        className={`${PLATE_MAIN} w-fit`}
      >
        ADD
      </button>
      {said !== null ? (
        <p role="status" className="w-fit bg-bubble-pale px-1 text-ink-bar">
          {said}
        </p>
      ) : null}
      <ul>
        {notes.map((each, index) => (
          <li key={each.id} className="rule-pixel py-2">
            <blockquote className="border-l-line border-ink pl-2 break-words">{each.quote}</blockquote>
            <p className="py-1 break-words whitespace-pre-wrap">{each.note}</p>
            {ON_THE_ACCOUNT ? <p className="text-ink-quiet">{each.ownerLabel}</p> : null}
            <p className="flex flex-wrap gap-1">
              <button type="button" onClick={() => onFind(index)} className={PLATE}>
                [ FIND ]
              </button>
              {each.ownerId === owner.id ? (
                <button type="button" onClick={() => void deleteNote(each.id).then(tried)} className={PLATE}>
                  [ DELETE ]
                </button>
              ) : (
                <ReportKey target={{ accountId: each.ownerId, name: each.ownerLabel, note: `A note on ${page}: ${each.note}`.slice(0, 480) }} />
              )}
              {toolsOn && each.ownerId !== owner.id ? (
                <button type="button" onClick={() => void hideSeen('note', each.id).then(tried)} className={PLATE}>
                  [ HIDE ]
                </button>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
