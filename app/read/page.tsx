import type { Metadata } from 'next';
import { Suspense } from 'react';
import ReaderPage from '../components/reader/ReaderPage';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Read',
  description: 'Continue the books you are reading, see the ones you finished, or open your own PDF or EPUB: the site finds which book it is, so your highlights count in every copy.',
};

/**
 * Your own book in the DEBASER reader (Luke, 2026-11-11: "allow people also to read their own pdfs in our reader"): a PDF or
 * an EPUB chosen from the reader's device, opened in their browser by the same engine, never uploaded or saved anywhere.
 * Open to visitors.
 */
export default function OwnBookRoute() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [READER]" active="read" tip="Your books, and your own PDFs and EPUBs, matched to their book." fill>
      <Suspense fallback={null}>
        <ReaderPage bookRef={null} />
      </Suspense>
    </SiteWindow>
  );
}
