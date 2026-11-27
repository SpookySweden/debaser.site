import { NAME_COLOURS } from '../profile/name-colours';
import { contrastRatio } from './colour';
import { DYES } from './themes';
import type { Explanation } from './explain';

/**
 * The modules: what the top bar's keys are called (Luke, 2026-11-06). Each person ticks which ones appear on their bar, and may give each one a colour its word
 * turns on hover. Pure, so a check can hold it. An unticked module's address still works; only its key goes.
 */

export type ModuleKey = 'home' | 'forum' | 'web' | 'comic' | 'read' | 'tagstation' | 'recommendations' | 'docs' | 'beatbox' | 'cytube' | 'animate' | 'leaguebot' | 'browser' | 'modules';

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /** Null for MODULOS, the key at the end, which opens the list rather than going anywhere. */
  href: string | null;
  group: 'site' | 'creative';
  /** On the bar until somebody says otherwise. */
  startsOn: boolean;
  /** Still being made: wears a WIP tag on the bar and in the list (Luke, 2026-11-06). */
  wip?: boolean;
  /** Can't be unticked: the way back to this list. */
  always?: boolean;
  /** The colour its word turns on hover until somebody picks another (a `NAME_COLOURS` id). */
  defaultColour?: string;
  /** What its key explains on hover while EXPLAIN is on (`./explain.ts`): what the page is and what it's for. */
  explain: Explanation;
};

/** The caution a WIP module's key carries. */
const STILL_BEING_MADE = 'STILL BEING MADE: PARTS MAY NOT WORK YET.';

/** In the order the bar draws them, MODULOS last. Luke's choice: BEATBOX, ANIMATE and DISCOVER start off and are tagged WIP, and CREATIVE holds BEATBOX, STREAM and ANIMATE. */
export const MODULES: readonly ModuleDef[] = [
  // (2026-11-14) A first visit's bar is FORUM, MEDIA and STREAM only (Luke: "only on modules by default being now, forum, media,
  // steam"); PROJECTS, READ and DOCS start off, still a tick away in MODULOS.
  {
    key: 'home',
    label: 'PROJECTS',
    href: '/projects',
    group: 'site',
    startsOn: false,
    explain: {
      what: 'Goes to PROJECTS, the map of every project the site holds.',
      why: 'Each project has a page gathering its parts: for the debaser comic, its concepts, lore, notes and links.',
    },
  },
  // (2026-11-16) The three hover colours are the ones the account "Good morning" chose (read from its saved choices; Luke: "the hover
  // colours the account 'good morning' chose": green, light blue, reddish pink), so a first visit has them and "reset everyone"
  // (modules-slot.ts's new storage key) gives everyone the same.
  {
    key: 'forum',
    label: 'FORUM',
    href: '/forum',
    group: 'site',
    startsOn: true,
    defaultColour: 'emerald',
    explain: {
      what: 'Goes to the FORUM, the board of posts and threads.',
      why: "The site's home and desktop: read and write posts, reply to people, and the windows (music, rooms, letters) open over it.",
    },
  },
  {
    key: 'web',
    label: 'MEDIA',
    href: '/media',
    group: 'site',
    startsOn: true,
    defaultColour: 'teal',
    explain: {
      what: 'Goes to MEDIA, one search over videos, music, films, books and live streams from other platforms and friends\' servers.',
      why: 'With nothing searched it shows a feed picked for you. Play things in their own players, put them in a room, or recommend them.',
    },
  },
  // Luke's comic (SPEC-comic.md): the reader at /comic, his studio at /comic/studio. On the bar for first visits from 2026-11-20 (Q1A)
  // until 2026-11-21 (Luke: "make comic no longer always on"): an ordinary module now, off until ticked. Its colour stays.
  {
    key: 'comic',
    label: 'COMIC',
    href: '/comic',
    group: 'site',
    startsOn: false,
    defaultColour: 'flavine',
    explain: { what: 'Goes to COMIC, where you read the Debaser comic page by page.', why: 'It remembers where you stopped, so CONTINUE picks up from there.' },
  },
  // The reader (Luke, 2026-11-13: "a new module for reading"): your books, and your own PDFs and EPUBs matched to their book.
  // (2026-11-14) Off by default: READ lives on the side panel's shelf under ARCADE instead (DesktopSidebar's ReadKey).
  {
    key: 'read',
    label: 'READ',
    href: '/read',
    group: 'site',
    startsOn: false,
    explain: {
      what: 'Goes to READ, your books in the site\'s own e-reader.',
      why: 'Open books found on MEDIA, or your own PDF and EPUB files, which stay in this browser and are never uploaded.',
    },
  },
  // A map of the words on MEDIA's items (SPEC-tag-station.md, SPEC-discover.md).
  {
    key: 'tagstation',
    label: 'DISCOVER',
    href: '/discover',
    group: 'site',
    startsOn: false,
    wip: true,
    explain: {
      what: 'Goes to DISCOVER, a map of the words (tags) on the things in MEDIA.',
      why: 'Wander from word to word to find music, videos and books you would not have searched for.',
      note: STILL_BEING_MADE,
    },
  },
  // Queues of things sent to people or posted publicly (SPEC-recommendations.md, Luke 2026-11-10): off until ticked.
  {
    key: 'recommendations',
    label: 'RECOMMENDATIONS',
    href: '/recommendations',
    group: 'site',
    startsOn: false,
    explain: {
      what: 'Goes to RECOMMENDATIONS: the things people have sent you, and the ones posted for everyone.',
      why: 'A queue of picks from people you know, to watch, read or listen to when you have time.',
    },
  },
  // Shared live documents in folders, the lore pages among them (SPEC-live-docs.md): on the bar from a first visit (Luke, 2026-11-13: "on for everyone").
  {
    key: 'docs',
    label: 'DOCS',
    href: '/docs',
    group: 'site',
    startsOn: false,
    explain: {
      what: 'Goes to DOCS, the shared documents in folders, the lore pages among them.',
      why: 'Several people can write in the same document at once and see each other typing.',
    },
  },
  // The music maker (app/features/beatbox).
  {
    key: 'beatbox',
    label: 'BEATBOX',
    href: '/beatbox',
    group: 'creative',
    startsOn: false,
    wip: true,
    explain: { what: 'Goes to BEATBOX, the music maker.', why: 'Build beats and tunes from pads and a note grid, and keep your songs.', note: STILL_BEING_MADE },
  },
  {
    key: 'cytube',
    label: 'STREAM',
    href: '/stream',
    group: 'creative',
    startsOn: true,
    defaultColour: 'rose',
    explain: {
      what: 'Goes to STREAM, for watching and listening together.',
      why: 'The live rooms open now, the stream canvases, and GO LIVE to start your own broadcast for others to join.',
    },
  },
  // The frame-by-frame animator (SPEC-animator.md).
  {
    key: 'animate',
    label: 'ANIMATE',
    href: '/animate',
    group: 'creative',
    startsOn: false,
    wip: true,
    explain: { what: 'Goes to ANIMATE, the frame-by-frame animator.', why: 'Draw a picture on each frame and play them in a row to make it move.', note: STILL_BEING_MADE },
  },
  // League of Legends stats, scouting and advice (SPEC-leaguebot.md, Luke 2026-11-17: a top-bar key and a shelf key, 10A+B): off until
  // ticked, WIP until all three tabs are built.
  {
    key: 'leaguebot',
    label: 'LEAGUEBOT',
    href: '/leaguebot',
    group: 'site',
    startsOn: false,
    wip: true,
    explain: {
      what: 'Goes to LEAGUEBOT, League of Legends stats, scouting and advice.',
      why: 'Look up a player\'s matches and champions, size up a game in progress, and get tips from your own play.',
      note: STILL_BEING_MADE,
    },
  },
  // BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md, Luke 2026-11-23): off until ticked, WIP until its phases are built.
  {
    key: 'browser',
    label: 'BROWSER',
    href: '/browser',
    group: 'site',
    startsOn: false,
    wip: true,
    explain: {
      what: 'Goes to BROWSER, the DEBASER SEEING MACHINE: other websites opened inside the site, in its own look.',
      why: 'Type an address or a search and press GO. A page is only fetched when you ask, and nothing of it is kept unless you capture it.',
      note: STILL_BEING_MADE,
    },
  },
  // MODULOS is the tab holding the rest of the modules, Luke's name for it (2026-11-06). The bar's own MODULES: title went on 2026-11-14.
  {
    key: 'modules',
    label: 'MODULOS',
    href: null,
    group: 'site',
    startsOn: true,
    always: true,
    explain: {
      what: 'Opens the MODULOS window: choose which pages have a key on this bar, and the colour each word turns under the pointer.',
      why: 'Hide the pages you never use and bring back the ones you do. A page taken off the bar still works from its address. Saved to your account.',
    },
  },
];

/** Only what somebody changed from the start, so a module's starting state can change later without touching anybody's choices. */
export type ModuleChoices = {
  on: Partial<Record<ModuleKey, boolean>>;
  colours: Partial<Record<ModuleKey, string>>;
};

export const NO_CHOICES: ModuleChoices = { on: {}, colours: {} };

const isModuleKey = (key: string): key is ModuleKey => MODULES.some((module) => module.key === key);

/** Anything stored, from a browser or an account, read back through the same door: unknown keys and colours are dropped, and anything else means no choices. */
export function parseModuleChoices(stored: unknown): ModuleChoices {
  if (typeof stored !== 'object' || stored === null) return NO_CHOICES;
  const { on, colours } = stored as { on?: unknown; colours?: unknown };
  const result: ModuleChoices = { on: {}, colours: {} };
  if (typeof on === 'object' && on !== null) {
    for (const [key, value] of Object.entries(on)) if (isModuleKey(key) && typeof value === 'boolean') result.on[key] = value;
  }
  if (typeof colours === 'object' && colours !== null) {
    for (const [key, value] of Object.entries(colours)) {
      if (isModuleKey(key) && typeof value === 'string' && NAME_COLOURS.some((colour) => colour.id === value)) result.colours[key] = value;
    }
  }
  return result;
}

/** The colour a module's word turns on hover: the one picked, else its own default; undefined for a module with neither. */
export function moduleColour(module: ModuleDef, choices: ModuleChoices): string | undefined {
  return choices.colours[module.key] ?? module.defaultColour;
}

/**
 * Every module with no colour of its own hovers like one that has (Luke, 2026-11-16: the DOCS key's hover was "a big yellow bar" while the
 * others only turn their word a colour): this is the colour it turns. Rose, the reddish pink, is the one the stream key has.
 */
export const FALLBACK_HOVER_COLOUR = 'rose';

export function moduleIsOn(module: ModuleDef, choices: ModuleChoices): boolean {
  return module.always === true || (choices.on[module.key] ?? module.startsOn);
}

export function withTick(choices: ModuleChoices, module: ModuleDef, on: boolean): ModuleChoices {
  if (module.always) return choices;
  const next = { ...choices.on };
  if (on === module.startsOn) delete next[module.key];
  else next[module.key] = on;
  return { ...choices, on: next };
}

/** Null takes the module's colour away. */
export function withColour(choices: ModuleChoices, key: ModuleKey, colourId: string | null): ModuleChoices {
  const next = { ...choices.colours };
  if (colourId === null) delete next[key];
  else next[key] = colourId;
  return { ...choices, colours: next };
}

/** Text must stay readable in every theme (`.claude/rules/frontend.md`). */
const READABLE = 4.5;

/**
 * What a swatch is drawn as on this bar: its own colour if that reads, else its counterpart for dark fields, else null. Null means the key keeps the site's own
 * hover, so a colour chosen on one theme can never make a word vanish on another.
 */
export function moduleInk(colourId: string | undefined, bar: string): string | null {
  const swatch = NAME_COLOURS.find((colour) => colour.id === colourId);
  if (swatch === undefined) return null;
  for (const ink of [swatch.hex, swatch.dark]) if (contrastRatio(ink, bar) >= READABLE) return ink;
  return null;
}

/** How much of the colour is in the highlighter stroke behind a selected module's word; the rest is the bar. */
export const SWIPE_SHARE = 0.28;

/** The least a stroke must differ from the bar to be seen at all (a contrast ratio; 1 is the same colour). */
const STANDS_OFF = 1.15;

/** Two hex colours mixed in sRGB, as CSS `color-mix(in srgb, ...)` does: `share` of `b`, the rest `a`. */
export function mixHex(a: string, b: string, share: number): string {
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [from, to] = [channels(a), channels(b)];
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * share).toString(16).padStart(2, '0')).join('')}`;
}

/** What the module you are on is drawn with: its word's colour and the highlighter stroke behind the lower part of the word. */
export type ModuleMark = { word: string; swipe: string };

/**
 * The selected module's look, from an ink for its word and a colour for its stroke (Luke, 2026-11-14: "the selected text colour is
 * constant and ... it neatly and artistically becomes just a little bit highlighter"). The stroke is a pale tint of the colour on
 * the bar. The word must read both on the bar and on its own stroke (4.5:1): where the colour as picked cannot, the word is stepped
 * towards white on a dark bar, or black on a bright one, a tenth at a time until it does. Same hue, same idea, readable.
 */
export function moduleMarkFrom(ink: string, tint: string, bar: string): ModuleMark {
  const swipe = mixHex(bar, tint, SWIPE_SHARE);
  const far = contrastRatio(DYES.white, bar) >= contrastRatio(DYES.black, bar) ? DYES.white : DYES.black;
  const reads = (word: string) => contrastRatio(word, bar) >= READABLE && contrastRatio(word, swipe) >= READABLE;
  let word = ink;
  for (let step = 1; step <= 10 && !reads(word); step += 1) word = mixHex(ink, far, step / 10);
  if (contrastRatio(swipe, bar) >= STANDS_OFF) return { word, swipe };
  // A colour too near the bar's own (Flavine on the Flavine bar) would leave a stroke nobody can see: tint with the word instead,
  // which has just been made to stand off the bar, and make sure the word still reads on that.
  let shown = word;
  let stroke = mixHex(bar, shown, SWIPE_SHARE);
  for (let step = 1; step <= 10 && contrastRatio(shown, stroke) < READABLE; step += 1) {
    shown = mixHex(word, far, step / 10);
    stroke = mixHex(bar, shown, SWIPE_SHARE);
  }
  return { word: shown, swipe: stroke };
}

/**
 * The mark for a module with a picked colour, or null when none is picked (the stylesheet then uses the site's own inks). A pick that
 * cannot be read as a word on this bar (Emerald on the bright theme's Flavine) still shows: the stroke is its tint, and the word is
 * the same colour stepped darker or lighter until it reads. So a pick made on one theme is never lost on another.
 */
export function moduleMark(colourId: string | undefined, bar: string): ModuleMark | null {
  const swatch = NAME_COLOURS.find((colour) => colour.id === colourId);
  if (swatch === undefined) return null;
  const ink = moduleInk(colourId, bar) ?? (contrastRatio(swatch.hex, bar) >= contrastRatio(swatch.dark, bar) ? swatch.hex : swatch.dark);
  return moduleMarkFrom(ink, ink, bar);
}

/**
 * What a key's word turns on hover, for every key on the bar: the module's own colour (picked, else its default), or the fallback one for a
 * module with neither, read against the bar. A colour that cannot read as it is is stepped as the selected look's is (`moduleMark`), so the
 * hover is always a coloured word and never the old solid block.
 */
export function moduleHoverInk(module: ModuleDef, choices: ModuleChoices, bar: string): string {
  const id = moduleColour(module, choices) ?? FALLBACK_HOVER_COLOUR;
  return moduleInk(id, bar) ?? moduleMark(id, bar)?.word ?? DYES.black;
}

/** The swatches worth offering on this bar: those that read, one for each colour they'd actually draw. The one already picked always stays, so it can be seen. */
export function moduleSwatches(bar: string, picked: string | undefined): { id: string; label: string; ink: string }[] {
  const seen = new Set<string>();
  const offered: { id: string; label: string; ink: string }[] = [];
  for (const colour of NAME_COLOURS) {
    const ink = moduleInk(colour.id, bar);
    if (ink === null) continue;
    const already = seen.has(ink);
    if (already && colour.id !== picked) continue;
    seen.add(ink);
    // Named for what's drawn, not for the choice: on a dark bar BLACK draws white, so the square beside it says WHITE.
    offered.push({ id: colour.id, label: ink === colour.hex ? colour.label : (colour.darkLabel ?? colour.label), ink });
  }
  return offered;
}
