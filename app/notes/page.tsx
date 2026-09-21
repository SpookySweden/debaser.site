import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteNav from '../components/SiteNav';
import { formatStamp } from '../lib/forum/format';
import { projectSection } from '../lib/projects/debaser';
import { PROJECT_NOTES } from '../lib/projects/notes';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Notes',
  description: 'Working notes and house rules: how the debaser archive is built and kept.',
};

export default function NotesPage() {
  const section = projectSection('notes');

  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [PROJECTS / DEBASER / NOTES]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        <SiteNav />

        {/* Content Body - the notes, newest first */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // NOTES</h1>
          <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
          <p className="text-[10px] font-bold mb-4 text-gray-700">
            NOTES ARE WRITTEN RATHER THAN DRAWN, SO THEY ARE FILED AS TEXT: ONE ENTRY EACH IN
            app/lib/projects/notes.ts.
          </p>

          <ProjectSectionNav current="notes" />

          <div className="space-y-4">
            {PROJECT_NOTES.map((note) => (
              <section
                key={note.id}
                id={note.id}
                className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#000080] px-2 py-1 text-xs font-bold text-white">
                  <span>{note.title}</span>
                  {/* The stamp is the board's blue on light panels; on the navy bar it
                      stays plain white so it can be read. */}
                  <span>[ FILED {formatStamp(note.filed)} ]</span>
                </div>

                <div className="space-y-2 p-3">
                  <p className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                    {note.kinds.map((kind) => (
                      <span key={kind} className="border border-black bg-white px-1">
                        [ {kind} ]
                      </span>
                    ))}
                    <span className="text-gray-700">NOTE ID {note.id}</span>
                  </p>

                  {note.body.map((paragraph) => (
                    <p key={paragraph.slice(0, 24)} className="text-[11px] leading-relaxed text-black">
                      {paragraph}
                    </p>
                  ))}

                  {note.href === undefined || note.hrefLabel === undefined ? null : (
                    <p className="text-[10px] font-bold">
                      <Link href={note.href} className="underline hover:bg-yellow-100">
                        {note.hrefLabel}
                      </Link>
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Notes Shelf Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
