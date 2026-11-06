/**
 * ANIMATE's paint: what a person draws with and marks their rows with. Data, not the site's look, so the token guard skips this file
 * (`scripts/check-tokens.cjs`), as it does a name's swatch. The panels themselves take their colours from the tokens.
 */
import type { Swatch } from './types';

/** The starting palette: the site's dyes, plus the greys and skin-neutral tones a figure needs. A person's own swatches replace these. */
export const DEFAULT_PALETTE: Swatch[] = [
  { name: 'BLACK', colour: '#000000' },
  { name: 'NIGROSINE', colour: '#1a1525' },
  { name: 'ASH', colour: '#3d3c44' },
  { name: 'GREY', colour: '#8c8b93' },
  { name: 'WHITE', colour: '#ffffff' },
  { name: 'ROYAL', colour: '#1d3ca6' },
  { name: 'DAFFODIL', colour: '#fff000' },
  { name: 'FLAVINE', colour: '#e1ff00' },
  { name: 'PINK', colour: '#ff00a0' },
  { name: 'ROSE', colour: '#e6004c' },
  { name: 'EMERALD', colour: '#28c745' },
  { name: 'CANDY', colour: '#ffb7e6' },
  { name: 'SALMON', colour: '#ff9da2' },
  { name: 'TANGERINE', colour: '#ff9368' },
  { name: 'MINT', colour: '#67dca9' },
  { name: 'ORCHID', colour: '#b149aa' },
];

export const DEFAULT_INK = '#000000';
export const DEFAULT_BACKGROUND = '#ffffff';
export const ONION_PREV = '#e6004c';
export const ONION_NEXT = '#28c745';
/** Rough's blue wash. */
export const ROUGH_TINT = '#1d3ca6';
/** The closures' helper lines: cyan, because nothing else on the sheet is. */
export const CLOSURE_COLOUR = '#00e5ff';
/** The fill's hover preview. */
export const FILL_PREVIEW = '#ff00a0';
/** The selection's outline over any drawing. */
export const SELECTION_INK = '#ff00a0';
export const SAFE_AREA = '#1d3ca6';

/** The labels offered on a layer row. */
export const LABEL_COLOURS = ['#e6004c', '#ff9368', '#fff000', '#28c745', '#1d3ca6', '#b149aa', '#ff00a0', '#8c8b93'];

/** The built-in tags' chips. */
export const TAG_COLOURS = {
  figure: '#ff9368',
  ink: '#8c8b93',
  rough: '#67dca9',
  shade: '#b149aa',
  background: '#c5ff3f',
  reference: '#ffb7e6',
  fx: '#ff00a0',
  notes: '#fff000',
} as const;

/** A readable colour for words on a chip of this colour: black or white, whichever has more contrast. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => {
    const v = ((n >> shift) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const light = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return light > 0.179 ? '#000000' : '#ffffff';
}
