/**
 * Colour as this site uses it: a hue given a *weight*, and two colours asked how well one reads on
 * the other.
 *
 * Both jobs came out of the same review. A tag's colour used to be painted across its whole chip, and
 * sixteen pastels across a board read as confetti; a username's colour is offered as sixteen swatches,
 * ten of which are hard to read on the page they get printed on. The fix is the same idea in both
 * places - keep the hue the person chose and let a rule decide its weight - so the arithmetic lives
 * here, once, instead of in two modules that would drift apart.
 */

export type Hsl = {
  /** 0-360. */
  h: number;
  /** 0-100. */
  s: number;
  /** 0-100. */
  l: number;
};

/** `#rgb` or `#rrggbb` to HSL, or null for anything else. */
export function hexToHsl(hex: string): Hsl | null {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (digit) => digit + digit) : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const red = parseInt(full.slice(0, 2), 16) / 255;
  const green = parseInt(full.slice(2, 4), 16) / 255;
  const blue = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l: lightness * 100 };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === red
      ? 60 * (((green - blue) / delta) % 6)
      : max === green
        ? 60 * ((blue - red) / delta + 2)
        : 60 * ((red - green) / delta + 4);

  return { h: (hue + 360) % 360, s: saturation * 100, l: lightness * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;

  const [red, green, blue] =
    hue < 60
      ? [chroma, second, 0]
      : hue < 120
        ? [second, chroma, 0]
        : hue < 180
          ? [0, chroma, second]
          : hue < 240
            ? [0, second, chroma]
            : hue < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];

  const channel = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** WCAG's relative luminance. An unreadable value is treated as black, which is what a browser does. */
export function relativeLuminance(hex: string): number {
  const hsl = hexToHsl(hex);
  if (hsl === null) return 0;

  const [red, green, blue] = hslToHex(hsl)
    .slice(1)
    .match(/.{2}/g)!
    .map((pair) => {
      const channel = parseInt(pair, 16) / 255;

      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG's contrast ratio: 1 (the same colour) to 21 (black on white). */
export function contrastRatio(ink: string, paper: string): number {
  const a = relativeLuminance(ink);
  const b = relativeLuminance(paper);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The weight a *mark* wears: a colour at a fixed lightness and calm saturation, hue untouched.
 *
 * A mark is the small square this site puts in front of a label - a tag's key, a swatch in a picker -
 * and it needs a different weight from a colour that fills something. Too light and it disappears
 * against the chip it sits on; too dark and every hue turns to mud; at full saturation sixteen of them
 * together are a bag of sweets. One rule for all of them is what makes a palette read as a palette:
 * a colour picked before this rule existed still tells you which tag it is, and it does it quietly.
 */
export const MARK_LIGHTNESS = 38;
export const MARK_SATURATION = 42;

/** Below this a mark is indistinguishable from the outline drawn around it. */
export const MARK_FLOOR = 24;

export function markColour(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl === null) return hex;

  return hslToHex({
    h: hsl.h,
    s: Math.min(hsl.s, MARK_SATURATION),
    l: Math.min(Math.max(hsl.l, MARK_FLOOR), MARK_LIGHTNESS),
  });
}
