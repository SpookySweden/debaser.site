import type { Metadata } from 'next';
import SiteNav from '../components/SiteNav';
import UserDirectory from '../components/UserDirectory';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Users',
  description: 'Every account on the site with its online lamp: the house account first, as admin.',
};

export default function UsersPage() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [USERS]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="users" />

        {/* Content Body - User Directory */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // USER DIRECTORY</h1>
          <p className="text-xs mb-4 leading-relaxed">
            Every account the site knows about, with the lamp that says whether anybody is behind it: green
            while a tab is open, yellow for the hour after it closes, red once that has passed. debaser.site
            is listed first as the house account - it administers the archive and signs every post an item
            owns. Each name is drawn in the colour its account chose and opens that account&apos;s public
            profile, and while nobody has to sign in to read this page, an account is what sends a message.
          </p>

          <UserDirectory />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Directory Online</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
