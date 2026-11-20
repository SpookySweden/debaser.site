'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getDocsRepository } from '../../lib/docs/repository';
import { getComicRepository } from '../../lib/comic/repository';
import { pagePath } from '../../lib/comic/rules';
import type { Appearance } from '../../lib/comic/types';
import { LINK_PIXEL, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';

type Found = { appearances: Appearance[]; isCharacter: boolean };

/** One read per lore page, shared by the picture at the top and the list at the foot. */
const reads = new Map<string, Promise<Found>>();

function readFor(slug: string): Promise<Found> {
  const known = reads.get(slug);
  if (known) return known;
  const read = (async (): Promise<Found> => {
    const doc = await getDocsRepository(null).getDocBySlug(slug);
    if (!doc) return { appearances: [], isCharacter: false };
    const comic = getComicRepository();
    const [appearances, isCharacter] = await Promise.all([comic.appearances(doc.id), comic.isCharacter(doc.id)]);
    return { appearances, isCharacter };
  })().catch(() => ({ appearances: [], isCharacter: false }));
  reads.set(slug, read);
  // Kept a minute: a page opened again later reads afresh.
  window.setTimeout(() => reads.delete(slug), 60_000);
  return read;
}

/**
 * The comic on a lore page (SPEC-comic.md, Q13, Q14). `portrait`, at the top of a CHARACTER's page: the panel where the
 * character first appears, cut from Luke's own page by the browser (no new file, no new art). `appearances`, at the foot:
 * APPEARS IN, every released panel the page is tagged on, each a link to it. Both show nothing when there is nothing.
 */
export default function ComicLoreLinks({ slug, part }: { slug: string; part: 'portrait' | 'appearances' }) {
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    let live = true;
    void readFor(slug).then((result) => {
      if (live) setFound(result);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  if (found === null || found.appearances.length === 0) return null;

  if (part === 'portrait') {
    if (!found.isCharacter) return null;
    const first = found.appearances[0];
    return <PanelCrop appearance={first} />;
  }

  return (
    <section aria-labelledby="lore-appears-in" className="flex flex-col gap-1 px-3 py-2 sm:px-4">
      <h2 id="lore-appears-in" className={TITLE_BAR}>
        APPEARS IN
      </h2>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {found.appearances.map((each) => (
          <li key={each.panelId}>
            <Link href={pagePath(each.chapterNumber, each.pageNumber, each.panelId)} className={`${LINK_PIXEL} text-label text-ink`}>
              {`CH ${each.chapterNumber} P ${each.pageNumber}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A panel cut from its page: a box the panel's shape, the page laid inside it so only the panel shows. */
function PanelCrop({ appearance }: { appearance: Appearance }) {
  const { box, page } = appearance;
  const width = page.readingWidth ?? 2;
  const height = page.readingHeight ?? 3;
  return (
    <figure className="flex flex-col gap-1 px-3 pt-2 sm:px-4">
      <Link
        href={pagePath(appearance.chapterNumber, appearance.pageNumber, appearance.panelId)}
        className="frame relative block w-full max-w-sm overflow-hidden"
        style={{ aspectRatio: `${box.w * width} / ${box.h * height}` }}
      >
        <ComicPageImage
          page={{ ...page, releasedAt: 'released', words: '' }}
          label={`FIRST SEEN IN CHAPTER ${appearance.chapterNumber}, PAGE ${appearance.pageNumber}`}
          style={{ position: 'absolute', width: `${100 / box.w}%`, left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%` }}
        />
      </Link>
      <figcaption className="text-label text-ink">{`FIRST SEEN: CH ${appearance.chapterNumber} P ${appearance.pageNumber}`}</figcaption>
    </figure>
  );
}
