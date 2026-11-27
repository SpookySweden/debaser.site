'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { matchesWords, searchWords } from '../../lib/search/site-search';
import { hideSeen } from '../../lib/seeing/account';
import { keptAddress, pageWords, type SeenPage } from '../../lib/seeing/pages';
import { keptPages, keptPagesOnServer, removePage, subscribeToKeptPages } from '../../lib/seeing/pages-store';
import { pageAnchor } from '../../lib/seeing/page-anchor';
import AddToLetterKey from '../AddToLetterKey';
import CommentPopout from '../CommentPopout';
import { ReportKey } from '../ModerationKeys';
import TalkedAboutIn from '../TalkedAboutIn';
import { useModeration } from '../ModerationProvider';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { explain, NOTE } from '../../lib/ui/explain';

const SHOWN = 60;

/** The kept pages, over the page: cards, by tag or by words. */
export default function SeeingKept({ me, onGo, onClose }: { me: string; onGo: (address: string) => void; onClose: () => void }) {
  const pages = useSyncExternalStore(subscribeToKeptPages, keptPages, keptPagesOnServer);
  const [words, setWords] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const tags = useMemo(() => [...new Set(pages.filter((page) => !page.tags.includes('OWN WEB')).flatMap((page) => page.tags))].sort(), [pages]);
  const found = useMemo(() => pages.filter((page) => !page.tags.includes('OWN WEB') && (tag === null || page.tags.includes(tag)) && (words.trim() === '' || matchesWords(searchWords(words), ...pageWords(page)))), [pages, tag, words]);
  return (
    <section aria-label="Kept pages" className="absolute inset-0 z-30 flex flex-col bg-paper p-2 text-label text-ink" data-seeing-kept>
      <div className="flex flex-wrap items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} min-w-40 flex-1`}>KEPT</h2>
        <input value={words} onChange={(event) => setWords(event.target.value)} aria-label="Find in kept pages" placeholder="FIND" spellCheck={false} className={`${FIELD_TIGHT} w-40`} />
        <button type="button" aria-label="Close kept pages" onClick={onClose} className={PLATE} {...explain('Closes the KEPT list and goes back to the page.')}>
          [ × ]
        </button>
      </div>
      {tags.length > 0 ? (
        <p className="flex flex-wrap gap-1 py-1">
          {tags.map((each) => (
            <button key={each} type="button" aria-pressed={tag === each} onClick={() => setTag(tag === each ? null : each)} className={tag === each ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain(`Shows only the kept pages tagged ${each}; press again to show them all.`, 'Tags are the words you gave pages when you kept them.')}>
              {each}
            </button>
          ))}
        </p>
      ) : null}
      {found.length === 0 ? <p className="p-1">NOTHING KEPT.</p> : null}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {found.slice(0, SHOWN).map((page) => (
          <Card key={page.id} page={page} mine={page.ownerId === me} onGo={onGo} />
        ))}
      </ul>
    </section>
  );
}

function Card({ page, mine, onGo }: { page: SeenPage; mine: boolean; onGo: (address: string) => void }) {
  const [sure, setSure] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const { toolsOn } = useModeration();
  return (
    <li className="rule-pixel flex gap-2 py-2">
      {/* The server's own shrunk copy, carried in the card. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {page.picture !== null ? <img src={page.picture} alt="" className="h-20 w-28 shrink-0 object-cover" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-prose break-words">{page.title}</p>
        <p className="text-ink-quiet">
          {page.site} · {new Date(page.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}
          {mine ? '' : ` · ${page.ownerLabel}`}
          {page.private ? ' · ONLY YOU' : ''}
        </p>
        {page.description !== '' ? <p className="break-words">{page.description}</p> : null}
        {page.note !== '' ? <p className="break-words whitespace-pre-wrap">{page.note}</p> : null}
        {page.quotes.map((quote) => (
          <blockquote key={quote} className="border-l-line border-ink pl-2 break-words">
            {quote}
          </blockquote>
        ))}
        <p className="flex flex-wrap gap-1 pt-1">
          {page.hasCopy ? (
            <button type="button" onClick={() => onGo(keptAddress(page.id))} className={PLATE} {...explain('Opens the copy kept of this page, as it was when it was kept.', 'For a page that has changed or gone since.')}>
              [ SEE THE COPY ]
            </button>
          ) : null}
          <button type="button" onClick={() => onGo(page.address)} title={page.address} className={PLATE} {...explain('Opens the page itself, as it is now, from its own site.', 'To see what has changed since it was kept.')}>
            [ SEE THE PAGE ]
          </button>
          {page.private ? null : (
            <>
              <AddToLetterKey thing={{ kind: 'page', ref: page.id, title: page.title }} />
              <CommentPopout anchor={pageAnchor(page)} label="BOARD THREAD" className={PLATE} />
            </>
          )}
          {mine ? (
            <button
              type="button"
              onBlur={() => setSure(false)}
              onClick={() => {
                if (sure) void removePage(page).catch((failure: unknown) => setSaid(failure instanceof Error ? failure.message : 'NOT DELETED'));
                setSure(!sure);
              }}
              className={PLATE}
              {...explain(sure ? 'Press again to delete this kept page and its copy.' : 'Deletes this kept page and its copy, after asking once.', 'Only your own kept pages have this key.', NOTE.undo)}
            >
              {sure ? '[ DELETE IT? ]' : '[ DELETE ]'}
            </button>
          ) : (
            <ReportKey target={{ accountId: page.ownerId, name: page.ownerLabel, note: `A kept page: ${page.title} (${page.address})`.slice(0, 480) }} />
          )}
          {toolsOn && !mine ? (
            <button type="button" onClick={() => void hideSeen('page', page.id).then((done) => setSaid(done ? 'HIDDEN' : 'NOT HIDDEN'))} className={PLATE} {...explain('Hides this kept page from everyone but the person who kept it and the moderators.', 'For a kept page that breaks the house rules.', NOTE.moderators)}>
              [ HIDE ]
            </button>
          ) : null}
        </p>
        {page.private ? null : <TalkedAboutIn kind="page" id={page.id} links={[page.address]} />}
        {said !== null ? (
          <p role="status" className="w-fit bg-bubble-pale px-1 text-ink-bar">
            {said}
          </p>
        ) : null}
      </div>
    </li>
  );
}
