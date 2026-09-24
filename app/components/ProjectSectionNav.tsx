import Link from 'next/link';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../lib/projects/debaser';
import { SHELF_CHIP } from '../lib/ui/controls';

const CURRENT =
  'rounded-none border border-black bg-ena px-2 py-[2px] text-paper max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:px-3 max-sm:text-sm';

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
    <div className="mb-4 flex flex-wrap items-center gap-1 border border-ink bg-ice-pale p-2 text-[10px] font-bold text-ink">
      <Link href={DEBASER_PROJECT.href} className={SHELF_CHIP}>
        [ &lt; {DEBASER_PROJECT.title} ]
      </Link>

      <span className="px-1 text-ink">::</span>

      {PROJECT_SECTIONS.map((section) =>
        section.id === current ? (
          <span key={section.id} className={CURRENT} title={`You are on ${section.label}`}>
            [ {section.label} ]
          </span>
        ) : (
          <Link key={section.id} href={section.href} className={SHELF_CHIP} title={section.summary}>
            [ {section.label} ]
          </Link>
        ),
      )}

      <Link href="/" className={`ml-auto ${SHELF_CHIP}`}>
        [ HOME ]
      </Link>
    </div>
  );
}
