import type { Metadata } from 'next';
import { Suspense } from 'react';
import ComicChapter from '../../../components/comic/ComicChapter';
import SiteWindow from '../../../components/SiteWindow';

function whole(value: string): number | null {
  return /^\d{1,4}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string; page: string }> }): Promise<Metadata> {
  const { chapter, page } = await params;
  const c = whole(chapter);
  const p = whole(page);
  return {
    title: c === null || p === null ? 'DEBASER.SITE - Comic' : `DEBASER.SITE - Comic, chapter ${c}, page ${p}`,
    description: 'Debaser, the comic, read here.',
  };
}

/**
 * A chapter opened at a page (SPEC-comic.md): the address the "new pages" alert and a panel's board thread link to. The same
 * column as `/comic/<chapter>`, scrolled to the page.
 */
export default async function ComicPageRoute({ params }: { params: Promise<{ chapter: string; page: string }> }) {
  const { chapter, page } = await params;
  const c = whole(chapter);
  const p = whole(page);
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMIC]" active="comic" tip="Debaser, the comic.">
      <h1 className="sr-only">{c === null ? 'DEBASER.SITE // COMIC' : `DEBASER.SITE // COMIC // CHAPTER ${c}`}</h1>
      {c === null ? (
        <p className="p-4 text-label text-ink">THIS CHAPTER ISN&apos;T OUT YET.</p>
      ) : (
        <Suspense fallback={null}>
          <ComicChapter key={`${c}-${p}`} chapterNumber={c} pageNumber={p} />
        </Suspense>
      )}
    </SiteWindow>
  );
}
