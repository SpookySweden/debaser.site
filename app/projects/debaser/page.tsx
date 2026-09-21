import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../../components/ProjectSectionNav';
import SiteNav from '../../components/SiteNav';
import { CONCEPT_SHEETS } from '../../lib/concepts/sheets';
import { pluralise } from '../../lib/forum/format';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../../lib/projects/debaser';
import { ARCHIVE_LINKS, OUTBOUND_LINKS } from '../../lib/projects/links';
import { PROJECT_NOTES } from '../../lib/projects/notes';
import { TRACKS } from '../../lib/projects/tracks';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Debaser Project',
  description: 'The debaser project: concept sheets, music, notes and links, gathered on one page.',
};

/**
 * What is on each shelf, counted from the manifest that owns it rather than typed
 * out here, so a tile can never claim a number the shelf does not have.
 */
const SECTION_COUNTS: Record<string, string> = {
  concepts: `${CONCEPT_SHEETS.length} ${pluralise(CONCEPT_SHEETS.length, 'SHEET')}`,
  music: `${TRACKS.length} ${pluralise(TRACKS.length, 'TRACK')}`,
  notes: `${PROJECT_NOTES.length} ${pluralise(PROJECT_NOTES.length, 'NOTE')}`,
  links: `${ARCHIVE_LINKS.length + OUTBOUND_LINKS.length} ${pluralise(
    ARCHIVE_LINKS.length + OUTBOUND_LINKS.length,
    'LINK',
  )}`,
};

/** The site's own rooms, rather than the project's shelves. */
const SITE_ROOMS = ['forum', 'users', 'comms', 'account'];

export default function DebaserProjectPage() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [PROJECTS / DEBASER]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation: the project is reached from the home page, so no site
            tab is marked as current here. */}
        <SiteNav />

        {/* Content Body - the project's own contents page */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // {DEBASER_PROJECT.title}</h1>
          <p className="text-sm mb-2 leading-relaxed">{DEBASER_PROJECT.summary}</p>
          <p className="text-[10px] font-bold mb-4 text-gray-700">
            {DEBASER_PROJECT.subtitle} :: THE CONCEPT ARCHIVE USED TO SIT ON THE TASKBAR - IT LIVES HERE NOW, ONE
            SHELF OF FOUR.
          </p>

          <ProjectSectionNav />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {PROJECT_SECTIONS.map((section) => (
              <Link
                key={section.id}
                href={section.href}
                className="block rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] hover:bg-gray-300"
              >
                <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
                  <span>{section.label}</span>
                  <span>[ {SECTION_COUNTS[section.id] ?? 'OPEN'} ]</span>
                </div>
                <div className="space-y-1 p-3 text-[10px] font-bold">
                  <p className="text-xs">{section.summary}</p>
                  <p className="text-gray-700">{section.note}</p>
                  <p className="text-gray-700">OPEN {section.href}</p>
                </div>
              </Link>
            ))}
          </div>

          <div className="border border-black p-4 bg-[#f0f0f0] mt-6">
            <p className="text-xs font-bold mb-2">AROUND THE ARCHIVE:</p>
            <ul className="space-y-1">
              {ARCHIVE_LINKS.filter((link) => SITE_ROOMS.includes(link.id)).map((link) => (
                <li key={link.id} className="text-[10px] font-bold">
                  <Link href={link.href} className="underline hover:bg-yellow-100">
                    {link.label}
                  </Link>{' '}
                  :: {link.summary}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Debaser Project Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
