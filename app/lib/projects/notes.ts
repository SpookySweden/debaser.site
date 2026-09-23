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
    id: 'note-what-a-tag-colour-is-for',
    title: 'WHAT A TAG COLOUR IS FOR',
    kinds: ['BOARD', 'HOUSE RULES'],
    filed: '2026-09-23T11:00:00.000Z',
    body: [
      'A tag wears its colour as a small key in front of its label rather than as a coat of paint over the whole chip. That one change is what lets sixteen colours live on one board: the chip stays the neutral grey every other control is drawn in, the key tells you which tag you are looking at, and a page of tags reads as one page instead of a bag of sweets.',
      'The palette is sixteen hues at one weight - the same saturation, the same lightness, only the hue changing - so two tags a step apart are equally strong and none of them shouts. A colour chosen in the tag editor is brought to that same weight before it is drawn, which is why a colour nobody would have picked as a fill still works as a key.',
      'A username colour works the other way round, because a name is ink rather than a mark: the sixteen swatches are offered in two rows, INK for a name the page cannot swallow and GLOW for one the page shows through. The rows are worked out from the contrast arithmetic rather than from taste, so the list of "hard to read" swatches is exactly the glow row and never drifts away from it.',
    ],
    href: '/notes',
    hrefLabel: '[ HOUSE RULES ]',
  },
  {
    id: 'note-what-a-tag-filter-matches',
    title: 'WHAT A TAG FILTER MATCHES',
    kinds: ['BOARD', 'HOUSE RULES'],
    filed: '2026-09-23T12:00:00.000Z',
    body: [
      'A tag can be typed onto a post or onto a reply, and the chooser counts both - a MECHANICS tag left in the reply box is what makes the MECHANICS chip read (1). A filter that read only the post would break that promise, offering a chip that brings nothing when it is pressed, so the filter reads the whole thread and a tag on a reply counts as a tag on the post it answers.',
      'Because those tags are not in the same place, a filtered card says where its match was found. `FILTER MATCH: [MECHANICS] ON THIS POST` needs no more than the one line; a match on a reply reads `IN 1 REPLY BY [name]` and carries a `[ OPEN THE REPLY ]` button, which opens the post and puts that reply on screen with a marker of its own. The tag is the reason the post is on the board at all, so the tag is what the row points at.',
      'The number on a chip counts uses rather than posts - one thread with the same tag on two replies reads (2) and brings one post - and the two numbers are meant to differ: the chip measures the vocabulary, and the board says SHOWING n OF n MATCHING underneath it when a post count is what you are after.',
    ],
    href: '/forum',
    hrefLabel: '[ FORUM BOARD ]',
  },
  {
    id: 'note-the-tag-window',
    title: 'THE TAG WINDOW',
    kinds: ['BOARD', 'HOUSE RULES'],
    filed: '2026-09-23T13:00:00.000Z',
    body: [
      'Every tag the board has is one list, ranked by how much it is used, and that list is a window of its own: `[ ALL TAGS... ]` opens it, it drags about the desktop, and closing it leaves the board exactly as it was. The ranking is the point. What a list of tags is *for* is telling you what is on the board, and that is a count - so nothing is filed by kind, and the same word is not shown twice for being two sorts of thing.',
      'The window has three tabs. MAIN is the index. MUSIC is the board`s own music: a switch that narrows the whole board to posts carrying a track, the sounds the filed files wear - tick one and only the posts whose music wears it stay - and a searcher over the files themselves, by title, artist, sound or poster, in the order you ask for: recently posted, most posted, or by uploader. TEST runs the rules this board is built on against the board as it is right now, one line each, PASS or FAIL: the same promises the scratch checks in `Temp/` hold, asked where the data lives.',
      'A file is "popular" when more posts carry it, and RECENT is when it was last posted. Both are read off the board rather than kept in a column, which is why a hand-written catalogue entry with no post behind it sorts last instead of claiming to be new - and why the /music browser can offer the same three orders (a to z, recent, popular, uploader) without a second source of truth to drift away from.',
    ],
    href: '/forum',
    hrefLabel: '[ FORUM BOARD ]',
  },
  {
    id: 'note-who-may-write-a-lore-page',
    title: 'WHO MAY WRITE A LORE PAGE',
    kinds: ['LORE', 'HOUSE RULES'],
    filed: '2026-09-23T10:00:00.000Z',
    body: [
      'A lore page is a shared document rather than a row: everybody who has it open is typing into the same page, and two versions of a paragraph merge instead of one of them winning. That is why this shelf asks for an account where the board does not - a keystroke has nowhere to go without a name on it, and nothing to sign it with.',
      'The address is read off the title when the page is opened and cannot be changed afterwards, because it is what every link to the page says. A page taken off the shelf takes its address with it, so a link that used to work says plainly that nothing lives there rather than showing a blank page.',
      'What is filed is the document\'s own state, and the same writing as plain text beside it. The state is what the editor opens and keeps merging; the plain text is what a visitor who has not signed in reads, so the writing is never locked away behind an account that only wanted to look.',
    ],
    href: '/lore',
    hrefLabel: '[ LORE SHELF ]',
  },
  {
    id: 'note-the-desktops-chrome',
    title: "THE DESKTOP'S OWN CHROME",
    kinds: ['HOUSE RULES', 'CHROME'],
    filed: '2026-09-23T09:00:00.000Z',
    body: [
      'Every page is drawn inside one window: a title bar, the page, the side panel on the right, and a taskbar along the foot with `[ START ]` at the left of it. Nothing in the chrome belongs to a page - a page hands over its content and, at most, which taskbar key it owns.',
      'The task buttons are the wide window\'s. A phone reaches the same keys, and the project\'s shelves, from the Start menu instead: one list is a better answer than five buttons competing with the Start button for a narrow strip of screen.',
      'The type is a bitmap face (Silkscreen, loaded by app/layout.tsx) with a real bold, because every label on this site is bold. It is deliberately not antialiased: smoothing is what turns a face drawn on a grid into a blurred one. The fallbacks - MS Sans Serif, Courier New - are the faces a desktop of this era actually had.',
      'The teal behind the window is a dither tile, and the pointers are hand-drawn files named in globals.css (assets/cursors/README.txt has the sizes to draw them at). Both are the site\'s furniture rather than its artwork: nothing there draws a character, an icon or a scene, which is the rule the sheets and the sprites answer to.',
    ],
  },
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
