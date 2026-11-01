'use client';

import { useState } from 'react';
import { RESULT_SORTS, excerpt, type ResultSort, type SearchHit } from '../lib/forum/board-search';
import { pluralise } from '../lib/forum/format';
import { displayTitle } from '../lib/forum/site-author';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import TimeStamp from './TimeStamp';

/** Results are not paged until there are more than this; then `[ MORE ]` shows the next lot. */
const RESULTS_PAGE = 25;

type ForumSearchResultsProps = {
  /** The hits, already in the chosen order. */
  hits: SearchHit[];
  /** The free words, to mark in each excerpt. */
  terms: string[];
  sort: ResultSort;
  onSort: (sort: ResultSort) => void;
  /** Opens the thread at that post or reply. */
  onOpen: (hit: SearchHit) => void;
  /** Closes the panel and ends the search (the phone's `[ ◂ BACK ]`, everywhere's `[ × ]`). */
  onClose: () => void;
};

/**
 * The search's results (SPEC-forum-search.md, part 2), Discord's panel in the site's look: a column
 * beside the board on a wide screen, the whole board on a phone (the board decides which, by CSS).
 *
 * One row per matching post and per matching reply. A row says who, when, which thread (`IN <title>`
 * for a reply), a stretch of the words with the searched words marked, and ♪ / IMG when it carries a
 * track or a picture. Pressing a row opens the thread there; the panel stays, so the next row is one
 * press away.
 */
export default function ForumSearchResults({ hits, terms, sort, onSort, onOpen, onClose }: ForumSearchResultsProps) {
  const [shown, setShown] = useState(RESULTS_PAGE);
  const visible = hits.slice(0, shown);

  return (
    <section aria-label="Search results" className="min-w-0 text-ink">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className={`${PLATE} @min-[58.5rem]:hidden`}>
          [ ◂ BACK ]
        </button>
        <h2 className={`${TITLE_BAR} flex-1 text-title`}>{hits.length === 0 ? 'NO RESULTS' : `${hits.length} ${pluralise(hits.length, 'RESULT')}`}</h2>
        <button type="button" onClick={onClose} aria-label="Close search results" className={`${PLATE} @max-[58.5rem]:hidden`}>
          [ × ]
        </button>
      </div>

      {hits.length === 0 ? (
        <p className="mt-2 text-label text-ink">TRY REMOVING A FILTER.</p>
      ) : (
        <>
          <div role="group" aria-label="Sort results" className="mt-1 flex flex-wrap items-center gap-1 text-label">
            {RESULT_SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSort(option.value)}
                aria-pressed={sort === option.value}
                className={sort === option.value ? PLATE_PRESSED : PLATE}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ol className="mt-2">
            {visible.map((hit) => {
              const title = displayTitle(hit.thread);
              const words = hit.body.trim().length > 0 ? hit.body : title;

              return (
                <li key={hit.comment?.id ?? hit.thread.id} className="rule-pixel">
                  <button
                    type="button"
                    onClick={() => onOpen(hit)}
                    className="block w-full cursor-pointer p-1 text-left hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble max-sm:min-h-tap"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-x-2 text-label">
                      <span>{hit.author.displayName}</span>
                      <TimeStamp at={hit.at} />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-label">
                      <span className="min-w-0 break-words">{hit.comment === undefined ? title : `IN ${title}`}</span>
                      {(hit.comment ?? hit.thread).track === undefined ? null : <span aria-label="has a track">♪</span>}
                      {(hit.comment ?? hit.thread).media === undefined ? null : <span>IMG</span>}
                    </span>
                    <span className="mt-0.5 block text-prose leading-normal wrap-anywhere">
                      {excerpt(words, terms).map((part, index) =>
                        part.hit ? (
                          <mark key={index} className="bg-sun text-ink-plate">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {hits.length > shown ? (
            <button type="button" onClick={() => setShown((current) => current + RESULTS_PAGE)} className={`${PLATE} mt-2`}>
              [ MORE ]
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
