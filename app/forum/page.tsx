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
 * `[ × ]` in its title bar back to here.
 *
 * A guest is asked to sign in once per screen, by the banner across the top (`./GuestPrompt.tsx`). The
 * board used to add a second offer under its heading (`GuestOffer`), and the side panel a third; both
 * went with SPEC-efficiency.md (2026-10-23), along with the big `DEBASER.SITE // MESSAGE BOARD`
 * heading, which is kept for screen readers only - the window's title already names the page.
 */
export default function Forum() {
  return (
    <SiteWindow
      title="DEBASER_OS - v1.0 [FORUM BOARD]"
      active="forum"
      tip="The board: anonymous posting, open to everybody. Guests post as Anonymous; an account signs your posts."
    >
    <h1 className="sr-only">DEBASER.SITE // MESSAGE BOARD</h1>

    <ForumBoard />
    </SiteWindow>
  );
}
