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
    <SiteWindow
      title="DEBASER_OS - v1.0 [PROJECTS / DEBASER]"
      tip={`${DEBASER_PROJECT.subtitle} :: ${DEBASER_PROJECT.summary}`}
    >
    <h1 className="sr-only">DEBASER.SITE // {DEBASER_PROJECT.title}</h1>

    <ProjectSectionNav />

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {PROJECT_SECTIONS.map((section) => (
        <Link
          key={section.id}
          href={section.href}
          className="block hover:bg-pointed"
        >
          <div className="title-line text-accent-ink">
            <span>{section.label}</span>
            <span>{SECTION_COUNTS[section.id] ?? 'OPEN'}</span>
          </div>
          <div className="space-y-1 p-3 text-label font-bold">
            <p className="text-key">{section.summary}</p>
            <p className="text-ink">{section.note}</p>
          </div>
        </Link>
      ))}
    </div>

    <div className="mt-6">
      <p className="text-key font-bold mb-2">AROUND THE ARCHIVE:</p>
      <ul className="space-y-1">
        {ARCHIVE_LINKS.filter((link) => SITE_ROOMS.includes(link.id)).map((link) => (
          <li key={link.id} className="text-label font-bold">
            <Link href={link.href} className="underline hover:bg-pointed max-sm:flex max-sm:min-h-tap max-sm:w-fit max-sm:items-center">
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
