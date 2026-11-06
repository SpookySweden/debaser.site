'use client';

import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { sourceLabel, suggest, type StationIndex } from '../lib/tag-station/query';
import { wordKey } from '../lib/tag-station/words';
import { looksLikeLink, MAX_LINK_LENGTH } from '../lib/web/link-shape';
import { FIELD } from '../lib/ui/controls';
import { STATION_RING } from './TagStationParts';

type Choice =
  | { key: string; kind: 'link'; link: string; label: string }
  | { key: string; kind: 'tag'; name: string; label: string; detail: string }
  | { key: string; kind: 'item'; id: string; label: string; detail: string };

/** A word nothing on the map spells: looked up in the catalogue when it's chosen. */
function lookIn(word: string, onMap: readonly string[]): Choice[] {
  if (word.length < 3 || onMap.some((name) => wordKey(name) === wordKey(word))) return [];
  return [{ key: `look:${word}`, kind: 'tag', name: word, label: word, detail: 'LOOK IN THE CATALOGUE' }];
}

/**
 * The one box at the top (SPEC-tag-station.md): a word, an item's name or a pasted link. It works out which and offers each,
 * forgiving typos. A combobox: arrow keys move through the offers, Enter takes one, Escape closes the list.
 */
export default function TagStationSearch({
  index,
  inputRef,
  onTag,
  onItem,
  onLink,
}: {
  index: StationIndex;
  inputRef: RefObject<HTMLInputElement | null>;
  onTag: (name: string) => void;
  onItem: (id: string) => void;
  onLink: (link: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();

  const choices = useMemo<Choice[]>(() => {
    const typed = text.trim();
    if (typed.length === 0) return [];
    if (looksLikeLink(typed)) return [{ key: 'link', kind: 'link', link: typed, label: `USE THIS LINK: ${typed}` }];
    const found = suggest(index, typed);
    return [
      ...found.tags.map((tag): Choice => ({ key: `tag:${tag.name}`, kind: 'tag', name: tag.name, label: tag.name, detail: tag.count === 1 ? 'WORD · 1 ITEM' : `WORD · ${tag.count} ITEMS` })),
      ...found.items.map((item): Choice => ({ key: `item:${item.id}`, kind: 'item', id: item.id, label: item.title, detail: sourceLabel(item.platform) })),
      // The map shows 2,000 words and the catalogue holds far more: any other word is looked up when it's chosen.
      ...lookIn(text.trim().toLowerCase(), found.tags.map((tag) => tag.name)),
    ];
  }, [index, text]);

  const showing = open && choices.length > 0;
  const take = (choice: Choice) => {
    setOpen(false);
    setText('');
    if (choice.kind === 'link') onLink(choice.link);
    else if (choice.kind === 'tag') onTag(choice.name);
    else onItem(choice.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (choices.length === 0) return;
      setOpen(true);
      if (showing) setHighlight((at) => (at + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
    } else if (event.key === 'Enter') {
      const choice = choices[Math.min(highlight, choices.length - 1)];
      if (choice) {
        event.preventDefault();
        take(choice);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0 flex-1 basis-72">
      <label className="block text-label font-bold text-ink-quiet">
        WORD, ITEM OR LINK
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing ? `${listId}-${Math.min(highlight, choices.length - 1)}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_LINK_LENGTH}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={`${FIELD} min-h-tap`}
        />
      </label>
      {/* Over the page, so opening it never pushes anything down. */}
      <ul id={listId} role="listbox" aria-label="Suggestions" hidden={!showing} className="frame absolute inset-x-0 top-full z-menu max-h-96 overflow-y-auto bg-paper">
        {choices.map((choice, at) => {
          const on = at === Math.min(highlight, choices.length - 1);
          return (
            <li
              key={choice.key}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={on}
              // Before the field's blur, or the list closes under the press.
              onPointerDown={(event) => {
                event.preventDefault();
                take(choice);
              }}
              className={`flex min-h-tap cursor-pointer flex-wrap items-center gap-x-2 px-2 py-1 text-prose ${on ? `bg-ink text-paper ${STATION_RING}` : 'text-ink'}`}
            >
              <span className="min-w-0 break-words">{choice.label}</span>
              {choice.kind !== 'link' ? <span className={`text-label ${on ? 'text-paper' : 'text-ink-quiet'}`}>{choice.detail}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
