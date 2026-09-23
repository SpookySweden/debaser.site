import type { Metadata } from 'next';
import { Suspense } from 'react';
import MusicDirectory from '../components/MusicDirectory';
import MusicUploadForm from '../components/MusicUploadForm';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description: 'The archive file directory: every track the site holds, filed by artist and sorted by tag.',
};

/**
 * The music page.
 *
 * The netlabel's file directory: the archive's own catalogue, whatever the `mp3` bucket
 * holds, and every MP3 somebody attached to a post - one listing, with a search bar over it
 * and the tags as the way through it. Playing a row hands the file to the player at the
 * bottom of the window. The audio itself is recorded by hand, the same way every drawing is
 * made by hand (see AGENTS.md).
 */
export default function MusicPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Archive">
      <h1 className="text-xl font-bold mb-4">DEBASER.SITE // MUSIC</h1>

      <ProjectSectionNav current="music" />

      <div className="space-y-4">
        {/* The directory reads the address for its filter, so it is drawn behind a boundary:
            the page itself stays static, the listing catches up on the client. */}
        <Suspense
          fallback={
            <p className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-3 text-[10px] font-bold text-black">
              READING THE DIRECTORY...
            </p>
          }
        >
          <MusicDirectory />
        </Suspense>

        <MusicUploadForm />
      </div>
    </SiteWindow>
  );
}
