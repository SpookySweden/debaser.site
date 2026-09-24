'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import {
  preferencesWindowState,
  subscribeToPreferencesWindow,
  togglePreferences,
} from '../lib/ui/preferences-window';
import { useAuth } from './AuthProvider';
import GoogleSignInButton from './GoogleSignInButton';
import ProfileAvatar from './ProfileAvatar';
import ProfileCustomiserWindow from './ProfileCustomiserWindow';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import { TITLE_BAR } from '../lib/ui/controls';

const SMALL =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice';

/** A control that sits on the title bar: small enough not to crowd it, and never a word. */
const TITLE_CONTROL =
  'cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-sun px-1 text-[10px] font-bold leading-none text-ink hover:bg-ena hover:text-sun';

/** One row of the settings menu. Full width, flat until the pointer is on it. */
const MENU_ROW =
  'block w-full cursor-pointer rounded-none border border-ink bg-paper px-2 py-[3px] text-left text-[10px] font-bold text-ink hover:bg-ice-pale';

/**
 * The side panel's top block: who is signed in.
 *
 * Signed out it is the way in - the account page's forms, and the Google button
 * beside them - because on a wide screen there is room to offer both without a
 * visitor having to go looking. Signed in it is the visitor's own card, and it
 * carries four things: their picture and their name, both of which open their
 * public profile; a pencil, which opens the customiser; the status they wrote;
 * and a cog, which opens the account's own menu.
 *
 * Two verbs, two controls, and the difference is deliberate. Pressing a name means
 * "show me this account" and pressing the pencil means "let me change mine", so a
 * reader who meant one of them does not get the other - which is what a single
 * control that guessed from the current page would do. The pencil and the cog are
 * the same shapes a desktop uses for exactly these two jobs, so they need no label.
 *
 * The three states are told apart by `status` rather than by `user === null`, and that distinction
 * is the whole point of this component. `user` is null while the session is still being read, so a
 * branch on it alone renders the *sign-in offer* to somebody who is already signed in - a log-in
 * button that flickers on the first paint and goes away, which reads as a bug even to a reader who
 * never notices why. `status` is the field that knows the difference between "nobody is signed in"
 * and "we have not finished asking", so while it is `loading` this draws neither card: it says it is
 * reading, and nothing else.
 */
export default function SidebarProfile() {
  const { user, status, usingMockAuth } = useAuth();
  const { profile } = usePublicProfile(user?.id ?? null);
  const [customising, setCustomising] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /*
    The preferences window's own state, read here for one reason only: the row's tick. The window
    itself is drawn by the shell, not by this component, so this subscribes to a slot rather than
    holding the state - which is what stops the menu and the window from being able to disagree.
  */
  const { open: preferencesOpen } = useSyncExternalStore(
    subscribeToPreferencesWindow,
    preferencesWindowState,
    preferencesWindowState,
  );

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className={TITLE_BAR}>
        <span>PROFILE</span>
        <span className="flex items-center gap-1">
          <span>[ {status === 'loading' ? 'READING...' : status === 'signed-in' ? 'SIGNED IN' : 'GUEST'} ]</span>

          {/* The cog. Only for somebody with a profile to set, because every row behind it is a thing
              an account does, and a guest has none of them. */}
          {status === 'signed-in' && user !== null ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
              aria-label="Profile settings"
              title="Profile settings"
              className={TITLE_CONTROL}
            >
              <span aria-hidden="true">⚙</span>
            </button>
          ) : null}
        </span>
      </div>

      {status === 'loading' ? (
        <p className="p-2 text-[10px] font-bold text-ink">READING THE LOCAL SESSION...</p>
      ) : status === 'signed-in' && user !== null ? (
        <div className="space-y-2 p-2">
          {/*
            The picture and the name are the door to the public profile, and the pencil beside them is
            the door to editing it. Two verbs, two controls, and the difference is the whole point:
            a reader clicking a name means "show me this account", and a reader clicking a pencil means
            "let me change mine". One control doing both would be a switch that depends on which page
            you happened to be standing on.
          */}
          <div className="flex items-start gap-2">
            <ProfileLink author={{ id: user.id, displayName: user.displayName }}>
              <ProfileAvatar
                version={currentAvatarVersion(profile)}
                displayName={user.displayName}
                size={56}
                hideVersionLabel
              />
            </ProfileLink>

            <div className="min-w-0 flex-1 space-y-1 text-[10px] font-bold text-ink">
              <p className="flex items-center gap-1">
                <ProfileLink author={{ id: user.id, displayName: user.displayName }} className="min-w-0 truncate">
                  <ProfileName author={{ id: user.id, displayName: user.displayName }} />
                </ProfileLink>

                <button
                  type="button"
                  onClick={() => setCustomising(true)}
                  aria-haspopup="dialog"
                  aria-label="Edit your public profile"
                  title="Edit your public profile"
                  className="shrink-0 cursor-pointer rounded-none border border-ink bg-paper px-[3px] leading-none text-ink hover:bg-ice"
                >
                  <span aria-hidden="true">✎</span>
                </button>
              </p>

              {/* What they wrote, not when they joined. A join date is a fact that never moves, so it
                  is the one line here that costs a reader attention without ever changing; a status is
                  the account's own words, which is what this row is for. Empty is a real state and it
                  says so rather than showing a blank. */}
              <p className="truncate" title={profile.status.length === 0 ? undefined : profile.status}>
                {profile.status.length === 0 ? (
                  'NO STATUS SET'
                ) : (
                  <>
                    STATUS: <span className="text-ink">{profile.status}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {settingsOpen ? (
            <div className="space-y-1 border-t border-ink pt-2" role="menu" aria-label="Profile settings">
              <Link href="/account" className={MENU_ROW} role="menuitem" onClick={() => setSettingsOpen(false)}>
                [ OPEN THE ACCOUNT PAGE ]
              </Link>

              {/*
                One row is now a real control and one is still a placeholder.
                The preferences row opens the settings window, which docks to the right-hand corner
                *over the board* rather than over this panel - so it is a toggle, because the row sits
                on the screen the window is drawn over and a second press should shut what the first
                opened. The same switch the shelf keys keep, and the tick says which state it is in
                before the press rather than after.

                No `aria-pressed`: a `menuitem` does not support it (eslint's jsx-a11y catches it), and
                the state is already in the accessible name through the `[ ON ]` / `[ ▶ ]` mark and the
                title, which is how every other switch on this site says which way it is.
              */}
              <button
                type="button"
                onClick={togglePreferences}
                aria-haspopup="dialog"
                title={preferencesOpen ? 'Close preferences' : 'Open preferences'}
                className={MENU_ROW}
                role="menuitem"
              >
                [ PREFERENCES ] {preferencesOpen ? '[ ON ]' : '[ ▶ ]'}
              </button>

              <button
                type="button"
                disabled
                title="Not built yet: what this will do is still being decided."
                className={`${MENU_ROW} cursor-not-allowed`}
                role="menuitem"
              >
                [ SESSION OPTIONS ] :: SOON
              </button>
            </div>
          ) : null}

          {usingMockAuth ? (
            <p className="text-[10px] text-ink">ACCOUNTS HERE LIVE ONLY IN THIS BROWSER.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 p-2">
          <p className="text-[10px] font-bold text-ink">
            NOBODY IS SIGNED IN. READING THE BOARD TAKES NO ACCOUNT - AN ACCOUNT IS WHAT SIGNS YOUR
            POSTS AND OPENS YOUR MESSAGES.
          </p>

          <Link href="/account" className={`${SMALL} w-full justify-center py-1`}>
            [ LOG IN OR CREATE AN ACCOUNT ]
          </Link>

          <GoogleSignInButton />
        </div>
      )}

      {/* The same pop-up the account page opens (`./AccountProfilePanel.tsx`), so there is one
          customiser rather than two that drift: this is the pencil's destination, not a second copy. */}
      {customising && user !== null ? (
        <ProfileCustomiserWindow userId={user.id} onClose={() => setCustomising(false)} />
      ) : null}
    </section>
  );
}
