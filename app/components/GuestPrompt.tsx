'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import MarqueeText from './MarqueeText';

/**
 * The guest fault: a fixed strip pinned across the top of the viewport while nobody is signed in.
 *
 * It used to be an offer - a pale panel under the title bar, easy to walk past, in the site's own
 * voice ("NOBODY IS SIGNED IN"). It is a fault now: `fixed`, so it does not scroll away; across the
 * full width, so it cannot be mistaken for part of the page; and wrapped in the one animation on this
 * site that is not decoration. `animate-alarm` steps the background between Emerald and Rose in whole
 * frames, and the label says ERROR rather than explaining politely, because that is what the brief
 * asked for and because a reader who is asked to sign in four times by an offer learns to ignore it.
 *
 * It sits at the **top** rather than the foot of the viewport, and that is a layout decision rather
 * than a stylistic one: the music player's bar and the taskbar are both `fixed` at the bottom
 * (`z-50`), and `pb-16` on the window in `./SiteWindow.tsx` reserves that strip. A banner at the foot
 * would have covered the player for every guest. At the top it covers the title bar, which is chrome
 * rather than content, and the fault is the first thing read.
 *
 * One thing keeps it from being hostile: it is `fixed` and opaque but *not* a scrim, so the board is
 * still readable and still scrollable behind it. A guest can read every thread without an account,
 * which is this site's actual position on accounts - the fault is about *interacting*, not reading.
 *
 * The ink on the words is Pure White, on a Black panel; the Emerald/Rose flash is the frame *around*
 * them rather than the field they sit on. That is forced by the arithmetic and worth writing down: the
 * two dyes have no common ink. Black is 9.35:1 on Emerald but 4.47:1 on Rose; Pure White is 4.70:1 on
 * Rose but 2.25:1 on Emerald. A strip whose field alternated would be unreadable for half of every
 * second whichever ink it used, so the thing that flashes is the part that carries no text.
 *
 * It is drawn only once the session has been read and came back empty. The guard is written the long
 * way round - `status !== 'anonymous'` rather than `user === null` - because `user` is null while the
 * session is still in flight, so the shorter test would flash a fault at somebody who is signed in.
 * `./SidebarProfile.tsx` makes the same distinction, and `Temp/check-shell.cjs` holds both to it.
 */
export default function GuestPrompt() {
  const { status } = useAuth();

  if (status !== 'anonymous') return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[95] flex flex-wrap items-center gap-2 border-b-2 border-black bg-acid px-1 py-1 animate-alarm"
    >
      {/* The words sit on Black, and the Emerald/Rose flash is the frame around them.
          This is not decoration: the two dyes you named have no common ink. Black is 9.35:1 on Emerald
          but 4.47:1 on Rose; Pure White is 4.70:1 on Rose but 2.25:1 on Emerald. So a strip whose
          *field* alternated could not be read for half of every second, whichever ink it used. The
          alarm is therefore the border, which carries no text, and the text is on the one surface that
          does not change. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 bg-ink px-2 py-1 text-[10px] font-bold text-paper">
        {/* A glyph rather than a lamp: this is a sentence, and a blinking colon would imply it is
            waiting for something. */}
        <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
          ☻
        </span>

        <MarqueeText
          text="ERROR: UNREGISTERED ENTITY. CREATE ACCOUNT OR LOG IN TO INTERACT."
          className="min-w-0 flex-1"
          durationSeconds={18}
        />

        <Link
          href="/account"
          className="shrink-0 cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-ink px-2 py-[3px] text-[10px] font-bold text-paper hover:bg-ena hover:text-sun active:border-t-2 active:border-l-2 active:border-black active:border-r active:border-b active:border-white"
        >
          [ CREATE ACCOUNT OR LOG IN ]
        </Link>
      </div>
    </div>
  );
}
