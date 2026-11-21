'use client';

import Link from 'next/link';
import { useState } from 'react';
import { chaptersInOrder, COMIC_HOME } from '../../lib/comic/rules';
import { useComic } from '../../lib/comic/use-comic';
import { PLATE, PLATE_LINK, PLATE_PRESSED } from '../../lib/ui/controls';
import StudioLore from './StudioLore';
import StudioPages from './StudioPages';
import StudioPanels from './StudioPanels';
import StudioRelease from './StudioRelease';

const TABS = [
  { id: 'pages', label: 'PAGES' },
  { id: 'panels', label: 'PANELS' },
  { id: 'lore', label: 'LORE' },
  { id: 'release', label: 'RELEASE' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/**
 * Luke's studio (`/comic/studio`, SPEC-comic.md): the admin (a moderator) only, here and in every database policy. PAGES holds the
 * volumes, chapters and pages (dropped in, put in order, marked SPREAD, given WORDS); PANELS fixes the guessed boxes; LORE
 * tags panels with lore pages and marks CHARACTERS; RELEASE sends the queued pages out, by hand, as one batch.
 */
export default function ComicStudio() {
  const comic = useComic();
  const [tab, setTab] = useState<Tab>('pages');
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);

  if (comic.contents === null) return <p className="p-4 text-label text-ink">LOADING…</p>;
  if (!comic.admin) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-label text-ink">ONLY A MODERATOR OPENS THE STUDIO.</p>
        <Link href={COMIC_HOME} className={PLATE_LINK}>
          [ CONTENTS ]
        </Link>
      </div>
    );
  }

  const chapters = chaptersInOrder(comic.contents);
  const chapter = chapters.find((each) => each.id === chapterId) ?? chapters[0] ?? null;

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={COMIC_HOME} className={PLATE_LINK}>
          [ CONTENTS ]
        </Link>
        <div className="flex flex-wrap gap-1" role="group" aria-label="STUDIO" data-undo-picks="STUDIO">
          {TABS.map((each) => (
            <button key={each.id} type="button" aria-pressed={tab === each.id} onClick={() => setTab(each.id)} className={tab === each.id ? PLATE_PRESSED : PLATE}>
              {`[ ${each.label} ]`}
            </button>
          ))}
        </div>
      </div>

      {comic.error ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{comic.error}</p> : null}

      {tab === 'pages' ? (
        <StudioPages contents={comic.contents} reload={comic.reload} chapter={chapter} onChapter={setChapterId} />
      ) : null}
      {tab === 'panels' ? (
        <StudioPanels contents={comic.contents} chapter={chapter} onChapter={setChapterId} pageId={pageId} onPage={setPageId} />
      ) : null}
      {tab === 'lore' ? <StudioLore contents={comic.contents} chapter={chapter} onChapter={setChapterId} pageId={pageId} onPage={setPageId} /> : null}
      {tab === 'release' ? <StudioRelease contents={comic.contents} reload={comic.reload} /> : null}
    </div>
  );
}
