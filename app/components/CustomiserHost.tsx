'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import ProfileCustomiserWindow from './ProfileCustomiserWindow';

/**
 * Mounts the profile customiser for whoever is signed in.
 *
 * The full-page route uses this because the account id only exists in the
 * session; the account page already knows its own user and mounts the customiser
 * directly (as a pop-up).
 */
export default function CustomiserHost() {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return (
      <p className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-3 text-xs font-bold text-black">
        READING THE SESSION...
      </p>
    );
  }

  if (user === null) {
    return (
      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-3 text-xs font-bold text-black">
        <p>NO ACCOUNT IS SIGNED IN - THE CUSTOMISER WRITES TO YOUR OWN PROFILE ONLY.</p>
        <p className="mt-2">
          <Link href="/account" className="underline hover:bg-gray-300">
            [ CREATE AN ACCOUNT OR LOG IN ]
          </Link>
        </p>
      </div>
    );
  }

  return <ProfileCustomiserWindow userId={user.id} variant="inline" />;
}
