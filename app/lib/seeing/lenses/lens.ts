/**
 * What a lens is (SPEC-seeing-machine.md, "Lenses"): one file each, listed in `./registry.ts`, and nothing about one lens in another.
 * Switching is instant and needs no refetch. Pure.
 */
import type { ThemeTokens } from '../../ui/themes';
import type { LensId } from './names';

/** READER's papers: the theme's own, or the book reader's three. */
export const PAPERS = ['theme', 'light', 'dark', 'sepia'] as const;
export type Paper = (typeof PAPERS)[number];

export const TEXT_SIZES = [1, 2, 3, 4, 5, 6] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export type ReaderLook = { paper: Paper; size: TextSize };
export const READER_LOOK_AT_FIRST: ReaderLook = { paper: 'theme', size: 2 };

/** What a lens is told when it dresses a page: the theme that is on, as values, so a new theme needs no work here. */
export type LensLook = {
  tokens: ThemeTokens;
  scheme: 'light' | 'dark';
  /** The site's own face, as the page has it. */
  face: string;
  reader: ReaderLook;
};

export type Lens = {
  id: LensId;
  /** The page as it was sent, or its reading form. */
  form: 'page' | 'reading';
  /** What is listed beside the page. */
  beside: 'watchers' | null;
  /** The stylesheet laid over the page; STANDARD lays none. */
  css(look: LensLook): string;
};
