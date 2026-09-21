/**
 * The notes shelf.
 *
 * Notes are written, not drawn, so they live here as text rather than as files -
 * one entry per note, in the order they should be read. They are written in the
 * archive's own voice about the archive itself (how a sheet is filed, what a lamp
 * means, who a post is signed by), which keeps the page true; lore and working
 * notes can be filed the same way, one entry at a time.
 *
 * Adding a note: append an entry with a stable id, a stamp, one or more `kinds`
 * and the paragraphs of the body. Nothing else has to change - the page and the
 * project landing page both read this list.
 */
export type ProjectNote = {
  /** Stable key, also the anchor id for links from elsewhere. */
  id: string;
  title: string;
  /** Shelves the note belongs on, printed as chips. */
  kinds: string[];
  /** ISO stamp, printed through `<TimeStamp />`. */
  filed: string;
  /** Paragraphs, top to bottom. */
  body: string[];
  /** A page to read next, when the note is about one. */
  href?: string;
  hrefLabel?: string;
};

export const PROJECT_NOTES: ProjectNote[] = [
  {
    id: 'note-filing-a-sheet',
    title: 'FILING A CONCEPT SHEET',
    kinds: ['HOUSE RULES', 'ARTWORK'],
    filed: '2026-09-21T09:00:00.000Z',
    body: [
      'Every drawing for this site is hand-drawn on a Kamvas tablet and kept in the project assets folder as a plain file. Nothing on these pages draws a character, an icon or an illustration in code, and nothing is generated: if a picture is missing, the page prints a notice naming the path it wanted rather than inventing a stand-in.',
      'A sheet is filed in three steps. Save the PNG as assets/concepts/concept-sheet-NN.png, add one entry to the concept manifest with its title, caption and pixel size, and the sheet window, the sheet index and the board picker all pick it up. The manifest entry is also what gives the picture its own forum thread, which the comment control under the artwork pops open.',
    ],
    href: '/concepts',
    hrefLabel: '[ CONCEPT ARCHIVE ]',
  },
  {
    id: 'note-what-the-lamp-means',
    title: 'WHAT THE LAMP MEANS',
    kinds: ['PRESENCE', 'ACCOUNTS'],
    filed: '2026-09-21T08:30:00.000Z',
    body: [
      'The square lamp beside a username is read off the clock rather than off a flag, so a tab that was closed without saying goodbye still ages out of green: two minutes of silence and the account is no longer at the keyboard, an hour and it is no longer recent, and after that the lamp is red.',
      'Debaser.site wears no lamp on the board. A post an item owns is signed by the archive even though a comment from a visitor is what opened it, so a lamp there would report that visitor rather than the account. The user directory is about accounts, so the house account does draw one there.',
    ],
    href: '/users',
    hrefLabel: '[ USER DIRECTORY ]',
  },
  {
    id: 'note-who-signs-a-post',
    title: 'WHO A POST IS SIGNED BY',
    kinds: ['BOARD', 'HOUSE RULES'],
    filed: '2026-09-21T08:00:00.000Z',
    body: [
      'A thread opened by the comment control on an asset or a text box is not a post somebody wrote: it is that item collecting its comments. The header therefore names the site rather than whoever typed first, and the comment underneath carries the account that actually said it.',
      'Anything written straight onto the board keeps naming the account that filed it, and guests post as Anonymous until they sign in. The rule lives in one place so the board, the search and the account filter never disagree about it.',
    ],
    href: '/forum',
    hrefLabel: '[ MESSAGE BOARD ]',
  },
  {
    id: 'note-where-the-archive-fits',
    title: 'WHERE THIS ARCHIVE FITS',
    kinds: ['PRODUCTION'],
    filed: '2026-09-21T07:30:00.000Z',
    body: [
      'The project is the comic and everything around it. Concept sheets are the visual development, music is the score, notes are how the archive is built, and links are the shelves worth going back to - the board, the conversations and the directory of accounts belong to the site as a whole rather than to any one shelf.',
      'The header keeps the site tabs. Everything that belongs to the project is reached from the project page, which is listed on the home page under PROJECTS.',
    ],
    href: '/projects/debaser',
    hrefLabel: '[ DEBASER PROJECT ]',
  },
];
