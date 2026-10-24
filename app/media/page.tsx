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
      closeHref="/forum"
      tip="Every file the site holds - pictures, music, video - with who filed it, its tags, and every place it is used. Pick a tab for one kind, search by title, credit or tag, and open a row to see the file and where it appears. Filing takes an account; a file that is already here is matched and the original used."
    >
      <h1 className="sr-only">DEBASER.SITE // MEDIA CATALOGUE</h1>

      <Suspense fallback={<p className="text-label font-bold text-ink">READING THE CATALOGUE...</p>}>
        <MediaCatalogue />
      </Suspense>
    </SiteWindow>
  );
}
