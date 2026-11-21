import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import ArcadeWindow from './components/ArcadeWindow';
import FloatingPlayer from './components/FloatingPlayer';
import ForYouRadio from './components/ForYouRadio';
import MusicRoomKeeper from './components/MusicRoomKeeper';
import SiteHistoryKeeper from './components/SiteHistoryKeeper';
import AccountSettingsKeeper from './components/AccountSettingsKeeper';
import AuthProvider from './components/AuthProvider';
import CharacterBrowserWindow from './components/CharacterBrowserWindow';
import CommsNotifier from './components/CommsNotifier';
import NotificationBalloon from './components/NotificationBalloon';
import CommsProvider from './components/CommsProvider';
import ForumProvider from './components/ForumProvider';
import MusicPlayer from './components/MusicPlayer';
import MusicLibraryProvider from './components/MusicLibraryProvider';
import MusicPlayerProvider from './components/MusicPlayerProvider';
import MusicWindow from './components/MusicWindow';
import QueueWindow from './components/QueueWindow';
import HistoryWindow from './components/HistoryWindow';
import DeskWindow from './components/DeskWindow';
import SearchWindow from './components/SearchWindow';
import PlayHistoryKeeper from './components/PlayHistoryKeeper';
import NotificationsProvider from './components/NotificationsProvider';
import LostAccountWindow from './components/LostAccountWindow';
import ModulesWindow from './components/ModulesWindow';
import PreferencesWindow from './components/PreferencesWindow';
import PrivacyFirstLook from './components/PrivacyFirstLook';
import FirstVisitTour from './components/FirstVisitTour';
import PresenceProvider from './components/PresenceProvider';
import { ModerationProvider } from './components/ModerationProvider';
import ReportWindow from './components/ReportWindow';
import ReportsWindow, { ReportsAddress } from './components/ReportsWindow';
import ScreenKeyGate from './components/ScreenKeyGate';
import ThemeHost from './components/ThemeHost';
import CatCursor from './components/CatCursor';
import Companion from './components/Companion';
import WatchWindow from './components/WatchWindow';
import LetterWindow from './components/LetterWindow';
import WindowLayoutHost from './components/WindowLayoutHost';
import { cursorBootScript } from './lib/ui/cursor-slot';
import { backdropBootScript } from './lib/ui/backdrop-slot';
import Aquarium from './components/Aquarium';
import Backdrops from './components/backdrops/Backdrops';
import BackdropThreads from './BackdropThreads';
import BackdropSettingsWindow, { BackdropKey } from './components/BackdropSettingsWindow';
import { siteFillBootScript } from './lib/ui/site-fill';
import { siteHiddenBootScript } from './lib/ui/site-hidden';
import CornerShelf from './components/CornerShelf';
import { themeBootScript } from './lib/ui/theme-slot';
import { FACE_VARIABLES } from './theme/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'DEBASER.SITE',
  description:
    "An archive of comic book lore and concept art, run like a Web 1.0 desktop: a board, an account directory, comms and the debaser project's shelves.",
};

/**
 * Phones get the desktop, zoomed out, like "Request desktop site" (Luke's decision,
 * 2026-11-02): a fixed 1280px layout width means every breakpoint sees a desktop screen.
 * `initialScale` is cleared because Next's default of 1 opens a phone zoomed in on the top-left
 * corner; without it the phone fits the whole 1280px to the screen.
 * The narrow layout stays in the code for the real phone design later; going back to it is
 * `width: 'device-width', initialScale: 1`.
 */
export const viewport: Viewport = {
  width: 1280,
  initialScale: undefined,
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
    <html lang="en" className={`${FACE_VARIABLES} h-full`}>
      {/* The theme, before the browser has anything to paint. It is generated from the theme library
          (`themeBootScript`), so the values cannot drift from the ones `ThemeHost` writes a moment
          later - and it exists because those writes land in a React effect, which is one painted frame
          too late: a reader who chose the dark theme saw a white flash first. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() + cursorBootScript() + backdropBootScript() + siteFillBootScript() + siteHiddenBootScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* The keyboard's first listener, for CONTROL of the PC from a room (SPEC-screens.md): first here, so it is first to hear. Draws nothing. */}
        <ScreenKeyGate />
        {/* The reader's theme, written onto <html> before anything else the client does. It draws
            nothing: a theme is CSS custom properties, not markup. */}
        <ThemeHost />
        {/* The CAT cursor, when it is the one chosen: draws nothing otherwise. */}
        <CatCursor />
        {/* The AQUARIUM background, fixed under everything while it is the chosen one (PREFERENCES, BACKGROUND). Outside the
            providers on purpose: nothing it shows depends on who is signed in, and nothing above it may make a layer of its own. */}
        <Aquarium />
        {/* ...and the simulated ones (SAND and the rest, SPEC-backgrounds.md), the same way: only the chosen one is drawn. */}
        {/* FLUID runs its world on a thread of its own where it can (PERF 1b): this tells the backgrounds how to start it. */}
        <BackdropThreads />
        <Backdrops />

        <AuthProvider>
          {/* Moderation (SPEC-moderation.md): moderator or not, banned or not, and whom the reader has blocked. */}
          <ModerationProvider>
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
                      {/* ...and a notification that arrives pops up as a balloon at the bottom right (SPEC-notifications.md). */}
                      <NotificationBalloon />
                      {/* ...and the player's bar sits over every page, docked to the bottom. */}
                      <MusicPlayer />
                      {/* The keys above it: [ ▲ ROOM ] and [ ▲ WINDOW ] (CornerShelf.tsx). */}
                      <CornerShelf />
                      {/* Your companion, walking the top edge of that bar (SPEC-companion.md); others' too, in a room. */}
                      <Companion />
                      {/* A music broadcast is a room now (SPEC-music-queues.md): the room window keeps it
                          going, and this opens yours again after a reload while it is public. PLAY FOR YOU
                          keeps topping up up-next from the shell, whatever window is open. */}
                      <MusicRoomKeeper />
                      {/* HISTORY's ears (SPEC-history.md): notes each play as the room you hear moves on. Draws nothing. */}
                      <PlayHistoryKeeper />
                      <ForYouRadio />
                      {/* The site's two utility windows, drawn once and docked beside whatever is
                          being read rather than being pages of their own: the arcade (a post's
                          `[ CHALLENGE ]`, the side panel's key or the bell) and the music window (the
                          MUSIC shelf, a post's plate, or a track's tag badge). They read the address,
                          so they are drawn behind a boundary: the layout stays static, the windows
                          catch up. Nothing here is inside the page, which is exactly why opening one
                          cannot re-render the board. */}
                      {/* Where the docked windows sit on a desktop - read from the account (or this browser,
                          for a guest), saved back, and kept on screen. Draws nothing; it comes before
                          the windows so the screen is measured before an address opens one. */}
                      <WindowLayoutHost />
                      <Suspense fallback={null}>
                        <ArcadeWindow />
                        <MusicWindow />
                        <QueueWindow />
                        {/* HISTORY (SPEC-history.md): the log of what you played, under QUEUE on the shelf. */}
                        <HistoryWindow />
                        {/* YOUR DESK and the one SEARCH box (SPEC-forum-v3.md): windows over the forum, from the top bar. */}
                        <DeskWindow />
                        <SearchWindow />
                        {/* The stream room (SPEC-watch-together.md): drawn here so a stream keeps
                            playing while the reader walks the site. */}
                        <WatchWindow />
                        {/* One letter (SPEC-letters.md), opened from a profile or `?letter=<id>`. */}
                        <LetterWindow />
                        {/* `?reports=1`, where a report alert on the bell leads, opens REPORTS for a moderator. */}
                        <ReportsAddress />
                      </Suspense>

                      {/* Preferences: the one window with no address, because a theme is a setting on
                          *this* browser and a link to somebody else's would promise a change it cannot
                          make. It is not behind the Suspense boundary with the other two, because it
                          reads no address and has nothing to catch up on. */}
                      <PreferencesWindow />

                      {/* The AQUARIUM window: every knob of the sea behind the site (SPEC-aquarium-settings.md), and the key
                          on the sea that opens it. Beside PREFERENCES, which holds its other key. */}
                      <BackdropSettingsWindow />
                      <BackdropKey />

                      {/* The MODULOS key's list: which modules appear on the bar, and their hover colours. */}
                      <ModulesWindow />

                      {/* Somebody back after the accounts were lost: a new password, then their profile. */}
                      <LostAccountWindow />

                      {/* The PRIVACY window, once per account (SPEC-privacy-phase-1.md). */}
                      <PrivacyFirstLook />

                      {/* FIRSTVISIT: the short tour of the desktop, for a first visit and a new account (`first-visit-tour.ts`). */}
                      <FirstVisitTour />

                      {/* Saved characters: also addressless, and for a stronger reason - a saved figure
                          is one account's own work in one browser, so there is nobody for a link to
                          name. It reads the character store, which is why it is drawn here rather than
                          inside the customiser: the shelf outlives the window that opened it. */}
                      <CharacterBrowserWindow />

                      {/* The one video playing (SPEC-floating-player.md): above every page, so it never reloads as
                          the reader walks the site. It sits over its row's box, or floats in a corner. */}
                      <FloatingPlayer />
                      {/* Your place on each page, for the arrows in the nav. Draws nothing. */}
                      <SiteHistoryKeeper />
                      {/* Settings that follow the account (SPEC-forum-v3.md, F1B): tells the sync who is signed in. Draws nothing. */}
                      <AccountSettingsKeeper />
                      {/* Moderation's two windows (SPEC-moderation.md): REPORT (anybody signed in) and REPORTS (moderators). */}
                      <ReportWindow />
                      <ReportsWindow />
                    </MusicLibraryProvider>
                  </MusicPlayerProvider>
                </NotificationsProvider>
              </CommsProvider>
            </ForumProvider>
          </PresenceProvider>
          </ModerationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
