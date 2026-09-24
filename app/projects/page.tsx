import type { Metadata } from 'next';
import Link from 'next/link';
import SiteWindow from '../components/SiteWindow';
import { pluralise } from '../lib/forum/format';
import { ARCHIVE_PROJECTS } from '../lib/projects/debaser';
import { ARCHIVE_LINKS } from '../lib/projects/links';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Projects',
  description: 'The projects the archive holds, and what is filed under each one.',
};

/**
 * The projects index: the map, before any one project's own page.
 *
 * It is drawn from `ARCHIVE_PROJECTS` rather than from a link typed out here, which is the whole
 * reason that list exists - the module's own note says "a second project is one more entry here plus
 * its own page", and this is the page that makes that true. With one project today the map has one
 * row; it is a map rather than a block so that adding the second one is a data change and not a
 * rewrite.
 *
 * It is *not* a project's page, so it carries no `ProjectSectionNav`: that strip lists the shelves of
 * the debaser project, and offering them here would be offering the shelves of something the reader
 * has not chosen yet. The way in is the project's own row.
 */
export default function ProjectsPage() {
  const shelfCount = ARCHIVE_LINKS.length;

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS]" status="Project Index Active">
      <h1 className="text-xl font-bold mb-2">DEBASER.SITE // PROJECTS</h1>
      <p className="text-sm mb-2 leading-relaxed">
        Everything the archive holds, gathered under the project it belongs to. A project owns a
        landing page, and that page gathers its parts - the sheets, the score, the notes and the links -
        so this is the map and the page behind each row is the territory.
      </p>
      <p className="text-[10px] font-bold mb-4 text-ink">
        {ARCHIVE_PROJECTS.length} {pluralise(ARCHIVE_PROJECTS.length, 'PROJECT')} FILED ::{' '}
        {shelfCount} {pluralise(shelfCount, 'SHELF')} ON THE LINK PAGE.
      </p>

      <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
        <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-paper">
          <span>THE PROJECTS</span>
          <span>[ {ARCHIVE_PROJECTS.length} ]</span>
        </div>

        <ul className="divide-y divide-ink">
          {ARCHIVE_PROJECTS.map((project) => (
            <li key={project.id}>
              <Link
                href={project.href}
                title={project.summary}
                className="block p-3 text-[10px] font-bold hover:bg-sun"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm">{project.title}</span>
                  <span className="text-ink">:: {project.subtitle}</span>
                </span>
                <span className="mt-1 block max-w-prose font-normal text-ink">{project.summary}</span>
                <span className="mt-1 block text-ink">OPEN {project.href}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 border border-black bg-ice-pale p-4">
        <p className="mb-2 text-xs font-bold">NOT A PROJECT:</p>
        <p className="text-[10px] font-bold text-ink">
          THE BOARD AND THE SITE&apos;S OWN ROOMS - USERS, COMMS, THE ACCOUNT - ARE THE ARCHIVE&apos;S
          RATHER THAN ANY PROJECT&apos;S. THEY LIVE ON THE HEADER ALONG THE TOP OF EVERY PAGE, WHICH
          IS WHERE A READER GOES FOR THEM.
        </p>
      </div>
    </SiteWindow>
  );
}
