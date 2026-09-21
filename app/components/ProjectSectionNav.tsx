import Link from 'next/link';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../lib/projects/debaser';

const LINK = 'cursor-pointer rounded-none border border-gray-500 bg-white px-2 py-[2px] hover:bg-yellow-100';
const CURRENT = 'rounded-none border border-black bg-[#000080] px-2 py-[2px] text-white';

type ProjectSectionNavProps = {
  /** The section this page is, so it is marked rather than linked. */
  current?: string;
};

/**
 * The strip that runs along the top of every page under the debaser project.
 *
 * It is the project's own little taskbar: a way back to the project page, one
 * button per shelf with the current one marked, and a way home. Pages outside the
 * project (the board, comms, the account page) do not use it - they are the
 * site's, not the project's.
 */
export default function ProjectSectionNav({ current }: ProjectSectionNavProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 border border-gray-500 bg-[#f0f0f0] p-2 text-[10px] font-bold text-black">
      <Link href={DEBASER_PROJECT.href} className={LINK}>
        [ &lt; {DEBASER_PROJECT.title} ]
      </Link>

      <span className="px-1 text-gray-700">::</span>

      {PROJECT_SECTIONS.map((section) =>
        section.id === current ? (
          <span key={section.id} className={CURRENT} title={`You are on ${section.label}`}>
            [ {section.label} ]
          </span>
        ) : (
          <Link key={section.id} href={section.href} className={LINK} title={section.summary}>
            [ {section.label} ]
          </Link>
        ),
      )}

      <Link href="/" className={`ml-auto ${LINK}`}>
        [ HOME ]
      </Link>
    </div>
  );
}
