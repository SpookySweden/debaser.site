import type { ForumAnchor, ForumPreview } from '../forum/types';

/**
 * Concept art manifest.
 *
 * The artwork itself is hand-drawn on a Kamvas tablet and dropped into the
 * project `assets/concepts/` folder by hand - the manifest only describes what
 * is on disk so the page and the comment windows can point at it.
 *
 * Every sheet owns a forum anchor, which is what makes each picture's comment
 * control pop open its own thread on the board.
 */
export type ConceptSheet = {
  /** File name stem; also the anchor id, so it must stay stable. */
  id: string;
  /** Window title bar text. */
  title: string;
  /** Alt text / caption for the sheet. */
  caption: string;
  /** Browser path, served out of the project `assets/` folder. */
  src: string;
  /** Intrinsic pixel size of the exported PNG (keep the art's aspect ratio). */
  width: number;
  height: number;
  anchor: ForumAnchor;
};

type ConceptSheetDefinition = {
  id: string;
  title: string;
  caption: string;
  src: string;
  width: number;
  height: number;
};

const SHEET_DEFINITIONS: ConceptSheetDefinition[] = [
  {
    id: 'concept-sheet-01',
    title: 'SHEET 01 // FIGURE STUDY',
    caption: 'Figure study, palette pass 1. Hand-drawn, Kamvas tablet.',
    src: '/assets/concepts/concept-sheet-01.png',
    width: 352,
    height: 366,
  },
];

/**
 * Each sheet owns its anchor, so its comments live on its own thread. The anchor
 * also carries the link back to /concepts and the artwork preview that hovering
 * that link shows.
 */
export const CONCEPT_SHEETS: ConceptSheet[] = SHEET_DEFINITIONS.map((sheet) => ({
  ...sheet,
  anchor: {
    kind: 'asset',
    id: sheet.id,
    label: sheet.title,
    href: '/concepts',
    preview: { src: sheet.src, alt: sheet.caption, width: sheet.width, height: sheet.height } satisfies ForumPreview,
  },
}));

export const CONCEPT_SHEET_ANCHORS: ForumAnchor[] = CONCEPT_SHEETS.map((sheet) => sheet.anchor);

/** Media that can be attached to a general forum post. */
export type ArchiveMedia = {
  id: string;
  label: string;
  preview: ForumPreview;
};

export const ARCHIVE_MEDIA: ArchiveMedia[] = SHEET_DEFINITIONS.map((sheet) => ({
  id: sheet.id,
  label: sheet.title,
  preview: { src: sheet.src, alt: sheet.caption, width: sheet.width, height: sheet.height },
}));
