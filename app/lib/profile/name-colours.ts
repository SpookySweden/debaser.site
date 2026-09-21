import type { PublicProfile } from './types';

/**
 * The colours a username can be drawn in.
 *
 * A fixed swatch of the sixteen saturated colours an old browser could paint
 * without dithering - the VGA/HTML 3.2 set: black, maroon, green, olive, navy,
 * purple, teal, silver, grey, red, lime, yellow, blue, fuchsia, aqua, white.
 * Nothing here is generated: a name is either one of these sixteen or black, so
 * a profile can never end up with an unreadable or off-brand colour.
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
  { id: 'maroon', label: 'MAROON', hex: '#800000' },
  { id: 'green', label: 'GREEN', hex: '#008000' },
  { id: 'olive', label: 'OLIVE', hex: '#808000' },
  { id: 'navy', label: 'NAVY', hex: '#000080' },
  { id: 'purple', label: 'PURPLE', hex: '#800080' },
  { id: 'teal', label: 'TEAL', hex: '#008080' },
  { id: 'silver', label: 'SILVER', hex: '#c0c0c0' },
  { id: 'grey', label: 'GREY', hex: '#808080' },
  { id: 'red', label: 'RED', hex: '#ff0000' },
  { id: 'lime', label: 'LIME', hex: '#00ff00' },
  { id: 'yellow', label: 'YELLOW', hex: '#ffff00' },
  { id: 'blue', label: 'BLUE', hex: '#0000ff' },
  { id: 'fuchsia', label: 'FUCHSIA', hex: '#ff00ff' },
  { id: 'aqua', label: 'AQUA', hex: '#00ffff' },
  { id: 'white', label: 'WHITE', hex: '#ffffff' },
];

/** The default: usernames are drawn in the page's own black. */
export const DEFAULT_NAME_COLOUR = '';

/** Swatches that are hard to read on the page's white/grey panels. */
export const LOW_CONTRAST_NAME_COLOURS = ['#ffffff', '#c0c0c0', '#ffff00', '#00ff00'];

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
