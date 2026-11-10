import type { Metadata } from 'next';
import { Suspense } from 'react';
import BookPage from '../../../components/BookPage';
import SiteWindow from '../../../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Book',
  description: 'A book or an audiobook: read it here, listen to it, and see who has highlighted it.',
};

/**
 * A book's page (SPEC-books.md, Luke 2026-11-10): `/media/book/books:OL85892W-pg345` or `/media/book/audiobooks:271`. Its
 * details come from Open Library or LibriVox (/api/web/book/info); `?at=<paragraph>` opens the reader at that spot (a
 * highlight's link). Open to visitors, as MEDIA is; who has highlighted it shows names only to signed-in people.
 */
export default async function BookRoute({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [BOOK]" active="web" tip="A book: read it, listen to it, and see who has highlighted it.">
      <h1 className="sr-only">DEBASER.SITE // BOOK</h1>
      <Suspense fallback={null}>
        <BookPage bookRef={decodeURIComponent(ref)} />
      </Suspense>
    </SiteWindow>
  );
}
