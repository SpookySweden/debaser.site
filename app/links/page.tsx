import type { Metadata } from 'next';
import Link from 'next/link';
import ProjectSectionNav from '../components/ProjectSectionNav';
import SiteNav from '../components/SiteNav';
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
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [PROJECTS / DEBASER / LINKS]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        <SiteNav />

        {/* Content Body - the two shelves */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // LINKS</h1>
          <p className="text-sm mb-2 leading-relaxed">{section?.note}</p>
          <p className="text-[10px] font-bold mb-4 text-gray-700">
            {ARCHIVE_LINKS.length + OUTBOUND_LINKS.length}{' '}
            {pluralise(ARCHIVE_LINKS.length + OUTBOUND_LINKS.length, 'LINK')} FILED.
          </p>

          <ProjectSectionNav current="links" />

          <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
              <span>THE ARCHIVE</span>
              <span>[ {ARCHIVE_LINKS.length} PAGES ]</span>
            </div>

            <ul className="divide-y divide-gray-500">
              {ARCHIVE_LINKS.map((link) => (
                <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-[10px] font-bold">
                  <Link href={link.href} className="text-xs underline hover:bg-yellow-100">
                    {link.label}
                  </Link>
                  <span className="text-gray-700">{link.href}</span>
                  <span className="text-gray-700">:: {link.summary}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-4 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
              <span>OUTBOUND</span>
              <span>[ {OUTBOUND_LINKS.length} LINKS ]</span>
            </div>

            {OUTBOUND_LINKS.length === 0 ? (
              <div className="space-y-2 p-3 text-[10px] font-bold text-black">
                <p>NOTHING FILED ON THIS SHELF YET.</p>
                <p className="text-gray-700">
                  ADD A LINK IN app/lib/projects/links.ts WITH A LABEL, ITS FULL ADDRESS AND A LINE SAYING WHAT
                  IS THERE - THE PAGE PRINTS WHATEVER IS IN THAT LIST, IN ORDER.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-500">
                {OUTBOUND_LINKS.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-2 text-[10px] font-bold">
                    <span className="text-xs">{link.label}</span>
                    <span className="text-gray-700">{link.href}</span>
                    <span className="text-gray-700">:: {link.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Link Shelf Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
