import type { AvatarVersion } from '../lib/profile/types';
import { DEFAULT_AVATAR_SRC } from '../lib/profile/avatar-catalogue';
import { SPRITE_SLOT } from '../lib/ui/controls';
import SheetImage from './SheetImage';

type ProfileAvatarProps = {
  /** The profile's picture, or nothing for an account that has never chosen one. */
  version?: AvatarVersion;
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
  /**
   * A picture that is not a profile's: the site's own default, on a post the item opened rather
   * than a person (see `PostAuthorRow`'s `picture`). It takes the place of `version` - passing one
   * or the other is the whole choice - and there is no version strip under it, because nobody
   * versioned it.
   */
  src?: string;
};

/**
 * Frame shared by every "plain" avatar: the board rows want the picture itself,
 * not grey trim. Exported so a picture that is not a profile's - the site's
 * profile's - the site's default pfp - is framed exactly the same way.
 */
export const AVATAR_PLAIN_FRAME =
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-none border border-ink bg-paper';

/** A frame this wide has room for the notice; below it the frame is smaller than the words. */
const NOTICE_MIN_SIZE = 96;

/**
 * The anonymous placeholder: what an account without a drawing wears.
 *
 * The archive's `assets/profiles/avatar-default.png` is a hand-drawn file that has not been drawn
 * yet, and an account that has never chosen a picture is the *common* case here - every visitor
 * starts as one. Falling through to a broken image, or to the board's `[ ? ]`, would turn the most
 * common state on the site into an error message, so the anonymous case gets a dithered slot of its
 * own instead: the same dark field `SpriteSlot` leaves for a sprite, at the size the drawing will
 * be, saying in its title which file it is waiting for. Nothing is drawn in it and nothing needs to
 * be - it reads as "no drawing chosen", which is the truth, rather than as "something went wrong".
 *
 * It is a plain file *and* the site's own default, so it covers three cases at once: a guest, a
 * signed-in account that has not picked a picture, and a post credited to the item itself rather
 * than to a person (`app/lib/forum/site-author.ts`).
 */
function AnonymousSlot({ size, label }: { size: number; label: string }) {
  return (
    <span
      className={`${SPRITE_SLOT} inline-flex items-center justify-center align-middle`}
      style={{ width: size, height: size }}
      title={`${label} has no profile picture yet - ${DEFAULT_AVATAR_SRC} is not in the assets folder`}
      role="img"
      aria-label={`${label} anonymous placeholder avatar`}
    >
      {/* Only wide enough for the notice when the frame can hold it; a 26px title-bar square gets
          the bare field, which is what a 26px square of any 1998 desktop actually showed. */}
      {size < NOTICE_MIN_SIZE ? null : (
        <span aria-hidden="true" className="text-[9px] font-bold text-paper">
          NO PICTURE
        </span>
      )}
    </span>
  );
}

/**
 * A profile picture, framed like everything else on the site.
 *
 * The drawing itself is hand-drawn and dropped into `assets/` by hand, so this only frames it:
 * `SheetImage` shows the standard "[ ARTWORK FILE NOT FOUND ]" notice while a slot is still empty,
 * and an untouched profile shows the anonymous slot above rather than a broken image.
 */
export default function ProfileAvatar({
  version,
  displayName,
  size = 128,
  variant = 'framed',
  className,
  hideVersionLabel = false,
  src,
}: ProfileAvatarProps) {
  // Either a profile's picture or one the caller named, and neither means the anonymous slot.
  const picture = src ?? version?.src;
  const anonymous = picture === undefined;

  if (variant === 'plain') {
    return (
      <span className={`${AVATAR_PLAIN_FRAME} ${className ?? ''}`} style={{ width: size, height: size }}>
        {anonymous || picture === undefined ? (
          <AnonymousSlot size={size} label={displayName} />
        ) : (
          <SheetImage
            src={picture}
            alt={version === undefined ? `${displayName} picture` : `${displayName} profile picture v${version.version}`}
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
      className={`shrink-0 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-1 ${className ?? ''}`}
      style={{ width: size }}
    >
      {anonymous || picture === undefined ? (
        <AnonymousSlot size={size - 8} label={displayName} />
      ) : (
        <SheetImage
          src={picture}
          alt={version === undefined ? `${displayName} picture` : `${displayName} profile picture v${version.version}`}
          width={size}
          height={size}
          sizes={`${size}px`}
        />
      )}

      {anonymous || version === undefined || hideVersionLabel ? null : (
        <p className="mt-1 text-center text-[10px] font-bold text-ink">P{version.version}</p>
      )}
    </div>
  );
}


