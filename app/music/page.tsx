import type { Metadata } from 'next';
import MusicShelf from '../components/MusicShelf';
import MusicUploadForm from '../components/MusicUploadForm';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import TrackList from '../components/TrackList';
import { MUSIC_BUCKET } from '../lib/audio/catalogue';
import { projectSection } from '../lib/projects/debaser';
import { TRACK_FOLDER, TRACKS } from '../lib/projects/tracks';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Music',
  description:
    'The debaser score: tracks filed in the project assets folder and in the mp3 bucket, played from the bar at the bottom of the window.',
};

export default function MusicPage() {
  const section = projectSection('music');

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]" status="Music Shelf Active">
      <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // MUSIC</h1>
      <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
      <p className="text-[10px] font-bold mb-4 text-gray-700">
        THE ARCHIVE&apos;S OWN TRACKS ARE MADE BY HAND AND DROPPED INTO {TRACK_FOLDER}/, THE SAME WAY EVERY DRAWING IS.
        EVERYTHING ELSE LIVES IN THE {MUSIC_BUCKET} BUCKET, AND THE PLAYER READS IT STRAIGHT FROM THERE - SO A FILE
        DROPPED IN BY HAND PLAYS WITHOUT ANYBODY EDITING A LIST.
      </p>

      <ProjectSectionNav current="music" />

      <div className="space-y-4">
        <TrackList tracks={TRACKS} />

        <MusicShelf />

        <MusicUploadForm />

        <div className="border border-black p-4 bg-[#f0f0f0] text-[10px] font-bold">
          <p className="text-xs mb-2">FILING A TRACK BY HAND:</p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>SAVE THE AUDIO AS {TRACK_FOLDER}/&lt;id&gt;.mp3 - MP3, M4A, OGG, WAV AND FLAC ARE SERVED.</li>
            <li>ADD ONE ENTRY TO app/lib/projects/tracks.ts WITH ITS TITLE, CREDIT, KIND AND RUNNING TIME.</li>
            <li>NOTHING ELSE CHANGES: THIS PAGE AND THE PROJECT PAGE BOTH READ THAT MANIFEST.</li>
          </ol>
          <p className="mt-2 text-gray-700">
            A FILE PUT STRAIGHT INTO THE {MUSIC_BUCKET} BUCKET IS PLAYED TOO - THE PLAYER LISTS THE BUCKET ITSELF, SO
            THE SHELF IS WHATEVER IS ACTUALLY THERE, AND ITS FIRST TRACK IS WHAT THE PLAYER OPENS ON AND LOOPS.
          </p>
        </div>
      </div>
    </SiteWindow>
  );
}
