'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { MARGINS, nudge, PAPERS, READER_FONTS, SIZE_MAX, SIZE_MIN, SPACING_MAX, SPACING_MIN, type ReaderSettings } from '../../lib/books/reader-look';
import type { SearchExcerpt, TocItem } from '../../lib/books/reader-engine';
import { highlightRef, type BookBookmark, type BookHighlight } from '../../lib/books/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import AddToLetterKey from '../AddToLetterKey';
import { SWATCH } from './HighlightBar';

export type PanelName = 'contents' | 'search' | 'bookmarks' | 'highlights' | 'look';

/**
 * One of the reader's side panels (SPEC-reader.md): a drawer at the right on a desktop, a sheet from the foot on a phone,
 * laid over the page so the book never reflows under it.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="frame absolute z-20 flex flex-col bg-sun-pale text-ink max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[70%] sm:bottom-2 sm:right-2 sm:top-2 sm:w-[24rem] sm:max-w-[calc(100%-1rem)]"
    >
      <div className="flex items-center gap-2 px-2 pt-1">
        <h2 className={`${TITLE_BAR} min-w-0 flex-1`}>{title}</h2>
        <button type="button" onClick={onClose} className={PLATE} aria-label={`Close ${title.toLowerCase()}`}>
          [ × ]
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
}

/** The book's own contents list, the chapter you're in marked. */
export function ContentsList({ toc, current, onGo }: { toc: readonly TocItem[]; current: string | null; onGo: (href: string) => void }) {
  if (toc.length === 0) return <p className="text-label">THIS BOOK HAS NO CONTENTS LIST.</p>;
  const rows = (items: readonly TocItem[], depth: number): ReactNode[] =>
    items.flatMap((item, index) => [
      item.href ? (
        <li key={`${depth}-${index}-${item.href}`} className="rule-pixel">
          <button
            type="button"
            onClick={() => item.href && onGo(item.href)}
            aria-current={current === item.href ? 'true' : undefined}
            className={`block w-full break-words py-1.5 text-left text-key ${current === item.href ? 'bg-pointed text-ink' : 'hover:bg-pointed'}`}
            style={{ paddingLeft: `${0.25 + depth}rem` }}
          >
            {current === item.href ? '▶ ' : ''}
            {(item.label ?? '').trim() || 'UNTITLED'}
          </button>
        </li>
      ) : null,
      ...(item.subitems?.length ? rows(item.subitems, depth + 1) : []),
    ]);
  return <ul>{rows(toc, 0)}</ul>;
}

export type SearchGroup = { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] };

/** Search in the book: every place the words appear, grouped by chapter, each a key to go there. Nothing is kept. */
export function SearchBox({
  onSearch,
  onGo,
  groups,
  searching,
  searched,
}: {
  onSearch: (query: string) => void;
  onGo: (cfi: string) => void;
  groups: readonly SearchGroup[];
  searching: number | null;
  searched: string;
}) {
  const [query, setQuery] = useState(searched);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length >= 2) onSearch(query.trim());
  };
  const found = groups.reduce((sum, group) => sum + group.subitems.length, 0);
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-1">
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" maxLength={100} aria-label="Words to find in the book" placeholder="WORDS" className={`${FIELD_TIGHT} min-w-0 flex-1`} autoFocus />
        <button type="submit" className={PLATE_MAIN}>
          FIND
        </button>
      </form>
      {searching !== null ? <p className="text-label" role="status">SEARCHING... {Math.floor(searching * 100)}%</p> : null}
      {searching === null && searched ? <p className="text-label" role="status">{found === 0 ? 'NOT FOUND.' : `${found} FOUND`}</p> : null}
      {groups.map((group, index) => (
        <section key={`${index}-${group.label}`}>
          <h3 className="pt-1 text-label text-ink-quiet">{group.label.trim() || 'CHAPTER'}</h3>
          <ul>
            {group.subitems.slice(0, 100).map((hit) => (
              <li key={hit.cfi} className="rule-pixel">
                <button type="button" onClick={() => onGo(hit.cfi)} className="block w-full break-words py-1 text-left text-label hover:bg-pointed">
                  {hit.excerpt.pre}
                  <mark className="bg-sun text-ink-plate">{hit.excerpt.match}</mark>
                  {hit.excerpt.post}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Your bookmarks in this book: + BOOKMARK for the page you're on, then each one's GO TO and DELETE. */
export function BookmarkList({
  signedIn,
  bookmarks,
  onAdd,
  onGo,
  onRemove,
}: {
  signedIn: boolean;
  bookmarks: readonly BookBookmark[];
  onAdd: () => void;
  onGo: (cfi: string) => void;
  onRemove: (bookmark: BookBookmark) => void;
}) {
  if (!signedIn) return <p className="text-label">LOG IN TO KEEP BOOKMARKS.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p>
        <button type="button" onClick={onAdd} className={PLATE_MAIN}>
          + BOOKMARK THIS PAGE
        </button>
      </p>
      {bookmarks.length === 0 ? <p className="text-label">NO BOOKMARKS YET.</p> : null}
      <ul>
        {bookmarks.map((bookmark) => (
          <li key={bookmark.id} className="rule-pixel flex flex-wrap items-center gap-1 py-1">
            <span className="min-w-0 flex-1 break-words text-label">{bookmark.label || 'BOOKMARK'}</span>
            <button type="button" onClick={() => onGo(bookmark.cfi)} className={PLATE}>
              [ GO TO ]
            </button>
            <button type="button" onClick={() => onRemove(bookmark)} className={PLATE}>
              [ DELETE ]
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Your highlights in this book: the words, your comment, when, the colour, and GO TO, the lock, DELETE and + LETTER. */
export function HighlightList({
  signedIn,
  highlights,
  onGo,
  onLock,
  onRemove,
}: {
  signedIn: boolean;
  highlights: readonly BookHighlight[];
  onGo: (highlight: BookHighlight) => void;
  onLock: (highlight: BookHighlight) => void;
  onRemove: (highlight: BookHighlight) => void;
}) {
  if (!signedIn) return <p className="text-label">LOG IN TO HIGHLIGHT.</p>;
  if (highlights.length === 0) return <p className="text-label">NO HIGHLIGHTS IN THIS BOOK YET.</p>;
  return (
    <ul>
      {highlights.map((highlight) => (
        <li key={highlight.id} className="rule-pixel py-1.5">
          <p className="flex gap-1.5">
            <span aria-hidden="true" className={`frame mt-0.5 h-3 w-3 shrink-0 ${SWATCH[highlight.colour]}`} />
            <span className="min-w-0 break-words text-label">&quot;{highlight.quote}&quot;</span>
          </p>
          {highlight.comment ? <p className="break-words pl-4.5 text-label text-ink-quiet">{highlight.comment}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-1 pl-4">
            <time className="text-label text-ink-quiet" dateTime={highlight.createdAt}>
              {highlight.createdAt.slice(0, 16).replace('T', ' ')}
            </time>
            <button type="button" onClick={() => onGo(highlight)} disabled={!highlight.cfi} className={PLATE}>
              [ GO TO ]
            </button>
            <button type="button" onClick={() => onLock(highlight)} aria-pressed={highlight.isLocked} className={PLATE}>
              {highlight.isLocked ? '[ 🔒 PRIVATE ]' : '[ 🔓 POSTED ]'}
            </button>
            <button type="button" onClick={() => onRemove(highlight)} className={PLATE}>
              [ DELETE ]
            </button>
            <AddToLetterKey thing={{ kind: 'highlight', ref: highlightRef(highlight), title: highlight.quote.slice(0, 120) }} />
          </p>
        </li>
      ))}
    </ul>
  );
}

const PAPER_NAMES: Record<ReaderSettings['paper'], string> = { light: 'LIGHT', dark: 'DARK', sepia: 'SEPIA' };
const PAPER_SAMPLE: Record<ReaderSettings['paper'], string> = {
  light: 'bg-reader-light-paper text-reader-light-ink',
  dark: 'bg-reader-dark-paper text-reader-dark-ink',
  sepia: 'bg-reader-sepia-paper text-reader-sepia-ink',
};
const FONT_NAMES: Record<ReaderSettings['font'], string> = { site: 'SITE', typewriter: 'TYPEWRITER', book: "BOOK'S OWN" };
const MARGIN_NAMES: Record<ReaderSettings['margin'], string> = { narrow: 'NARROW', normal: 'MEDIUM', wide: 'WIDE' };

/** LOOK: text size, line spacing, margins, font and paper, remembered for every book. */
export function LookSettings({ settings, onChange }: { settings: ReaderSettings; onChange: (next: ReaderSettings) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label="TEXT SIZE"
        value={`${settings.size}%`}
        onLess={() => onChange(nudge(settings, 'size', -1))}
        onMore={() => onChange(nudge(settings, 'size', 1))}
        lessOff={settings.size <= SIZE_MIN}
        moreOff={settings.size >= SIZE_MAX}
        lessGlyph="A-"
        moreGlyph="A+"
      />
      <Stepper
        label="LINE SPACING"
        value={settings.spacing.toFixed(1)}
        onLess={() => onChange(nudge(settings, 'spacing', -1))}
        onMore={() => onChange(nudge(settings, 'spacing', 1))}
        lessOff={settings.spacing <= SPACING_MIN}
        moreOff={settings.spacing >= SPACING_MAX}
        lessGlyph="−"
        moreGlyph="+"
      />
      <Choice label="MARGINS" options={MARGINS} names={MARGIN_NAMES} value={settings.margin} onPick={(margin) => onChange({ ...settings, margin })} />
      <Choice label="FONT" options={READER_FONTS} names={FONT_NAMES} value={settings.font} onPick={(font) => onChange({ ...settings, font })} />
      <fieldset>
        <legend className="pb-1 text-label text-ink-quiet">PAPER</legend>
        <p className="flex flex-wrap gap-2">
          {PAPERS.map((paper) => (
            <button
              key={paper}
              type="button"
              onClick={() => onChange({ ...settings, paper })}
              aria-pressed={settings.paper === paper}
              className={`frame min-h-tap px-3 py-2 text-key ${PAPER_SAMPLE[paper]} ${settings.paper === paper ? 'outline-2 outline-offset-2 outline-accent-ink' : ''}`}
            >
              {settings.paper === paper ? '● ' : ''}
              {PAPER_NAMES[paper]}
            </button>
          ))}
        </p>
      </fieldset>
    </div>
  );
}

function Stepper({
  label,
  value,
  onLess,
  onMore,
  lessOff,
  moreOff,
  lessGlyph,
  moreGlyph,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  lessOff: boolean;
  moreOff: boolean;
  lessGlyph: string;
  moreGlyph: string;
}) {
  return (
    <div>
      <p className="pb-1 text-label text-ink-quiet">{label}</p>
      <p className="flex items-center gap-2">
        <button type="button" onClick={onLess} disabled={lessOff} className={PLATE} aria-label={`${label.toLowerCase()} smaller`}>
          [ {lessGlyph} ]
        </button>
        <span className="min-w-12 text-center text-key" aria-live="polite">
          {value}
        </span>
        <button type="button" onClick={onMore} disabled={moreOff} className={PLATE} aria-label={`${label.toLowerCase()} bigger`}>
          [ {moreGlyph} ]
        </button>
      </p>
    </div>
  );
}

function Choice<T extends string>({ label, options, names, value, onPick }: { label: string; options: readonly T[]; names: Record<T, string>; value: T; onPick: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="pb-1 text-label text-ink-quiet">{label}</legend>
      <p className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onPick(option)} aria-pressed={value === option} className={value === option ? PLATE_PRESSED : PLATE}>
            {value === option ? names[option] : `[ ${names[option]} ]`}
          </button>
        ))}
      </p>
    </fieldset>
  );
}
