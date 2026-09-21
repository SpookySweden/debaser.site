import { CONCEPT_SHEETS } from '../concepts/sheets';

/**
 * The pictures a profile can wear.
 *
 * Artwork rule (see AGENTS.md): every drawing in this project is hand-drawn on the
 * Kamvas tablet and added by hand. Nothing here draws a picture and nothing
 * generates one - the catalogue only lists what is already on disk.
 *
 * Two sources, both offered by the account page's picture tab:
 *
 *   1. an upload: the file picked there and then;
 *   2. a drawing the site already holds (`SITE_PICTURES`), for somebody who would
 *      rather wear one of the archive's own pictures than find a file of their own.
 *
 * Profiles filed against the old fixed slots (`assets/profiles/avatar-slot-NN.png`)
 * keep working: a version stores whatever `src` it was filed with.
 */

/**
 * The house picture, used where a post belongs to the site rather than to a
 * person (see app/lib/forum/site-author.ts). Not offered in the picker, because
 * nobody picks it - square PNG, dropped in here by hand.
 */
export const DEFAULT_AVATAR_SRC = '/assets/profiles/avatar-default.png';

/** Where uploaded drawings are written, relative to the project root. */
export const AVATAR_UPLOAD_DIRECTORY = 'assets/profiles/uploads';

/** Uploads are PNGs/JPGs/GIFs/WebPs; anything bigger is refused. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** One drawing the site already holds, offered as a profile picture. */
export type SitePicture = {
  id: string;
  /** Shown beside the thumbnail. */
  label: string;
  /** Served by app/assets/[...path]/route.ts. */
  src: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * How far from square a drawing may be and still make a profile picture.
 *
 * The picker draws these at 1:1, so artwork exported close to it lands whole rather
 * than being cropped into a shape the artist did not draw. The concept sheet is
 * 352x366, which is inside this; a wide landscape sheet would not be, and simply
 * would not be offered.
 */
export const PROFILE_PICTURE_SLACK = 0.1;

/** The drawings already on the site whose shape suits a profile picture. */
export const SITE_PICTURES: SitePicture[] = CONCEPT_SHEETS.filter(
  (sheet) => Math.abs(sheet.width / sheet.height - 1) <= PROFILE_PICTURE_SLACK,
).map((sheet) => ({
  id: sheet.id,
  label: sheet.title,
  src: sheet.src,
  alt: sheet.caption,
  width: sheet.width,
  height: sheet.height,
}));
