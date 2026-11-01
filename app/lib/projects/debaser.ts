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
  /** A short phrase: the hover tip of the section's own page. */
  note: string;
};

export type ArchiveProject = {
  id: string;
  title: string;
  href: string;
  summary: string;
};

export const DEBASER_PROJECT: ArchiveProject = {
  id: 'debaser',
  title: 'DEBASER PROJECT',
  href: '/projects/debaser',
  summary: 'The comic: sheets, lore, score, notes, links.',
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
    note: 'Concept sheets.',
  },
  {
    id: 'lore',
    label: 'LORE',
    href: '/lore',
    summary: 'The world, written down.',
    note: 'Lore pages.',
  },
  {
    id: 'music',
    label: 'MUSIC',
    // The archive's address: the AUDIO tab of the media catalogue, where the shelf lives since
    // 2026-10-24 (`lib/audio/music-window.ts`, MUSIC_HREF). The reader's own music stays a window.
    href: '/media?kind=audio',
    summary: 'The score, and the rough mixes.',
    note: 'The music archive.',
  },
  {
    id: 'notes',
    label: 'NOTES',
    href: '/notes',
    summary: 'Working notes and house rules.',
    note: 'Working notes and house rules.',
  },
  {
    id: 'links',
    label: 'LINKS',
    href: '/links',
    summary: 'Everywhere else worth going.',
    note: 'Every shelf, and links out.',
  },
];

export function projectSection(id: string): ProjectSection | undefined {
  return PROJECT_SECTIONS.find((section) => section.id === id);
}
