import type { Metadata } from 'next';
import { Suspense } from 'react';
import MediaCatalogue from '../components/MediaCatalogue';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Files',
  description: 'Every picture, track and video the site holds, and where each one is used.',
};

/**
 * FILES, the media catalogue: a page, not a window (SPEC-media-catalogue.md, decision 2). It was MEDIA, at /media,
 * until Luke gave that name to the search page (2026-11-04); its old addresses redirect here (next.config.ts).
 *
 * `useSearchParams` reads the tab off the address (`/files?kind=audio`), which is why the catalogue
 * sits under a Suspense boundary: a page that reads the query is rendered on the client, and Next
 * asks for the boundary so the shell around it can still be served at once.
 */
export default function MediaPage() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [FILES]"
      active="media"
      tip="Every picture, track and video, and where each is used."
    >
      <h1 className="sr-only">DEBASER.SITE // FILES</h1>

      <Suspense fallback={<p className="text-label font-bold text-ink">READING THE CATALOGUE...</p>}>
        <MediaCatalogue />
      </Suspense>
    </SiteWindow>
  );
}
