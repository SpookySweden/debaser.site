'use client';

import Link from 'next/link';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import GoogleSignInButton from './GoogleSignInButton';
import ProfileAvatar from './ProfileAvatar';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

const SMALL =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300';

/**
 * The side panel's top block: who is signed in.
 *
 * Signed out it is the way in - the account page's forms, and the Google button
 * beside them - because on a wide screen there is room to offer both without a
 * visitor having to go looking. Signed in it is the visitor's own card: picture,
 * name in its own colour, the lamp, and the two places it leads.
 */
export default function SidebarProfile() {
  const { user, status, usingMockAuth } = useAuth();
  const { profile } = usePublicProfile(user?.id ?? null);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>PROFILE</span>
        <span>[ {status === 'loading' ? 'READING...' : user === null ? 'GUEST' : 'SIGNED IN'} ]</span>
      </div>

      {user === null ? (
        <div className="space-y-2 p-2">
          <p className="text-[10px] font-bold text-black">
            {status === 'loading'
              ? 'READING THE LOCAL SESSION...'
              : 'NOBODY IS SIGNED IN. READING THE BOARD TAKES NO ACCOUNT - AN ACCOUNT IS WHAT SIGNS YOUR POSTS AND OPENS YOUR MESSAGES.'}
          </p>

          <Link href="/account" className={`${SMALL} w-full justify-center py-1`}>
            [ LOG IN OR CREATE AN ACCOUNT ]
          </Link>

          <GoogleSignInButton />
        </div>
      ) : (
        <div className="space-y-2 p-2">
          <div className="flex items-center gap-2">
            <ProfileAvatar
              version={currentAvatarVersion(profile)}
              displayName={user.displayName}
              size={56}
              hideVersionLabel
            />

            <div className="min-w-0 space-y-1 text-[10px] font-bold text-black">
              <p className="truncate">
                <ProfileName author={{ id: user.id, displayName: user.displayName }} />
              </p>
              <p className="text-gray-700">
                JOINED <TimeStamp at={user.createdAt} />
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Link href={`/profile/${encodeURIComponent(user.id)}`} className={SMALL}>
              [ PROFILE ]
            </Link>
            <Link href="/account" className={SMALL}>
              [ ACCOUNT ]
            </Link>
            <Link href="/comms" className={SMALL}>
              [ COMMS ]
            </Link>
          </div>

          {usingMockAuth ? (
            <p className="text-[10px] text-gray-700">ACCOUNTS HERE LIVE ONLY IN THIS BROWSER.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
