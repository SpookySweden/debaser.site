import type { Metadata } from 'next';
import MusicShelf from '../components/MusicShelf';
import MusicUploadForm from '../components/MusicUploadForm';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import TrackList from '../components/TrackList';
import { projectSection } from '../lib/projects/debaser';
import { TRACKS } from '../lib/projects/tracks';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description:
    'The debaser score: every track, played from the bar at the bottom of the window.',
};

export default function MusicPage() {
  const section = projectSection('music');

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Shelf Active">
      <h1 className="text-xl font-bold mb-2">DEBASER.SITE // MUSIC</h1>
      <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
      <p className="text-[10px] font-bold mb-4 text-gray-700">
        TRACKS ARE MADE BY HAND, THE SAME WAY EVERY DRAWING IS - FILE ONE BELOW AND IT PLAYS AT ONCE.
      </p>

      <ProjectSectionNav current="music" />

      <div className="space-y-4">
        <TrackList tracks={TRACKS} />

        <MusicShelf />

        <MusicUploadForm />
      </div>
    </SiteWindow>
  );
}
