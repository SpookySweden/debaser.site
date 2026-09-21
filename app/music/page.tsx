import type { Metadata } from 'next';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteNav from '../components/SiteNav';
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
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [PROJECTS / DEBASER / MUSIC]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        <SiteNav />

        {/* Content Body - the track list */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
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
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Music Shelf Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
