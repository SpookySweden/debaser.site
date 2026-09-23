import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import { Suspense } from 'react';
import ArcadeWindow from './components/ArcadeWindow';
import AuthProvider from './components/AuthProvider';
import CommsNotifier from './components/CommsNotifier';
import CommsProvider from './components/CommsProvider';
import ForumProvider from './components/ForumProvider';
import MusicPlayer from './components/MusicPlayer';
import MusicPlayerProvider from './components/MusicPlayerProvider';
import NotificationsProvider from './components/NotificationsProvider';
import PresenceProvider from './components/PresenceProvider';
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
                    {/* The arcade is a window rather than a page: a post's `[ CHALLENGE ]`, the
                        header's key and the bell's invitation all open it over whatever the reader
                        was on (see ./components/ArcadeWindow.tsx). It reads the address, so it is
                        drawn behind a boundary: the layout stays static, the window catches up. */}
                    <Suspense fallback={null}>
                      <ArcadeWindow />
                    </Suspense>
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
