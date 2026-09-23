import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteWindow from '../components/SiteWindow';
import { pluralise } from '../lib/forum/format';
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
    <SiteWindow title="DEBASER_OS - v1.0 [PROJECTS / DEBASER / LINKS]" status="Link Shelf Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // LINKS</h1>
    <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
    <p className="text-[10px] font-bold mb-4 text-ink">
      {ARCHIVE_LINKS.length + OUTBOUND_LINKS.length}{' '}
      {pluralise(ARCHIVE_LINKS.length + OUTBOUND_LINKS.length, 'LINK')} FILED.
    </p>

    <ProjectSectionNav current="links" />

    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-white">
        <span>THE ARCHIVE</span>
        <span>[ {ARCHIVE_LINKS.length} PAGES ]</span>
      </div>

      <ul className="divide-y divide-gray-500">
        {ARCHIVE_LINKS.map((link) => (
          <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-[10px] font-bold">
            <Link href={link.href} className="text-xs underline hover:bg-sun">
              {link.label}
            </Link>
            <span className="text-ink">{link.href}</span>
            <span className="text-ink">:: {link.summary}</span>
          </li>
        ))}
      </ul>
    </section>

    <section className="mt-4 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className="flex items-center justify-between bg-ena px-2 py-1 text-xs font-bold text-white">
        <span>OUTBOUND</span>
        <span>[ {OUTBOUND_LINKS.length} LINKS ]</span>
      </div>

      {OUTBOUND_LINKS.length === 0 ? (
        <div className="space-y-2 p-3 text-[10px] font-bold text-ink">
          <p>NOTHING FILED ON THIS SHELF YET.</p>
          <p className="text-ink">
            LINKS ARE ADDED BY HAND - EACH ONE WITH A LABEL, ITS ADDRESS AND A LINE SAYING WHAT IS THERE.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-500">
          {OUTBOUND_LINKS.map((link) => (
            <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-[10px] font-bold">
              <span className="text-xs">{link.label}</span>
              <span className="text-ink">{link.href}</span>
              <span className="text-ink">:: {link.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
    </SiteWindow>
  );
}
