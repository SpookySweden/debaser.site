import type { Metadata } from 'next';
import { Suspense } from 'react';
import MusicDirectory from '../components/MusicDirectory';
import MusicUploadForm from '../components/MusicUploadForm';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import { projectSection } from '../lib/projects/debaser';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description: 'The archive file directory: every track the site holds, filed by tag and played from the bar below.',
};

/**
 * The music page.
 *
 * A netlabel's file directory rather than a shelf: the archive's own tracks, every
 * track in the `mp3` bucket, and every MP3 somebody attached to a post or a reply,
 * in one list - with the tags as the way through it and the player at the bottom of
 * the window as the way to hear it. The audio itself is made by hand, the same way
 * every drawing is (see AGENTS.md).
 */
export default function MusicPage() {
  const section = projectSection('music');

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Directory Active">
      <h1 className="text-xl font-bold mb-2">DEBASER.SITE // MUSIC</h1>
      <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
      <p className="text-[10px] font-bold mb-4 text-gray-700">
        EVERY FILE THE ARCHIVE HOLDS - FILED BY HAND, UPLOADED, OR ATTACHED TO A POST ON THE BOARD. PRESS PLAY AND IT
        KEEPS GOING WHILE YOU READ.
      </p>

      <ProjectSectionNav current="music" />

      <div className="space-y-4">
        {/* The directory reads the address for its filter, so it is drawn behind a
            boundary: the page itself stays static, the list catches up on the client. */}
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
