'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import MarqueeText from './MarqueeText';

/**
 * The guest banner: the first thing under the title bar while nobody is signed in.
 *
 * It is drawn in the shell rather than on a page (see ./SiteWindow.tsx), so every screen a visitor
 * lands on says the same thing in the same place instead of the landing page being the only one
 * that mentions accounts. That matters here more than it would on another site: the board is the
 * front door and it *works* without an account, so the banner is not a gate - it is an offer, and it
 * has to be easy to walk past.
 *
 * The line crawls because a fixed banner is furniture a reader stops seeing by the second page.
 * The marquee measures first (see ./MarqueeText.tsx), so a line that fits on a wide screen sits
 * still; and the whole thing goes quiet under `prefers-reduced-motion`.
 */
export default function GuestPrompt() {
  const { status } = useAuth();

  if (status !== 'anonymous') return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale px-2 py-2 text-[10px] font-bold text-ink">
      {/* A glyph rather than a lamp: this is a sentence, and a blinking colon would imply it is
          waiting for something. */}
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
        ☻
      </span>

      <MarqueeText
        text="NOBODY IS SIGNED IN :: AN ACCOUNT SIGNS YOUR POSTS, KEEPS YOUR PROFILE ALIVE AND OPENS THE HIDDEN CHANNELS"
        className="min-w-0 flex-1"
        durationSeconds={22}
      />

      <Link
        href="/account"
        className="shrink-0 cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun px-2 py-[3px] text-[10px] font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun active:border-t-2 active:border-l-2 active:border-black active:border-r active:border-b active:border-white active:bg-bubble active:text-ink"
      >
        CREATE AN ACCOUNT OR LOG IN
      </Link>
    </div>
  );
}
