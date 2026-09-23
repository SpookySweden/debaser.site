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
  /** What gets stored on the profile and drawn on the page. */
  hex: string;
};

export const NAME_COLOURS: NameColour[] = [
  { id: 'black', label: 'BLACK', hex: '#000000' },
  { id: 'nigrosine', label: 'NIGROSINE', hex: '#1a1525' },
  { id: 'royal-blue', label: 'ROYAL BLUE', hex: '#1d3ca6' },
  { id: 'emerald', label: 'EMERALD', hex: '#28c745' },
  { id: 'rose', label: 'ROSE', hex: '#e6004c' },
  { id: 'brilliant-pink', label: 'BRILLIANT PINK', hex: '#ff00a0' },
  { id: 'flavine', label: 'FLAVINE', hex: '#e1ff00' },
  { id: 'daffodil', label: 'DAFFODIL YELLOW', hex: '#fff000' },
];

/** The default: usernames are drawn in the page's own black. */
export const DEFAULT_NAME_COLOUR = '';

/**
 * The surfaces a name is read on.
 *
 * A username is printed on the paper of a post card and on the Flavine field a panel is read on, so
 * those are the two backgrounds the arithmetic below asks about. Flavine is the stricter of the two,
 * which is why a swatch can pass on a post and still be hard to find in a list.
 */
const NAME_BACKGROUNDS = ['#ffffff', '#e1ff00'];

/** How well a swatch reads as a name on the page: the worst of those two, as a ratio from 1 to 21. */
export function nameColourContrast(hex: string): number {
  return Math.min(...NAME_BACKGROUNDS.map((paper) => contrastRatio(hex, paper)));
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
