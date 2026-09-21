import type { AvatarVersion } from '../lib/profile/types';
import SheetImage from './SheetImage';

type ProfileAvatarProps = {
  version: AvatarVersion | undefined;
  displayName: string;
  /** Rendered edge length in pixels. */
  size?: number;
  /**
   * 'framed' keeps the Win95 chrome (profile page); 'plain' is just the picture
   * with a hairline border, so board rows are not eaten by grey trim.
   */
  variant?: 'framed' | 'plain';
  className?: string;
  /** Hide the "V<n>" strip under the picture (used by the small inline avatars). */
  hideVersionLabel?: boolean;
};

/**
 * Frame shared by every "plain" avatar: the board rows want the picture itself,
 * not grey trim. Exported so a picture that is not a profile's - the site's
 * default pfp - is framed exactly the same way.
 */
export const AVATAR_PLAIN_FRAME =
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-none border border-black bg-white';

/**
 * A profile picture, framed like everything else on the site.
 *
 * The drawing itself is hand-drawn and dropped into `assets/` by hand, so this
 * only frames it: `SheetImage` shows the standard "[ ARTWORK FILE NOT FOUND ]"
 * notice while a slot is still empty, and an untouched profile shows a plain
 * "NO PICTURE" box instead of a broken image.
 */
export default function ProfileAvatar({
  version,
  displayName,
  size = 128,
  variant = 'framed',
  className,
  hideVersionLabel = false,
}: ProfileAvatarProps) {
  if (variant === 'plain') {
    return (
      <span
        className={`${AVATAR_PLAIN_FRAME} ${className ?? ''}`}
        style={{ width: size, height: size }}
      >
        {version === undefined ? (
          <span className="text-[9px] font-bold text-gray-700">?</span>
        ) : (
          <SheetImage
            src={version.src}
            alt={`${displayName} profile picture v${version.version}`}
            width={size}
            height={size}
            sizes={`${size}px`}
            compact
          />
        )}
      </span>
    );
  }

  return (
    <div
      className={`shrink-0 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-1 ${className ?? ''}`}
      style={{ width: size }}
    >
      {version === undefined ? (
        <div
          className="flex items-center justify-center rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#f0f0f0]"
          style={{ height: size - 10 }}
        >
          <span className="text-[10px] font-bold text-black">NO PICTURE</span>
        </div>
      ) : (
        <SheetImage
          src={version.src}
          alt={`${displayName} profile picture v${version.version}`}
          width={size}
          height={size}
          sizes={`${size}px`}
        />
      )}

      {version === undefined || hideVersionLabel ? null : (
        <p className="mt-1 text-center text-[10px] font-bold text-black">V{version.version}</p>
      )}
    </div>
  );
}
