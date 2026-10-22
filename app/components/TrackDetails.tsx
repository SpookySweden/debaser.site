'use client';

import Link from 'next/link';
import { formatClock } from '../lib/audio/format';
import { GLOBE } from '../lib/audio/loops';
import { uploaderIdFromSrc } from '../lib/audio/track-context';
import { DEFAULT_AVATAR_SRC } from '../lib/profile/avatar-catalogue';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import MarqueeText from './MarqueeText';
import ProfileAvatar from './ProfileAvatar';

/**
 * One track, described the same way everywhere it is described: who uploaded it, what it was heard as
 * part of, its name, and where you are in it out of its length.
 *
 *   [pfp]  SWEDEN'S QUEUE                       <- context, quiet; blank when there is none
 *          SONG V1                              <- the song, bold
 *          1:19 / 5:12   ⊕ THE QUEUES LIST      <- position out of length, and where it came from
 *
 * Used by RADI-OH's details strip (on the window's field) and by the player bar (on its black LED), so
 * the two read as one vocabulary. The three lines are always drawn - an empty context is a blank line,
 * not a missing one - so the block keeps its height whatever is in it and nothing beside it moves.
 */
export default function TrackDetails({
  src,
  context,
  title,
  position,
  length,
  tone,
  href,
  where,
  marquee = false,
  extra,
}: {
  /** The file's address, which names its uploader (`uploaderIdFromSrc`); null when nothing is loaded. */
  src: string | null;
  context: string;
  title: string;
  position: number;
  /** The full running time in seconds, or NaN when it is not known yet. */
  length: number;
  /** `field` on the window's own background, `led` on the player's black display. */
  tone: 'field' | 'led';
  href?: string;
  where?: string | null;
  /** Lets a long title scroll rather than cut off - the bar's habit. */
  marquee?: boolean;
  /** Anything else for the third line's end, e.g. the bar's play mark. */
  extra?: React.ReactNode;
}) {
  const ink =
    tone === 'led'
      ? { context: 'text-ink-bar', title: 'text-acid', clock: 'text-ink-bar', link: 'text-ink-bar hover:text-acid' }
      : { context: 'text-ink-quiet', title: 'text-ink', clock: 'text-ink', link: 'text-accent-ink hover:text-ink' };

  return (
    // A fixed height, so the block is the same size whatever it holds - a picture still loading, a blank
    // context line, a link or none - and nothing beside it moves when it changes.
    <div className={`flex min-w-0 items-center gap-2 overflow-hidden ${tone === 'led' ? 'h-[46px]' : 'h-[48px]'}`}>
      <UploaderPicture src={src} size={tone === 'led' ? 30 : 36} />

      <div className="min-w-0 flex-1 leading-tight">
        <p className={`truncate text-[13px] leading-[14px] font-bold ${ink.context}`}>{context.length === 0 ? <>&nbsp;</> : context}</p>

        {marquee ? (
          <MarqueeText className={`block text-[14px] font-bold ${ink.title}`} text={title} />
        ) : (
          <p className={`truncate text-[14px] font-bold ${ink.title}`} title={title}>
            {title}
          </p>
        )}

        <p className={`flex min-w-0 items-center gap-2 text-[13px] leading-[14px] ${ink.clock}`}>
          {extra}
          <span className="shrink-0 font-bold">
            {formatClock(Math.max(0, position))} / {Number.isFinite(length) ? formatClock(length) : '-:--'}
          </span>

          {href === undefined || where === undefined || where === null ? null : (
            <Link href={href} title={where} className={`min-w-0 truncate font-bold underline underline-offset-2 ${ink.link}`}>
              <span aria-hidden="true">{GLOBE}</span> {where}
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The uploader's picture, read from the file's own address. A file that came with the site has no
 * uploader and shows the site's default picture - deliberately the same "nobody chose one" picture a
 * person without a profile picture gets.
 */
function UploaderPicture({ src, size }: { src: string | null; size: number }) {
  const uploaderId = src === null ? null : uploaderIdFromSrc(src);
  const { profile, ready } = usePublicProfile(uploaderId);
  const name = uploaderId === null ? 'DEBASER.SITE' : ready ? profile.displayName : '...';

  const picture =
    uploaderId === null ? (
      <ProfileAvatar src={DEFAULT_AVATAR_SRC} displayName={name} size={size} variant="plain" hideVersionLabel />
    ) : (
      <ProfileAvatar
        version={currentAvatarVersion(profile)}
        displayName={name}
        size={size}
        variant="plain"
        hideVersionLabel
      />
    );

  if (uploaderId === null) {
    return (
      <span className="shrink-0" title="Came with the site">
        {picture}
      </span>
    );
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(uploaderId)}`}
      title={`Uploaded by ${name} - open their profile`}
      className="shrink-0"
    >
      {picture}
    </Link>
  );
}
