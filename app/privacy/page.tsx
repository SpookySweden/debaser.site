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
      'Your room is private until you press GO LIVE. If you share its link, people who join can see and hear what you play, see your queue and chat, until you remove them. REFRESH LINK stops the old link letting anyone new in.',
      'GO LIVE puts your room on the site’s lists, with a record on the board, until you press GO PRIVATE. If you leave while it is live with people in it, it becomes theirs.',
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
    heading: 'BROWSER, THE SEEING MACHINE',
    lines: [
      'BROWSER shows other websites in two ways. OWN EYE is your own browser, signed in as you, through the DEBASER extension: the page comes from your own connection, and nothing of the page itself is sent to the site unless you yourself switch on OWN WEB for OWN EYE (the next line). Its address and title go into your HISTORY, kept on your account like the rest of your history so it follows you to another device: they are stored on the site’s server, read by you alone, and CLEAR in HISTORY empties them. (A page OWN EYE showed before your account kept such pages stays in the browser that showed it, marked KEPT IN THIS BROWSER ONLY.)',
      'OWN WEB for OWN EYE is off for everybody until you turn it on yourself, in two presses on the extension’s own SITES page (KEEP OWN EYE’S PAGES), in each browser separately. While it is on, the words a reader can see on each page OWN EYE shows inside BROWSER, your mail included if you open it there, are sent from your browser to the site’s server and kept on your account, private, once a day for each address: the page’s address, title and words (at most 200,000 characters a page, 200 pages a day). Never what is typed in a box, a password, a hidden or one-time-code field, anything not shown on the page, a picture, a cookie or anything else your browser stores for that site. Never a page in an ordinary tab of your browser, and never a sign-in, bank or payment page on the extension’s never-list. A page that itself prints what you type somewhere else on the page reads as ordinary words and is kept with them. They are read by you alone; the site’s owner, who runs the server, and its backups hold them too. STOP KEEPING above the page switches it off at once, and OWN WEB deletes one page, one site or all of them.',
      'Four of BROWSER’s tools reach a page OWN EYE shows, each done by the extension in your own browser when you press its key: MEDIA lists the addresses and titles of the videos and sounds the page names, the WATCHERS lens the names of the outside hosts the page spoke to and how many times, SEARCH THIS takes the words you selected on the page (never words in a box you typed in) to the search engine you chose, and ERASE hides the part you press. What they find is handed to BROWSER’s page in your browser and is not stored by the site; the parts you erased are remembered in your browser only.',
      'The server’s eye fetches a page you ask for from the site’s server, on its owner’s home connection, never signed in: the website sees that connection, not yours. Nothing it fetches is kept, except a page you press KEEP PAGE for.',
      'For every account but the owner’s, the server’s eye writes down which site it opened (its name only, never the page or its address) and when. This record is kept with no end date and read only by the site’s owner, so that anything done from the house’s connection can be traced to an account. To see or have your lines removed, ask; it is done by hand.',
      'Your BROWSER history and open tabs are kept on your account, read by you alone, and cleared by one key. Notes you leave on a page are seen by people with an account who open it; a page you keep is seen by everyone, its full copy by people with an account.',
      'Words you search for go to the search engine you choose. In the server’s eye that engine sees the house’s connection; they are never stored by the site.',
    ],
  },
  {
    heading: 'THE DEBASER EXTENSION',
    lines: [
      'The extension acts only on sites you add to it, and on the tab you press its key on; or on every site, if you press ALLOW EVERY SITE on its own SITES page. That is off until you press it, your browser asks you first in its own box, and TAKE IT BACK undoes it. While it is on, a few lines of the extension run in every tab of your browser and stop at their first line, reading and sending nothing, unless the page is shown directly inside a debaser.site page or the extension’s own page. Inside a debaser.site page they ask that page one fixed question, whether theirs is the frame BROWSER made for OWN EYE, and say nothing more unless it answers yes; only in that one frame, and in the extension’s own page, do they tell the extension the page’s address and title, for BROWSER’s address box and the lenses. A video or other embed elsewhere on the site is never followed. Sign-in pages, banks and payments are never shown inside anything. A site you add by name is shown even when that means switching off its own script-safety rules (its Content-Security-Policy) while it is inside BROWSER or the extension’s page; ALLOW EVERY SITE alone never does that. It never reads your passwords or cookies.',
      'A page’s words are read only in that one frame, only for BROWSER’s own page on debaser.site, and only while KEEP OWN EYE’S PAGES is on in the extension: while it is off the extension hands a page’s words to nothing, whatever asks. debaser.site can switch it off for you (STOP KEEPING) and can never switch it on.',
      'It tells debaser.site its version, its settings, whether OWN WEB for OWN EYE is on, whether the page in front of you is on its list, and what you press to send; and, for the one frame BROWSER made, what MEDIA, WATCHERS, SEARCH THIS and ERASE find when you press them, and the page’s words while OWN WEB for OWN EYE is on. It never sends the list of sites you added.',
      'IMPORT FROM THIS BROWSER reads the sites your browser has been to in the last 30 days, by name, once, inside the extension, when you press it; the permission is given back straight after and nothing of it leaves your browser.',
      'If you choose its folder, new versions are written into it by the site, each file checked against the list the site was built with, and the browser asks you first.',
      'The bookmarks-bar key (DEBASER LENSES) is not the extension: it holds all of its own code, changes only the page you press it on, and tells debaser.site nothing. Only when you press TO DEBASER on a video does that video’s address open here, in your own browser.',
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
    lines: ['If what the site keeps changes, this page changes with it. Last changed 27 November 2026.'],
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
