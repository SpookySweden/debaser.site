import type { Metadata } from 'next';
import { Suspense } from 'react';
import ReaderPage from '../../components/reader/ReaderPage';
import SiteWindow from '../../components/SiteWindow';
import { isReadable } from '../../lib/books/types';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Reader',
  description: 'A free Project Gutenberg book in the DEBASER reader: two-page spreads, contents, search, bookmarks and highlights.',
};

/**
 * The DEBASER reader (SPEC-reader.md, Luke 2026-11-11): `/read/books:OL85892W-pg345`, a full page filling the window, with
 * a focus mode that fills the screen. `?at=<cfi>` opens at a spot, `?h=<highlight id>` at a highlight; otherwise where the
 * reader left off. Open to visitors, as MEDIA is; highlights and bookmarks need an account.
 */
export default async function ReadRoute({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const bookRef = decodeURIComponent(ref);
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [READER]" active="read" tip="A free book, read here." fill>
      {isReadable(bookRef) ? (
        <Suspense fallback={null}>
          <ReaderPage bookRef={bookRef} />
        </Suspense>
      ) : (
        <p className="p-4 text-label text-ink">THIS BOOK CAN&apos;T BE READ HERE.</p>
      )}
    </SiteWindow>
  );
}
