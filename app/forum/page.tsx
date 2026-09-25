import type { Metadata } from 'next';
import ForumBoard from '../components/ForumBoard';
import GuestOffer from '../components/GuestOffer';
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
 *
 * The offer to sign in is `./GuestOffer.tsx` rather than a paragraph here, and that is the fix for a
 * fault worth naming: this page used to carry the sentence "Guests post as Anonymous. CREATE AN
 * ACCOUNT OR LOG IN to sign your posts..." as **plain text**, with no idea who was reading it. So a
 * signed-in reader was told to create an account they already had, on every visit to the board, and
 * the page had no way to know better - a server component cannot read a session.
 *
 * It is now a small client component that draws only while nobody is signed in, using the same
 * `status !== 'anonymous'` guard as `./GuestPrompt.tsx` and for the same reason: `user` is null while
 * the session is still in flight, so the shorter test would flash the offer at somebody who is signed
 * in. The two are different things and both are wanted - this is the *offer* beside the board, and
 * `GuestPrompt` is the fault across the top of the viewport - but they answer the same question, so
 * they answer it the same way.
 */
export default function Forum() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [FORUM BOARD]" active="forum" status="Message Board Active">
    <h1 className="mb-2 text-xl font-bold">DEBASER.SITE // MESSAGE BOARD</h1>

    <GuestOffer />

    <ForumBoard />
    </SiteWindow>
  );
}
