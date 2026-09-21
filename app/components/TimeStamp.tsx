import { formatStamp } from '../lib/forum/format';

/**
 * A posting stamp, drawn in the retro link blue.
 *
 * Times used to be plain black on white, which buried them in the text around
 * them; the saturated blue is the colour the old web used to mark a thing you
 * can read more about, and it is the same blue the swatch offers usernames. The
 * text itself comes from `formatStamp` (UTC, no trailing `Z`), so the server and
 * the browser still agree to the byte.
 */
export const TIME_STAMP_CLASS = 'text-[#0000ff]';

type TimeStampProps = {
  /** The stored ISO instant; missing or blank prints as `--:--` rather than failing. */
  at: string | null | undefined;
  /** Extra classes for the surrounding row (size, weight). */
  className?: string;
};

export default function TimeStamp({ at, className }: TimeStampProps) {
  return (
    <span className={className === undefined ? TIME_STAMP_CLASS : `${TIME_STAMP_CLASS} ${className}`}>
      {formatStamp(at)}
    </span>
  );
}
