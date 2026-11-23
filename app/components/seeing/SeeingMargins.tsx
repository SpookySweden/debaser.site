'use client';

import { useState } from 'react';
import { MARGIN_LENGTH, withNote, withoutNote, type Margin } from '../../lib/seeing/margins';
import { changeMargins } from '../../lib/seeing/margins-store';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/** MARGINALIA, beside the page: a note on a passage, and the passage marked where it stands. */
export default function SeeingMargins({ page, notes, selected, onFind, onClose }: { page: string; notes: readonly Margin[]; selected: string; onFind: (index: number) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <section aria-label="Notes" className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l-line border-ink bg-paper p-2 text-label text-ink" data-seeing-margins>
      <div className="flex items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} flex-1`}>NOTES</h2>
        <button type="button" aria-label="Close notes" onClick={onClose} className={PLATE}>
          [ × ]
        </button>
      </div>
      <p className="text-ink-quiet">ONLY YOU, IN THIS BROWSER</p>
      <p className="break-words">{selected === '' ? 'SELECT WORDS ON THE PAGE' : `“${selected}”`}</p>
      <label className="flex flex-col">
        NOTE
        <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={MARGIN_LENGTH} rows={3} className={FIELD_TIGHT} />
      </label>
      <button
        type="button"
        disabled={selected === '' || text.trim() === ''}
        onClick={() => {
          changeMargins((all) => withNote(all, { id: window.crypto.randomUUID(), page, quote: selected, note: text, at: Date.now() }));
          setText('');
        }}
        className={`${PLATE_MAIN} w-fit`}
      >
        ADD
      </button>
      <ul>
        {notes.map((each, index) => (
          <li key={each.id} className="rule-pixel py-2">
            <blockquote className="border-l-line border-ink pl-2 break-words">{each.quote}</blockquote>
            <p className="py-1 break-words whitespace-pre-wrap">{each.note}</p>
            <button type="button" onClick={() => onFind(index)} className={PLATE}>
              [ FIND ]
            </button>
            <button type="button" onClick={() => changeMargins((all) => withoutNote(all, each.id))} className={PLATE}>
              [ DELETE ]
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
