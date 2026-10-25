import type { Metadata } from 'next';
import Link from 'next/link';
import SiteWindow from '../components/SiteWindow';
import { ARCHIVE_PROJECTS } from '../lib/projects/debaser';

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
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [PROJECTS]"
      tip="The projects."
    >
      <h1 className="sr-only">DEBASER.SITE // PROJECTS</h1>

      <section>
        <div className="title-line text-accent-ink">
          <span>THE PROJECTS</span>
        </div>

        <ul>
          {ARCHIVE_PROJECTS.map((project) => (
            <li key={project.id} className="rule-pixel">
              <Link
                href={project.href}
                className="block p-3 text-label font-bold hover:bg-pointed"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm">{project.title}</span>
                </span>
                <span className="mt-1 block max-w-prose font-normal text-ink">{project.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

    </SiteWindow>
  );
}
