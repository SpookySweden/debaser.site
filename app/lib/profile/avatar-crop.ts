import { SITE_ACCOUNT_ID } from '../auth/builtin-account';
import type { PublicProfile } from './types';

/**
 * How a profile picture is cut to the square it is shown in (Luke, 2026-10-30).
 *
 * Only the display is cut: the uploaded file is never touched, so turning the crop off brings the
 * whole drawing back. `x` and `y` are the CSS `object-position` percentages - 0 shows the left (top)
 * edge, 100 the right (bottom) - and only one of them ever matters for a given picture: `x` for a
 * wide one, `y` for a tall one. A square picture looks the same whatever they say.
 */
export type AvatarCrop = {
  /** Off shows the whole picture inside the square, with blank bars. */
  on: boolean;
  x: number;
  y: number;
};

/** Every account starts cropped to the middle. */
export const DEFAULT_AVATAR_CROP: AvatarCrop = { on: true, x: 50, y: 50 };

/** A position the store will keep: a whole percentage, 0 to 100. */
export function cropPosition(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 50;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** Whatever a store handed back, as a crop: anything missing or odd reads as the default. */
export function normalizeAvatarCrop(value: unknown): AvatarCrop {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_AVATAR_CROP };
  const row = value as Partial<AvatarCrop>;
  return { on: row.on !== false, x: cropPosition(row.x), y: cropPosition(row.y) };
}

/** A patch laid over what is stored, so moving the square never switches the crop off. */
export function mergeAvatarCrop(current: AvatarCrop, patch: Partial<AvatarCrop>): AvatarCrop {
  return normalizeAvatarCrop({ ...current, ...patch });
}

/**
 * The crop a profile's picture is drawn with, or `null` for "as it always was" - which is what the
 * site's own account (debaser.site) keeps: its picture is never cut.
 */
export function displayCrop(profile: Pick<PublicProfile, 'userId' | 'avatarCrop'> | null | undefined): AvatarCrop | null | undefined {
  if (profile === null || profile === undefined) return undefined;
  if (profile.userId === SITE_ACCOUNT_ID) return null;
  return profile.avatarCrop;
}

/**
 * The same for one picture in the history. The square was placed on the picture on display, so an
 * older drawing is cut to its own middle; the on/off choice holds for every picture.
 */
export function versionCrop(
  profile: Pick<PublicProfile, 'userId' | 'avatarCrop' | 'avatar'> | null | undefined,
  versionId: string | undefined,
): AvatarCrop | null | undefined {
  const crop = displayCrop(profile);
  if (crop === null || crop === undefined || versionId === profile?.avatar.currentVersionId) return crop;
  return { ...crop, x: DEFAULT_AVATAR_CROP.x, y: DEFAULT_AVATAR_CROP.y };
}
