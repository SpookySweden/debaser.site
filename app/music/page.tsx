import type { Metadata } from 'next';
import { Suspense } from 'react';
import MusicDirectory from '../components/MusicDirectory';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description: 'The archive file browser: every folder and track the site holds, filed by hand or by any account.',
};

/**
 * The music page.
 *
 * The netlabel's file browser: the archive's own releases, the folders anybody signed in has
 * made, and every MP3 attached to a post - one directory, with a search bar over it, tags as the
 * way through it, and the toolbar that files new files and folders. Playing a row hands the file
 * to the player at the bottom of the window. The audio itself is recorded by hand, the same way
 * every drawing is made by hand (see AGENTS.md).
 */
export default function MusicPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Archive" closeHref="/forum">
      <h1 className="text-xl font-bold mb-4">DEBASER.SITE // MUSIC</h1>

      <ProjectSectionNav current="music" />

      {/* The directory reads the address for its filter, so it is drawn behind a boundary: the
          page itself stays static, the listing catches up on the client. */}
      <Suspense
        fallback={
          <p className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-3 text-[10px] font-bold text-black">
            READING THE DIRECTORY...
          </p>
        }
      >
        <MusicDirectory />
      </Suspense>
    </SiteWindow>
  );
}
