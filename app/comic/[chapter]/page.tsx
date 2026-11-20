import type { Metadata } from 'next';
import { Suspense } from 'react';
import ComicChapter from '../../components/comic/ComicChapter';
import SiteWindow from '../../components/SiteWindow';

function whole(value: string): number | null {
  return /^\d{1,4}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }): Promise<Metadata> {
  const { chapter } = await params;
  const number = whole(chapter);
  return {
    title: number === null ? 'DEBASER.SITE - Comic' : `DEBASER.SITE - Comic, chapter ${number}`,
    description: 'Debaser, the comic, read here.',
  };
}

/** A chapter of the comic (SPEC-comic.md): one scrolling column of pages. `?panel=<id>` opens a panel's pane. */
export default async function ComicChapterRoute({ params }: { params: Promise<{ chapter: string }> }) {
  const { chapter } = await params;
  const number = whole(chapter);
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMIC]" active="comic" tip="Debaser, the comic.">
      <h1 className="sr-only">{number === null ? 'DEBASER.SITE // COMIC' : `DEBASER.SITE // COMIC // CHAPTER ${number}`}</h1>
      {number === null ? (
        <p className="p-4 text-label text-ink">THIS CHAPTER ISN&apos;T OUT YET.</p>
      ) : (
        <Suspense fallback={null}>
          <ComicChapter key={number} chapterNumber={number} pageNumber={null} />
        </Suspense>
      )}
    </SiteWindow>
  );
}
