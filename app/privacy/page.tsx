import type { Metadata } from 'next';
import Link from 'next/link';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Privacy',
  description: 'What debaser.site keeps about you, why, for how long, and how to have it removed.',
};

/**
 * The privacy policy (Luke, 2026-11-14: Google needs one before its sign-in can be opened to everyone). Plain words about
 * what the site actually keeps, written from the code and the database as they are; change it when they change.
 */

const SECTIONS: { heading: string; lines: string[] }[] = [
  {
    heading: 'WHO RUNS THIS',
    lines: [
      'debaser.site is a personal, non-commercial website for the comic Debaser, run by its author. It has no adverts and sells nothing. Nothing about you is sold or shared for marketing.',
    ],
  },
  {
    heading: 'YOUR ACCOUNT',
    lines: [
      'To make an account the site keeps your email address, a password (stored only as a one-way scrambled form by our sign-in provider), and the name you choose.',
      'If you sign in with Google, or link a Google account, the site receives your Google email address, name and picture from Google. It never sees your Google password.',
    ],
  },
  {
    heading: 'WHAT YOU PUT ON THE SITE',
    lines: [
      'Whatever you post, comment, upload or make is kept so it can be shown: board posts and replies, profile pictures and tracks, songs, letters, recommendations, documents, highlights in books, characters, stream rooms and their chat.',
      'Private messages are kept so you and the person you wrote to can read them. Only the two of you can read them through the site.',
      'Things you mark private or share with named people are only shown to them. Public things can be seen by visitors.',
    ],
  },
  {
    heading: 'WHAT THE SITE NOTICES WHILE YOU USE IT',
    lines: [
      'Whether you are online, so others can see a status lamp. You can hide it in your privacy settings.',
      'Where you are in a book, so you can carry on reading on another device.',
      'Your room: what you are playing and your queue are saved to your account so they follow you between devices. Only you can read them; no other account can, the house account included.',
      'If you share your room’s link, people who join with it can see what you play and your queue until you remove them. REFRESH LINK stops the old link letting anyone new in.',
      'A picture added from outside the site is loaded from wherever it lives, only after you press SHOW, and that server then sees that your browser loaded it.',
      'Your private history: what you open, play and read, whether you finished a video or closed it within half a minute, and what you press on a result’s feedback key (NOT FOR ME, MORE LIKE THIS, SHOW LESS FROM THIS CHANNEL). It is used only to suggest things for you (FOR YOU). Only you can see it. It deletes itself after 90 days, and you can pause it, forget single items or erase it all on your account PRIVACY tab.',
      'Settings you choose, such as your theme and which pages are on your top bar.',
    ],
  },
  {
    heading: 'YOUR YOUTUBE (ONLY IF YOU LINK IT)',
    lines: [
      'If you press LINK YOUTUBE and agree on Google’s screen, the site reads, read-only: the channels you subscribe to, your liked videos and the day you liked each, your playlist names and which channels the videos in your playlists are from and when you added them, the newest videos of the channels that shows you still watch, and the topics YouTube files those channels under.',
      'It is used only to suggest things to you on this site. It never posts, changes or deletes anything on YouTube, and it never reads or stores counts.',
      'Google’s permission is never stored. Up to 50 channels that matter to you (subscribed or not, each with whether you subscribe and the day of your latest like or playlist add) and your topic words are kept on your account for at most 30 days, then deleted. Video lists and the days of your likes stay in your own browser for a week. UNLINK deletes it at once.',
      'The site’s use of information received from Google APIs keeps to the Google API Services User Data Policy, including its Limited Use requirements.',
      'To suggest videos from channels you do not subscribe to, the site asks YouTube what it shows next to a few videos you liked or played here. Only the video is asked about, from the site’s server: nothing about you or your account goes with it.',
      'IMPORT YOUTUBE HISTORY (only if you choose to): you can bring your own watch history file from Google Takeout. The file is read in your browser and never uploaded. Only a summary is kept on your account: up to 200 channel names, each with how much you watch it (1 to 5) and the month you last did, and up to 60 topic words. No videos, titles or times. Only you can see it. It deletes itself 12 months after the import, and REMOVE IMPORT or ERASE MY HISTORY deletes it at once.',
    ],
  },
  {
    heading: 'FILES YOU OPEN TO READ',
    lines: [
      'A PDF or EPUB you open from your own device is read in your browser and never uploaded. Only its fingerprint, the book it matches and your place in it are saved.',
    ],
  },
  {
    heading: 'COOKIES AND YOUR BROWSER',
    lines: [
      'The site keeps your sign-in and a few conveniences (which panels you left open, your view choices) in your browser’s own storage. There are no advertising or tracking cookies.',
    ],
  },
  {
    heading: 'OTHER SERVICES THE SITE USES',
    lines: [
      'Supabase stores the database, accounts and uploaded files. Vercel hosts the website. Google provides Google sign-in and YouTube reading.',
      'Videos, music and pictures from other platforms (such as YouTube, the Internet Archive or Bandcamp) are shown with those platforms’ own players and pictures, so those platforms may see that your browser loaded them, under their own privacy policies.',
    ],
  },
  {
    heading: 'DELETING YOUR THINGS OR YOUR ACCOUNT',
    lines: [
      'You can delete your own posts, comments, uploads, letters, documents and history from the site.',
      'To have your whole account and everything with it deleted, send a message on the site to the debaser.site account, or ask on the board. It will be done by hand.',
    ],
  },
  {
    heading: 'CHANGES',
    lines: ['If what the site keeps changes, this page changes with it. Last changed 14 November 2026.'],
  },
];

export default function PrivacyPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PRIVACY]" tip="What the site keeps about you, and how to remove it.">
      <h1 className="sr-only">DEBASER.SITE // PRIVACY POLICY</h1>
      <div className="title-line text-accent-ink">
        <span>PRIVACY POLICY</span>
      </div>
      <div className="space-y-4 p-3">
        {SECTIONS.map((section) => (
          <section key={section.heading} aria-labelledby={`privacy-${section.heading}`}>
            <h2 id={`privacy-${section.heading}`} className="text-label font-bold text-accent-ink">
              {section.heading}
            </h2>
            {section.lines.map((line) => (
              <p key={line} className="mt-1 text-prose leading-normal text-ink">
                {line}
              </p>
            ))}
          </section>
        ))}
        <p className="text-label font-bold text-ink">
          <Link href="/account" className="underline">
            YOUR PRIVACY SETTINGS
          </Link>
        </p>
      </div>
    </SiteWindow>
  );
}
