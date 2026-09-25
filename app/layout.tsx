import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import { Suspense } from 'react';
import ArcadeWindow from './components/ArcadeWindow';
import BroadcastHeartbeat from './components/BroadcastHeartbeat';
import AuthProvider from './components/AuthProvider';
import CommsNotifier from './components/CommsNotifier';
import CommsProvider from './components/CommsProvider';
import ForumProvider from './components/ForumProvider';
import MusicPlayer from './components/MusicPlayer';
import MusicLibraryProvider from './components/MusicLibraryProvider';
import MusicPlayerProvider from './components/MusicPlayerProvider';
import MusicWindow from './components/MusicWindow';
import QueueWindow from './components/QueueWindow';
import NotificationsProvider from './components/NotificationsProvider';
import PreferencesWindow from './components/PreferencesWindow';
import PresenceProvider from './components/PresenceProvider';
import ThemeHost from './components/ThemeHost';
import './globals.css';

/**
 * The site's face: a pixel one, drawn on a grid, in the two weights the chrome needs.
 *
 * AGENTS.md asks for heavily pixelated monospace type, and this is the trade that gets it done
 * with one download: Silkscreen is a bitmap face with a *real* bold, which matters because every
 * label on this site is `font-bold` - a pixel face without one leaves the browser to fake the
 * weight, and a faked bold on a bitmap face is exactly the blur the face exists to avoid. The
 * fallbacks in `globals.css` (MS Sans Serif, Courier New) are the faces a desktop of this era
 * actually had, so a visitor the font never reaches still sees the right kind of window.
 */
const pixel = Silkscreen({
  variable: '--font-pixel',
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
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
 * hands its content to - title bar and taskbar included.
 *
 * Nothing here is antialiased, on purpose: a pixel face is drawn on a grid, and smoothing is
 * what smears it.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${pixel.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        {/* The reader's theme, written onto <html> before anything else the client does. It draws
            nothing: a theme is CSS custom properties, not markup. */}
        <ThemeHost />

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
                    {/* The reader's own music - what they liked, and the lists they made - read once
                        for whoever asks. Two screens need it: the personal library draws it, and the
                        archive's rows wear a heart from it, so a track can be liked without leaving
                        the shelf. It hangs here, inside AuthProvider, because the read is *per
                        account* and a guest has none. */}
                    <MusicLibraryProvider>
                      {children}
                      {/* Any page: a message that arrives pops up (desktop) or opens comms (mobile). */}
                      <CommsNotifier />
                      {/* ...and the player's bar sits over every page, docked to the bottom. */}
                      <MusicPlayer />
                      {/* A broadcast has to keep telling the database where it is, whether or not the
                          window that started it is open - so the heartbeat is drawn by the shell, next to
                          the player whose clock it reads, and not inside the queue window. */}
                      <BroadcastHeartbeat />
                      {/* The site's two utility windows, drawn once and docked beside whatever is
                          being read rather than being pages of their own: the arcade (a post's
                          `[ CHALLENGE ]`, the side panel's key or the bell) and the music window (the
                          MUSIC shelf, a post's plate, or a track's tag badge). They read the address,
                          so they are drawn behind a boundary: the layout stays static, the windows
                          catch up. Nothing here is inside the page, which is exactly why opening one
                          cannot re-render the board. */}
                      <Suspense fallback={null}>
                        <ArcadeWindow />
                        <MusicWindow />
                        <QueueWindow />
                      </Suspense>

                      {/* Preferences: the one window with no address, because a theme is a setting on
                          *this* browser and a link to somebody else's would promise a change it cannot
                          make. It is not behind the Suspense boundary with the other two, because it
                          reads no address and has nothing to catch up on. */}
                      <PreferencesWindow />
                    </MusicLibraryProvider>
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
