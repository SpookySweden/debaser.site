import type { Metadata } from 'next';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import TrackList from '../components/TrackList';
import { projectSection } from '../lib/projects/debaser';
import { TRACK_FOLDER, TRACKS } from '../lib/projects/tracks';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description: 'The debaser score: tracks filed in the project assets folder, played from the track list.',
};

export default function MusicPage() {
  const section = projectSection('music');

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Shelf Active">
    <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // MUSIC</h1>
    <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
    <p className="text-[10px] font-bold mb-4 text-gray-700">
      THE AUDIO IS MADE BY HAND AND DROPPED INTO THE PROJECT {TRACK_FOLDER}/ FOLDER, THE SAME WAY EVERY
      DRAWING IS. A ROW PLAYS THE FILE THE MOMENT IT EXISTS AND NAMES THE PATH IT WANTS UNTIL THEN.
    </p>

    <ProjectSectionNav current="music" />

    <TrackList tracks={TRACKS} />

    <div className="border border-black p-4 bg-[#f0f0f0] mt-6 text-[10px] font-bold">
      <p className="text-xs mb-2">FILING A TRACK:</p>
      <ol className="ml-4 list-decimal space-y-1">
        <li>SAVE THE AUDIO AS {TRACK_FOLDER}/&lt;id&gt;.mp3 - MP3, M4A, OGG, WAV AND FLAC ARE SERVED.</li>
        <li>ADD ONE ENTRY TO app/lib/projects/tracks.ts WITH ITS TITLE, CREDIT, KIND AND RUNNING TIME.</li>
        <li>NOTHING ELSE CHANGES: THIS PAGE AND THE PROJECT PAGE BOTH READ THAT MANIFEST.</li>
      </ol>
      <p className="mt-2 text-gray-700">
        THE FIRST ENTRY IN THE MANIFEST IS THE THEME, WHICH IS WHAT THE PROJECT PAGE COUNTS.
      </p>
    </div>
    </SiteWindow>
  );
}
