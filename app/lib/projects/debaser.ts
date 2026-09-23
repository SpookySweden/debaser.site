/**
 * The project the archive is built around.
 *
 * The home page lists projects, and each project owns a landing page that gathers
 * its parts, so this module is where "which parts does DEBASER have" is answered
 * once: the landing page draws its tiles from `PROJECT_SECTIONS`, and every page
 * under the project draws its strip from the same list.
 *
 * A section is a page, not a folder: CONCEPTS is the sheet archive that used to be
 * a tab of its own, and MUSIC, NOTES and LINKS are the shelves beside it.
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
    id: 'music',
    label: 'MUSIC',
    href: '/music',
    summary: 'The score, and the rough mixes.',
    note: 'Every file the archive holds, in one directory: the tracks filed by hand, what has been uploaded to the shelf, and every MP3 attached to a post on the board - sorted by audio tag and played from the bar at the foot of the window.',
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
