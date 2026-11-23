/**
 * What a lens is (SPEC-seeing-machine.md, "Lenses"): one file each, listed in `./registry.ts`, and nothing about one lens in another.
 * Switching is instant and needs no refetch. Pure.
 */
import type { ThemeTokens } from '../../ui/themes';
import type { FrameTools } from '../frame';
import type { LensId } from './names';

/** READER's papers: the theme's own, or the book reader's three. */
export const PAPERS = ['theme', 'light', 'dark', 'sepia'] as const;
export type Paper = (typeof PAPERS)[number];

export const TEXT_SIZES = [1, 2, 3, 4, 5, 6] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export type ReaderLook = { paper: Paper; size: TextSize };
export const READER_LOOK_AT_FIRST: ReaderLook = { paper: 'theme', size: 2 };

/** LOW-FI's palettes, from dyes the themes already have. */
export const PALETTES = ['theme', 'mono', 'terminal', 'amber', '1-bit'] as const;
export type Palette = (typeof PALETTES)[number];

/** CUSTOM's building blocks. A recipe is which of them are on: shared as a recipe, never as code. */
export const BLOCKS = [
  { id: 'words', label: 'WORDS ONLY' },
  { id: 'pictures', label: 'PICTURES ONLY' },
  { id: 'links', label: 'LINKS ONLY' },
  { id: 'invert', label: 'INVERT' },
  { id: 'mono', label: 'MONO' },
  { id: 'contrast', label: 'HIGH CONTRAST' },
  { id: 'recolour', label: 'YOUR THEME' },
  { id: 'nomenus', label: 'HIDE MENUS' },
  { id: 'noforms', label: 'HIDE FORMS' },
  { id: 'large', label: 'LARGE' },
] as const;
export type BlockId = (typeof BLOCKS)[number]['id'];

export type LensSettings = { reader: ReaderLook; palette: Palette; recipe: readonly BlockId[] };
export const SETTINGS_AT_FIRST: LensSettings = { reader: READER_LOOK_AT_FIRST, palette: 'theme', recipe: ['words', 'recolour'] };

/** A recipe as words people can send each other, and back. */
export const recipeText = (recipe: readonly BlockId[]): string => `SEE:${recipe.join('+')}`;
export function recipeFrom(text: string): BlockId[] | null {
  const said = /^\s*SEE:([a-z+]{0,200})\s*$/i.exec(text)?.[1];
  if (said === undefined) return null;
  const wanted = said.toLowerCase().split('+');
  return BLOCKS.map((block) => block.id).filter((id) => wanted.includes(id));
}

/** What a lens is told when it dresses a page: the theme that is on, as values, so a new theme needs no work here. */
export type LensLook = {
  tokens: ThemeTokens;
  scheme: 'light' | 'dark';
  /** The site's own face, as the page has it. */
  face: string;
  settings: LensSettings;
};

export type Lens = {
  id: LensId;
  /** The page as it was sent, or its reading form. */
  form: 'page' | 'reading';
  /** What is listed beside the page. */
  beside: 'watchers' | 'xray' | null;
  /** The stylesheet laid over the page; STANDARD lays none. */
  css(look: LensLook): string;
  /** What it needs done to the page itself. */
  tools?(look: LensLook): FrameTools;
  /** The site's own background shows through it. */
  clear?: true;
};
