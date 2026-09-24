import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../../components/ProjectSectionNav';
import SiteWindow from '../../components/SiteWindow';
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
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER]" status="Debaser Project Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // {DEBASER_PROJECT.title}</h1>
    <p className="text-sm mb-2 leading-relaxed">{DEBASER_PROJECT.summary}</p>
    <p className="text-[10px] font-bold mb-4 text-ink">
      {DEBASER_PROJECT.subtitle}
    </p>

    <ProjectSectionNav />

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {PROJECT_SECTIONS.map((section) => (
        <Link
          key={section.id}
          href={section.href}
          className="block rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale hover:bg-sun"
        >
          <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-paper">
            <span>{section.label}</span>
            <span>[ {SECTION_COUNTS[section.id] ?? 'OPEN'} ]</span>
          </div>
          <div className="space-y-1 p-3 text-[10px] font-bold">
            <p className="text-xs">{section.summary}</p>
            <p className="text-ink">{section.note}</p>
            <p className="text-ink">OPEN {section.href}</p>
          </div>
        </Link>
      ))}
    </div>

    <div className="border border-black p-4 bg-ice-pale mt-6">
      <p className="text-xs font-bold mb-2">AROUND THE ARCHIVE:</p>
      <ul className="space-y-1">
        {ARCHIVE_LINKS.filter((link) => SITE_ROOMS.includes(link.id)).map((link) => (
          <li key={link.id} className="text-[10px] font-bold">
            <Link href={link.href} className="underline hover:bg-sun">
              {link.label}
            </Link>{' '}
            :: {link.summary}
          </li>
        ))}
      </ul>
    </div>
    </SiteWindow>
  );
}
