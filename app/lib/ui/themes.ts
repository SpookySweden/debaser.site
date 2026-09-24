/**
 * The site's colour themes, as data.
 *
 * A theme is a name and a map of the `@theme` token names to hexes - nothing else. It is deliberately
 * *not* a stylesheet per theme: the tokens are what every component already asks for (`bg-sun`,
 * `text-ena`), so a theme is the set of values behind those names and switching one is a matter of
 * writing different values onto `<html>`. No component learns that themes exist, and none writes a hex.
 *
 * `DEFAULT_THEME` is the site as it has always been, recorded here so that "the default" is a name
 * rather than an absence - which is what makes it selectable after somebody has tried another one.
 *
 * The contrast floors are the same for every theme and are held by `Temp/check-themes.cjs`: an ink and
 * the surface it sits on must clear 4.5:1, whichever theme is on. A theme that cannot do that is not a
 * theme, it is an unreadable site - so the check runs the arithmetic over every one of them rather
 * than trusting that a dark palette was chosen carefully.
 */

export type ThemeId = 'default' | 'dark';

/** Every token a theme has to define. The nine dyes, plus the two furniture surfaces. */
export type ThemeTokens = {
  /** The ink on the *field*: prose, labels, anything read on `paper`/`sun-pale`. */
  ink: string;
  /**
   * The ink on a *plate*: a control's face, a status bar, a coloured badge.
   *
   * A second ink rather than one, and the arithmetic is why. On the default theme the two are the same
   * colour, so nothing needed to say so. On a dark theme they cannot be: the field is Nigrosine and
   * wants Pure White (17.83:1), while a Daffodil plate against that same changing ink would be
   * 1.19:1 - a plate label nobody could read. So the pair is split, and every control that draws a
   * label on a coloured face asks for this one. It is Black in both themes today, because Daffodil and
   * Emerald are too bright to carry anything else.
   */
  'ink-plate': string;
  /** The field a page is read on. Prose is set on this. */
  paper: string;
  /** The quiet dark furniture: a disabled plate, and the press. */
  chrome: string;
  /** The quiet pale furniture: an inactive title bar. */
  'chrome-dark': string;
  /** Royal Blue: the title bar of the window you are in. */
  ena: string;
  /** Nigrosine: the desktop's tile, and the deep field. */
  'ena-deep': string;
  /** Daffodil: every plate's face. */
  sun: string;
  /** Flavine: the pale field panels are read on. */
  'sun-pale': string;
  ice: string;
  'ice-pale': string;
  bubble: string;
  'bubble-pale': string;
  acid: string;
  'acid-pale': string;
};

export type Theme = {
  id: ThemeId;
  /** What the picker calls it. */
  label: string;
  /** One line on what it is for, shown under the label. */
  note: string;
  /** True while this is not a finished look - the picker says so rather than pretending. */
  experimental?: boolean;
  tokens: ThemeTokens;
};

/**
 * The site as it stands. Every value here is the one already in `globals.css`, so selecting this theme
 * is indistinguishable from the site having no theme system at all - which is the point: the default
 * has to be the thing that was already there, not a look that happens to resemble it.
 */
export const DEFAULT_THEME: Theme = {
  id: 'default',
  label: 'DEBASER',
  note: 'THE ARCHIVE AS IT STANDS: FLAVINE FIELDS, DAFFODIL PLATES, ROYAL BLUE TITLE BARS.',
  tokens: {
    ink: '#000000',
    // On the default theme the two inks are the same colour. They are still separate tokens, because
    // a theme that needs them to differ must not have to invent one - see `DARK_THEME`.
    'ink-plate': '#000000',
    paper: '#ffffff',
    chrome: '#1a1525',
    'chrome-dark': '#e1ff00',
    ena: '#1d3ca6',
    'ena-deep': '#1a1525',
    sun: '#fff000',
    'sun-pale': '#e1ff00',
    ice: '#e1ff00',
    'ice-pale': '#e1ff00',
    bubble: '#ff00a0',
    'bubble-pale': '#e6004c',
    acid: '#28c745',
    'acid-pale': '#e1ff00',
  },
};

/**
 * The dark theme, and it is genuinely experimental - the picker says so rather than pretending.
 *
 * Nine colours and no grey is what makes this hard. A dark site usually leans on a grey to be *quiet*
 * in, and there is no grey here; what it has instead is Nigrosine, which is already the desktop's own
 * tile colour and light enough for Pure White to sit on at 17.83:1. So the field becomes Nigrosine,
 * and the two furniture surfaces invert onto the darks.
 *
 * The split ink is the whole trick: **`ink` is Pure White so prose reads on the dark field, and
 * `ink-plate` stays Black** so a label on a Daffodil plate is 17.72:1 rather than the 1.19:1 that
 * white on Daffodil would be. A dark theme that changed one ink would be a dark theme with unreadable
 * buttons, which is why the token pair exists at all.
 */
export const DARK_THEME: Theme = {
  id: 'dark',
  label: 'NIGROSINE',
  note: 'EXPERIMENTAL. THE FIELD GOES DARK; THE PLATES KEEP THEIR COLOUR AND THEIR BLACK LABELS.',
  experimental: true,
  tokens: {
    // White prose on the Nigrosine field: 17.83:1.
    ink: '#ffffff',
    // Black on Daffodil (17.72:1), Emerald (9.35:1) and Rose (4.47:1) - the plates do not change, so
    // neither does the ink that reads on them.
    'ink-plate': '#000000',
    // The field prose is read on. Nigrosine, not Black: Black is the bevel, and a site with no grey
    // needs the two darks to stay distinct or every edge disappears.
    paper: '#1a1525',
    // The disabled plate. Pale, read in the field ink - and that is the only pair that holds in both
    // themes. A *dark* plate was tried first, because "disabled" reads as pressed in, but the ink that
    // goes on a dark field (`paper`) flips lightness between themes and so cannot be fixed:
    // Pure White on Nigrosine is 17.83:1 in the default and Nigrosine on Black is 1.18:1 here, so no
    // single dark surface works for both. `chrome-dark` is pale in both (Flavine, then Royal Blue) and
    // this theme's `ink` is White, so the pair holds at 9.34:1. The plate is *faded* rather than
    // *pressed in*, which is the trade the palette forces and the check is what found.
    chrome: '#1d3ca6',
    // The inactive title bar. Royal Blue, because it is the one dye light enough to carry White
    // (9.34:1) and still read as the site's own blue.
    'chrome-dark': '#1d3ca6',
    ena: '#1d3ca6',
    'ena-deep': '#000000',
    // Daffodil and Flavine keep their jobs, but the *fields* they were used for go dark.
    sun: '#fff000',
    'sun-pale': '#1a1525',
    ice: '#1a1525',
    'ice-pale': '#000000',
    bubble: '#ff00a0',
    'bubble-pale': '#e6004c',
    acid: '#28c745',
    'acid-pale': '#1a1525',
  },
};

export const THEMES: readonly Theme[] = [DEFAULT_THEME, DARK_THEME];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}

/** The token names, so the applier and the check walk the same list. */
export const THEME_TOKEN_NAMES = Object.keys(DEFAULT_THEME.tokens) as (keyof ThemeTokens)[];
