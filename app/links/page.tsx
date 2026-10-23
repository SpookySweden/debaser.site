import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import { projectSection } from '../lib/projects/debaser';
import { ARCHIVE_LINKS, OUTBOUND_LINKS } from '../lib/projects/links';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Links',
  description: 'The link shelf: every page of the debaser archive, and the outbound links filed by hand.',
};

/**
 * The link shelf.
 *
 * Two lists that are not the same kind of thing: the archive's own pages, which
 * are the same hrefs the taskbar uses and so can never go stale, and the outbound
 * links, which are only worth listing once somebody has decided they should be -
 * so that half says it is waiting rather than guessing at addresses.
 */
export default function LinksPage() {
  const section = projectSection('links');

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LINKS]" tip={section?.note}>
    <h1 className="sr-only">DEBASER.SITE // LINKS</h1>

    <ProjectSectionNav current="links" />

    <section>
      <div className="title-line text-accent-ink">
        <span>THE ARCHIVE</span>
      </div>

      <ul>
        {ARCHIVE_LINKS.map((link) => (
          <li
            key={link.id}
            className="rule-pixel flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-label font-bold"
          >
            <Link href={link.href} className="text-key underline hover:bg-pointed max-sm:inline-flex max-sm:min-h-tap max-sm:items-center">
              {link.label}
            </Link>
            <span className="text-ink">:: {link.summary}</span>
          </li>
        ))}
      </ul>
    </section>

    <section className="mt-4">
      <div className="title-line text-accent-ink">
        <span>OUTBOUND</span>
      </div>

      {OUTBOUND_LINKS.length === 0 ? (
        <div className="space-y-2 p-3 text-label font-bold text-ink">
          <p>NOTHING FILED ON THIS SHELF YET.</p>
          <p className="text-ink">
            LINKS ARE ADDED BY HAND - EACH ONE WITH A LABEL, ITS ADDRESS AND A LINE SAYING WHAT IS THERE.
          </p>
        </div>
      ) : (
        <ul>
          {OUTBOUND_LINKS.map((link) => (
            <li
              key={link.id}
              className="rule-pixel flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-label font-bold"
            >
              <span className="text-key" title={link.href}>
                {link.label}
              </span>
              <span className="text-ink">:: {link.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
    </SiteWindow>
  );
}
