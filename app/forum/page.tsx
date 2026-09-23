import type { Metadata } from 'next';
import ForumBoard from '../components/ForumBoard';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Forum Board',
  description: 'Anonymous message board for Debaser lore, concept art and continuity threads.',
};

/**
 * The desktop.
 *
 * The board is where this site is read, and everything else it carries opens *from it* - the music
 * archive, the arcade, the account directory, the account's own control panel - through the header
 * and the Start menu, which is where a desktop keeps its windows. Each of those pages wears a
 * `[ X CLOSE ]` in its title bar back to here.
 */
export default function Forum() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [FORUM BOARD]" active="forum" status="Message Board Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // MESSAGE BOARD</h1>
    <p className="text-xs mb-4">Guests post as Anonymous - an account signs your posts.</p>

    <ForumBoard />
    </SiteWindow>
  );
}
