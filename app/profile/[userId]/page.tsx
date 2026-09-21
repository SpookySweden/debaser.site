import type { Metadata } from 'next';
import PublicProfileWindow from '../../components/PublicProfileWindow';
import SiteNav from '../../components/SiteNav';

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
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [PUBLIC PROFILE]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="forum" />

        {/* Content Body - Public Profile */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // PUBLIC PROFILE</h1>
          <p className="text-xs mb-4 leading-relaxed">
            Everything here was chosen by the account owner in their customiser: the picture (with every earlier version
            kept on file), the bio, the tags other users gave them, and whether comments are open.
          </p>

          <PublicProfileWindow userId={id} />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Profile Viewer Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
