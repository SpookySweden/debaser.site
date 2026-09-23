/**
 * The project the archive is built around.
 *
 * The home page lists projects, and each project owns a landing page that gathers
 * its parts, so this module is where "which parts does DEBASER have" is answered
 * once: the landing page draws its tiles from `PROJECT_SECTIONS`, and every page
 * under the project draws its strip from the same list.
 *
 * A section is somewhere to go, and most of them are pages: CONCEPTS is the sheet archive that used
 * to be a tab of its own, and NOTES and LINKS are the shelves beside it. MUSIC is the exception - it
 * is a window docked over the board, so its `href` is the board's address carrying the archive's own
 * query (see app/lib/audio/music-window.ts). A reader pressing either kind of href ends up somewhere
 * they can read; only one of them moves them off the page they were on.
 */
export type ProjectSection = {
  /** Stable key, also what `current` is matched against on the strip. */
  id: string;
  label: string;
  href: string;
  /** One line under the label, on the landing page's tile. */
  summary: string;
  /** What the shelf is for, in the section's own words. */
  note: string;
};

export type ArchiveProject = {
  id: string;
  title: string;
  /** The line under the title where the project is listed. */
  subtitle: string;
  href: string;
  summary: string;
};

export const DEBASER_PROJECT: ArchiveProject = {
  id: 'debaser',
  title: 'DEBASER PROJECT',
  subtitle: 'THE COMIC, ITS MUSIC, ITS NOTES, ITS LINKS',
  href: '/projects/debaser',
  summary:
    'The serialized comic and everything around it: the hand-drawn concept sheets, the score, the working notes and the links worth keeping.',
};

/**
 * The projects the archive holds, in the order the home page lists them.
 *
 * One entry today - the debaser project - and the home page is a map rather than a
 * fixed block, so a second project is one more entry here plus its own page.
 */
export const ARCHIVE_PROJECTS: ArchiveProject[] = [DEBASER_PROJECT];

export const PROJECT_SECTIONS: ProjectSection[] = [
  {
    id: 'concepts',
    label: 'CONCEPTS',
    href: '/concepts',
    summary: 'The hand-drawn concept sheets.',
    note: 'Visual development, one sheet per window, each carrying its own comment thread on the board.',
  },
  {
    id: 'lore',
    label: 'LORE',
    href: '/lore',
    summary: 'The world, written down.',
    note: 'The lore pages: what the world is made of, written by whoever has a page open and merged as it is typed.',
  },
  {
    id: 'music',
    label: 'MUSIC',
    // The one shelf that is a window rather than a page: the archive docks beside the board, so its
    // address is the board's with the archive's own query (`lib/audio/music-window.ts`).
    href: '/forum?music=1',
    summary: 'The score, and the rough mixes.',
    note: 'The netlabel shelf: every release the archive holds, filed by artist and sorted by tag - opened beside the thread you are reading, with `[ INJECT TO POST ]` on any row.',
  },
  {
    id: 'notes',
    label: 'NOTES',
    href: '/notes',
    summary: 'Working notes and house rules.',
    note: 'How the archive is built and how a post, a sheet or a lamp is meant to work - written down where it can be read.',
  },
  {
    id: 'links',
    label: 'LINKS',
    href: '/links',
    summary: 'Everywhere else worth going.',
    note: 'Every shelf the archive keeps, plus the outbound links that are filed by hand.',
  },
];

export function projectSection(id: string): ProjectSection | undefined {
  return PROJECT_SECTIONS.find((section) => section.id === id);
}
