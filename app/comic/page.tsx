import type { Metadata } from 'next';
import { Suspense } from 'react';
import ComicHome from '../components/comic/ComicHome';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Comic',
  description: 'Debaser, the comic: every released chapter, read here.',
};

/**
 * COMIC (SPEC-comic.md, Q1A): the contents. Open to everyone; only released pages show. Reads `?panel=<id>` (a board
 * thread's link back to its panel), so it sits inside a Suspense boundary.
 */
export default function ComicRoute() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [COMIC]" active="comic" tip="Debaser, the comic.">
      <h1 className="sr-only">DEBASER.SITE // COMIC</h1>
      <Suspense fallback={null}>
        <ComicHome />
      </Suspense>
    </SiteWindow>
  );
}
