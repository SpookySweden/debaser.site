import type { Metadata } from 'next';
import { Suspense } from 'react';
import ReaderPage from '../components/reader/ReaderPage';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Your own book',
  description: 'Read your own PDF or EPUB in the DEBASER reader. It opens in your browser and stays on your device.',
};

/**
 * Your own book in the DEBASER reader (Luke, 2026-11-11: "allow people also to read their own pdfs in our reader"): a PDF or
 * an EPUB chosen from the reader's device, opened in their browser by the same engine, never uploaded or saved anywhere.
 * Open to visitors.
 */
export default function OwnBookRoute() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [READER]" active="web" tip="Your own book, read here." fill>
      <Suspense fallback={null}>
        <ReaderPage bookRef={null} />
      </Suspense>
    </SiteWindow>
  );
}
