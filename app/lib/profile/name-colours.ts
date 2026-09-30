import { contrastRatio } from '../ui/colour';
import type { PublicProfile } from './types';

/**
 * The colours a username can be drawn in.
 *
 * This is the *account's* copy of the swatch, and it is the same eight the chrome is dyed with
 * (`app/globals.css`). It used to be the sixteen a VGA browser could paint without dithering, which
 * read as a second palette sitting beside the first: a site whose every surface is one of eight dyes
 * cannot then offer a username in `olive`. Offering the dye pot itself is also the more interesting
 * choice, because there are fewer of them and each one is already loaded with a meaning on this site
 * - a Rose name is the colour things are pinned in, an Emerald one is the colour that means "go".
 *
 * Nothing here is generated: a name is either one of these or the page's own black, so a profile can
 * never end up with an unreadable or off-brand colour.
 *
 * The set is kept whole, and split in two further down by how it *reads* rather than by how it looks:
 * `INK` for a name the page cannot swallow, `GLOW` for one the page shows through. The picker draws
 * them as those two rows, which is the honest way to offer a Flavine name - next to a note saying
 * what it will do.
 */
export type NameColour = {
  /** Stable key, also the swatch's tooltip. */
  id: string;
  label: string;
  /** What gets stored on the profile, and what is drawn where the field is light. */
  hex: string;
  /**
   * The same *choice* where the field is dark.
   *
   * A `NameColour` is a pair, and the second value is not a nicety: the token that carries a name has to
   * move with the field, and a name colour is the one ink on this site that is chosen by a reader rather
   * than by a stylesheet. The light theme's field is White and Flavine, the dark theme's is Nigrosine, and
   * **no single dye reads on all three** - a colour dark enough for White (Black, 21:1) is invisible on
   * Nigrosine (1.18:1), and a colour light enough for Nigrosine (White, 17.83:1) is White on White. So the
   * *choice* is kept and its value is restated where the field is dark, which is what the row split below
   * is judged on: a swatch is `INK` only if it reads in both themes.
   *
   * The counterparts are the palette's own answer rather than a tint: Black becomes Pure White (the same
   * ink, moved), Nigrosine becomes Flavine and Royal Blue becomes Daffodil (the two light dyes, and the
   * only ones that read on Nigrosine) - and the light dyes stay themselves, because they already read
   * there. Rose becomes Brilliant Pink, the lighter of the two hot dyes, and the rest do not move.
   */
  dark: string;
};

export const NAME_COLOURS: NameColour[] = [
  { id: 'black', label: 'BLACK', hex: '#000000', dark: '#ffffff' },
  { id: 'nigrosine', label: 'NIGROSINE', hex: '#1a1525', dark: '#e1ff00' },
  { id: 'royal-blue', label: 'ROYAL BLUE', hex: '#1d3ca6', dark: '#fff000' },
  { id: 'emerald', label: 'EMERALD', hex: '#28c745', dark: '#28c745' },
  { id: 'rose', label: 'ROSE', hex: '#e6004c', dark: '#ff00a0' },
  { id: 'brilliant-pink', label: 'BRILLIANT PINK', hex: '#ff00a0', dark: '#ff00a0' },
  { id: 'flavine', label: 'FLAVINE', hex: '#e1ff00', dark: '#e1ff00' },
  { id: 'daffodil', label: 'DAFFODIL YELLOW', hex: '#fff000', dark: '#fff000' },
];

/** The default: usernames are drawn in the page's own black. */
export const DEFAULT_NAME_COLOUR = '';

/**
 * The surfaces a name is read on, per theme.
 *
 * A username is printed on the paper of a post card and on the Flavine field a panel is read on, so those
 * are the two backgrounds the arithmetic below asks about in the light theme. Flavine is the stricter of
 * the two, which is why a swatch can pass on a post and still be hard to find in a list. The dark theme
 * has one field tone (see `app/lib/ui/themes.ts`), so it is one background - and it is asked about with the
 * swatch's *dark* value, because that is what a reader in that theme actually sees.
 */
const FIELD_TONES: Record<'light' | 'dark', string[]> = {
  light: ['#ffffff', '#e1ff00'],
  dark: ['#1a1525'],
};

/**
 * How well a swatch reads as a name: the worst of *both* themes, as a ratio from 1 to 21.
 *
 * The worst rather than the light theme's own number, because a name is the one ink on this site that an
 * account chooses and everybody else then reads. A swatch that is legible in one theme and invisible in
 * the other is not a colour - it is a theme-dependent accident, and the demo account's Royal Blue name
 * measured 1.91:1 on the dark field before this. A colour that is not on the swatch (a caller passing a
 * hex straight through) is judged on the light field alone, which is what the old arithmetic did.
 */
export function nameColourContrast(hex: string): number {
  const swatch = NAME_COLOURS.find((colour) => colour.hex === hex);
  const values = swatch === undefined ? { light: [hex], dark: [] } : { light: [hex], dark: [swatch.dark] };

  return Math.min(
    ...FIELD_TONES.light.flatMap((tone) => values.light.map((value) => contrastRatio(value, tone))),
    ...FIELD_TONES.dark.flatMap((tone) => values.dark.map((value) => contrastRatio(value, tone))),
  );
}

/**
 * The value a stored swatch is drawn in where the field is dark.
 *
 * `undefined` for a colour that is not on the swatch, which leaves `ProfileName` with the one value a
 * caller gave it - the same behaviour as before this pair existed.
 */
export function nameColourDark(hex: string): string | undefined {
  return NAME_COLOURS.find((colour) => colour.hex === hex)?.dark;
}

/** What WCAG asks of body text. The words are here so the numbers below are not a mystery. */
const READABLE = 4.5;

/**
 * The palette, split by what the arithmetic says rather than by what somebody remembered.
 *
 * The picker used to hand-write a list of four swatches as "hard to read on the white pages", and the
 * arithmetic disagrees with it: eleven of the sixteen sit below the line on at least one of the two
 * surfaces, and two of the four it named are not even the worst of them. So both groups are computed
 * here, once, and the picker draws them as two rows - `INK` (a name the page cannot swallow) and
 * `GLOW` (a name the page shows through, which is a taste and not a fault).
 *
 * **`INK` means "in both themes" now.** The number behind the split is the worst of the light field and
 * the dark one (see `nameColourContrast`), so a swatch whose dark counterpart does not read is a `GLOW`
 * whatever it does on a white page. Black, Nigrosine and Royal Blue come through because they are
 * restated as Pure White, Flavine and Daffodil where the field is dark - so the row a reader picks "a
 * name that reads" from is a row that reads wherever the site is read.
 */
export const NAME_COLOURS_THAT_READ = NAME_COLOURS.filter((colour) => nameColourContrast(colour.hex) >= READABLE);

export const NAME_COLOURS_THAT_GLOW = NAME_COLOURS.filter((colour) => nameColourContrast(colour.hex) < READABLE);

/**
 * Swatches that are hard to read on the page's white/grey panels: the `GLOW` row, by definition.
 *
 * Kept as a list of hexes because it is what the picker's own marker asked for, and derived from the
 * arithmetic so it cannot drift away from the two rows it names.
 */
export const LOW_CONTRAST_NAME_COLOURS = NAME_COLOURS_THAT_GLOW.map((colour) => colour.hex);

export function isNameColour(hex: string): boolean {
  return NAME_COLOURS.some((colour) => colour.hex === hex);
}

/** The stored swatch hex, or undefined for a profile that never picked one. */
export function profileNameColour(profile: PublicProfile | null | undefined): string | undefined {
  const chosen = profile?.nameColour;
  if (chosen === undefined || chosen.length === 0) return undefined;
  return isNameColour(chosen) ? chosen : undefined;
}

export function nameColourLabel(hex: string): string {
  return NAME_COLOURS.find((colour) => colour.hex === hex)?.label ?? 'DEFAULT';
}

/** The swatch hex for one of the sixteen by name, e.g. `green` -> `#008000`. */
export function nameColourHex(id: string): string | undefined {
  return NAME_COLOURS.find((colour) => colour.id === id)?.hex;
}
