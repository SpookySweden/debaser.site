import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
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
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / NOTES]" status="Notes Shelf Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // NOTES</h1>
    <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
    <p className="text-[10px] font-bold mb-4 text-ink">
      NOTES ARE WRITTEN RATHER THAN DRAWN, SO THEY ARE FILED AS TEXT.
    </p>

    <ProjectSectionNav current="notes" />

    <div className="space-y-4">
      {PROJECT_NOTES.map((note) => (
        <section
          key={note.id}
          id={note.id}
          className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 bg-ena px-2 py-1 text-xs font-bold text-white">
            <span>{note.title}</span>
            {/* The stamp is the board's blue on light panels; on the navy bar it
                stays plain white so it can be read. */}
            <span>[ FILED {formatStamp(note.filed)} ]</span>
          </div>

          <div className="space-y-2 p-3">
            <p className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
              {note.kinds.map((kind) => (
                <span key={kind} className="border border-black bg-paper px-1">
                  [ {kind} ]
                </span>
              ))}
              <span className="text-ink">NOTE ID {note.id}</span>
            </p>

            {note.body.map((paragraph) => (
              <p key={paragraph.slice(0, 24)} className="text-[11px] leading-relaxed text-ink">
                {paragraph}
              </p>
            ))}

            {note.href === undefined || note.hrefLabel === undefined ? null : (
              <p className="text-[10px] font-bold">
                <Link href={note.href} className="underline hover:bg-sun">
                  {note.hrefLabel}
                </Link>
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
    </SiteWindow>
  );
}
