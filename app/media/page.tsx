import type { Metadata } from 'next';
import { Suspense } from 'react';
import MediaCatalogue from '../components/MediaCatalogue';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Media Catalogue',
  description: 'Every picture, track and video the site holds, and where each one is used.',
};

/**
 * The media catalogue: a page, not a window (SPEC-media-catalogue.md, decision 2).
 *
 * `useSearchParams` reads the tab off the address (`/media?kind=audio`), which is why the catalogue
 * sits under a Suspense boundary: a page that reads the query is rendered on the client, and Next
 * asks for the boundary so the shell around it can still be served at once.
 */
export default function MediaPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [MEDIA CATALOGUE]"
      active="media"
      tip="Every picture, track and video, and where each is used."
    >
      <h1 className="sr-only">DEBASER.SITE // MEDIA CATALOGUE</h1>

      <Suspense fallback={<p className="text-label font-bold text-ink">READING THE CATALOGUE...</p>}>
        <MediaCatalogue />
      </Suspense>
    </SiteWindow>
  );
}
