'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { LAYOUTS, MARGINS, nudge, PAGE_COUNTS, PAPERS, READER_FONTS, SIZE_MAX, SIZE_MIN, SIZE_STEP, SPACING_MAX, SPACING_MIN, type ReaderSettings } from '../../lib/books/reader-look';
import type { SearchExcerpt, TocItem } from '../../lib/books/reader-engine';
import { highlightRef, type BookBookmark, type BookHighlight } from '../../lib/books/types';
import { copyName, pageOfCfi } from '../../lib/books/copies';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import { explain, explainFrom, NOTE, type Explanation } from '../../lib/ui/explain';
import AddToLetterKey from '../AddToLetterKey';
import { SWATCH } from './HighlightBar';

export type PanelName = 'contents' | 'search' | 'bookmarks' | 'highlights' | 'look';

/**
 * One of the reader's side panels (SPEC-reader.md): a drawer at the right on a wide screen, a sheet from the foot on an
 * upright one. By orientation, not width: a phone is shown the site 1280px wide and shrunk (`app/layout.tsx`), so a width
 * rule would never see one. Laid over the page so the book never reflows under it.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="frame absolute z-20 flex flex-col bg-sun-pale text-ink portrait:inset-x-0 portrait:bottom-0 portrait:max-h-[45%] landscape:bottom-2 landscape:right-2 landscape:top-2 landscape:w-[24rem] landscape:max-w-[calc(100%-1rem)]"
    >
      <div className="flex items-center gap-2 px-2 pt-1">
        <h2 className={`${TITLE_BAR} min-w-0 flex-1`}>{title}</h2>
        <button type="button" onClick={onClose} className={PLATE} aria-label={`Close ${title.toLowerCase()}`} {...explain('Closes this panel, so the whole page of the book shows again.', 'The panel lies over the page and the book never moves under it. Esc closes it too, and its key on the top row opens it again.')}>
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
            {...explain('Goes to the start of this chapter or section of the book.', "The list is the book's own contents; the one marked with an arrow is where you are now. On an upright screen the panel closes so the page shows.")}
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
        <button type="submit" className={PLATE_MAIN} {...explain('Searches the whole book for the words typed, and lists every place they appear, chapter by chapter.', 'Needs at least two characters. In a book whose words reflow (an EPUB), the matches are outlined on the page too. Nothing about the search is saved.')}>
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
                <button type="button" onClick={() => onGo(hit.cfi)} className="block w-full break-words py-1 text-left text-label hover:bg-pointed" {...explain('Goes to this place in the book, where the words you searched for appear.', 'The row shows the words around the match. A chapter lists its first 100 matches.')}>
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
        <button type="button" onClick={onAdd} className={PLATE_MAIN} {...explain('Keeps a bookmark at the page you are on, named by its chapter and how far through the book it is.', 'Bookmarks are saved to your account, for this copy of the book, and only you see them. A page already bookmarked is not added twice.')}>
          + BOOKMARK THIS PAGE
        </button>
      </p>
      {bookmarks.length === 0 ? <p className="text-label">NO BOOKMARKS YET.</p> : null}
      <ul>
        {bookmarks.map((bookmark) => (
          <li key={bookmark.id} className="rule-pixel flex flex-wrap items-center gap-1 py-1">
            <span className="min-w-0 flex-1 break-words text-label">{bookmark.label || 'BOOKMARK'}</span>
            <button type="button" onClick={() => onGo(bookmark.cfi)} className={PLATE} {...explain('Turns the book to the page this bookmark was made on.', 'Your reading place moves there too, as with any page turn.')}>
              [ GO TO ]
            </button>
            <button type="button" onClick={() => onRemove(bookmark)} className={PLATE} {...explain('Deletes this bookmark from your account, at once.', 'Only the bookmark goes; the book and your place in it are untouched.', `NO QUESTION IS ASKED. ${NOTE.undo}`)}>
              [ DELETE ]
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Your highlights in this book: the words, your comment, when, the colour, and GO TO, the lock, DELETE and + LETTER. */
/**
 * The highlights panel: yours in every copy of this book, then other readers' public ones (Luke, 2026-11-13). One made in
 * another copy goes to where its words were found in this one; when they weren't (a scan with no words, or different
 * wording), it says FROM ANOTHER COPY, with its quote and where it was, instead of being lost.
 */
export function HighlightList({
  signedIn,
  me,
  bookRef,
  highlights,
  findable,
  onGo,
  onLock,
  onRemove,
}: {
  signedIn: boolean;
  me: string | null;
  bookRef: string;
  highlights: readonly BookHighlight[];
  /** The highlights there is a place to go to in this copy: their own, or one found by its words. */
  findable: ReadonlySet<string>;
  onGo: (highlight: BookHighlight) => void;
  onLock: (highlight: BookHighlight) => void;
  onRemove: (highlight: BookHighlight) => void;
}) {
  if (!signedIn) return <p className="text-label">LOG IN TO HIGHLIGHT.</p>;
  if (highlights.length === 0) return <p className="text-label">NO HIGHLIGHTS IN THIS BOOK YET.</p>;
  return (
    <ul>
      {highlights.map((highlight) => {
        const mine = highlight.person === me;
        const elsewhere = highlight.bookRef !== bookRef;
        const lost = elsewhere && !findable.has(highlight.id);
        const page = pageOfCfi(highlight.cfi);
        const where = lost ? `FROM ANOTHER COPY: ${copyName(highlight.bookRef)}${page !== null ? `, PAGE ${page + 1}` : ''}` : elsewhere ? 'FOUND FROM ANOTHER COPY' : '';
        const about = [mine ? '' : "A READER'S", where].filter(Boolean).join(' · ');
        return (
          <li key={highlight.id} className="rule-pixel py-1.5" data-highlight={highlight.id} data-from-another-copy={lost ? 'true' : undefined}>
            {about ? <p className="text-label text-ink-quiet">{about}</p> : null}
            <p className="flex gap-1.5">
              <span aria-hidden="true" className={`frame mt-0.5 h-3 w-3 shrink-0 ${SWATCH[highlight.colour]}`} />
              <span className="min-w-0 break-words text-label">&quot;{highlight.quote}&quot;</span>
            </p>
            {highlight.comment ? <p className="break-words pl-4.5 text-label text-ink-quiet">{highlight.comment}</p> : null}
            <p className="mt-1 flex flex-wrap items-center gap-1 pl-4">
              <time className="text-label text-ink-quiet" dateTime={highlight.createdAt}>
                {highlight.createdAt.slice(0, 16).replace('T', ' ')}
              </time>
              <button
                type="button"
                onClick={() => onGo(highlight)}
                disabled={!findable.has(highlight.id)}
                className={PLATE}
                {...explain(
                  'Turns the book to where these highlighted words are.',
                  'A highlight made in another copy of the book goes to where its words were found in this one. The key is off when they were not found here (FROM ANOTHER COPY).',
                )}
              >
                [ GO TO ]
              </button>
              {mine ? (
                <>
                  <button
                    type="button"
                    onClick={() => onLock(highlight)}
                    aria-pressed={highlight.isLocked}
                    className={PLATE}
                    {...(highlight.isLocked
                      ? explain('Unlocks this highlight: it is posted in your own reading thread for this book on the forum.', 'PRIVATE means only you see it. Press when you want other people to read it.', NOTE.others)
                      : explain('Makes this highlight private: its post in your reading thread on the forum is taken down, and only you see it.', 'POSTED means other readers can see it, here and on the forum. The highlight itself stays in the book either way.'))}
                  >
                    {highlight.isLocked ? '[ 🔒 PRIVATE ]' : '[ 🔓 POSTED ]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(highlight)}
                    className={PLATE}
                    {...explain('Deletes this highlight from the book, and its post on the forum with it.', 'To hide it from other people but keep it, make it PRIVATE instead.', `${NOTE.asks} ${NOTE.undo}`)}
                  >
                    [ DELETE ]
                  </button>
                  <AddToLetterKey thing={{ kind: 'highlight', ref: highlightRef(highlight), title: highlight.quote.slice(0, 120) }} />
                </>
              ) : null}
            </p>
          </li>
        );
      })}
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

const LAYOUT_NAMES: Record<ReaderSettings['layout'], string> = { standard: 'STANDARD', comic: 'COMIC', verse: 'VERSE' };
const PAGE_NAMES: Record<ReaderSettings['pages'], string> = { two: 'TWO PAGES', one: 'ONE PAGE' };

/** What every LOOK key ends with: where the choice is kept. */
const LOOK_KEPT = 'Kept for every book: in this browser, and on your account when you are signed in.';

/** EXPLAIN's words for each LOOK choice, beside the names above. */
const LAYOUT_WORDS: Record<ReaderSettings['layout'], Explanation> = {
  standard: { what: 'Lays the book out as ordinary prose: columns of text with margins at the sides.', why: `For novels and most books. In a book whose words reflow (an EPUB) the width of the margins is picked lower in this panel; on a PDF each page is shown as large as fits. ${LOOK_KEPT}` },
  comic: { what: 'Lays the book out for pictures: no margins, and each picture as large as the page allows.', why: `For comics and graphic novels. On a PDF each page is shown as large as fits. ${LOOK_KEPT}` },
  verse: { what: 'Lays the book out for lines that must not be rejoined: a narrow column, wide margins, no hyphenation and line breaks kept.', why: `For poems, plays and scripts. A PDF's pages are shown as wide as the reading area. ${LOOK_KEPT}` },
};
const PAGE_WORDS: Record<ReaderSettings['pages'], Explanation> = {
  two: { what: 'Shows two pages side by side, like an open book, when the screen is wide enough.', why: `A PDF is opened again at the same page to change this. ${LOOK_KEPT}` },
  one: { what: 'Shows one page at a time.', why: `For a narrow window, or to read a single column. A PDF is opened again at the same page to change this. ${LOOK_KEPT}` },
};
const MARGIN_WORDS: Record<ReaderSettings['margin'], Explanation> = {
  narrow: { what: 'Sets narrow margins: the widest columns of text, with the least empty space around them.', why: `Only the STANDARD layout follows this; COMIC and VERSE have margins of their own. ${LOOK_KEPT}` },
  normal: { what: 'Sets medium margins: the usual column width and space around the text.', why: `Only the STANDARD layout follows this; COMIC and VERSE have margins of their own. ${LOOK_KEPT}` },
  wide: { what: 'Sets wide margins: narrower columns of text with more empty space around them.', why: `Only the STANDARD layout follows this; COMIC and VERSE have margins of their own. ${LOOK_KEPT}` },
};
const FONT_WORDS: Record<ReaderSettings['font'], Explanation> = {
  site: { what: "Sets the book's text in the site's own typeface.", why: `The book then reads like the rest of DEBASER. ${LOOK_KEPT}` },
  typewriter: { what: "Sets the book's text in a typewriter typeface (Courier).", why: `Every letter is the same width, as in a typescript. ${LOOK_KEPT}` },
  book: { what: 'Leaves the text in the typefaces the book itself came with.', why: `For a book whose own design matters, or when the other two read badly. ${LOOK_KEPT}` },
};
const PAPER_WORDS: Record<ReaderSettings['paper'], Explanation> = {
  light: { what: 'Reads on light paper: dark words on a pale page.', why: `The key is drawn in the paper's own colours. ${LOOK_KEPT}` },
  dark: { what: 'Reads on dark paper: light words on a dark page.', why: `Easier in a dark room. The key is drawn in the paper's own colours. ${LOOK_KEPT}` },
  sepia: { what: 'Reads on sepia paper: brown words on a warm, yellowed page.', why: `Softer than white for long reading. The key is drawn in the paper's own colours. ${LOOK_KEPT}` },
};

/**
 * LOOK: the layout (STANDARD, COMIC for graphic novels, VERSE for poems and plays), one page or two, text size, line
 * spacing, margins, font and paper, remembered for every book. A PDF's pages are fixed pictures of the page: only the
 * layout, the page count and the paper around them apply there.
 */
export function LookSettings({ settings, onChange, fixedPages = false }: { settings: ReaderSettings; onChange: (next: ReaderSettings) => void; fixedPages?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Choice label="LAYOUT" options={LAYOUTS} names={LAYOUT_NAMES} words={LAYOUT_WORDS} value={settings.layout} onPick={(layout) => onChange({ ...settings, layout })} />
      <Choice label="PAGES" options={PAGE_COUNTS} names={PAGE_NAMES} words={PAGE_WORDS} value={settings.pages} onPick={(pages) => onChange({ ...settings, pages })} />
      {fixedPages ? null : <TextSettings settings={settings} onChange={onChange} />}
      <PaperChoice settings={settings} onChange={onChange} />
    </div>
  );
}

function TextSettings({ settings, onChange }: { settings: ReaderSettings; onChange: (next: ReaderSettings) => void }) {
  return (
    <>
      <Stepper
        label="TEXT SIZE"
        value={`${settings.size}%`}
        onLess={() => onChange(nudge(settings, 'size', -1))}
        onMore={() => onChange(nudge(settings, 'size', 1))}
        lessOff={settings.size <= SIZE_MIN}
        moreOff={settings.size >= SIZE_MAX}
        lessGlyph="A-"
        moreGlyph="A+"
        lessWords={{ what: `Makes the book's text one step smaller (${SIZE_STEP}% at a time, down to ${SIZE_MIN}%).`, why: `More words fit on a page. The key is off at the smallest size. ${LOOK_KEPT}` }}
        moreWords={{ what: `Makes the book's text one step bigger (${SIZE_STEP}% at a time, up to ${SIZE_MAX}%).`, why: `Easier to read from further away. The key is off at the biggest size. ${LOOK_KEPT}` }}
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
        lessWords={{ what: `Brings the lines of text one step closer together (down to ${SPACING_MIN.toFixed(1)}).`, why: `More lines fit on a page. The key is off at the tightest spacing. ${LOOK_KEPT}` }}
        moreWords={{ what: `Sets the lines of text one step further apart (up to ${SPACING_MAX.toFixed(1)}).`, why: `Airier lines are easier to follow. The key is off at the widest spacing. ${LOOK_KEPT}` }}
      />
      <Choice label="MARGINS" options={MARGINS} names={MARGIN_NAMES} words={MARGIN_WORDS} value={settings.margin} onPick={(margin) => onChange({ ...settings, margin })} />
      <Choice label="FONT" options={READER_FONTS} names={FONT_NAMES} words={FONT_WORDS} value={settings.font} onPick={(font) => onChange({ ...settings, font })} />
    </>
  );
}

function PaperChoice({ settings, onChange }: { settings: ReaderSettings; onChange: (next: ReaderSettings) => void }) {
  return (
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
              {...explainFrom(PAPER_WORDS[paper])}
            >
              {settings.paper === paper ? '● ' : ''}
              {PAPER_NAMES[paper]}
            </button>
          ))}
        </p>
      </fieldset>
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
  lessWords,
  moreWords,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  lessOff: boolean;
  moreOff: boolean;
  lessGlyph: string;
  moreGlyph: string;
  /** EXPLAIN's words for the two keys, from the caller (the same two keys step the text size and the line spacing). */
  lessWords: Explanation;
  moreWords: Explanation;
}) {
  return (
    <div>
      <p className="pb-1 text-label text-ink-quiet">{label}</p>
      <p className="flex items-center gap-2">
        <button type="button" onClick={onLess} disabled={lessOff} className={PLATE} aria-label={`${label.toLowerCase()} smaller`} {...explainFrom(lessWords)}>
          [ {lessGlyph} ]
        </button>
        <span className="min-w-12 text-center text-key" aria-live="polite">
          {value}
        </span>
        <button type="button" onClick={onMore} disabled={moreOff} className={PLATE} aria-label={`${label.toLowerCase()} bigger`} {...explainFrom(moreWords)}>
          [ {moreGlyph} ]
        </button>
      </p>
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  names,
  words,
  value,
  onPick,
}: {
  label: string;
  options: readonly T[];
  names: Record<T, string>;
  /** EXPLAIN's words for each option, from the caller. */
  words: Record<T, Explanation>;
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="pb-1 text-label text-ink-quiet">{label}</legend>
      <p className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onPick(option)} aria-pressed={value === option} className={value === option ? PLATE_PRESSED : PLATE} {...explainFrom(words[option])}>
            {value === option ? names[option] : `[ ${names[option]} ]`}
          </button>
        ))}
      </p>
    </fieldset>
  );
}
