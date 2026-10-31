'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  RECENT_STORAGE_KEY,
  SEARCH_FILTERS,
  activeToken,
  dayKey,
  formatFilter,
  formatSearch,
  isDateFilter,
  isSearchEmpty,
  monthGrid,
  parseRecent,
  parseSearch,
  pushRecent,
  suggestValues,
  takeFinishedFilters,
  type ParsedSearch,
  type SearchFilter,
  type SearchFilterKey,
  type SuggestContext,
} from '../lib/forum/board-search';
import { PLATE } from '../lib/ui/controls';

/**
 * The board's search box (SPEC-forum-search.md, part 2): Discord's behaviour in the site's look.
 *
 * Typing opens an autofill list under the box. With nothing typed it offers every filter (SEARCH
 * OPTIONS) and the last five searches (RECENT SEARCHES, this browser only). Picking a filter writes
 * `from:` into the box and the list turns into that filter's suggestions; a date filter gets a month
 * calendar. A finished filter becomes a pill (`FROM: shade ×`): a space after it, a pick, or running
 * the search makes it one. Backspace at the start of the box takes the last pill off whole.
 *
 * Keys: Up/Down move through the list, Enter or Tab picks, Enter with nothing picked runs the search,
 * Esc closes the list and a second Esc clears the box.
 *
 * All matching lives in app/lib/forum/board-search.ts; this only edits text and hands the search over.
 */

type ForumSearchBoxProps = SuggestContext & {
  /** True while a search is showing, so taking a pill off runs what is left. */
  running: boolean;
  onRun: (search: ParsedSearch) => void;
  onClear: () => void;
  /** The box took focus (the board folds its sort panel away). */
  onFocus?: () => void;
};

type Item =
  | { kind: 'filter'; key: SearchFilterKey; example: string }
  | { kind: 'value'; key: SearchFilterKey; value: string; label: string; note?: string }
  | { kind: 'recent'; search: string };

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const LIST_ID = 'forum-search-list';
const optionId = (index: number) => `forum-search-option-${index}`;

function readRecent(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_STORAGE_KEY));
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // A browser that refuses storage still searches; it just forgets.
  }
}

export default function ForumSearchBox({ threads, directory, tagVocabulary, running, onRun, onClear, onFocus }: ForumSearchBoxProps) {
  const [pills, setPills] = useState<SearchFilter[]>([]);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Recent searches are this browser's: read once, in a frame, after the first draw.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRecent(readRecent()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // A press anywhere outside the box closes the list (the box keeps what was typed).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const active = activeToken(text, caret);
  const context = useMemo(() => ({ threads, directory, tagVocabulary }), [threads, directory, tagVocabulary]);
  const calendar = active.key !== null && isDateFilter(active.key);

  const items: Item[] = useMemo(() => {
    if (active.key !== null) {
      if (isDateFilter(active.key)) return [];
      const key = active.key;
      return suggestValues(key, active.partial, context)
        .slice(0, 8)
        .map((suggestion) => ({ kind: 'value' as const, key, ...suggestion }));
    }

    const typed = active.partial.toLowerCase();
    const filters: Item[] = SEARCH_FILTERS.filter((filter) => filter.key.startsWith(typed)).map((filter) => ({ kind: 'filter' as const, ...filter }));
    if (typed.length > 0) return filters;

    return [...filters, ...recent.map((search) => ({ kind: 'recent' as const, search }))];
  }, [active.key, active.partial, context, recent]);

  const showList = open && (items.length > 0 || calendar);

  /**
   * Puts the caret where it should be once React has drawn `forText` - and only if the box still says
   * that: a fast typist's next letter may land before the frame does, and moving the caret then would
   * put the rest of the word in front of it.
   */
  const placeCaret = useCallback((at: number, forText: string) => {
    setCaret(at);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input === null) return;
      input.focus();
      if (input.value === forText) input.setSelectionRange(at, at);
    });
  }, []);

  /** A value's list highlights its first suggestion, so Enter takes it; everything else starts unpicked. */
  const resetHighlight = (nextText: string, nextCaret: number) => {
    const token = activeToken(nextText, nextCaret);
    setHighlight(token.key !== null && !isDateFilter(token.key) ? 0 : -1);
  };

  const run = useCallback(
    (nextPills: SearchFilter[], nextText: string) => {
      const finished = takeFinishedFilters(nextText, true);
      const allPills = [...nextPills, ...finished.filters];
      const search: ParsedSearch = { filters: allPills, terms: parseSearch(finished.rest).terms };

      setPills(allPills);
      setText(finished.rest);
      placeCaret(finished.rest.length, finished.rest);
      setOpen(false);
      setHighlight(-1);

      if (isSearchEmpty(search)) {
        onClear();
        return;
      }

      const next = pushRecent(readRecent(), formatSearch(search));
      setRecent(next);
      saveRecent(next);
      onRun(search);
    },
    [onClear, onRun, placeCaret],
  );

  /** Turns the token under the caret into a pill. */
  const pillFromActive = (key: SearchFilterKey, value: string) => {
    const rest = `${text.slice(0, active.start)}${text.slice(active.end)}`.replace(/\s+/g, ' ').trimStart();
    setPills((current) => [...current, { key, value }]);
    setText(rest);
    placeCaret(Math.min(active.start, rest.length), rest);
    setHighlight(-1);
  };

  const pick = (item: Item) => {
    if (item.kind === 'filter') {
      const written = `${item.key}:`;
      const next = `${text.slice(0, active.start)}${written}${text.slice(active.end)}`;
      setText(next);
      placeCaret(active.start + written.length, next);
      resetHighlight(next, active.start + written.length);
      setOpen(true);
      return;
    }

    if (item.kind === 'value') {
      pillFromActive(item.key, item.value);
      return;
    }

    const finished = takeFinishedFilters(item.search, true);
    run(finished.filters, finished.rest);
  };

  const removePill = (index: number) => {
    const next = pills.filter((_pill, at) => at !== index);
    setPills(next);
    if (running) run(next, text);
    // The words are unchanged, so only the focus comes back (now, not a frame later: a caret placed late
    // lands in the middle of whatever was typed since).
    else inputRef.current?.focus();
  };

  const clearAll = () => {
    setPills([]);
    setText('');
    placeCaret(0, '');
    setOpen(false);
    onClear();
  };

  const onChange = (value: string, at: number) => {
    // A filter followed by a space is finished: it becomes a pill.
    const finished = takeFinishedFilters(value, false);
    if (finished.filters.length > 0) {
      const rest = finished.rest.length > 0 && /\s$/.test(value) ? `${finished.rest} ` : finished.rest;
      setPills((current) => [...current, ...finished.filters]);
      setText(rest);
      placeCaret(rest.length, rest);
      resetHighlight(rest, rest.length);
    } else {
      setText(value);
      setCaret(at);
      resetHighlight(value, at);
    }
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showList) {
        setOpen(true);
        return;
      }
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + step + items.length + (current === -1 && step === -1 ? 1 : 0)) % items.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (showList && highlight >= 0 && highlight < items.length) pick(items[highlight]);
      else run(pills, text);
      return;
    }

    if (event.key === 'Tab' && showList && items.length > 0 && highlight >= 0) {
      event.preventDefault();
      pick(items[highlight]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      // Kept from the board's own ESC (which folds its panels away).
      event.stopPropagation();
      if (showList) setOpen(false);
      else clearAll();
      return;
    }

    if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && pills.length > 0) {
      event.preventDefault();
      removePill(pills.length - 1);
    }
  };

  const recentStart = items.findIndex((item) => item.kind === 'recent');
  const today = dayKey(new Date());

  const row = (item: Item, index: number, content: ReactNode, extra?: ReactNode) => (
    <li
      key={`${item.kind}-${index}`}
      id={optionId(index)}
      role="option"
      aria-selected={highlight === index}
      onMouseDown={(event) => event.preventDefault()}
      // A move, not an enter: a list redrawn under a still pointer must not pick a row by itself.
      onMouseMove={() => setHighlight(index)}
      onClick={() => pick(item)}
      className={`flex cursor-pointer items-center justify-between gap-2 px-1 py-0.5 text-label max-sm:min-h-tap ${
        highlight === index ? 'bg-ink text-paper' : 'text-ink'
      }`}
    >
      <span className="min-w-0 break-words">{content}</span>
      {extra}
    </li>
  );

  return (
    <div ref={boxRef} className="relative min-w-0 max-sm:basis-full sm:min-w-64 sm:flex-1">
      {/* The box: pills, then the words being typed. Pressing anywhere in it lands in the words. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="frame flex min-h-tap flex-wrap items-center gap-1 bg-paper px-1 py-0.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-dotted focus-within:outline-bubble sm:min-h-0"
      >
        {pills.map((pill, index) => (
          <span key={`${formatFilter(pill)}-${index}`} className="inline-flex items-center gap-1 bg-ink pl-1 text-label text-paper">
            {`${pill.key.toUpperCase()}: ${pill.value}`}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removePill(index);
              }}
              aria-label={`Remove ${formatFilter(pill)}`}
              className="cursor-pointer px-1 text-label text-paper max-sm:min-h-tap max-sm:min-w-tap"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search the board"
          aria-expanded={showList}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={showList && highlight >= 0 ? optionId(highlight) : undefined}
          value={text}
          placeholder={pills.length === 0 ? 'SEARCH' : ''}
          onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          // A press on a box that already has focus (after an Esc) opens the list again.
          onClick={() => setOpen(true)}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          className="min-w-24 flex-1 bg-transparent py-0.5 font-mono text-prose text-ink outline-none"
        />
      </div>

      {showList ? (
        // Capped and scrolled inside itself, so on a phone the recent searches are not below the screen.
        <div className="absolute top-full right-0 left-0 z-menu mt-1 max-h-[60vh] overflow-y-auto frame max-sm:max-h-[45vh] bg-paper p-2">
          {calendar ? (
            <Calendar
              year={month.year}
              month={month.month}
              today={today}
              onMonth={(step) =>
                setMonth((current) => {
                  const date = new Date(current.year, current.month + step, 1);
                  return { year: date.getFullYear(), month: date.getMonth() };
                })
              }
              onPick={(day) => active.key !== null && pillFromActive(active.key, day)}
            />
          ) : null}

          <ul id={LIST_ID} role="listbox" aria-label="Search suggestions" className="space-y-0.5">
            {active.key === null && items.length > 0 && recentStart !== 0 ? (
              <li role="presentation" className="px-1 text-label text-accent-ink">
                SEARCH OPTIONS
              </li>
            ) : null}

            {items.map((item, index) => {
              if (item.kind === 'filter') {
                return row(
                  item,
                  index,
                  <>
                    <span className={highlight === index ? '' : 'text-accent-ink'}>{`${item.key}:`}</span> {item.example}
                  </>,
                );
              }

              if (item.kind === 'value') {
                return row(item, index, item.label, item.note ? <span>{item.note}</span> : null);
              }

              return (
                <RecentRow
                  key={`recent-${item.search}`}
                  first={index === recentStart}
                  onClearAll={() => {
                    setRecent([]);
                    saveRecent([]);
                  }}
                >
                  {row(
                    item,
                    index,
                    item.search,
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = recent.filter((entry) => entry !== item.search);
                        setRecent(next);
                        saveRecent(next);
                      }}
                      aria-label={`Remove recent search ${item.search}`}
                      className="cursor-pointer px-1 max-sm:min-h-tap max-sm:min-w-tap"
                    >
                      ×
                    </button>,
                  )}
                </RecentRow>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The RECENT SEARCHES heading (with its CLEAR) drawn above the first recent row. */
function RecentRow({ first, onClearAll, children }: { first: boolean; onClearAll: () => void; children: ReactNode }) {
  if (!first) return <>{children}</>;

  return (
    <>
      <li role="presentation" className="mt-1 flex items-center justify-between px-1 text-label text-accent-ink">
        RECENT SEARCHES
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClearAll} className={PLATE}>
          [ CLEAR ]
        </button>
      </li>
      {children}
    </>
  );
}

/** A month of days to pick from, like Discord's: before:, after: and during: take a day. */
function Calendar({
  year,
  month,
  today,
  onMonth,
  onPick,
}: {
  year: number;
  month: number;
  today: string;
  onMonth: (step: number) => void;
  onPick: (day: string) => void;
}) {
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    <div className="mb-2 w-fit" onMouseDown={(event) => event.preventDefault()}>
      <div className="flex items-center justify-between gap-2 text-label text-ink">
        <button type="button" onClick={() => onMonth(-1)} aria-label="Previous month" className={PLATE}>
          [ ◂ ]
        </button>
        <span>{`${MONTHS[month]} ${year}`}</span>
        <button type="button" onClick={() => onMonth(1)} aria-label="Next month" className={PLATE}>
          [ ▸ ]
        </button>
      </div>

      <table className="mt-1 border-collapse text-label text-ink">
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="px-0.5 font-normal">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(year, month).map((week, row) => (
            <tr key={row}>
              {week.map((day, column) => {
                if (day === null) return <td key={column} />;
                const value = `${year}-${pad(month + 1)}-${pad(day)}`;

                return (
                  <td key={column} className="p-0 text-center">
                    <button
                      type="button"
                      onClick={() => onPick(value)}
                      aria-label={value}
                      className={`w-8 cursor-pointer py-0.5 text-label hover:bg-ink hover:text-paper max-sm:min-h-tap max-sm:w-11 ${
                        value === today ? 'text-accent-ink underline' : 'text-ink'
                      }`}
                    >
                      {day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-1 text-label text-ink">OR TYPE 2026-10-31</p>
    </div>
  );
}
