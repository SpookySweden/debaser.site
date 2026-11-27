'use client';

import { useState } from 'react';
import { pageAnchor } from '../../lib/seeing/page-anchor';
import { cleanQuote, cleanTags, copyFrom, keptAddress, NOTE_LENGTH, pageFrom, QUOTES_MOST, type SeenPage } from '../../lib/seeing/pages';
import { keepPage, PAGES_ARE_SHARED } from '../../lib/seeing/pages-store';
import { OWN_WEB_TAG } from '../../lib/seeing/own-web';
import { makeCopy } from '../../lib/seeing/server-engine';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import AddToLetterKey from '../AddToLetterKey';
import CommentPopout from '../CommentPopout';
import { explain, NOTE } from '../../lib/ui/explain';

/** KEEP PAGE, beside the page: your tags, your note, the passages you pick, and one key. */
export default function SeeingKeep({ address, owner, selected, onOpen, onClose }: { address: string; owner: { id: string; label: string }; selected: string; onOpen: (address: string) => void; onClose: () => void }) {
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [quotes, setQuotes] = useState<readonly string[]>([]);
  const [state, setState] = useState<{ words: string; fault: boolean; kept: string | null; page?: SeenPage } | null>(null);
  const [busy, setBusy] = useState(false);

  const keep = async () => {
    setBusy(true);
    setState({ words: 'KEEPING', fault: false, kept: null });
    try {
      const made = await makeCopy(address);
      if (typeof made === 'string') throw new Error(made);
      const copy = copyFrom(made.copy);
      const page = pageFrom({
        id: window.crypto.randomUUID(),
        ownerId: owner.id,
        ownerLabel: owner.label,
        address: made.address,
        ...made.card,
        at: Date.now(),
        // OWN WEB is the house's own mark: typed here, it would hide a page kept on purpose among OWN WEB's, where DELETE EVERYTHING takes it.
        tags: cleanTags(tags).filter((tag) => tag !== OWN_WEB_TAG),
        note: note.trim(),
        quotes,
        hasCopy: copy !== null,
        // A page that shows a signed-out reader something else is nobody else's to see.
        private: copy === null || !PAGES_ARE_SHARED,
      });
      if (page === null) throw new Error('NOT KEPT');
      await keepPage(page, copy);
      setState({ words: copy === null ? 'KEPT, WITH NO COPY: THE PAGE IS NOT THE SAME SIGNED OUT, OR IS TOO LARGE' : 'KEPT', fault: false, kept: copy === null ? null : keptAddress(page.id), page });
    } catch (failure) {
      setState({ words: failure instanceof Error ? failure.message : 'NOT KEPT', fault: true, kept: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Keep page" className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l-line border-ink bg-paper p-2 text-label text-ink" data-seeing-keep>
      <div className="flex items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} flex-1`}>KEEP PAGE</h2>
        <button type="button" aria-label="Close keep page" onClick={onClose} className={PLATE} {...explain('Closes KEEP PAGE without keeping anything.', 'The tags, note and quotes typed here are dropped when it closes.')}>
          [ × ]
        </button>
      </div>
      <label className="flex flex-col">
        TAGS
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="FOG, HARBOURS" maxLength={300} spellCheck={false} className={FIELD_TIGHT} />
      </label>
      <label className="flex flex-col">
        NOTE
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_LENGTH} rows={3} className={FIELD_TIGHT} />
      </label>
      <div>
        <button type="button" disabled={selected === '' || quotes.length >= QUOTES_MOST || quotes.includes(selected)} onClick={() => setQuotes([...quotes, cleanQuote(selected)])} className={PLATE} {...explain('Adds the words you have selected on the page as a quote on this keep.', 'Select a passage on the page first; the quotes you pick are kept with the page so you remember why you kept it.')}>
          [ + QUOTE ]
        </button>{' '}
        {quotes.length === 0 ? 'SELECT WORDS ON THE PAGE' : `${quotes.length}/${QUOTES_MOST}`}
        <ul>
          {quotes.map((quote) => (
            <li key={quote} className="rule-pixel flex items-start gap-1 py-1">
              <span className="min-w-0 flex-1 break-words">&ldquo;{quote}&rdquo;</span>
              <button type="button" aria-label="Remove quote" onClick={() => setQuotes(quotes.filter((each) => each !== quote))} className={PLATE} {...explain('Takes this quote off the keep before it is kept.')}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <button type="button" disabled={busy} onClick={() => void keep()} className={PLATE_MAIN} {...explain('Keeps this page with your tags, note and quotes, and a copy of how it looks signed out when the house can make one.', 'Kept pages are found again under KEPT, even if the page changes or goes away.', PAGES_ARE_SHARED ? NOTE.others : undefined)}>
          KEEP
        </button>{' '}
        {PAGES_ARE_SHARED ? 'EVERYONE WILL SEE THIS' : 'ONLY YOU, IN THIS BROWSER'}
      </div>
      {state !== null ? (
        <p role="status" className={state.fault ? 'w-fit bg-bubble-pale px-1 text-ink-bar' : ''}>
          {state.words}{' '}
          {state.kept !== null ? (
            <button type="button" onClick={() => onOpen(state.kept ?? '')} className={PLATE} {...explain('Opens the copy just kept, in this tab.', 'To check the copy looks right: it is the page as it was when you kept it.')}>
              [ SEE THE COPY ]
            </button>
          ) : null}
          {/* Straight on to a letter or the board, as the KEPT list offers; a private page goes nowhere. */}
          {state.page !== undefined && !state.page.private ? (
            <>
              {' '}
              <AddToLetterKey thing={{ kind: 'page', ref: state.page.id, title: state.page.title }} />{' '}
              <CommentPopout anchor={pageAnchor(state.page)} label="BOARD THREAD" className={PLATE} />
            </>
          ) : null}
        </p>
      ) : null}
      <a href={`https://web.archive.org/save/${address}`} target="_blank" rel="noopener noreferrer" className={`${PLATE} w-fit`} {...explain('Asks archive.org, the Wayback Machine, to save a copy of this page for everyone.', 'A public copy that lasts outside this site; anybody can find it there later.', NOTE.leaves)}>
        [ KEEP A COPY AT ARCHIVE.ORG ↗ ]
      </a>
    </section>
  );
}
