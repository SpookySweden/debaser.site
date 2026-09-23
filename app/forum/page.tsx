import type { Metadata } from 'next';
import Link from 'next/link';
import ForumBoard from '../components/ForumBoard';
import SiteWindow from '../components/SiteWindow';
import { PLATE_LINK } from '../lib/ui/controls';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Forum Board',
  description: 'Anonymous message board for Debaser lore, concept art and continuity threads.',
};

export default function Forum() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [FORUM BOARD]" active="forum" status="Message Board Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // MESSAGE BOARD</h1>
    {/* The desktop's shelf: one plate per window, and no paragraph explaining any of them. */}
    <p className="mb-3 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
      OPEN:
      <Link href="/music" className={PLATE_LINK}>
        [ MUSIC ]
      </Link>
      <Link href="/games" className={PLATE_LINK}>
        [ GAMES ]
      </Link>
      <Link href="/users" className={PLATE_LINK}>
        [ USERS ]
      </Link>
      <Link href="/comms" className={PLATE_LINK}>
        [ COMMS ]
      </Link>
      <Link href="/account" className={PLATE_LINK}>
        [ CONTROL PANEL ]
      </Link>
    </p>

    <p className="text-xs mb-4">Guests post as Anonymous - an account signs your posts.</p>

    <ForumBoard />
    </SiteWindow>
  );
}
