import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import AuthProvider from './components/AuthProvider';
import CommsNotifier from './components/CommsNotifier';
import CommsProvider from './components/CommsProvider';
import ForumProvider from './components/ForumProvider';
import MusicPlayer from './components/MusicPlayer';
import MusicPlayerProvider from './components/MusicPlayerProvider';
import NotificationsProvider from './components/NotificationsProvider';
import PresenceProvider from './components/PresenceProvider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'DEBASER.SITE',
  description:
    "An archive of comic book lore and concept art, run like a Web 1.0 desktop: a board, an account directory, comms and the debaser project's shelves.",
};

/**
 * One shell for the whole site: the stores and the audio element live here, above every
 * page, so walking from the board to a profile to the music shelf never interrupts a track,
 * an unread count or a notification. The chrome itself is `SiteWindow`, which each page
 * hands its content to.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <PresenceProvider>
            <ForumProvider>
              <CommsProvider>
                {/* Tags and replies: the bell in the side panel and the pop-up menu read this,
                    and the composers write to it when a post names somebody. */}
                <NotificationsProvider>
                  {/* The station: one audio element for the whole site, so a track keeps
                      playing while the reader moves from page to page. */}
                  <MusicPlayerProvider>
                    {children}
                    {/* Any page: a message that arrives pops up (desktop) or opens comms (mobile). */}
                    <CommsNotifier />
                    {/* ...and the player's bar sits over every page, docked to the bottom. */}
                    <MusicPlayer />
                  </MusicPlayerProvider>
                </NotificationsProvider>
              </CommsProvider>
            </ForumProvider>
          </PresenceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
