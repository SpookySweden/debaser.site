import type { Metadata } from 'next';
import PublicProfileWindow from '../../components/PublicProfileWindow';
import SiteWindow from '../../components/SiteWindow';

type ProfilePageProps = {
  params: Promise<{ userId: string }>;
};

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { userId } = await params;
  const id = decodeURIComponent(userId);

  return {
    title: `DEBASER.SITE - Profile ${id}`,
    description: 'Public profile: picture history, bio, tags given by other users and comments.',
  };
}

/**
 * The page a username or a picture opens from the board.
 *
 * Everything it shows comes from the profile store, so it is the same picture,
 * bio and visibility the owner set in the customiser. Guests reach it without
 * signing in; only the owner sees what is hidden.
 */
export default async function ProfilePage({ params }: ProfilePageProps) {
  const { userId } = await params;
  const id = decodeURIComponent(userId);

  return (
    <SiteWindow title="DEBASER_OS - v1.0 [PUBLIC PROFILE]" active="forum" status="Profile Viewer Active">
    <h1 className="text-xl font-bold mb-2">DEBASER.SITE // PUBLIC PROFILE</h1>
    <p className="text-xs mb-4">WHAT THIS ACCOUNT CHOSE TO SHOW.</p>

    <PublicProfileWindow userId={id} />
    </SiteWindow>
  );
}
