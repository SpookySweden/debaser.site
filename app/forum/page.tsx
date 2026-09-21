import type { Metadata } from 'next';
import ForumBoard from '../components/ForumBoard';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Forum Board',
  description: 'Anonymous message board for Debaser lore, concept art and continuity threads.',
};

export default function Forum() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [FORUM BOARD]" active="forum" status="Message Board Active">
    <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // MESSAGE BOARD</h1>
    <p className="text-xs mb-4 leading-relaxed">
      Threads arrive from two places: the composer pop-up (opened with [+ NEW POST...] in the board panel
      above), and the comment boxes attached to any asset or text box on the site. A comment left under an
      asset opens its thread automatically, and every post gets its badges generated from the copy. Authors
      post as Anonymous until Supabase Auth is switched on.
    </p>

    <ForumBoard />
    </SiteWindow>
  );
}
