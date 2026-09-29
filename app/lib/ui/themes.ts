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

/**
 * Every token a theme has to define. The nine dyes, plus the furniture surfaces and the desktop.
 *
 * **The rule the three inks exist for, and it is worth saying once here: an ink that *flips* with the
 * theme must sit on a surface that flips with it.** `paper` is White in the default theme and Nigrosine
 * in the dark one; a Royal Blue bar is Royal Blue in both. Put a flipping ink on a stable surface and
 * one of the two themes is unreadable - which is not a hypothetical: 55 rows of this site were
 * `text-paper` on `bg-ena`, white on blue under the default theme and Nigrosine on blue under the dark
 * one, at 1.91:1. A surface that does not move needs an ink that does not move, and the palette needs
 * one of each lightness to do it: `ink-bar` for the dark surfaces, `ink-plate` for the light ones.
 */
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
   *
   * It is the ink for a *light stable* surface. Brilliant Pink is the same pink in both themes and is
   * light enough (relative luminance 0.28) to want Black on it, so a pressed plate and the accent plate
   * ask for this one - `ink-bar` would be 3.65:1 on that same pink.
   */
  'ink-plate': string;
  /**
   * The ink on a coloured *bar*: a chip, a row, a strip whose own colour does not move with the theme.
   *
   * Pure White in both themes, which is what makes it a third ink rather than a second: Royal Blue
   * (9.34:1), Rose (4.70:1), Nigrosine and Black (17.83:1) are all deep in every theme, so the ink
   * that reads on them is the same in every theme. `paper` cannot do this job - it means the field,
   * and the field is what a dark theme changes.
   */
  'ink-bar': string;
  /**
   * The brand ink on the *field*: a label, a timestamp, a name that is printed in the site's own blue.
   *
   * A fourth ink, and it is the same fault as the other three wearing its last costume. `ena` is a
   * *surface* - the desktop, a title bar, a pressed plate - and Royal Blue is a dye that does not move
   * with the theme. `text-ena` was therefore Royal Blue ink: 9.34:1 on the default theme's White field
   * and **1.91:1** on the dark one's Nigrosine, which measured as 19 labels and timestamps on the board
   * that a reader in the dark theme could not read. A dye cannot be a surface and an ink at once once a
   * theme can darken the field, so the ink gets its own token.
   *
   * Royal Blue in the default theme - the same hex `ena` carries, so the default theme's pixels do not
   * move. Daffodil in the dark one (15.04:1 on the field, 17.71:1 on a Black panel), because none of
   * the nine dyes is a blue that reads on Nigrosine and inventing one would be inventing a tenth colour.
   */
  'accent-ink': string;
  /**
   * The caption ink on the *field*: the `text-[9px]` line under a title, a second reading set quiet.
   *
   * `ena-deep` is a *surface* - Nigrosine here, Black in the dark theme, an inset screen either way -
   * and as an ink that pair is legible on a pale field (17.83:1) and invisible on a dark one (Black on
   * Nigrosine is 1.18:1, Black on Black 1:1). So the ink is this token: Nigrosine in the default theme,
   * so nothing moves, and Flavine in the dark one (16.08:1 on the field, 18.94:1 on a Black panel).
   *
   * In the dark theme it lands beside `accent-ink` and the two are close in hue; the hierarchy there is
   * carried by size instead, because a dark field has no *quiet* dye that is still legible - and a second
   * dark would be a grey, which the palette does not have.
   */
  'ink-quiet': string;
  /** The field a page is read on. Prose is set on this. */
  paper: string;
  /** The quiet dark furniture: a disabled plate, and the press. */
  chrome: string;
  /** The quiet pale furniture: an inactive title bar. */
  'chrome-dark': string;
  /**
   * The hardware panel: the Black inset a readout is printed on - a player's screen, the scrim behind a
   * window, the reverse-video chip.
   *
   * It was `ink` for most of this site's life, which read correctly while there was one theme: `bg-hardware`
   * was "a black panel" and `text-paper` on it was "white on black", both true. A dark theme makes both
   * halves false in opposite directions - `bg-hardware` flips to White and `text-paper` to Nigrosine - so the
   * panel turned pale and every Emerald or Daffodil readout printed on it fell to 2.25:1. Black in both
   * themes, because a hardware panel is black before it is anything else, and it is the one surface the
   * field may not borrow.
   */
  hardware: string;
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
  /**
   * The desktop behind the windows: the tile's own fill, which the scrollbar's trough is also made of.
   *
   * The site's largest surface, and until this token existed it was a hex written into `globals.css`, so
   * a dark theme produced the one thing worse than a bright field - a dark page you had just walked to
   * and a Brilliant Pink desktop behind it. A token rather than six browns because the tile is *one*
   * surface with a texture on it, and the two halves have to move together or the dither is a colour
   * nobody chose (Nigrosine on Nigrosine, in the dark theme, is invisible).
   */
  desktop: string;
  /** The dye dithered through `desktop` in 4px squares - the tile's texture, not a second surface. */
  'desktop-dither': string;
  /**
   * The dye a native control's own `accentColor` names: the check on a checkbox, the filled half of a
   * slider, the caret.
   *
   * It has to be a token for the reason a token exists at all: the browser draws these, so no component
   * can style them, and an accent is only legible against the surface it sits on. Royal Blue is 1.91:1
   * against the dark theme's field, and Daffodil is 15.04:1 - so the same dye cannot serve both, and
   * nothing in the markup could have said so.
   */
  accent: string;
};

export type Theme = {
  id: ThemeId;
  /** What the picker calls it. */
  label: string;
  /** One line on what it is for, shown under the label. */
  note: string;
  /** True while this is not a finished look - the picker says so rather than pretending. */
  experimental?: boolean;
  /**
   * What the browser should assume the page is, written to `<html>` as `color-scheme`.
   *
   * It is not a colour and it is not a token: it is the hint the browser uses for the parts of the page
   * *it* draws and no stylesheet can reach - the popup of a `<select>`, the date picker, the default
   * canvas background, the scrollbar where `scrollbar-color` has no support, and the text caret. A dark
   * theme that leaves this at `light` gets a white caret and a white dropdown inside a dark window, and
   * nothing in any component could have fixed it. Declared rather than defaulted so a third theme has to
   * say which it is, and so `Temp/check-themes.cjs` can hold it to one of exactly two values.
   */
  scheme: 'light' | 'dark';
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
  scheme: 'light',
  tokens: {
    ink: '#000000',
    // On the default theme the two inks are the same colour. They are still separate tokens, because
    // a theme that needs them to differ must not have to invent one - see `DARK_THEME`.
    'ink-plate': '#000000',
    // White, and White again: on the default theme the bar ink and the field ink coincide, exactly as
    // `ink` and `ink-plate` do. The tokens are not merged for the same reason - the dark theme needs
    // them apart, and a bar is a bar in either theme.
    'ink-bar': '#ffffff',
    // Royal Blue, the same hex `ena` carries: the two inks below are the *brand* ink and the *quiet*
    // ink, and neither is allowed to be a surface's value. Both are the default theme's existing
    // colours, so a reader who never picks a theme sees exactly what they saw before.
    'accent-ink': '#1d3ca6',
    'ink-quiet': '#1a1525',
    paper: '#ffffff',
    chrome: '#1a1525',
    'chrome-dark': '#e1ff00',
    // Black, and the same Black the default theme has always drawn its panels in - so this token moves
    // nothing here. It exists for the dark theme, where `ink` becomes White and a panel that borrowed it
    // would be a pale screen with Daffodil readouts on it.
    hardware: '#000000',
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
    // The desktop as it has always been: Brilliant Pink with Nigrosine dithered through it. These two
    // are what `globals.css` used to hold as literals, so the default theme is pixel-identical.
    desktop: '#ff00a0',
    'desktop-dither': '#1a1525',
    // Royal Blue, which is what the three native controls on this site asked for before it was a token.
    accent: '#1d3ca6',
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
 *
 * **This theme is a night desktop, not a dark page.** Everything the reader stands on goes dark - the
 * field, the tile behind the windows, the scrollbar's trough, the native controls' own accent - while
 * everything that is *furniture in front of* the reader keeps its dye. A title bar is still Royal Blue, a
 * plate is still Daffodil, and the ink on those is `ink-bar`/`ink-plate`, which do not move. The one
 * thing this theme cannot express, and it is a limit of nine colours rather than of the code: the light
 * theme has two field tones (White and Flavine) and this one has one, so a panel that was *pale* is now
 * the same Nigrosine as the page it sits on and is told apart by its bevel alone.
 */
export const DARK_THEME: Theme = {
  id: 'dark',
  label: 'NIGROSINE',
  note: 'EXPERIMENTAL. THE FIELD GOES DARK; THE PLATES KEEP THEIR COLOUR AND THEIR BLACK LABELS.',
  experimental: true,
  scheme: 'dark',
  tokens: {
    // White prose on the Nigrosine field: 17.83:1.
    ink: '#ffffff',
    // Black on Daffodil (17.72:1), Emerald (9.35:1) and Rose (4.47:1) - the plates do not change, so
    // neither does the ink that reads on them.
    'ink-plate': '#000000',
    // White as well, and it is not `paper` wearing another name: a bar is Royal Blue, Rose or Nigrosine
    // and none of those moves with the theme, so the ink on them must not either. This is the token that
    // makes a title bar, a chip and a forum row readable in both themes at once.
    'ink-bar': '#ffffff',
    // Daffodil, and it is the dye this theme has to reach for: Royal Blue ink on this field is 1.91:1
    // (that is the fault this token was added for) and no blue in the palette is light enough to read
    // on Nigrosine. Daffodil is 15.04:1 here and 17.71:1 on a hardware panel, so a timestamp or a
    // "debaser.site" byline is legible wherever the field puts it.
    'accent-ink': '#fff000',
    // Flavine, 16.08:1. Not White, because White is the field ink and a caption that is exactly the
    // prose colour is not a caption - and not a dark tone either, because a dark caption on a dark
    // field is the pair this token exists to stop.
    'ink-quiet': '#e1ff00',
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
    // Black here too, and this is the token the dark theme actually needed: a readout printed on Black
    // keeps its inks - Emerald 11.90:1, Daffodil 19.56:1, Pure White 21:1 - so the player screens, the
    // scrims and the reverse-video chips look the same in this theme as in the other one. On this field
    // Nigrosine is a whisper away (1.28:1), so a panel drawn in `ena-deep` would read as a hole rather
    // than as an inset screen; Black is the surface that still reads as *drawn on*.
    hardware: '#000000',
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
    // The night desktop: the tile's fill is the field's own Nigrosine and its dither is Black, so the
    // largest surface on the site is the darkest thing on it and the texture is a black-on-nigrosine
    // whisper rather than a colour. It cannot be Black with a Nigrosine dither: the dither is what the
    // eye reads as texture, and Black under Nigrosine squares is 1.28:1 - a tile that reads as flat.
    desktop: '#1a1525',
    'desktop-dither': '#000000',
    // Daffodil, because Royal Blue is 1.91:1 against the field this theme sets and a checkbox nobody can
    // see is a checkbox that is not there. 15.04:1, and it is the dye every plate already wears.
    accent: '#fff000',
  },
};

export const THEMES: readonly Theme[] = [DEFAULT_THEME, DARK_THEME];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}

/** The token names, so the applier and the check walk the same list. */
export const THEME_TOKEN_NAMES = Object.keys(DEFAULT_THEME.tokens) as (keyof ThemeTokens)[];
