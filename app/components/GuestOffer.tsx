'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { PLATE_LINK } from '../lib/ui/controls';

/**
 * The offer: a line under the board's title inviting a visitor to make an account.
 *
 * It is the *offer* rather than the fault. `./GuestPrompt.tsx` is the alarm pinned across the top of
 * the viewport, in plain words, when somebody without an account tries to interact; this is the quiet
 * sentence beside the board that says what an account would add, and it is the one the board should
 * show first - the alarm is what happens if they ignore it.
 *
 * **Why it is a component rather than a paragraph in `app/forum/page.tsx`, which is where it used to
 * live.** That page is a server component, so it cannot read a session, and the line was plain text:
 * it told *everybody* to create an account, including the reader who was already signed in and had
 * one. That is the fault this file fixes - the offer now draws only while nobody is signed in.
 *
 * The guard is `status !== 'anonymous'` rather than `user === null`, written the long way round and
 * for a reason spelled out in `./AuthProvider.tsx`: while the session is still being read the status
 * is `loading` and `user` is null, so the short test would flash the offer at somebody who is signed
 * in - a fault that has already been fixed once in this codebase and must not come back here.
 * `./SidebarProfile.tsx` and `./GuestPrompt.tsx` make the same distinction, and
 * `Temp/check-shell.cjs` and `Temp/check-signin-banner.cjs` hold all three to it.
 */
export default function GuestOffer() {
  const { status } = useAuth();

  if (status !== 'anonymous') return null;

  return (
    <p className="mb-4 text-xs">
      Guests post as Anonymous.{' '}
      <Link href="/account" className={`${PLATE_LINK} text-[10px]`}>
        CREATE AN ACCOUNT OR LOG IN
      </Link>
      {' '}to sign your posts, unlock comms and keep your profile alive.
    </p>
  );
}
