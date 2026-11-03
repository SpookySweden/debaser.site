import type { Metadata } from 'next';
import { Suspense } from 'react';
import CytubePage from '../components/CytubePage';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - CYTUBE',
  description: 'Watch and listen together: go live, join a live room, see the stream canvases and pick the look of your room.',
};

/**
 * CYTUBE (SPEC-cytube.md): streaming explained, the live rooms, the stream canvases, GO LIVE and CUSTOMIZE
 * LAYOUT. Drawn on the client (it needs the reader's account); the tab is read from the address, which needs a
 * Suspense boundary.
 */
export default function Page() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [CYTUBE]" active="cytube" tip="Watch and listen together.">
      <h1 className="sr-only">DEBASER.SITE // CYTUBE</h1>
      <Suspense fallback={null}>
        <CytubePage />
      </Suspense>
    </SiteWindow>
  );
}
