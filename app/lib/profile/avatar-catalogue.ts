/**
 * The hand-drawn picture slots a profile can use.
 *
 * Artwork rule (see AGENTS.md): every drawing is hand-drawn on the Kamvas
 * tablet and added to the project by hand. These entries point at
 * `assets/profiles/avatar-slot-NN.png`; until a file exists the picker and the
 * profile window show the standard "[ ARTWORK FILE NOT FOUND ]" notice naming
 * the path (`SheetImage`), and nothing here generates a picture in code.
 *
 * The alternative is the upload control, which files the PNG the artist chose
 * into `assets/profiles/uploads/` through `POST /api/profile/avatar`.
 */

export type AvatarSlot = {
  id: string;
  /** Shown on the picker button. */
  label: string;
  /** Served by app/assets/[...path]/route.ts. */
  src: string;
  width: number;
  height: number;
};

export const AVATAR_SLOT_DIRECTORY = 'assets/profiles';

export const AVATAR_SLOTS: AvatarSlot[] = [
  { id: 'slot-01', label: 'SLOT 01 :: STATIC MASK', src: '/assets/profiles/avatar-slot-01.png', width: 256, height: 256 },
  { id: 'slot-02', label: 'SLOT 02 :: LOOPING EYES', src: '/assets/profiles/avatar-slot-02.png', width: 256, height: 256 },
  { id: 'slot-03', label: 'SLOT 03 :: GREY WARD', src: '/assets/profiles/avatar-slot-03.png', width: 256, height: 256 },
  { id: 'slot-04', label: 'SLOT 04 :: STATIC HANDS', src: '/assets/profiles/avatar-slot-04.png', width: 256, height: 256 },
  { id: 'slot-05', label: 'SLOT 05 :: PALE HOUR', src: '/assets/profiles/avatar-slot-05.png', width: 256, height: 256 },
  { id: 'slot-06', label: 'SLOT 06 :: UNFILED', src: '/assets/profiles/avatar-slot-06.png', width: 256, height: 256 },
];

/** Where uploaded drawings are written, relative to the project root. */
export const AVATAR_UPLOAD_DIRECTORY = 'assets/profiles/uploads';

/** Uploads are hand-drawn PNGs/JPGs/GIFs/WebPs; anything bigger is refused. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export function avatarSlot(id: string): AvatarSlot | undefined {
  return AVATAR_SLOTS.find((slot) => slot.id === id);
}

/** Slot paths and uploads are both served from the project assets folder. */
export function isLocalAvatarSrc(src: string): boolean {
  return src.startsWith('/assets/');
}
