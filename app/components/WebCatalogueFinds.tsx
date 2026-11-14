'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { digLine, useDigging, type Digging } from '../lib/tag-station/more';
import { keepShownFirst, sinkPoor } from '../lib/tag-station/title-quality';
import type { StationItem } from '../lib/tag-station/types';
import { PLATE } from '../lib/ui/controls';
import type { WebItem } from '../lib/web/types';
import { NoPlayerRow } from './WebPickedList';
import { useMediaView, viewListClass } from '../lib/web/media-view';

const STEP = 12;
const SECTION_ID = 'web-catalogue-finds';

/** The sources the catalogue holds rows from. A search of any other is about that source alone. */
const CATALOGUE_SOURCES = new Set(['all', 'internet_archive', 'peertube', 'openverse']);

export type CatalogueFinds = Digging & { rows: StationItem[]; asked: boolean };

/**
 * MEDIA search's tagged rows (SPEC-discover.md): the words the search typed, looked up in the pool's files. Their own request, so the outside sites are neither waited on nor slowed. Only with
 * words and no `from:`; TYPE keeps its own kind and one SOURCE keeps its own platform.
 */
export function useCatalogueFinds(search: { query: string; source: string; type: string; authors: readonly string[] } | null): CatalogueFinds {
  const text = search !== null && search.authors.length === 0 && CATALOGUE_SOURCES.has(search.source) ? search.query.trim() : '';
  const digging = useDigging(text.length > 0 ? { q: text } : null);
  const { items } = digging.answer;
  const source = search?.source ?? 'all';
  const type = search?.type ?? 'all';
  const rows = useMemo(() => sinkPoor(items.filter((item) => (type === 'all' || item.kind === type) && (source === 'all' || item.platform === source))), [items, source, type]);
  return { ...digging, rows, asked: text.length > 0 };
}

/** One fixed line above the results, the same height whatever it says, so the tagged rows arriving never move what the reader is looking at. */
export function CatalogueLine({ finds }: { finds: CatalogueFinds }) {
  const count = finds.rows.length;
  return (
    <p className="flex min-h-tap flex-wrap items-center gap-1 text-label font-bold text-ink-quiet" data-catalogue-line>
      {finds.loading ? 'TAGGED CATALOGUE: READING...' : count === 0 ? 'TAGGED CATALOGUE: NOTHING YET.' : `TAGGED CATALOGUE: ${count}${finds.more ? '+' : ''} BELOW.`}
      {count > 0 ? (
        <button type="button" onClick={() => document.getElementById(SECTION_ID)?.scrollIntoView()} className={PLATE}>
          [ GO ]
        </button>
      ) : null}
    </p>
  );
}

/**
 * The rows themselves, below the outside sites' results. A row an outside site has already found is left to that site's result, except one already on the screen, which stays where it is: an outside
 * site answering late never takes a row away from under the reader.
 */
export default function WebCatalogueFinds({ finds, resultIds, renderRow }: { finds: CatalogueFinds; resultIds: ReadonlySet<string>; renderRow: (item: WebItem) => ReactNode }) {
  const view = useMediaView();
  const [shown, setShown] = useState(STEP);
  const [pinned, setPinned] = useState<{ ids: readonly string[]; found: ReadonlySet<string> }>({ ids: [], found: new Set() });
  const rows = useMemo(() => {
    const onScreen = new Set(pinned.ids);
    return keepShownFirst(pinned.ids, finds.rows.filter((item) => onScreen.has(item.id) || !pinned.found.has(item.id)));
  }, [pinned, finds.rows]);
  if (rows.length === 0 && !finds.more) return null;
  const press = () => {
    // These rows and the ones this press brings into view: what arrives from the files comes after them.
    const next = rows.slice(shown).filter((item) => !resultIds.has(item.id)).slice(0, STEP);
    setPinned({ ids: [...rows.slice(0, shown), ...next].map((item) => item.id), found: resultIds });
    setShown(shown + STEP);
    if (rows.length < shown + 2 * STEP) finds.dig();
  };
  return (
    <section id={SECTION_ID} aria-label="From the tagged catalogue" className="mt-3" data-catalogue-finds={rows.length}>
      <p className="text-label font-bold text-ink-quiet">FROM THE TAGGED CATALOGUE</p>
      <ul className={viewListClass(view)}>
        {rows.slice(0, shown).map((item) => (item.seenOnly ? <NoPlayerRow key={item.id} item={item} /> : renderRow({ ...item, tags: item.words.map((word) => word.word) })))}
      </ul>
      {rows.length > shown || finds.more ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button type="button" onClick={press} disabled={finds.digging} className={PLATE}>
            {finds.digging ? '[ DIGGING... ]' : '[ MORE FROM THE CATALOGUE ]'}
          </button>
          <span className="text-label text-ink-quiet">{digLine(finds.answer)}</span>
        </div>
      ) : null}
    </section>
  );
}
