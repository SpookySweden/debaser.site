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
      Threads arrive from two places: the composer (opened with [+ NEW POST...] above), and the comment boxes
      on any asset or text box. A comment under an asset opens its thread automatically, and every post gets
      its badges from the copy. Guests post as Anonymous - an account signs your posts.
    </p>

    <ForumBoard />
    </SiteWindow>
  );
}
