'use client';

import { useMemo, useState } from 'react';
import type { RelatedTag, StationIndex } from '../lib/tag-station/query';
import { STATION_KEY, WordChip } from './TagStationParts';

const STEP = 60;

/**
 * The same words as the map, in order of closeness (SPEC-tag-station.md): everything the map does, without the map. The chosen
 * words first, then what's near them with the reason, then every other word the filters leave, commonest first.
 */
export default function TagStationList({
  index,
  focus,
  related,
  visibleNames,
  onPick,
  onAdd,
}: {
  index: StationIndex;
  focus: readonly string[];
  related: readonly RelatedTag[];
  visibleNames: ReadonlySet<string>;
  onPick: (word: string) => void;
  onAdd: (word: string) => void;
}) {
  const [shown, setShown] = useState(STEP);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; reason: string; chosen: boolean }[] = [];
    const add = (name: string, reason: string, chosen: boolean) => {
      if (seen.has(name)) return;
      seen.add(name);
      out.push({ name, reason, chosen });
    };
    const onItems = (name: string) => {
      const count = index.tagByName.get(name)?.count ?? 0;
      return count === 1 ? 'ON 1 ITEM' : `ON ${count} ITEMS`;
    };
    for (const name of focus) add(name, onItems(name), true);
    for (const one of related) add(one.tag.name, one.reason, false);
    const rest = index.graph.tags.filter((tag) => visibleNames.has(tag.name)).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
    for (const tag of rest) add(tag.name, onItems(tag.name), false);
    return out;
  }, [index, focus, related, visibleNames]);

  if (rows.length === 0) return <p className="py-2 text-title text-ink">NO WORDS.</p>;
  return (
    <div>
      <ul aria-label="Words, closest first">
        {rows.slice(0, shown).map((row) => (
          <li key={row.name} className="rule-pixel flex flex-wrap items-center gap-x-2 py-1">
            <WordChip word={row.name} active={row.chosen} onPick={onPick} onAdd={onAdd} />
            <span className="min-w-0 break-words text-label text-ink">{row.reason}</span>
          </li>
        ))}
      </ul>
      {rows.length > shown ? (
        <button type="button" onClick={() => setShown((current) => current + STEP)} className={STATION_KEY}>
          [ MORE WORDS ]
        </button>
      ) : null}
    </div>
  );
}
