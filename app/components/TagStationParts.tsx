'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import type { StationIndex } from '../lib/tag-station/query';
import type { ItemWord, StationItem } from '../lib/tag-station/types';
import { eraOf } from '../lib/tag-station/words';
import { rowAddresses, type ExtraHosts } from '../lib/web/row-addresses';
import { PLATFORM_LABELS } from '../lib/web/types';
import SpriteSlot from './SpriteSlot';

/**
 * The small pieces every TAG STATION panel shares (SPEC-tag-station.md): keys at least 44px tall with a thick focus ring, word
 * chips marked with where a word came from, and item rows with their source named.
 */

/** A thick ring for the keyboard: Flavine on the dark windows, the quiet ink on the bright ones. */
export const STATION_RING = 'focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-ink-quiet';
const PRESS = 'active:translate-y-press active:bg-bubble active:text-ink-plate';

export const STATION_KEY = `key inline-flex min-h-tap cursor-pointer items-center px-1 py-1 text-label ${STATION_RING} ${PRESS} disabled:cursor-not-allowed`;
/** A switch that is on, or the view you are on: a filled pill in the field ink, so it never relies on colour alone. */
export const STATION_KEY_ON = `key key-fill key-on [--key-fill:var(--color-ink)] inline-flex min-h-tap cursor-pointer items-center px-1 py-1 text-label text-paper ${STATION_RING}`;

export function TitleLine({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="title-line text-accent-ink text-title font-bold">
      {children}
    </h2>
  );
}

/** A row of keys where one is on: strictness, the niche dial, how far out. */
export function KeyGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="text-label font-bold text-ink-quiet">{label}</span>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)} className={option.value === value ? STATION_KEY_ON : STATION_KEY}>
          {option.value === value ? option.label : `[ ${option.label} ]`}
        </button>
      ))}
    </div>
  );
}

/** Where a word came from, as letters as well as words: colour never works alone here. */
export function sourceLetters(word: Pick<ItemWord, 'claude' | 'platform'>): { letters: string; label: string } {
  if (word.claude && word.platform) return { letters: 'CP', label: "Claude's word and the platform's" };
  return word.claude ? { letters: 'C', label: "Claude's word" } : { letters: 'P', label: "the platform's own word" };
}

/** A word: press it to go there, `+` to add it to the recipe. `from` is its source when known. */
export function WordChip({
  word,
  from,
  letter,
  letterLabel,
  active,
  onPick,
  onAdd,
}: {
  word: string;
  from?: Pick<ItemWord, 'claude' | 'platform'>;
  /** A source that isn't Claude or the platform: L for a link's own word, T for its title. */
  letter?: string;
  letterLabel?: string;
  active?: boolean;
  onPick: (word: string) => void;
  onAdd: (word: string) => void;
}) {
  const source = from ? sourceLetters(from) : letter && letterLabel ? { letters: letter, label: letterLabel } : null;
  const era = eraOf(word) !== null;
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={() => onPick(word)}
        aria-pressed={active ?? false}
        aria-label={`Go to ${word}${source ? `, ${source.label}` : ''}${era ? ', an era' : ''}`}
        className={active ? STATION_KEY_ON : STATION_KEY}
      >
        {source ? <span className="mr-1 text-ink-quiet">{source.letters}</span> : null}
        {era ? <span className="mr-1 text-ink-quiet">E</span> : null}
        {word}
      </button>
      <button type="button" onClick={() => onAdd(word)} aria-label={`Add ${word} to the recipe`} className={STATION_KEY}>
        [ + ]
      </button>
    </span>
  );
}

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;

/** A hotlinked picture from the platform, in a fixed box so nothing moves when it arrives or fails. */
export function Thumb({ src, wide }: { src: string | null; wide?: boolean }) {
  const [failed, setFailed] = useState(false);
  const box = wide ? 'h-36 w-48' : 'h-12 w-16';
  return (
    <span className={`block shrink-0 overflow-hidden border border-ink-plate bg-paper ${box}`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked from the platform, never proxied (see WebStream).
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="block h-full w-full object-cover" />
      ) : (
        <SpriteSlot src={MISSING_THUMB_SRC} alt="" width={wide ? 192 : 64} height={wide ? 144 : 48} title="No picture" fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">{wide ? 'NO IMAGE' : ''}</span>} />
      )}
    </span>
  );
}

/** A search result nobody saved has no address here, so this finds it again through MEDIA's own search. */
export function FindInMedia({ item }: { item: Pick<StationItem, 'title'> }) {
  return (
    <Link href={`/media?q=${encodeURIComponent(item.title.slice(0, 100))}`} aria-label={`Find "${item.title}" in MEDIA`} className={STATION_KEY}>
      [ FIND IN MEDIA ]
    </Link>
  );
}

/** One item in a list: its name goes there, and its source is always named beside it. */
export function ItemRow({ item, note, extraHosts, onPick }: { item: StationItem; note?: string; extraHosts: ExtraHosts; onPick: (id: string) => void }) {
  const { link, thumb } = rowAddresses(item, extraHosts);
  const source = PLATFORM_LABELS[item.platform];
  const year = Number.isFinite(Date.parse(item.publishedAt)) ? ` · ${item.publishedAt.slice(0, 4)}` : '';
  return (
    <li className="rule-pixel flex items-start gap-2 py-2">
      <Thumb src={thumb} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onPick(item.id)} aria-label={`Go to ${item.title}`} className={`key block min-h-tap w-full cursor-pointer break-words px-1 py-1 text-left text-label ${STATION_RING} ${PRESS}`}>
          {item.title}
        </button>
        <p className="break-words px-1 text-label text-ink">
          {source} · {item.kind.toUpperCase()}
          {year}
          {item.creator ? ` · ${item.creator}` : ''}
        </p>
        {note ? <p className="break-words px-1 text-label text-ink-quiet">{note}</p> : null}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open "${item.title}" on ${source} (new tab)`} className={STATION_KEY}>
            [ OPEN ↗ ]
          </a>
        ) : null}
        {item.seenOnly ? <FindInMedia item={item} /> : null}
      </div>
    </li>
  );
}

/** Every platform and kind actually on the map, for the filter lists. */
export function presentChoices(index: StationIndex) {
  const platforms = [...new Set(index.graph.items.map((item) => item.platform))].sort();
  const kinds = [...new Set(index.graph.items.map((item) => item.kind))].sort();
  return { platforms, kinds };
}
